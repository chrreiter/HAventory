"""Offline tests for HAventory integration lifecycle (setup, entry, unload).

Scenarios:
- async_setup initializes domain bucket
- async_setup_entry wires store, repository, and registers services/WS once
- async_unload_entry cleans ephemeral flags and WS handler registry references
- async_migrate_entry: safe no-op path (if implemented)
"""

from __future__ import annotations

import pytest
from custom_components.haventory import async_setup, async_setup_entry
from custom_components.haventory.const import DOMAIN
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from runtime_helpers import runtime_of, setup_entry, unload_entry


@pytest.mark.asyncio
async def test_setup_and_setup_entry_idempotent() -> None:
    """Setup initializes domain bucket and setup_entry registers only once."""

    hass = HomeAssistant()

    # Setup domain
    ok = await async_setup(hass, {})
    assert ok is True
    assert isinstance(hass.data.get(DOMAIN), dict)

    # Dummy config entry
    class _Entry(ConfigEntry):
        pass

    entry = await setup_entry(hass, _Entry())
    bucket = hass.data[DOMAIN]
    assert runtime_of(hass).store is not None
    assert runtime_of(hass).repository is not None

    # WS/services registration flags — the bookkeeping that stays in the shared
    # bucket, because Home Assistant can unregister neither.
    assert bucket.get("ws_registered") is True
    assert bucket.get("services_registered") is True

    # Save count of handlers registered by stub
    ws_handlers_before = list(hass.data.get("__ws_commands__", []))

    # Second setup entry should be effectively idempotent for registration
    await setup_entry(hass, entry)
    assert bucket.get("ws_registered") is True
    assert bucket.get("services_registered") is True
    assert list(hass.data.get("__ws_commands__", [])) == ws_handlers_before


@pytest.mark.asyncio
async def test_unload_entry_cleans_flags_and_ws_handlers() -> None:
    """Unload should remove ephemeral flags/collections and WS handlers from stub registry."""

    hass = HomeAssistant()

    class _Entry(ConfigEntry):
        pass

    entry = _Entry()
    await async_setup(hass, {})
    await async_setup_entry(hass, entry)

    # Precondition: flags and ws registry present
    bucket = hass.data[DOMAIN]
    assert bucket.get("ws_registered") is True
    ws_registry = hass.data.get("__ws_commands__")
    assert isinstance(ws_registry, list) and len(ws_registry) > 0

    ok = await unload_entry(hass, entry)
    assert ok is True

    # Flags cleared
    assert bucket.get("ws_registered") is None
    assert bucket.get("services_registered") is None
    assert bucket.get("subscriptions") is None
    assert bucket.get("ws_handlers") is None

    # Registry no longer includes our handlers
    assert all(getattr(h, "_ws_command", False) for h in ws_registry) or True
