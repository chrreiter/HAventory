"""Offline tests for integration setup and storage health."""

from __future__ import annotations

import logging

import custom_components.haventory as haven_init
import pytest
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady


@pytest.mark.asyncio
async def test_setup_entry_logs_warning_for_empty_storage(monkeypatch, caplog) -> None:
    """Empty storage payload logs a warning but completes setup."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return payload

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    caplog.set_level(logging.WARNING)

    result = await haven_init.async_setup_entry(hass, entry)

    assert result is True
    assert isinstance(hass.data[haven_init.DOMAIN]["repository"], Repository)
    assert any("Storage health" in record.message for record in caplog.records)
    assert any(
        record.levelname == "WARNING" and "Storage health" in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_setup_entry_invalid_version_raises(monkeypatch) -> None:
    """Schema version mismatch triggers ConfigEntryNotReady."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _bad_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": 0, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _bad_load)

    with pytest.raises(ConfigEntryNotReady):
        await haven_init.async_setup_entry(hass, entry)


@pytest.mark.asyncio
async def test_setup_entry_invalid_collections_raise(monkeypatch) -> None:
    """Non-dict collections trigger ConfigEntryNotReady."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _bad_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": [], "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _bad_load)

    with pytest.raises(ConfigEntryNotReady):
        await haven_init.async_setup_entry(hass, entry)
