"""Offline tests for haventory services layer.

Scenarios:
- item_create validates and creates an item; logs context on success
- item_update applies update and logs validation errors without stack trace
- location_create and update wire through to repository
- the service catalog agrees across registration, `services.yaml` and `strings.json`
"""

from __future__ import annotations

import inspect
import json
from datetime import date
from pathlib import Path

import pytest
import voluptuous as vol
import yaml
from custom_components.haventory import events as events_mod
from custom_components.haventory import media as media_mod
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import EVENT_ITEM_CHANGED
from custom_components.haventory.exceptions import (
    ConflictError,
    NotFoundError,
    StorageError,
    ValidationError,
)
from custom_components.haventory.models import AttachmentMeta, iso_utc_now, new_uuid4
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.util import dt as dt_util

from runtime_helpers import install_runtime, repo_of, runtime_of


@pytest.mark.asyncio
async def test_item_create_and_update_flow_logs_and_mutates() -> None:
    """Create an item, then update it; ensure repo state changes and no exceptions bubble."""

    hass = HomeAssistant()
    install_runtime(hass)

    # Create
    await services_mod.service_item_create(
        hass,
        {
            "name": "Widget",
            "quantity": 2,
            "tags": ["Blue", "blue"],  # dedup/normalize handled by model
        },
    )

    repo: Repository = repo_of(hass)
    assert repo.get_counts()["items_total"] == 1

    # Update name and quantity
    item_id = str(repo.list_items()["items"][0].id)
    updated_quantity = 3
    await services_mod.service_item_update(
        hass, {"item_id": item_id, "name": "Widget Pro", "quantity": updated_quantity}
    )

    updated = repo.get_item(item_id)
    assert updated.name == "Widget Pro"
    assert updated.quantity == updated_quantity


@pytest.mark.asyncio
async def test_item_update_refuses_a_bad_inspection_date_by_its_own_name() -> None:
    """An action is typed by hand, and the refusal is all the author is shown."""

    hass = HomeAssistant()
    install_runtime(hass)
    await services_mod.service_item_create(hass, {"name": "Boiler"})
    repo: Repository = repo_of(hass)
    item_id = str(repo.list_items()["items"][0].id)

    with pytest.raises(ValidationError) as refusal:
        await services_mod.service_item_update(
            hass, {"item_id": item_id, "inspection_date": "2026-02-30"}
        )

    assert str(refusal.value) == "inspection_date must be a valid calendar date (YYYY-MM-DD)"
    assert repo.get_item(item_id).inspection_date is None


@pytest.mark.asyncio
async def test_item_move_and_quantity_helpers() -> None:
    """Move item between locations and adjust quantities via helpers."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)

    # Create locations and item
    await services_mod.service_location_create(hass, {"name": "Garage"})
    loc_id = str(next(repo.iter_locations()).id)
    # Update location name via service
    await services_mod.service_location_update(hass, {"location_id": loc_id, "name": "Garage2"})
    assert repo.get_location(loc_id).name == "Garage2"
    await services_mod.service_item_create(
        hass, {"name": "Box", "quantity": 1, "location_id": loc_id}
    )
    item_id = str(repo.list_items()["items"][0].id)

    # Move to root
    await services_mod.service_item_move(hass, {"item_id": item_id, "new_location_id": None})
    assert repo.get_item(item_id).location_id is None

    # Adjust and set
    target_quantity = 5
    await services_mod.service_item_set_quantity(
        hass, {"item_id": item_id, "quantity": target_quantity}
    )
    assert repo.get_item(item_id).quantity == target_quantity
    await services_mod.service_item_check_in(hass, {"item_id": item_id})
    await services_mod.service_item_check_out(hass, {"item_id": item_id, "due_date": "2030-01-01"})
    assert repo.get_item(item_id).checked_out is True

    # Delete
    await services_mod.service_item_delete(hass, {"item_id": item_id})
    assert repo.get_counts()["items_total"] == 0


@pytest.mark.asyncio
async def test_services_persist_after_mutations(monkeypatch) -> None:
    """Service handlers should call DomainStore.async_save after changes."""

    hass = HomeAssistant()
    install_runtime(hass)
    store = DomainStore(hass)
    runtime_of(hass).store = store

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1
        assert isinstance(payload, dict) and "items" in payload and "locations" in payload

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Create item + location
    await services_mod.service_item_create(hass, {"name": "Widget"})
    await services_mod.service_location_create(hass, {"name": "Root"})
    MIN_PERSISTS_AFTER_CREATE = 2
    assert calls["count"] >= MIN_PERSISTS_AFTER_CREATE

    # Also ensure delete persists
    repo: Repository = repo_of(hass)
    loc_id = str(next(repo.iter_locations()).id)
    await services_mod.service_location_delete(hass, {"location_id": loc_id})
    MIN_PERSISTS_AFTER_DELETE = 3
    assert calls["count"] >= MIN_PERSISTS_AFTER_DELETE


@pytest.mark.asyncio
async def test_service_registration_and_schema_errors(monkeypatch, caplog) -> None:
    """Services register and schema errors are logged without raising."""

    hass = HomeAssistant()

    # Wire repository and store
    install_runtime(hass)

    services_mod.setup(hass)
    # Ensure all expected services are registered
    names = {name for (_d, name, _h, _s, _r) in hass.services.registered}
    assert {
        "item_create",
        "item_update",
        "item_delete",
        "item_move",
        "item_adjust_quantity",
        "item_set_quantity",
        "item_check_out",
        "item_check_in",
        "location_create",
        "location_update",
        "location_delete",
    }.issubset(names)

    # OPTIONAL on every service: a caller passing `response_variable` gets the
    # entity back, and one that omits it is unaffected. ONLY would break every
    # existing automation that calls these without asking for a response.
    assert {r for (_d, _n, _h, _s, r) in hass.services.registered} == {SupportsResponse.OPTIONAL}

    # Home Assistant classifies each handler with HassJob and dispatches anything
    # that is neither a coroutine function nor a @callback to the executor, where
    # a handler that merely returns a coroutine is never awaited. Registering an
    # `async def` is what keeps the service from silently doing nothing; the
    # end-to-end proof lives in tests/integration/test_services.py.
    not_awaitable = [
        name
        for (_d, name, h, _s, _r) in hass.services.registered
        if not inspect.iscoroutinefunction(h)
    ]
    assert not not_awaitable

    # Grab a handler and feed invalid payload to trigger vol.Invalid
    caplog.clear()
    caplog.set_level("WARNING")
    # Find item_update handler
    _domain, _name, handler, _schema, _response = next(
        r for r in hass.services.registered if r[1] == "item_update"
    )

    class _Call:
        def __init__(self, data):
            self.data = data

    # Missing required item_id should fail schema and bubble up
    with pytest.raises(vol.Invalid):
        await handler(_Call({}))
    # Assert an error log from our boundary with op context
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)


@pytest.mark.asyncio
async def test_repository_exceptions_are_logged(monkeypatch, caplog) -> None:
    """Repository exceptions surface as logs with context and do not crash."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)

    # Create one item to operate on
    await services_mod.service_item_create(hass, {"name": "Widget"})
    item_id = str(repo.list_items()["items"][0].id)

    # Force NotFoundError: delete then try update
    await services_mod.service_item_delete(hass, {"item_id": item_id})
    caplog.clear()
    caplog.set_level("WARNING")
    with pytest.raises(NotFoundError):
        await services_mod.service_item_update(hass, {"item_id": item_id, "name": "Nope"})
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)

    # Force ConflictError via expected_version mismatch
    await services_mod.service_item_create(hass, {"name": "Widget2"})
    item_id2 = str(repo.list_items()["items"][0].id)
    caplog.clear()
    with pytest.raises(ConflictError):
        await services_mod.service_item_update(
            hass, {"item_id": item_id2, "expected_version": 999, "name": "Boom"}
        )
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)

    # Simulate storage failure during persist
    caplog.clear()

    # Monkeypatch helper to raise StorageError at boundary
    async def _persist(_hass):  # type: ignore[no-untyped-def]
        raise StorageError("persist failed")

    monkeypatch.setattr(services_mod, "async_persist_repo", _persist)
    with pytest.raises(StorageError):
        await services_mod.service_location_create(hass, {"name": "Root"})
    assert any(getattr(r, "op", None) == "location_create" for r in caplog.records)


def test_service_catalog_agrees_across_registration_yaml_and_strings() -> None:
    """Every registered service, and every field it takes, is declared and translated.

    Home Assistant renders a service in the UI from three files that nothing
    joins up: `services.py` registers it and types what it accepts,
    `services.yaml` declares the fields and their selectors, and `strings.json`
    supplies every piece of text the frontend shows. A service or a field added
    to one file and not the others still works over the API, so the gap surfaces
    as a bare key in Developer Tools → Actions rather than as a failure.

    `services.yaml` carries no text of its own. Home Assistant falls back to it
    where a translation is missing, so a name left there would render for every
    language instead of the one it was written in, and it is the one place
    user-facing text would sit outside `strings.json`.
    """

    package = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    registered = {name: schema for name, _handler, schema in services_mod.SERVICES}
    documented = yaml.safe_load((package / "services.yaml").read_text(encoding="utf-8"))
    translated = json.loads((package / "strings.json").read_text(encoding="utf-8"))["services"]

    assert set(documented) == set(registered), "services.yaml and the SERVICES table disagree"
    assert set(translated) == set(registered), "strings.json and the SERVICES table disagree"

    for service, schema in registered.items():
        accepted = {str(marker) for marker in schema.schema}
        declared = documented[service]["fields"]
        entry = translated[service]

        assert set(documented[service]) == {"fields"}, (
            f"services.yaml's {service} carries text that belongs in strings.json"
        )
        assert set(declared) == accepted, (
            f"services.yaml and the schema disagree about {service}'s fields"
        )
        for field, spec in declared.items():
            assert {"name", "description"}.isdisjoint(spec), (
                f"services.yaml's {service}.{field} carries text that belongs in strings.json"
            )

        assert entry.keys() == {"name", "description", "fields"}, service
        assert set(entry["fields"]) == accepted, (
            f"strings.json and the schema disagree about {service}'s fields"
        )
        for field, text in entry["fields"].items():
            assert text.keys() == {"name", "description"}, f"{service}.{field}"
            assert all(value.strip() for value in text.values()), f"{service}.{field}"


def test_every_service_field_carries_an_example_and_one_selector_per_name() -> None:
    """Developer Tools → Actions builds its form field by field out of the yaml.

    Two gaps this closes. A field with no `example` gives the author an empty
    box and no hint of the shape it takes. And a field name declared one way on
    one service and another way on the next renders the same value two ways —
    `tags` was `text:` on `item_create` and `object:` on `item_update`, so the
    create form offered a single-line box for a value both schemas take as a
    list.
    """

    package = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    documented = yaml.safe_load((package / "services.yaml").read_text(encoding="utf-8"))

    seen: dict[str, tuple[str, object]] = {}
    for service, spec in documented.items():
        for field, declared in spec["fields"].items():
            assert "example" in declared, f"services.yaml's {service}.{field} shows no example"
            first_service, first_selector = seen.setdefault(field, (service, declared["selector"]))
            assert declared["selector"] == first_selector, (
                f"{service}.{field} and {first_service}.{field} declare different selectors"
            )


def test_every_service_names_the_fields_its_refusal_logs() -> None:
    """The log context is per service, so the table has to cover every one.

    A service missing from it would raise inside the handler's own `except`, and
    an operator would get a traceback about logging instead of the refusal.
    """

    registered = {name for name, _handler, _schema in services_mod.SERVICES}
    assert set(services_mod._CONTEXT_FIELDS) == registered


@pytest.mark.asyncio
async def test_a_refusal_logs_the_fields_its_own_service_names(caplog) -> None:
    """`item_move` names the location it was asked for; `item_create` the name."""

    hass = HomeAssistant()
    install_runtime(hass)
    caplog.set_level("WARNING")

    with pytest.raises(NotFoundError):
        await services_mod.service_item_move(
            hass, {"item_id": "00000000-0000-4000-8000-000000000000", "new_location_id": "shelf-9"}
        )

    refusal = next(r for r in caplog.records if getattr(r, "op", None) == "item_move")
    assert refusal.new_location_id == "shelf-9"
    assert refusal.item_id == "00000000-0000-4000-8000-000000000000"

    caplog.clear()
    with pytest.raises(ValidationError):
        await services_mod.service_item_create(hass, {"name": "   "})

    # `item_name`, not `name`: `name` is a reserved LogRecord key.
    refusal = next(r for r in caplog.records if getattr(r, "op", None) == "item_create")
    assert refusal.item_name == "   "


# -----------------------------
# Service responses
# -----------------------------


async def _seeded(hass: HomeAssistant) -> tuple[Repository, str, str]:
    """A repository holding one location and one item inside it."""

    install_runtime(hass)
    loc = await services_mod.service_location_create(hass, {"name": "Shelf"})
    item = await services_mod.service_item_create(
        hass, {"name": "Widget", "quantity": 5, "location_id": loc["location"]["id"]}
    )
    return repo_of(hass), item["item"]["id"], loc["location"]["id"]


@pytest.mark.asyncio
async def test_every_service_answers_with_the_canonical_envelope() -> None:
    """Every service hands back the entity it touched.

    The keys are the ones `docs/data_shapes.md` specifies for the WebSocket
    surface, so a script's `response_variable` and a card's WS result are the
    same dict. Returning the whole entity rather than a bare id is what makes
    chaining work: the next call needs `version` for its `expected_version`.
    """

    hass = HomeAssistant()
    repo, item_id, loc_id = await _seeded(hass)

    item_calls = [
        (services_mod.service_item_update, {"item_id": item_id, "name": "Widget Pro"}),
        (services_mod.service_item_move, {"item_id": item_id, "new_location_id": None}),
        (services_mod.service_item_adjust_quantity, {"item_id": item_id, "delta": -1}),
        (services_mod.service_item_set_quantity, {"item_id": item_id, "quantity": 7}),
        (services_mod.service_item_check_out, {"item_id": item_id, "due_date": "2030-01-01"}),
        (services_mod.service_item_check_in, {"item_id": item_id}),
        (
            services_mod.service_item_update,
            {
                "item_id": item_id,
                "reminder_date": "2026-09-01",
                "reminder_interval": {"unit": "months", "count": 3},
            },
        ),
        (services_mod.service_reminder_bump, {"item_id": item_id}),
    ]
    for handler, payload in item_calls:
        response = await handler(hass, payload)
        assert set(response) == {"item"}, handler.__name__
        assert response["item"]["id"] == item_id, handler.__name__
        assert response["item"]["version"] == repo.get_item(item_id).version, handler.__name__

    updated_location = await services_mod.service_location_update(
        hass, {"location_id": loc_id, "name": "Top shelf"}
    )
    assert set(updated_location) == {"location"}
    assert updated_location["location"]["name"] == "Top shelf"

    # The two deletes answer with the body they removed, read before the delete.
    removed_item = await services_mod.service_item_delete(hass, {"item_id": item_id})
    assert removed_item["item"]["id"] == item_id
    removed_location = await services_mod.service_location_delete(hass, {"location_id": loc_id})
    assert removed_location["location"]["id"] == loc_id
    assert repo.get_counts()["items_total"] == 0
    assert repo.get_counts()["locations_total"] == 0


@pytest.mark.asyncio
async def test_item_create_response_survives_json_serialization() -> None:
    """Home Assistant puts the response on the wire; an unserializable one fails there.

    Called directly, a response carrying a `uuid.UUID` or a `date` looks fine —
    the failure only surfaces once HA hands it to a websocket or REST caller.
    """

    hass = HomeAssistant()
    install_runtime(hass)

    response = await services_mod.service_item_create(
        hass,
        {
            "name": "Widget",
            "quantity": 2,
            "tags": ["blue"],
            "checked_out": True,
            "due_date": "2030-01-01",
            "inspection_date": "2031-06-30",
            "custom_fields": {"sku": "A-1", "count": 3, "fragile": True},
        },
    )

    assert json.loads(json.dumps(response)) == response


@pytest.mark.asyncio
async def test_delete_answers_once_and_then_raises_not_found() -> None:
    """A second delete of the same id is an error, not an empty envelope."""

    hass = HomeAssistant()
    _repo, item_id, _loc_id = await _seeded(hass)

    first = await services_mod.service_item_delete(hass, {"item_id": item_id})
    assert first["item"]["id"] == item_id
    with pytest.raises(NotFoundError):
        await services_mod.service_item_delete(hass, {"item_id": item_id})


@pytest.mark.asyncio
async def test_every_item_service_reaches_the_bus() -> None:
    """A service mutation fires the same bus event its WebSocket twin does.

    `services.py` imports no `ws` module, so before this it emitted nothing at
    all: `haventory.item_create` left every sensor stale and triggered no
    automation.
    """

    hass = HomeAssistant()
    _repo, item_id, _loc_id = await _seeded(hass)

    calls = [
        (services_mod.service_item_update, {"item_id": item_id, "name": "Widget Pro"}, "updated"),
        (
            services_mod.service_item_move,
            {"item_id": item_id, "new_location_id": None},
            "moved",
        ),
        (
            services_mod.service_item_adjust_quantity,
            {"item_id": item_id, "delta": -1},
            "quantity_changed",
        ),
        (
            services_mod.service_item_set_quantity,
            {"item_id": item_id, "quantity": 7},
            "quantity_changed",
        ),
        (
            services_mod.service_item_check_out,
            {"item_id": item_id, "due_date": "2030-01-01"},
            "checked_out",
        ),
        (services_mod.service_item_check_in, {"item_id": item_id}, "checked_in"),
        (services_mod.service_item_delete, {"item_id": item_id}, "deleted"),
    ]
    for handler, payload, _action in calls:
        await handler(hass, payload)

    fired = hass.bus.events_of(EVENT_ITEM_CHANGED)
    # The seed created one item and one location; the location fires nothing.
    assert [e["action"] for e in fired] == ["created", *(action for _h, _p, action in calls)]
    assert {e["item_id"] for e in fired} == {item_id}


@pytest.mark.asyncio
async def test_a_failed_service_fires_no_event() -> None:
    """The event follows the durable write, so a rejected call announces nothing."""

    hass = HomeAssistant()
    install_runtime(hass)

    with pytest.raises(NotFoundError):
        await services_mod.service_item_update(hass, {"item_id": "nope", "name": "Ghost"})

    assert hass.bus.fired == []


@pytest.mark.asyncio
async def test_a_failed_persist_answers_nothing(monkeypatch) -> None:
    """The response is produced after the write; a failed write raises instead.

    Answering with an entity the store never accepted would tell the caller a
    mutation is durable when it is not.
    """

    hass = HomeAssistant()
    install_runtime(hass)

    async def _persist(_hass):  # type: ignore[no-untyped-def]
        raise StorageError("persist failed")

    monkeypatch.setattr(services_mod, "async_persist_repo", _persist)
    with pytest.raises(StorageError):
        await services_mod.service_item_create(hass, {"name": "Widget"})


# -----------------------------
# Reminders from an automation
# -----------------------------


@pytest.mark.asyncio
async def test_a_reminder_can_be_set_and_cleared_through_item_update() -> None:
    """No reminder-specific service for the two field writes: they are field writes.

    The schemas carried `due_date` and `inspection_date` but not these two, so
    an automation could set every date on an item except the one the release is
    about.
    """

    hass = HomeAssistant()
    repo, item_id, _loc_id = await _seeded(hass)

    stored = await services_mod.service_item_update(
        hass,
        {
            "item_id": item_id,
            "reminder_date": "2026-09-01",
            "reminder_interval": {"unit": "months", "count": 3},
        },
    )
    assert stored["item"]["reminder_date"] == "2026-09-01"
    assert stored["item"]["reminder_interval"] == {"unit": "months", "count": 3}

    cleared = await services_mod.service_item_update(
        hass, {"item_id": item_id, "reminder_date": None, "reminder_interval": None}
    )
    assert cleared["item"]["reminder_date"] is None
    assert repo.get_item(item_id).reminder_interval is None


@pytest.mark.asyncio
async def test_a_reminder_created_with_the_item_is_stored() -> None:
    hass = HomeAssistant()
    install_runtime(hass)

    created = await services_mod.service_item_create(
        hass,
        {
            "name": "HVAC filter",
            "reminder_date": "2026-09-01",
            "reminder_interval": {"unit": "months", "count": 3},
        },
    )

    assert created["item"]["reminder_date"] == "2026-09-01"


@pytest.mark.asyncio
async def test_the_bump_service_moves_the_series_the_way_the_command_does() -> None:
    """Two surfaces, one rule — `bumped_reminder_date` is the only copy of it."""

    hass = HomeAssistant()
    _repo, item_id, _loc_id = await _seeded(hass)
    await services_mod.service_item_update(
        hass,
        {
            "item_id": item_id,
            "reminder_date": "2020-01-01",
            "reminder_interval": {"unit": "days", "count": 7},
        },
    )

    bumped = await services_mod.service_reminder_bump(hass, {"item_id": item_id})

    landed = date.fromisoformat(bumped["item"]["reminder_date"])
    assert landed > dt_util.now().date()
    # Series-aligned: whole weeks from the anchor, not "today plus seven".
    assert (landed - date(2020, 1, 1)).days % 7 == 0


@pytest.mark.asyncio
async def test_the_bump_service_refuses_what_the_command_refuses() -> None:
    """A one-off has no next occurrence, and an automation gets told so."""

    hass = HomeAssistant()
    _repo, item_id, _loc_id = await _seeded(hass)
    await services_mod.service_item_update(
        hass, {"item_id": item_id, "reminder_date": "2026-09-01"}
    )

    with pytest.raises(ValidationError, match="no interval"):
        await services_mod.service_reminder_bump(hass, {"item_id": item_id})

    with pytest.raises(ValidationError, match="no reminder"):
        await services_mod.service_reminder_bump(hass, {"item_id": (await _seeded(hass))[1]})


@pytest.mark.asyncio
async def test_the_bump_service_reaches_the_bus() -> None:
    """It is an item edit, so an automation watching items has to see it."""

    hass = HomeAssistant()
    events_mod.seed_low_stock_snapshot(hass)
    _repo, item_id, _loc_id = await _seeded(hass)
    events_mod.seed_low_stock_snapshot(hass)
    await services_mod.service_item_update(
        hass,
        {
            "item_id": item_id,
            "reminder_date": "2026-09-01",
            "reminder_interval": {"unit": "months", "count": 3},
        },
    )
    hass.bus.fired.clear()

    await services_mod.service_reminder_bump(hass, {"item_id": item_id})

    fired = hass.bus.events_of(EVENT_ITEM_CHANGED)
    assert [e["action"] for e in fired] == ["updated"]
    assert fired[0]["item_id"] == item_id


@pytest.mark.asyncio
async def test_the_bump_service_keeps_the_series_on_its_own_day() -> None:
    """One rule, in `Repository.bump_reminder`, so both surfaces answer the same."""

    hass = HomeAssistant()
    repo, item_id, _loc_id = await _seeded(hass)
    await services_mod.service_item_update(
        hass,
        {
            "item_id": item_id,
            "reminder_date": "2026-08-31",
            "reminder_interval": {"unit": "months", "count": 1},
        },
    )

    bumped = await services_mod.service_reminder_bump(hass, {"item_id": item_id})

    assert bumped["item"]["reminder_date"] == "2026-09-30"
    assert bumped["item"]["reminder_anchor"] == "2026-08-31"
    assert repo.get_item(item_id).reminder_anchor == "2026-08-31"


# -----------------------------
# The files of a deleted item
#
# `haventory.item_delete` removes an item the same way `haventory/item/delete`
# does, so it owes the same files: unlinked once the write has landed, and left
# where they are when it has not.
# -----------------------------


def _attachment_meta() -> AttachmentMeta:
    return AttachmentMeta(
        id=new_uuid4(),
        kind="picture",
        filename="photo.png",
        mime="image/png",
        size=16,
        uploaded_at=iso_utc_now(),
    )


@pytest.mark.asyncio
async def test_item_delete_service_frees_the_files_after_the_save(monkeypatch) -> None:
    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    store = DomainStore(hass)
    runtime_of(hass).store = store
    item = repo.create_item({"name": "Drill"})
    meta = _attachment_meta()
    repo.add_attachment(item.id, meta)

    order: list[str] = []
    unlinked: list[tuple[str, str]] = []

    async def _spy_save(_payload):  # type: ignore[no-untyped-def]
        order.append("save")

    async def _spy_delete(_hass, pairs):  # type: ignore[no-untyped-def]
        order.append("unlink")
        unlinked.extend((item_id, str(entry.id)) for item_id, entry in pairs)

    monkeypatch.setattr(store, "async_save", _spy_save)
    monkeypatch.setattr(media_mod, "async_delete_attachments", _spy_delete)

    await services_mod.service_item_delete(hass, {"item_id": str(item.id)})

    assert order == ["save", "unlink"]
    assert unlinked == [(str(item.id), str(meta.id))]


@pytest.mark.asyncio
async def test_item_delete_service_frees_nothing_when_the_save_fails(monkeypatch) -> None:
    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    item = repo.create_item({"name": "Drill"})
    repo.add_attachment(item.id, _attachment_meta())

    unlinked: list[tuple[str, str]] = []

    async def _spy_delete(_hass, pairs):  # type: ignore[no-untyped-def]
        unlinked.extend((item_id, str(entry.id)) for item_id, entry in pairs)

    async def _persist(_hass):  # type: ignore[no-untyped-def]
        raise StorageError("disk full")

    monkeypatch.setattr(media_mod, "async_delete_attachments", _spy_delete)
    monkeypatch.setattr(services_mod, "async_persist_repo", _persist)

    with pytest.raises(StorageError):
        await services_mod.service_item_delete(hass, {"item_id": str(item.id)})

    assert unlinked == []
