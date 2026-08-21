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

from datetime import date

import pytest
import voluptuous as vol
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import NotFoundError, StorageError, ValidationError
from custom_components.haventory.repository import Repository
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import STORAGE_KEY
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

DUE_DATE = "2030-01-01"


async def _setup(hass: HomeAssistant) -> Repository:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return find_runtime(hass).repository


async def _call(hass: HomeAssistant, service: str, data: dict) -> None:
    await hass.services.async_call(DOMAIN, service, data, blocking=True)
    await hass.async_block_till_done()


def _only_location_id(repo: Repository) -> str:
    locations = repo._debug_get_internal_indexes()["locations_by_id"]
    assert len(locations) == 1, locations
    return next(iter(locations))


def _only_item_id(repo: Repository) -> str:
    items = repo._debug_get_internal_indexes()["items_by_id"]
    assert len(items) == 1, items
    return next(iter(items))


async def test_all_services_are_registered(hass: HomeAssistant) -> None:
    """Setup registers the full ``haventory.*`` catalog."""

    await _setup(hass)

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


async def test_every_service_dispatches_its_handler(hass: HomeAssistant) -> None:
    """Calling each service through HA runs the handler and mutates the repository.

    One walk covers the whole catalog: a location is created, renamed and finally
    deleted around an item that is created, edited, re-quantified, checked out and
    back in, moved and deleted. Every assertion would fail if HA had dispatched the
    handler to the executor instead of awaiting it.
    """

    repo = await _setup(hass)

    await _call(hass, "location_create", {"name": "Garage"})
    location_id = _only_location_id(repo)
    assert repo.get_location(location_id).name == "Garage"

    await _call(hass, "location_update", {"location_id": location_id, "name": "Workshop"})
    assert repo.get_location(location_id).name == "Workshop"

    await _call(
        hass,
        "item_create",
        {"name": "Hammer", "quantity": 1, "location_id": location_id, "tags": ["tools"]},
    )
    item_id = _only_item_id(repo)
    item = repo.get_item(item_id)
    assert item.name == "Hammer"
    assert item.tags == ["tools"]
    assert item.location_path.display_path == "Workshop"

    await _call(hass, "item_update", {"item_id": item_id, "description": "Claw hammer"})
    assert repo.get_item(item_id).description == "Claw hammer"

    adjusted_quantity = 5
    await _call(hass, "item_adjust_quantity", {"item_id": item_id, "delta": 4})
    assert repo.get_item(item_id).quantity == adjusted_quantity

    set_quantity = 2
    await _call(hass, "item_set_quantity", {"item_id": item_id, "quantity": set_quantity})
    assert repo.get_item(item_id).quantity == set_quantity

    await _call(hass, "item_check_out", {"item_id": item_id, "due_date": DUE_DATE})
    checked_out = repo.get_item(item_id)
    assert checked_out.checked_out is True
    assert checked_out.due_date == DUE_DATE

    await _call(hass, "item_check_in", {"item_id": item_id})
    assert repo.get_item(item_id).checked_out is False

    await _call(hass, "item_move", {"item_id": item_id, "new_location_id": None})
    assert repo.get_item(item_id).location_id is None

    await _call(hass, "item_delete", {"item_id": item_id})
    assert repo.get_counts()["items_total"] == 0

    await _call(hass, "location_delete", {"location_id": location_id})
    assert repo.get_counts()["locations_total"] == 0


async def test_service_call_persists_through_the_store(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """A service mutation reaches the HA Store, not just the in-memory repository."""

    await _setup(hass)

    await _call(hass, "item_create", {"name": "Flashlight", "quantity": 2})

    persisted = hass_storage[STORAGE_KEY]["data"]
    assert any(i["name"] == "Flashlight" for i in persisted["items"].values())


async def test_service_call_surfaces_domain_errors(hass: HomeAssistant) -> None:
    """A repository error reaches the caller instead of being swallowed mid-dispatch."""

    await _setup(hass)

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


async def test_service_call_rejects_a_bad_payload(hass: HomeAssistant) -> None:
    """HA validates against the registered schema before the handler runs."""

    repo = await _setup(hass)

    # ``item_create`` requires a name; the registered schema rejects the call.
    with pytest.raises(vol.Invalid):
        await _call(hass, "item_create", {"quantity": 1})

    # A well-typed but domain-invalid value gets past the schema and is rejected
    # by the model layer, which the handler re-raises.
    with pytest.raises(ValidationError):
        await _call(hass, "item_create", {"name": "   "})

    assert repo.get_counts()["items_total"] == 0


async def test_services_answer_when_the_caller_asks_for_a_response(hass: HomeAssistant) -> None:
    """``return_response`` hands back the entity, so a script can chain calls.

    ``supports_response`` lives in the real service registry — the offline stub
    has none, so nothing about this classification is observable there.
    """

    repo = await _setup(hass)

    created = await hass.services.async_call(
        DOMAIN, "item_create", {"name": "Torch"}, blocking=True, return_response=True
    )
    await hass.async_block_till_done()

    assert set(created) == {"item"}
    item_id = created["item"]["id"]
    assert created["item"]["name"] == "Torch"
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


async def test_a_caller_that_ignores_the_response_still_mutates(hass: HomeAssistant) -> None:
    """``OPTIONAL`` means the pre-existing call shape keeps working unchanged."""

    repo = await _setup(hass)

    # No `return_response`: HA returns None and the mutation still lands.
    answer = await hass.services.async_call(DOMAIN, "item_create", {"name": "Torch"}, blocking=True)
    await hass.async_block_till_done()
    assert answer is None

    assert repo.get_counts()["items_total"] == 1


async def test_delete_answers_with_the_body_it_removed(hass: HomeAssistant) -> None:
    """The response is the item as it last stood, and the repository is empty after."""

    quantity = 3
    repo = await _setup(hass)
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


async def test_reminders_are_reachable_from_an_automation(hass: HomeAssistant) -> None:
    """The whole point of the service surface: a household can act on a reminder.

    Reminders shipped WebSocket-only, and no Home Assistant automation can send a
    WebSocket command — so "check the smoke detector every three months", the
    automation-facing feature of the release, was unreachable from an automation.
    """

    await _setup(hass)

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
