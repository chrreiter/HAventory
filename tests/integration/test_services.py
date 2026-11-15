"""Integration: ``haventory.*`` services dispatched by the real service registry.

The offline suite awaits the registered handler itself, which passes no matter how
the handler was registered. Home Assistant does not: it classifies every handler
with ``HassJob`` and sends anything that is not a coroutine function (or a
``@callback``) to the executor, where a handler that merely *returns* a coroutine
is never awaited and the mutation silently never happens. Only a call through
``hass.services.async_call`` exercises that classification, so these tests drive
every registered service through it and assert the repository actually changed.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import voluptuous as vol
import yaml
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import NotFoundError, StorageError, ValidationError
from custom_components.haventory.repository import Repository
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import STORAGE_KEY
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import translation
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

DUE_DATE = "2030-01-01"


async def _call(hass: HomeAssistant, service: str, data: dict) -> None:
    await hass.services.async_call(DOMAIN, service, data, blocking=True)
    await hass.async_block_till_done()


def _only_item_id(repo: Repository) -> str:
    items = repo.list_items()["items"]
    assert len(items) == 1, items
    return str(items[0].id)


async def test_all_services_are_registered(hass: HomeAssistant, setup_entry) -> None:
    """Setup registers the full ``haventory.*`` catalog."""

    await setup_entry()

    assert hass.services.async_services_for_domain(DOMAIN).keys() == {
        "item_create",
        "item_update",
        "item_delete",
        "item_move",
        "item_adjust_quantity",
        "item_set_quantity",
        "item_check_out",
        "item_check_in",
        "reminder_bump",
        "location_create",
        "location_update",
        "location_delete",
    }


async def test_every_service_dispatches_its_handler(
    hass: HomeAssistant, setup_entry, call_service
) -> None:
    """Calling each service through HA runs the handler and answers with the entity.

    One walk covers the whole catalog: a location is created, renamed and finally
    deleted around an item that is created, edited, re-quantified, checked out and
    back in, moved and deleted. Each answer is the envelope `docs/data_shapes.md`
    gives the WebSocket surface (the whole entity, so the next call has the
    `version` its `expected_version` needs), and every answer would be missing if
    HA had dispatched the handler to the executor instead of awaiting it.
    """

    await setup_entry()
    repo = find_runtime(hass).repository

    async def item_step(service: str, **data: Any) -> dict:
        response = await call_service(service, **data)
        assert set(response) == {"item"}, service
        assert response["item"]["id"] == item_id, service
        assert response["item"]["version"] == repo.get_item(item_id).version, service
        return response["item"]

    created_location = await call_service("location_create", name="Garage")
    assert set(created_location) == {"location"}
    location_id = created_location["location"]["id"]

    renamed = await call_service("location_update", location_id=location_id, name="Workshop")
    assert renamed["location"]["id"] == location_id
    assert renamed["location"]["name"] == "Workshop"

    created = await call_service(
        "item_create",
        name="Hammer",
        quantity=1,
        location_id=location_id,
        tags=["tools"],
        status="missing",
    )
    item_id = created["item"]["id"]
    assert created["item"]["tags"] == ["tools"]
    assert created["item"]["status"] == "missing"
    assert created["item"]["location_path"]["display_path"] == "Workshop"

    updated = await item_step(
        "item_update", item_id=item_id, description="Claw hammer", status="ok"
    )
    assert (updated["description"], updated["status"]) == ("Claw hammer", "ok")
    adjusted, reset = 5, 2
    assert (await item_step("item_adjust_quantity", item_id=item_id, delta=4))[
        "quantity"
    ] == adjusted
    assert (await item_step("item_set_quantity", item_id=item_id, quantity=reset))[
        "quantity"
    ] == reset

    checked_out = await item_step("item_check_out", item_id=item_id, due_date=DUE_DATE)
    assert (checked_out["checked_out"], checked_out["due_date"]) == (True, DUE_DATE)
    assert (await item_step("item_check_in", item_id=item_id))["checked_out"] is False

    assert (await item_step("item_move", item_id=item_id, new_location_id=None))[
        "location_id"
    ] is None

    await item_step(
        "item_update",
        item_id=item_id,
        reminder_date="2026-09-01",
        reminder_interval={"unit": "months", "count": 3},
    )
    await item_step("reminder_bump", item_id=item_id)

    removed_item = await call_service("item_delete", item_id=item_id)
    assert set(removed_item) == {"item"}
    assert removed_item["item"]["id"] == item_id
    assert repo.get_counts()["items_total"] == 0

    removed_location = await call_service("location_delete", location_id=location_id)
    assert set(removed_location) == {"location"}
    assert removed_location["location"]["id"] == location_id
    assert repo.get_counts()["locations_total"] == 0


async def test_service_call_persists_through_the_store(
    hass: HomeAssistant, hass_storage: dict, setup_entry
) -> None:
    """A service mutation reaches the HA Store, not just the in-memory repository."""

    await setup_entry()

    await _call(hass, "item_create", {"name": "Flashlight", "quantity": 2})

    persisted = hass_storage[STORAGE_KEY]["data"]
    assert any(i["name"] == "Flashlight" for i in persisted["items"].values())


async def test_service_call_surfaces_domain_errors(hass: HomeAssistant, setup_entry) -> None:
    """A repository error reaches the caller instead of being swallowed mid-dispatch."""

    await setup_entry()

    with pytest.raises(NotFoundError):
        await _call(hass, "item_update", {"item_id": "does-not-exist", "name": "Nope"})


async def test_service_call_after_removal_refuses(hass: HomeAssistant, hass_storage) -> None:
    """Services outlive the entry the same way commands do, and refuse the same way.

    ``hass.services.async_remove`` is never called, so the catalog stays; what
    changes is that the handlers no longer have a repository to reach.
    """

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    await _call(hass, "item_create", {"name": "Torch"})

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()

    assert "item_create" in hass.services.async_services_for_domain(DOMAIN)
    with pytest.raises(StorageError):
        await _call(hass, "item_create", {"name": "Ghost"})

    assert [i["name"] for i in hass_storage[STORAGE_KEY]["data"]["items"].values()] == ["Torch"]


async def test_service_call_rejects_a_bad_payload(
    hass: HomeAssistant, setup_entry, call_service
) -> None:
    """HA's schema refuses a malformed call; what passes it, the model layer refuses.

    An action is typed by hand, and the refusal is all its author is shown, so
    the message has to name the field.
    """

    await setup_entry()
    repo = find_runtime(hass).repository
    item_id = (await call_service("item_create", name="Boiler"))["item"]["id"]

    with pytest.raises(vol.Invalid):
        await call_service("item_create", quantity=1)
    with pytest.raises(ValidationError):
        await call_service("item_create", name="   ")
    with pytest.raises(ValidationError) as refusal:
        await call_service("item_update", item_id=item_id, inspection_date="2026-02-30")

    assert str(refusal.value) == "inspection_date must be a valid calendar date (YYYY-MM-DD)"
    assert repo.get_item(item_id).inspection_date is None
    assert repo.get_counts()["items_total"] == 1


async def test_services_answer_when_the_caller_asks_for_a_response(
    hass: HomeAssistant, setup_entry, hass_ws_client
) -> None:
    """``return_response`` hands back the entity, so a script can chain calls.

    The first call goes over a WebSocket as the frontend makes it, so Home
    Assistant's own JSON encoding is what checks the response: a payload with a
    date, a tuple or a UUID in it fails there and nowhere a direct call looks.
    """

    await setup_entry()
    repo = find_runtime(hass).repository

    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "call_service",
            "domain": DOMAIN,
            "service": "item_create",
            "service_data": {
                "name": "Torch",
                "quantity": 2,
                "tags": ["blue"],
                "checked_out": True,
                "due_date": DUE_DATE,
                "inspection_date": "2031-06-30",
                "custom_fields": {"sku": "A-1", "count": 3, "fragile": True},
            },
            "return_response": True,
        }
    )
    answer = await client.receive_json()
    assert answer["success"] is True, answer
    created = answer["result"]["response"]

    assert set(created) == {"item"}
    item_id = created["item"]["id"]
    assert created["item"]["name"] == "Torch"
    assert created["item"]["inspection_date"] == "2031-06-30"
    assert created["item"]["custom_fields"] == {"sku": "A-1", "count": 3, "fragile": True}
    assert item_id == _only_item_id(repo)
    assert created["item"]["version"] == repo.get_item(item_id).version

    # The chain the issue asks for: the response's id and version drive the next call.
    location = await hass.services.async_call(
        DOMAIN, "location_create", {"name": "Shed"}, blocking=True, return_response=True
    )
    await hass.async_block_till_done()
    moved = await hass.services.async_call(
        DOMAIN,
        "item_move",
        {
            "item_id": item_id,
            "new_location_id": location["location"]["id"],
            "expected_version": created["item"]["version"],
        },
        blocking=True,
        return_response=True,
    )
    await hass.async_block_till_done()

    assert moved["item"]["location_id"] == location["location"]["id"]
    assert moved["item"]["location_path"]["display_path"] == "Shed"
    assert moved["item"]["version"] == created["item"]["version"] + 1


async def test_a_caller_that_ignores_the_response_still_mutates(
    hass: HomeAssistant, setup_entry
) -> None:
    """``OPTIONAL`` means the pre-existing call shape keeps working unchanged."""

    await setup_entry()
    repo = find_runtime(hass).repository

    # No `return_response`: HA returns None and the mutation still lands.
    answer = await hass.services.async_call(DOMAIN, "item_create", {"name": "Torch"}, blocking=True)
    await hass.async_block_till_done()
    assert answer is None

    assert repo.get_counts()["items_total"] == 1


async def test_delete_answers_with_the_body_it_removed(hass: HomeAssistant, setup_entry) -> None:
    """The response is the item as it last stood; nothing is left, and a repeat refuses."""

    quantity = 3
    await setup_entry()
    repo = find_runtime(hass).repository
    await _call(hass, "item_create", {"name": "Torch", "quantity": quantity})
    item_id = _only_item_id(repo)

    removed = await hass.services.async_call(
        DOMAIN, "item_delete", {"item_id": item_id}, blocking=True, return_response=True
    )
    await hass.async_block_till_done()

    assert removed["item"]["id"] == item_id
    assert removed["item"]["name"] == "Torch"
    assert removed["item"]["quantity"] == quantity
    assert repo.get_counts()["items_total"] == 0

    # A second delete is an error, not an empty envelope.
    with pytest.raises(NotFoundError):
        await _call(hass, "item_delete", {"item_id": item_id})


async def test_reminders_are_reachable_from_an_automation(hass: HomeAssistant, setup_entry) -> None:
    """The whole point of the service surface: a household can act on a reminder.

    Reminders shipped WebSocket-only, and no Home Assistant automation can send a
    WebSocket command — so "check the smoke detector every three months", the
    automation-facing feature of the release, was unreachable from an automation.
    """

    await setup_entry()

    created = await hass.services.async_call(
        DOMAIN,
        "item_create",
        {
            "name": "HVAC filter",
            "reminder_date": "2020-01-01",
            "reminder_interval": {"unit": "days", "count": 7},
        },
        blocking=True,
        return_response=True,
    )
    item_id = created["item"]["id"]
    assert created["item"]["reminder_interval"] == {"unit": "days", "count": 7}

    bumped = await hass.services.async_call(
        DOMAIN, "reminder_bump", {"item_id": item_id}, blocking=True, return_response=True
    )

    landed = date.fromisoformat(bumped["item"]["reminder_date"])
    assert landed > dt_util.now().date()
    # Series-aligned, exactly as the WebSocket command leaves it.
    assert (landed - date(2020, 1, 1)).days % 7 == 0

    cleared = await hass.services.async_call(
        DOMAIN,
        "item_update",
        {"item_id": item_id, "reminder_date": None, "reminder_interval": None},
        blocking=True,
        return_response=True,
    )
    assert cleared["item"]["reminder_date"] is None


async def test_services_exist_and_refuse_before_any_entry_is_loaded(hass: HomeAssistant) -> None:
    """`async_setup` registers the catalog; with no entry a call is the caller's to retry.

    A `ServiceValidationError`, so Home Assistant logs no traceback for it.
    """

    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    assert "item_create" in hass.services.async_services_for_domain(DOMAIN)
    with pytest.raises(ServiceValidationError) as raised:
        await _call(hass, "item_create", {"name": "Torch"})
    assert raised.value.translation_domain == DOMAIN
    assert raised.value.translation_key == "not_loaded"


async def test_a_refused_service_call_reaches_a_german_caller_by_its_key(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """What Developer Tools gets: the key and placeholders, worded from `de.json`."""

    await setup_entry()
    await _call(hass, "item_create", {"name": "Torch"})
    repo = find_runtime(hass).repository
    item_id = _only_item_id(repo)

    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "call_service",
            "domain": DOMAIN,
            "service": "item_update",
            "service_data": {"item_id": item_id, "name": "Lamp", "expected_version": 99},
        }
    )
    error = (await client.receive_json())["error"]

    assert error["code"] == "service_validation_error"
    assert error["translation_domain"] == DOMAIN
    assert error["translation_key"] == "version_conflict"
    placeholders = error["translation_placeholders"]
    assert placeholders == {"expected": "99", "actual": "1"}

    german = await translation.async_get_translations(hass, "de", "exceptions", {DOMAIN})
    template = german[f"component.{DOMAIN}.exceptions.version_conflict.message"]
    assert template.format(**placeholders) == (
        "Dieser Gegenstand wurde zwischenzeitlich geändert (erwartete Version 99, aktuell 1). "
        "Lade ihn neu und wiederhole die Änderung."
    )


async def test_service_catalog_agrees_across_registration_yaml_and_strings(
    hass: HomeAssistant, setup_entry
) -> None:
    """Every registered service, and every field it takes, is declared and translated.

    Home Assistant renders a service in the UI from three files that nothing joins
    up: the registry (the schema `services.py` registers), `services.yaml` (fields
    and selectors) and `strings.json` (every piece of text). A service or field
    missing from one still works over the API, so the gap shows as a bare key in
    Developer Tools. `services.yaml` carries no text: HA falls back to it where a
    translation is missing, so a name left there would render in every language.
    Each field has an `example` (else the author gets an empty box with no hint
    of its shape), and a field name has one selector across services (`tags` was
    `text:` on create and `object:` on update).
    """

    await setup_entry()
    package = Path(services_mod.__file__).parent
    registered = hass.services.async_services_for_domain(DOMAIN)
    documented = yaml.safe_load((package / "services.yaml").read_text(encoding="utf-8"))
    translated = json.loads((package / "strings.json").read_text(encoding="utf-8"))["services"]

    assert set(documented) == set(registered), "services.yaml and the registry disagree"
    assert set(translated) == set(registered), "strings.json and the registry disagree"

    selectors: dict[str, tuple[str, object]] = {}
    for service, registration in registered.items():
        accepted = {str(marker) for marker in registration.schema.schema}
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
            assert "example" in spec, f"services.yaml's {service}.{field} shows no example"
            first_service, first = selectors.setdefault(field, (service, spec["selector"]))
            assert spec["selector"] == first, (
                f"{service}.{field} and {first_service}.{field} declare different selectors"
            )

        assert entry.keys() == {"name", "description", "fields"}, service
        assert all(entry[key].strip() for key in ("name", "description")), service
        assert set(entry["fields"]) == accepted, (
            f"strings.json and the schema disagree about {service}'s fields"
        )
        for field, text in entry["fields"].items():
            assert text.keys() == {"name", "description"}, f"{service}.{field}"
            assert all(value.strip() for value in text.values()), f"{service}.{field}"
