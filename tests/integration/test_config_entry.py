"""Integration: config entry lifecycle against a real Home Assistant core.

Verifies the integration sets up and tears down cleanly through the real
``hass.config_entries`` machinery — the path the offline stubs can't exercise.
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry


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
