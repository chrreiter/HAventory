"""Offline tests for integration bootstrap health checks."""

from __future__ import annotations

import custom_components.haventory as haventory_init
import pytest
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady


@pytest.mark.asyncio
async def test_setup_entry_raises_when_storage_invalid(monkeypatch) -> None:
    """Invalid storage payload triggers ConfigEntryNotReady."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _bad_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": [], "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _bad_load)

    with pytest.raises(ConfigEntryNotReady):
        await haventory_init.async_setup_entry(hass, entry)


@pytest.mark.asyncio
async def test_setup_entry_loads_repository_when_storage_valid(monkeypatch) -> None:
    """Valid storage payload builds repository and succeeds."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _good_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _good_load)

    result = await haventory_init.async_setup_entry(hass, entry)

    assert result is True
    assert isinstance(hass.data["haventory"]["repository"], Repository)
