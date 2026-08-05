"""Offline tests for HAventory storage manager.

Scenarios:
- Initial load returns an empty dataset with correct schema_version
- Save then load returns equal data (roundtrip)
- Migration hook is invoked when schema_version differs
- Migration failure raises StorageError and does not persist changes
- Corrupted payload (non-dict) raises StorageError
- A payload written by a newer schema is refused without rewriting the store
- A payload whose schema_version is not an integer is refused, never coerced
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest
from custom_components.haventory import migrations
from custom_components.haventory.exceptions import (
    CorruptSchemaVersionError,
    SchemaDowngradeError,
    StorageError,
)
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORE_COLLECTIONS,
    DomainStore,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore

#: Schema versions that introduced each backfill, so a payload stored below one
#: is the payload that step rewrites.
_STATUS_BACKFILL_VERSION = 5
_ATTACHMENTS_BACKFILL_VERSION = 6


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
        # Save backfills any collection the caller omits, so naming every one
        # of them is what keeps this an equality test rather than a subset one.
        "statuses": {},
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

    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, getattr(underlying, "key", "haventory_store"))
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
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
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
async def test_migration_from_v1_to_current_preserves_payload() -> None:
    """v1 payload migrates to current schema and persists updated version."""

    hass = HomeAssistant()
    key = "test_store_migrate_v1_to_current"
    store = DomainStore(hass, key=key)

    pre_payload = {
        "schema_version": 1,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(pre_payload)

    migrated = await store.async_load()

    assert migrated["schema_version"] == CURRENT_SCHEMA_VERSION
    # v4 -> v5 backfills the per-item status and v5 -> v6 the attachment list;
    # everything else passes through.
    expected_items = {"i1": {**pre_payload["items"]["i1"], "status": "ok", "attachments": []}}
    assert migrated["items"] == expected_items
    assert migrated["locations"] == pre_payload["locations"]
    # v6 seeds the status definitions the items' slugs resolve against.
    assert sorted(migrated["statuses"]) == ["missing", "needs_repair", "ok"]
    # on-disk should be updated to current schema_version
    persisted = await raw_store.async_load()
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION


@pytest.mark.asyncio
@pytest.mark.parametrize("stored_version", range(CURRENT_SCHEMA_VERSION + 1))
async def test_equal_and_older_versions_still_load(stored_version: int) -> None:
    """Every version up to and including the current one loads and ends up current."""

    hass = HomeAssistant()
    key = f"test_store_forward_load_v{stored_version}"
    store = DomainStore(hass, key=key)

    pre_payload = {
        "schema_version": stored_version,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    loaded = await store.async_load()

    assert loaded["schema_version"] == CURRENT_SCHEMA_VERSION
    # Each step only runs for a payload below it: migrate_4_to_5 backfills the
    # status, migrate_5_to_6 the attachment list. A payload already at the
    # current version is normalized, never migrated.
    expected_items = deepcopy(pre_payload["items"])
    if stored_version < _STATUS_BACKFILL_VERSION:
        expected_items["i1"]["status"] = "ok"
    if stored_version < _ATTACHMENTS_BACKFILL_VERSION:
        expected_items["i1"]["attachments"] = []
    assert loaded["items"] == expected_items
    assert loaded["locations"] == pre_payload["locations"]


@pytest.mark.asyncio
async def test_newer_schema_version_is_refused_and_store_untouched() -> None:
    """A payload from a newer build is refused; the store is left byte-for-byte intact."""

    hass = HomeAssistant()
    key = "test_store_newer_schema_refused"
    store = DomainStore(hass, key=key)

    newer_version = CURRENT_SCHEMA_VERSION + 1
    pre_payload = {
        "schema_version": newer_version,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5, "future_field": True}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    with pytest.raises(SchemaDowngradeError) as excinfo:
        await store.async_load()

    # The message names both versions so the user knows which build to run.
    message = str(excinfo.value)
    assert str(newer_version) in message
    assert str(CURRENT_SCHEMA_VERSION) in message

    # A downgrade refusal is a storage failure, so existing handlers still map it.
    assert isinstance(excinfo.value, StorageError)

    # Nothing was rewritten: version, unknown fields and all.
    assert await raw_store.async_load() == pre_payload


@pytest.mark.asyncio
async def test_newer_schema_version_never_reaches_migrations(monkeypatch) -> None:
    """The refusal happens before ``migrations.migrate`` is consulted."""

    hass = HomeAssistant()
    key = "test_store_newer_schema_skips_migrate"
    store = DomainStore(hass, key=key)

    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(
        {"schema_version": CURRENT_SCHEMA_VERSION + 3, "items": {}, "locations": {}}
    )

    def _fail(_payload, *, from_version, to_version):  # type: ignore[no-untyped-def]
        raise AssertionError("migrations.migrate must not run for a newer payload")

    monkeypatch.setattr(migrations, "migrate", _fail)

    with pytest.raises(SchemaDowngradeError):
        await store.async_load()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("label", "stored"),
    [
        ("null", None),
        ("numeric_string", "4"),
        ("word", "abc"),
        ("float", 4.0),
        ("bool", True),
        ("list", [4]),
        ("dict", {"v": 4}),
    ],
)
async def test_corrupt_schema_version_is_refused_and_store_untouched(
    label: str, stored: Any
) -> None:
    """A non-integer schema_version is named as corruption, not coerced or crashed on."""

    hass = HomeAssistant()
    key = f"test_store_corrupt_version_{label}"
    store = DomainStore(hass, key=key)

    pre_payload = {
        "schema_version": stored,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    with pytest.raises(CorruptSchemaVersionError) as excinfo:
        await store.async_load()

    # The message quotes the offending value back, so `"4"` is distinguishable
    # from `4` in the log — that pair is exactly what coercion used to hide.
    message = str(excinfo.value)
    assert "schema_version" in message
    assert repr(stored) in message

    # Still a storage failure, so every existing handler keeps mapping it.
    assert isinstance(excinfo.value, StorageError)

    # Refusing means refusing to write, too.
    assert await raw_store.async_load() == pre_payload


@pytest.mark.asyncio
async def test_corrupt_schema_version_message_is_bounded() -> None:
    """A huge value under the key is truncated, not pasted into the error state."""

    hass = HomeAssistant()
    key = "test_store_corrupt_version_huge"
    store = DomainStore(hass, key=key)

    huge = "x" * 5000
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save({"schema_version": huge, "items": {}, "locations": {}})

    with pytest.raises(CorruptSchemaVersionError) as excinfo:
        await store.async_load()

    message = str(excinfo.value)
    assert huge not in message
    assert "…" in message
    assert len(message) < len(huge)


@pytest.mark.asyncio
async def test_corrupt_schema_version_never_reaches_migrations(monkeypatch) -> None:
    """The refusal happens before ``migrations.migrate`` is consulted."""

    hass = HomeAssistant()
    key = "test_store_corrupt_version_skips_migrate"
    store = DomainStore(hass, key=key)

    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save({"schema_version": None, "items": {}, "locations": {}})

    def _fail(_payload, *, from_version, to_version):  # type: ignore[no-untyped-def]
        raise AssertionError("migrations.migrate must not run for a corrupt version")

    monkeypatch.setattr(migrations, "migrate", _fail)

    with pytest.raises(CorruptSchemaVersionError):
        await store.async_load()


@pytest.mark.asyncio
async def test_absent_schema_version_still_loads_as_version_zero() -> None:
    """A missing key is not corruption: it means v0 and migrates forward."""

    hass = HomeAssistant()
    key = "test_store_missing_version"
    store = DomainStore(hass, key=key)

    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save({"items": {"i1": {"id": "i1", "name": "Screws"}}, "locations": {}})

    loaded = await store.async_load()

    assert loaded["schema_version"] == CURRENT_SCHEMA_VERSION
    assert loaded["items"]["i1"]["name"] == "Screws"


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


@pytest.mark.asyncio
async def test_export_state_emits_every_stored_collection() -> None:
    """The repository must emit every collection the store persists.

    A save writes exactly ``Repository.export_state()``. The load path is wider —
    it keeps whatever the file holds — so a collection the store knows about but
    the repository does not emit survives a restart and is erased by the first
    save afterwards, with nothing logged. Adding a name to ``STORE_COLLECTIONS``
    without teaching the repository to emit it fails here instead.
    """

    repo = Repository()

    exported = repo.export_state()

    missing = [name for name in STORE_COLLECTIONS if name not in exported]
    assert not missing, (
        f"Repository.export_state() omits {missing}; the first save after boot "
        f"would erase them from the store"
    )


@pytest.mark.asyncio
async def test_a_stored_collection_survives_a_repository_roundtrip() -> None:
    """Every stored collection survives export -> save -> load -> export.

    The guard above pins the key set; this pins the contents, which is what a user
    actually loses. Entities are built through the repository API rather than
    hand-written dicts, so a drop here means the persistence path lost them and
    not that validation rejected a malformed fixture.
    """

    hass = HomeAssistant()
    key = "test_store_collection_roundtrip"
    store = DomainStore(hass, key=key)

    source = Repository()
    garage = source.create_location(name="Garage")
    source.create_item(ItemCreate(name="Drill", location_id=str(garage.id)))
    await store.async_save(source.export_state())

    restored = Repository()
    restored.load_state(await store.async_load())
    await store.async_save(restored.export_state())

    reloaded = await store.async_load()
    for name in STORE_COLLECTIONS:
        assert reloaded[name], f"{name} was emptied by the roundtrip"
    assert [i["name"] for i in reloaded["items"].values()] == ["Drill"]
    assert [loc["name"] for loc in reloaded["locations"].values()] == ["Garage"]
