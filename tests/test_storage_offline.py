"""Offline tests for HAventory storage manager.

Scenarios:
- Initial load returns an empty dataset with correct schema_version
- Save then load returns equal data (roundtrip)
- Migration hook is invoked when schema_version differs
"""

from __future__ import annotations

import pytest
from custom_components.haventory import migrations
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore


@pytest.mark.asyncio
async def test_initial_load_returns_empty_dataset() -> None:
    """First load initializes an empty dataset."""

    # Arrange
    hass = HomeAssistant()
    store = DomainStore(hass)

    # Act
    data = await store.async_load()

    # Assert
    assert isinstance(data, dict)
    assert data["schema_version"] == CURRENT_SCHEMA_VERSION
    assert data["items"] == {}
    assert data["locations"] == {}


@pytest.mark.asyncio
async def test_save_then_load_roundtrip() -> None:
    """Save then load equality."""

    # Arrange
    hass = HomeAssistant()
    store = DomainStore(hass)
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 50}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }

    # Act
    await store.async_save(payload)
    loaded = await store.async_load()

    # Assert
    assert loaded == payload


@pytest.mark.asyncio
async def test_migration_is_applied_for_older_payload(monkeypatch) -> None:
    """Migration hook is invoked when schema_version differs."""

    # Arrange
    hass = HomeAssistant()
    store = DomainStore(hass)

    # Simulate older payload saved directly to underlying Store
    underlying = store  # we only have DomainStore; reach its attribute via name
    # Use the same key as DomainStore config; tests' Store stub exposes key
    # Save a v0 payload lacking required keys

    raw_store = HAStore(hass, 1, getattr(underlying, "key", "haventory_store"))
    await raw_store.async_save({"schema_version": 0})

    # Spy on migrations.migrate to ensure it's called
    calls = {"count": 0}

    def _spy_migrate(payload, *, from_version, to_version):  # type: ignore[no-untyped-def]
        calls["count"] += 1
        # no-op advance to target with required fields
        result = dict(payload)
        result.setdefault("items", {})
        result.setdefault("locations", {})
        result["schema_version"] = to_version
        return result

    monkeypatch.setattr(migrations, "migrate", _spy_migrate)

    # Act
    loaded = await store.async_load()

    # Assert
    assert calls["count"] >= 1
    assert loaded["schema_version"] == CURRENT_SCHEMA_VERSION
    assert loaded["items"] == {}
    assert loaded["locations"] == {}
