"""Offline tests for integration setup and storage health."""

from __future__ import annotations

import logging
from copy import deepcopy

import custom_components.haventory as haven_init
import pytest
from custom_components.haventory.const import CONF_CARD_TITLE, DEFAULT_CARD_TITLE
from custom_components.haventory.exceptions import (
    CorruptSchemaVersionError,
    SchemaDowngradeError,
)
from custom_components.haventory.models import ItemCreate
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
async def test_setup_entry_refuses_corrupt_schema_version_and_leaves_store_intact(
    monkeypatch,
) -> None:
    """A non-integer schema_version stops setup with the corruption message."""

    hass = HomeAssistant()
    entry = ConfigEntry()
    key = "test_init_corrupt_schema_version"
    monkeypatch.setattr(haven_init, "STORAGE_KEY", key)

    pre_payload = {
        "schema_version": None,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    # ConfigEntryError, not ConfigEntryNotReady: backing off forever cannot repair
    # a corrupt file, and the generic "storage load failed" hid what was wrong.
    with pytest.raises(ConfigEntryError) as excinfo:
        await haven_init.async_setup_entry(hass, entry)

    message = str(excinfo.value)
    assert "schema_version" in message
    assert "None" in message

    assert await raw_store.async_load() == pre_payload
    assert "repository" not in hass.data[haven_init.DOMAIN]


@pytest.mark.asyncio
async def test_validate_storage_payload_rejects_a_numeric_string_version() -> None:
    """``"5"`` is corruption, not the current version — validation must not coerce it."""

    payload = {
        "schema_version": str(CURRENT_SCHEMA_VERSION),
        "items": {},
        "locations": {},
    }

    with pytest.raises(CorruptSchemaVersionError) as excinfo:
        haven_init._validate_storage_payload(payload, schema_version=CURRENT_SCHEMA_VERSION)

    assert repr(str(CURRENT_SCHEMA_VERSION)) in str(excinfo.value)


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


@pytest.mark.asyncio
async def test_setup_entry_publishes_card_title(monkeypatch) -> None:
    """The card title option is resolved into hass.data for haventory/config."""

    hass = HomeAssistant()
    entry = ConfigEntry(options={CONF_CARD_TITLE: "Pantry"})

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    assert await haven_init.async_setup_entry(hass, entry) is True
    assert hass.data[haven_init.DOMAIN]["card_title"] == "Pantry"

    entry.options[CONF_CARD_TITLE] = "Garage"
    await haven_init._async_options_updated(hass, entry)
    assert hass.data[haven_init.DOMAIN]["card_title"] == "Garage"


@pytest.mark.asyncio
async def test_setup_entry_defaults_card_title_for_older_entries(monkeypatch) -> None:
    """An entry created before the option existed still gets a usable heading."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    assert await haven_init.async_setup_entry(hass, entry) is True
    assert hass.data[haven_init.DOMAIN]["card_title"] == DEFAULT_CARD_TITLE


@pytest.mark.asyncio
async def test_setup_entry_refuses_a_store_it_cannot_fully_read(monkeypatch) -> None:
    """A corrupt row stops setup instead of loading the rest over it.

    Every WS and service handler persists immediately, so a loaded entry rewrites
    the store without the unreadable rows on the first mutation. Refusing is what
    keeps the file repairable; the message has to say which file and how much.
    """

    hass = HomeAssistant()
    entry = ConfigEntry()
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {"not-a-uuid": {"id": "not-a-uuid", "name": "Broken"}},
    }

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(payload)

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    with pytest.raises(ConfigEntryError) as excinfo:
        await haven_init.async_setup_entry(hass, entry)

    message = str(excinfo.value)
    assert "1 item(s)" in message
    assert "haventory_store" in message
    assert "not-a-uuid" in message
    # The entry never got a repository, so nothing downstream can persist over
    # the file we just refused to read.
    assert "repository" not in hass.data[haven_init.DOMAIN]


@pytest.mark.asyncio
async def test_setup_entry_accepts_a_readable_store(monkeypatch) -> None:
    """The refusal above must not fire for a store this build reads end to end."""

    hass = HomeAssistant()
    entry = ConfigEntry()

    source = Repository()
    where = source.create_location(name="Garage")
    source.create_item(ItemCreate(name="Drill", location_id=str(where.id)))
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, **source.export_state()}

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return deepcopy(payload)

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    assert await haven_init.async_setup_entry(hass, entry) is True
    assert isinstance(hass.data[haven_init.DOMAIN]["repository"], Repository)
