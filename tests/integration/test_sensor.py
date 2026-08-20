"""Integration: the four count sensors on the HAventory device.

Everything here needs machinery the offline stub does not have — an entity
platform, a device registry, `hass.config_entries`, and a service registry that
dispatches. The offline suite can only check the catalog the entities are built
from (`tests/test_sensor_offline.py`).
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN, SENSOR_DESCRIPTIONS
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

LOW_THRESHOLD = 3


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


async def test_four_sensors_land_on_one_device(hass: HomeAssistant) -> None:
    """One service device, four entities, `unique_id`s scoped to the entry."""

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
    repo = hass.data[DOMAIN]["repository"]

    entity_id = _entity_id_for(hass, entry, descriptor.key)

    assert hass.states.get(entity_id).state == str(repo.get_counts()[descriptor.key])
