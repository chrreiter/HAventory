"""Offline tests for HAventory storage manager.

Scenarios:
- Initial load returns an empty dataset with correct schema_version
- Save then load returns equal data (roundtrip)
- Migration hook is invoked when schema_version differs
- Migration failure raises StorageError and does not persist changes
- Corrupted payload (non-dict) raises StorageError
"""

from __future__ import annotations

import pytest
from custom_components.haventory import migrations
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore


@pytest.mark.asyncio
async def test_initial_load_returns_empty_dataset() -> None:
    """First load initializes an empty dataset."""

    # Arrange
    hass = HomeAssistant()
    store = DomainStore(hass, key="test_store_initial_clean")

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
    store = DomainStore(hass, key="test_store_roundtrip")
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
async def test_repository_roundtrip_via_export_and_load() -> None:
    """Repository export to store and load back yields equivalent state."""

    hass = HomeAssistant()
    store = DomainStore(hass)

    # Build a small repo
    repo = Repository()
    loc = repo.create_location(name="Garage")
    item = repo.create_item({"name": "Screws", "quantity": 50, "location_id": loc.id})

    # Persist
    await store.async_save(repo.export_state())

    # Load and hydrate a new repo
    payload = await store.async_load()
    repo2 = Repository.from_state(payload)

    # Compare a couple of properties
    assert repo2.get_location(loc.id).name == "Garage"
    assert repo2.get_item(item.id).name == "Screws"


@pytest.mark.asyncio
async def test_repository_roundtrip_preserves_string_area_ids_and_filtering() -> None:
    """Storage roundtrip preserves location.area_id (string) and allows area filtering."""

    hass = HomeAssistant()
    store = DomainStore(hass, key="test_store_roundtrip_area_strings")

    repo = Repository()
    loc = repo.create_location(name="Pantry", area_id="kitchen")
    it = repo.create_item({"name": "Spices", "location_id": loc.id})

    await store.async_save(repo.export_state())
    payload = await store.async_load()
    repo2 = Repository.from_state(payload)

    # area_id preserved
    assert repo2.get_location(loc.id).name == "Pantry"
    # list by area works
    page = repo2.list_items(flt={"area_id": "kitchen"})  # type: ignore[typeddict-item]
    assert [x.id for x in page["items"]] == [it.id]


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


@pytest.mark.asyncio
async def test_migration_failure_raises_and_does_not_persist(monkeypatch) -> None:
    """Migration failure raises StorageError and leaves on-disk payload unchanged."""

    # Arrange
    hass = HomeAssistant()
    key = "test_store_migrate_failure_no_persist"
    store = DomainStore(hass, key=key)

    # Seed an older valid payload directly into underlying storage
    pre_payload = {"schema_version": 0, "items": {"i1": {"id": "i1"}}, "locations": {}}
    raw_store = HAStore(hass, 1, key)
    await raw_store.async_save(pre_payload)

    # Make migrate raise
    def _raise(_payload, *, from_version, to_version):  # type: ignore[no-untyped-def]
        raise RuntimeError("boom")

    monkeypatch.setattr(migrations, "migrate", _raise)

    # Act + Assert
    with pytest.raises(StorageError):
        await store.async_load()

    # Assert on-disk payload was not overwritten
    underlying = await raw_store.async_load()
    assert underlying == pre_payload


@pytest.mark.asyncio
async def test_corrupted_payload_non_dict_raises_storage_error() -> None:
    """Non-dict payload in storage should raise StorageError on load."""

    # Arrange
    hass = HomeAssistant()
    key = "test_store_corrupted_payload"
    store = DomainStore(hass, key=key)
    raw_store = HAStore(hass, 1, key)
    # Save a corrupted payload (string instead of dict)
    await raw_store.async_save("oops")

    # Act + Assert
    with pytest.raises(StorageError):
        await store.async_load()
