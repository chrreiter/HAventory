"""Integration: config entry lifecycle against a real Home Assistant core.

Verifies the integration sets up and tears down cleanly through the real
``hass.config_entries`` machinery — the path the offline stubs can't exercise.
Removal especially: the offline stub takes our handlers back out of its fake
command registry on unload, which real Home Assistant has no API for, so only
here can "the commands are still registered and refuse" be told apart from "the
commands are gone".
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_config_entry_setup_and_unload(hass: HomeAssistant) -> None:
    """A config entry sets up (LOADED) and unloads (NOT_LOADED) cleanly."""

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    # Setup wired the runtime data structures into hass.data.
    bucket = hass.data[DOMAIN]
    assert "store" in bucket
    assert isinstance(bucket["repository"], Repository)

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    # Ephemeral registration flags are cleared on unload.
    assert hass.data[DOMAIN].get("ws_registered") is None


async def test_removed_entry_leaves_the_ws_api_refusing(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """A dashboard left open cannot go on reading or writing a removed inventory."""

    entry = await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Screwdriver"})
    assert (await client.receive_json())["success"] is True

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()

    # Still dispatched — Home Assistant has no API to unregister a command — and
    # answering the contract's storage_error rather than serving dropped state.
    await client.send_json({"id": 2, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is False, listed
    assert listed["error"]["code"] == "storage_error", listed

    await client.send_json({"id": 3, "type": "haventory/item/create", "name": "Ghost"})
    created = await client.receive_json()
    assert created["success"] is False, created
    assert created["error"]["code"] == "storage_error", created

    assert hass.data[DOMAIN].get("repository") is None


async def test_re_adding_a_removed_entry_restores_the_inventory(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """Removal keeps the store file, so adding the integration again brings it back."""

    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Screwdriver"})
    assert (await client.receive_json())["success"] is True

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    await _setup(hass)

    await client.send_json({"id": 2, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]
