"""Offline tests for integration setup and storage health."""

from __future__ import annotations

import logging
from copy import deepcopy

import custom_components.haventory as haven_init
import pytest
from custom_components.haventory.exceptions import SchemaDowngradeError
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers.storage import Store as HAStore


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
async def test_setup_entry_refuses_newer_schema_and_leaves_store_intact(monkeypatch) -> None:
    """Data written by a newer build aborts setup permanently and is never rewritten."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    key = "test_init_newer_schema_refused"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    newer_version = CURRENT_SCHEMA_VERSION + 1
    pre_payload = {
        "schema_version": newer_version,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    # ConfigEntryError, not ConfigEntryNotReady: retrying cannot make this build
    # understand newer data, so HA must stop instead of backing off forever.
    with pytest.raises(ConfigEntryError) as excinfo:
        await haven_init.async_setup_entry(hass, entry)

    message = str(excinfo.value)
    assert str(newer_version) in message
    assert str(CURRENT_SCHEMA_VERSION) in message
    assert "Upgrade HAventory" in message

    assert await raw_store.async_load() == pre_payload
    assert "repository" not in hass.data[haven_init.DOMAIN]


@pytest.mark.asyncio
async def test_validate_storage_payload_reports_newer_version_specifically() -> None:
    """A newer payload reaching validation is refused with the downgrade message."""

    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION + 2,
        "items": {},
        "locations": {},
    }

    with pytest.raises(SchemaDowngradeError) as excinfo:
        haven_init._validate_storage_payload(payload, schema_version=CURRENT_SCHEMA_VERSION)

    assert str(CURRENT_SCHEMA_VERSION + 2) in str(excinfo.value)


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
