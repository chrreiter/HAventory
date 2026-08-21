"""Integration: the count sensors on the HAventory device.

Everything here needs machinery the offline stub does not have — an entity
platform, a device registry, `hass.config_entries`, and a service registry that
dispatches. The offline suite can only check the catalog the entities are built
from (`tests/test_sensor_offline.py`).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from custom_components.haventory.const import DOMAIN, SENSOR_DESCRIPTIONS
from custom_components.haventory.runtime import find_runtime
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

LOW_THRESHOLD = 3


def _utc_day_offset(days: int) -> str:
    """A UTC calendar date `days` from today, as YYYY-MM-DD."""

    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _sensor_entries(hass: HomeAssistant, entry: MockConfigEntry) -> list[er.RegistryEntry]:
    """Only this platform's entities — the entry also owns `calendar.haventory`."""

    registry = er.async_get(hass)
    return [
        e
        for e in er.async_entries_for_config_entry(registry, entry.entry_id)
        if e.domain == "sensor"
    ]


def _entity_ids(hass: HomeAssistant, entry: MockConfigEntry) -> list[str]:
    return sorted(e.entity_id for e in _sensor_entries(hass, entry))


def _entity_id_for(hass: HomeAssistant, entry: MockConfigEntry, key: str) -> str:
    """Find a sensor by the count it reports rather than by its entity_id.

    `unique_id` is the entry_id plus the count's key, and neither moves. The
    entity_id is generated once, from whatever the entity was named at first
    creation, so matching on it would tie these tests to the wording of a name.
    """

    registry = er.async_get(hass)
    return next(
        e.entity_id
        for e in er.async_entries_for_config_entry(registry, entry.entry_id)
        if e.unique_id == f"{entry.entry_id}_{key}"
    )


async def test_every_sensor_lands_on_one_device(hass: HomeAssistant) -> None:
    """One service device, one entity per catalog entry, `unique_id`s scoped to it."""

    entry = await _setup(hass)

    entries = _sensor_entries(hass, entry)
    assert len(entries) == len(SENSOR_DESCRIPTIONS)

    assert {e.unique_id for e in entries} == {
        f"{entry.entry_id}_{d.key}" for d in SENSOR_DESCRIPTIONS
    }

    device_registry = dr.async_get(hass)
    device = device_registry.async_get_device(identifiers={(DOMAIN, entry.entry_id)})
    assert device is not None
    assert {e.device_id for e in entries} == {device.id}

    # `_attr_has_entity_name` plus a translation key: HA builds the friendly name
    # from the device name and the `entity.sensor` block, so a missing entry is
    # visible as an entity_id where a name should be.
    for entity_id in _entity_ids(hass, entry):
        state = hass.states.get(entity_id)
        assert state is not None, entity_id
        assert state.attributes["friendly_name"].startswith("HAventory ")
        assert not state.attributes["friendly_name"].endswith("HAventory ")


async def test_items_total_moves_on_a_service_call_with_no_polling(hass: HomeAssistant) -> None:
    """`haventory.item_create` repaints the sensor — the path that emitted nothing.

    No `async_update_entity`, no time travel: if the push were missing the state
    would still read 0 here.
    """

    entry = await _setup(hass)
    total = _entity_id_for(hass, entry, "items_total")

    assert hass.states.get(total).state == "0"

    await hass.services.async_call(DOMAIN, "item_create", {"name": "Torch"}, blocking=True)
    await hass.async_block_till_done()

    assert hass.states.get(total).state == "1"


async def test_items_total_moves_on_a_websocket_mutation(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """The other write path pushes the same way."""

    entry = await _setup(hass)
    total = _entity_id_for(hass, entry, "items_total")
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Torch"})
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()

    assert hass.states.get(total).state == "1"


async def test_low_stock_sensor_tracks_the_threshold(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    low = _entity_id_for(hass, entry, "low_stock_count")

    created = await hass.services.async_call(
        DOMAIN,
        "item_create",
        {"name": "Batteries", "quantity": 10, "low_stock_threshold": LOW_THRESHOLD},
        blocking=True,
        return_response=True,
    )
    await hass.async_block_till_done()
    assert hass.states.get(low).state == "0"

    await hass.services.async_call(
        DOMAIN,
        "item_set_quantity",
        {"item_id": created["item"]["id"], "quantity": 1},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert hass.states.get(low).state == "1"


async def test_unload_removes_the_entities(hass: HomeAssistant) -> None:
    """An unloaded entry serves nothing, entities included."""

    entry = await _setup(hass)
    entity_ids = _entity_ids(hass, entry)
    assert entity_ids

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    for entity_id in entity_ids:
        state = hass.states.get(entity_id)
        assert state is None or state.state == "unavailable", entity_id


@pytest.mark.parametrize("descriptor", SENSOR_DESCRIPTIONS, ids=lambda d: d.key)
async def test_each_sensor_reports_its_count(hass: HomeAssistant, descriptor) -> None:
    """Every entity reads its own key, so none of them is wired to the wrong one."""

    entry = await _setup(hass)
    repo = find_runtime(hass).repository

    entity_id = _entity_id_for(hass, entry, descriptor.key)

    assert hass.states.get(entity_id).state == str(repo.get_counts()[descriptor.key])


async def test_an_inspection_due_today_is_due_and_not_overdue(hass: HomeAssistant) -> None:
    """The two inspection sensors differ by exactly the items due today.

    `due` includes today and `overdue` does not — the distinction the counts are
    named for, read off the entities a dashboard actually shows.
    """

    entry = await _setup(hass)
    due = _entity_id_for(hass, entry, "inspection_due_count")
    overdue = _entity_id_for(hass, entry, "inspection_overdue_count")

    await hass.services.async_call(
        DOMAIN,
        "item_create",
        {"name": "Harness", "inspection_date": _utc_day_offset(0)},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get(due).state == "1"
    assert hass.states.get(overdue).state == "0"

    await hass.services.async_call(
        DOMAIN,
        "item_create",
        {"name": "Ladder", "inspection_date": _utc_day_offset(-1)},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get(due).state == "2"
    assert hass.states.get(overdue).state == "1"


async def test_the_inspection_due_sensor_moves_at_utc_midnight(
    hass: HomeAssistant, freezer
) -> None:
    """A date-derived count rewrites on the rollover, with nothing mutated.

    Tomorrow's inspection becomes today's without anybody touching the item, so
    a sensor that only listened for mutations would sit at yesterday's figure
    all day.
    """

    entry = await _setup(hass)
    due = _entity_id_for(hass, entry, "inspection_due_count")
    tomorrow = _utc_day_offset(1)

    await hass.services.async_call(
        DOMAIN, "item_create", {"name": "Harness", "inspection_date": tomorrow}, blocking=True
    )
    await hass.async_block_till_done()
    assert hass.states.get(due).state == "0"

    freezer.move_to(f"{tomorrow}T00:00:30+00:00")
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()

    assert hass.states.get(due).state == "1"


async def test_the_location_sensor_moves_on_a_location_mutation(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """A location create touches no item, and the count is still a sensor.

    Only `events.notify_location_changed` moves it; without that call the entity
    reports the old figure until something happens to edit an item.
    """

    entry = await _setup(hass)
    locations = _entity_id_for(hass, entry, "locations_total")
    client = await hass_ws_client(hass)

    assert hass.states.get(locations).state == "0"

    await client.send_json({"id": 1, "type": "haventory/location/create", "name": "Garage"})
    created = await client.receive_json()
    assert created["success"] is True, created
    await hass.async_block_till_done()

    assert hass.states.get(locations).state == "1"

    await hass.services.async_call(DOMAIN, "location_create", {"name": "Cellar"}, blocking=True)
    await hass.async_block_till_done()

    assert hass.states.get(locations).state == "2"

    await client.send_json(
        {"id": 2, "type": "haventory/location/delete", "location_id": created["result"]["id"]}
    )
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()

    assert hass.states.get(locations).state == "1"
