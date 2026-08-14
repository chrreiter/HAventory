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
from pathlib import Path

import pytest
import voluptuous as vol
import yaml
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import ConflictError, NotFoundError, StorageError
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from homeassistant.core import HomeAssistant, SupportsResponse


@pytest.mark.asyncio
async def test_item_create_and_update_flow_logs_and_mutates() -> None:
    """Create an item, then update it; ensure repo state changes and no exceptions bubble."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    # Create
    await services_mod.service_item_create(
        hass,
        {
            "name": "Widget",
            "quantity": 2,
            "tags": ["Blue", "blue"],  # dedup/normalize handled by model
        },
    )

    repo: Repository = hass.data[DOMAIN]["repository"]
    assert repo.get_counts()["items_total"] == 1

    # Update name and quantity
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))
    updated_quantity = 3
    await services_mod.service_item_update(
        hass, {"item_id": item_id, "name": "Widget Pro", "quantity": updated_quantity}
    )

    updated = repo.get_item(item_id)
    assert updated.name == "Widget Pro"
    assert updated.quantity == updated_quantity


@pytest.mark.asyncio
async def test_item_move_and_quantity_helpers() -> None:
    """Move item between locations and adjust quantities via helpers."""

    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    # Create locations and item
    await services_mod.service_location_create(hass, {"name": "Garage"})
    loc_id = next(iter(repo._debug_get_internal_indexes()["locations_by_id"]))
    # Update location name via service
    await services_mod.service_location_update(hass, {"location_id": loc_id, "name": "Garage2"})
    assert repo.get_location(loc_id).name == "Garage2"
    await services_mod.service_item_create(
        hass, {"name": "Box", "quantity": 1, "location_id": loc_id}
    )
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))

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
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store

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
    repo: Repository = hass.data[DOMAIN]["repository"]
    loc_id = next(iter(repo._debug_get_internal_indexes()["locations_by_id"]))
    await services_mod.service_location_delete(hass, {"location_id": loc_id})
    MIN_PERSISTS_AFTER_DELETE = 3
    assert calls["count"] >= MIN_PERSISTS_AFTER_DELETE


@pytest.mark.asyncio
async def test_service_registration_and_schema_errors(monkeypatch, caplog) -> None:
    """Services register and schema errors are logged without raising."""

    hass = HomeAssistant()

    # Provide a minimal services registry stub with async_register behavior
    class _Services:
        def __init__(self) -> None:
            self._registered: list[tuple[str, str, object, object]] = []
            self._responses: dict[str, object] = {}

        def async_register(  # type: ignore[no-untyped-def]
            self, domain, name, handler, schema=None, *, supports_response=SupportsResponse.NONE
        ):
            self._registered.append((domain, name, handler, schema))
            self._responses[name] = supports_response

    hass.services = _Services()  # type: ignore[attr-defined]

    # Wire repository and store
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    services_mod.setup(hass)
    # Ensure all expected services are registered
    names = {n for (_d, n, _h, _s) in hass.services._registered}
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
    assert set(hass.services._responses.values()) == {SupportsResponse.OPTIONAL}

    # Home Assistant classifies each handler with HassJob and dispatches anything
    # that is neither a coroutine function nor a @callback to the executor, where
    # a handler that merely returns a coroutine is never awaited. Registering an
    # `async def` is what keeps the service from silently doing nothing; the
    # end-to-end proof lives in tests/integration/test_services.py.
    not_awaitable = [
        n for (_d, n, h, _s) in hass.services._registered if not inspect.iscoroutinefunction(h)
    ]
    assert not not_awaitable

    # Grab a handler and feed invalid payload to trigger vol.Invalid
    caplog.clear()
    caplog.set_level("WARNING")
    # Find item_update handler
    _domain, _name, handler, _schema = next(
        r for r in hass.services._registered if r[1] == "item_update"
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
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    # Create one item to operate on
    await services_mod.service_item_create(hass, {"name": "Widget"})
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))

    # Force NotFoundError: delete then try update
    await services_mod.service_item_delete(hass, {"item_id": item_id})
    caplog.clear()
    caplog.set_level("WARNING")
    with pytest.raises(NotFoundError):
        await services_mod.service_item_update(hass, {"item_id": item_id, "name": "Nope"})
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)

    # Force ConflictError via expected_version mismatch
    await services_mod.service_item_create(hass, {"name": "Widget2"})
    item_id2 = next(reversed(repo._debug_get_internal_indexes()["items_by_id"]))
    caplog.clear()
    with pytest.raises(ConflictError):
        await services_mod.service_item_update(
            hass, {"item_id": item_id2, "expected_version": 999, "name": "Boom"}
        )
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)

    # Simulate storage failure during persist
    caplog.clear()

    async def _raise(_payload):  # type: ignore[no-untyped-def]
        raise RuntimeError("save failed")

    monkeypatch.setattr(DomainStore(hass), "async_save", _raise)

    # Monkeypatch helper to raise StorageError at boundary
    async def _persist(_hass):  # type: ignore[no-untyped-def]
        raise StorageError("persist failed")

    monkeypatch.setattr(services_mod, "async_persist_repo", _persist)
    with pytest.raises(StorageError):
        await services_mod.service_location_create(hass, {"name": "Root"})
    assert any(getattr(r, "op", None) == "location_create" for r in caplog.records)


def test_service_catalog_agrees_across_registration_yaml_and_strings() -> None:
    """Every registered service is described in `services.yaml` and translated.

    Home Assistant renders a service in the UI from three files that nothing
    joins up: `services.py` registers it, `services.yaml` declares its fields,
    and `strings.json` supplies the name and description the frontend shows —
    falling back to the `services.yaml` text only where the translation is
    missing. A service added to one file and not the others still works over the
    API, so the gap shows up as a shabby entry in the service picker rather than
    as a failure.
    """

    package = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"
    registered = {name for name, _handler, _schema in services_mod.SERVICES}
    documented = set(yaml.safe_load((package / "services.yaml").read_text(encoding="utf-8")))
    translated = json.loads((package / "strings.json").read_text(encoding="utf-8"))["services"]

    assert documented == registered, "services.yaml and the SERVICES table disagree"
    assert set(translated) == registered, "strings.json and the SERVICES table disagree"
    assert all(entry.keys() == {"name", "description"} for entry in translated.values())


# -----------------------------
# Service responses
# -----------------------------


async def _seeded(hass: HomeAssistant) -> tuple[Repository, str, str]:
    """A repository holding one location and one item inside it."""

    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    loc = await services_mod.service_location_create(hass, {"name": "Shelf"})
    item = await services_mod.service_item_create(
        hass, {"name": "Widget", "quantity": 5, "location_id": loc["location"]["id"]}
    )
    return hass.data[DOMAIN]["repository"], item["item"]["id"], loc["location"]["id"]


@pytest.mark.asyncio
async def test_every_service_answers_with_the_canonical_envelope() -> None:
    """All eleven services hand back the entity they touched.

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
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)

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
async def test_a_failed_persist_answers_nothing(monkeypatch) -> None:
    """The response is produced after the write; a failed write raises instead.

    Answering with an entity the store never accepted would tell the caller a
    mutation is durable when it is not.
    """

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    async def _persist(_hass):  # type: ignore[no-untyped-def]
        raise StorageError("persist failed")

    monkeypatch.setattr(services_mod, "async_persist_repo", _persist)
    with pytest.raises(StorageError):
        await services_mod.service_item_create(hass, {"name": "Widget"})
