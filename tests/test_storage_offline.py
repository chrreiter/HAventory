"""Offline tests for HAventory storage manager.

Scenarios:
- Initial load returns an empty dataset with correct schema_version
- Save then load returns equal data (roundtrip)
- Migration hook is invoked when schema_version differs
- Migration failure raises StorageError and does not persist changes
- Corrupted payload (non-dict) raises StorageError
- A payload written by a newer schema is refused without rewriting the store
- A payload whose schema_version is not an integer is refused, never coerced
- A saved payload carries the stored collections and the schema number, nothing else
- A store still carrying `_generation` loads, and the key is not read back
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
from custom_components.haventory.migrations import ADOPTABLE_SCHEMA_VERSIONS
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORE_COLLECTIONS,
    DomainStore,
    async_backup_store,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore

#: What the load path fills in on an item that carries none of it — the fields a
#: store written before each of them existed lacks. A fixture naming them is one
#: the load hands back unchanged, which is what makes a roundtrip an equality.
_STORED_ITEM_FIELDS: dict[str, Any] = {
    "status": "ok",
    "attachments": [],
    "reminder_date": None,
    "reminder_interval": None,
    "reminder_anchor": None,
}

#: One above everything the amnesty covers: a store no build of this project
#: wrote, and the only kind the downgrade refusal is left for.
BEYOND_THE_ADOPTABLE_RANGE = max(ADOPTABLE_SCHEMA_VERSIONS) + 1

#: A counter value no fresh load could reach, so reading it back would be visible.
STALE_GENERATION = 17


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
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 50, **_STORED_ITEM_FIELDS}},
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
async def test_a_store_stamped_before_the_collapse_gave_v1_its_meaning_is_filled_in() -> None:
    """A store stamped 1 by an early build reads as current and predates every field.

    Nothing about the number says which of the two v1s it is, so the load fills
    in what is absent either way. Without that, such a store reaches the
    repository with no ``statuses`` collection and no per-item status.
    """

    hass = HomeAssistant()
    key = "test_store_early_v1"
    store = DomainStore(hass, key=key)

    pre_payload = {
        "schema_version": 1,
        "items": {"i1": {"id": "i1", "name": "Screws", "quantity": 5}},
        "locations": {"l1": {"id": "l1", "name": "Garage"}},
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(pre_payload))

    loaded = await store.async_load()

    assert loaded["schema_version"] == CURRENT_SCHEMA_VERSION
    assert loaded["items"] == {"i1": {**pre_payload["items"]["i1"], **_STORED_ITEM_FIELDS}}
    assert loaded["locations"] == pre_payload["locations"]
    assert sorted(loaded["statuses"]) == ["missing", "needs_repair", "ok"]

    # Written back, so the next boot is the ordinary one.
    persisted = await raw_store.async_load()
    assert persisted["items"]["i1"]["status"] == "ok"
    assert sorted(persisted["statuses"]) == ["missing", "needs_repair", "ok"]


@pytest.mark.asyncio
async def test_a_store_already_holding_everything_is_not_rewritten(monkeypatch) -> None:
    """A current store that needs no fill is handed back without touching the file.

    Every boot reads the store; a load that wrote it back unconditionally would
    rewrite the whole inventory on each of them for nothing.
    """

    hass = HomeAssistant()
    key = "test_store_current_untouched"
    store = DomainStore(hass, key=key)

    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    repo = Repository()
    repo.create_item(ItemCreate(name="Screws"))
    stored = {"schema_version": CURRENT_SCHEMA_VERSION, **repo.export_state()}
    await raw_store.async_save(deepcopy(stored))

    writes: list[dict[str, Any]] = []

    async def _record(payload: dict[str, Any]) -> None:
        writes.append(payload)

    monkeypatch.setattr(store._store, "async_save", _record)
    loaded = await store.async_load()

    assert writes == []
    assert loaded == stored


@pytest.mark.asyncio
@pytest.mark.parametrize("stored_version", [0, *sorted(ADOPTABLE_SCHEMA_VERSIONS)])
async def test_every_version_this_build_accepts_lands_at_v1(stored_version: int) -> None:
    """A store from anywhere in the project's history loads, intact, stamped v1.

    The versions above the current one are the ones the amnesty takes in; 0 is a
    store with no stamp at all. Both end up at the collapsed version with the
    same fields filled in, because what a store carries is what it was written
    with, not what its number claims.
    """

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
    assert loaded["items"] == {"i1": {**pre_payload["items"]["i1"], **_STORED_ITEM_FIELDS}}
    assert loaded["locations"] == pre_payload["locations"]
    assert sorted(loaded["statuses"]) == ["missing", "needs_repair", "ok"]

    # Restamped on disk, so the crossing happens once.
    persisted = await raw_store.async_load()
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION

    # And a second load is the first one again.
    assert await store.async_load() == loaded


@pytest.mark.asyncio
async def test_newer_schema_version_is_refused_and_store_untouched() -> None:
    """A payload from a newer build is refused; the store is left byte-for-byte intact.

    "Newer" is anything above the amnesty, which is the only kind of newer left:
    the versions inside it were written by this project before the collapse and
    are taken in instead.
    """

    hass = HomeAssistant()
    key = "test_store_newer_schema_refused"
    store = DomainStore(hass, key=key)

    newer_version = BEYOND_THE_ADOPTABLE_RANGE
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
async def test_a_store_stamped_above_the_amnesty_is_refused_whatever_it_holds() -> None:
    """The amnesty is a membership test, never "anything above the current one".

    A build that stamped something past the project's own range knows a shape
    this one does not — a status ``color`` outside the vocabulary it validates,
    say, whose definition would be skipped on load and every item carrying its
    slug rewritten to the default on the next save. Refusing without a rewrite
    is what leaves that data for a build that understands it.
    """

    hass = HomeAssistant()
    key = "test_store_above_the_amnesty"

    written_by_a_newer_build = {
        "schema_version": BEYOND_THE_ADOPTABLE_RANGE,
        "items": {"i1": {"id": "i1", "name": "Drill", "status": "loaned", "attachments": []}},
        "locations": {},
        "statuses": {
            "loaned": {
                "slug": "loaned",
                "label": "Loaned out",
                "order": 1,
                "color": "#3366cc",
                "icon": "check",
            }
        },
    }
    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(deepcopy(written_by_a_newer_build))

    with pytest.raises(SchemaDowngradeError):
        await DomainStore(hass, key=key).async_load()

    assert await raw_store.async_load() == written_by_a_newer_build


@pytest.mark.asyncio
async def test_newer_schema_version_never_reaches_migrations(monkeypatch) -> None:
    """The refusal happens before ``migrations.migrate`` is consulted."""

    hass = HomeAssistant()
    key = "test_store_newer_schema_skips_migrate"
    store = DomainStore(hass, key=key)

    raw_store = HAStore(hass, CURRENT_SCHEMA_VERSION, key)
    await raw_store.async_save(
        {"schema_version": BEYOND_THE_ADOPTABLE_RANGE + 2, "items": {}, "locations": {}}
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
async def test_a_saved_payload_carries_nothing_beyond_the_stored_collections() -> None:
    """The store holds the household's data and the schema number, and nothing else.

    The guard below runs the other way — every collection the store defines must
    be emitted. This one closes the gap on that side: a key the repository emits
    but the store knows nothing about is written to disk anyway, read back into
    the load path, and becomes a field of the stored shape that nobody decided
    on. ``_generation`` was one for the whole dev range.
    """

    hass = HomeAssistant()
    store = DomainStore(hass, key="test_store_saved_payload_keys")
    repo = Repository()
    where = repo.create_location(name="Garage")
    repo.create_item(ItemCreate(name="Screws", location_id=str(where.id)))

    await store.async_save(repo.export_state())
    written = await store.async_load()

    assert set(written) == {*STORE_COLLECTIONS, "schema_version"}


@pytest.mark.asyncio
async def test_a_store_written_before_the_generation_was_dropped_still_loads() -> None:
    """Every store this build inherits carries the key, and none of them may refuse.

    Dropping the key took no schema bump — a build that no longer writes it and
    one that never wrote it are the same store to read — so nothing rewrites the
    stores that have it. They have to keep loading, and the key has to survive
    until the next save rather than making the load fail.
    """

    hass = HomeAssistant()
    store = DomainStore(hass, key="test_store_stale_generation_key")
    repo = Repository()
    repo.create_item(ItemCreate(name="Screws"))
    legacy = {**repo.export_state(), "_generation": STALE_GENERATION}

    await store.async_save(legacy)
    payload = await store.async_load()
    reloaded = Repository.from_state(payload)

    assert payload["_generation"] == STALE_GENERATION
    assert [item.name for item in reloaded.list_items()["items"]] == ["Screws"]


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


@pytest.mark.asyncio
async def test_save_leaves_the_caller_payload_alone() -> None:
    """The defaults the save stamps on land on its own dict, not the caller's.

    A payload built for one save would otherwise come back carrying a
    ``schema_version`` it never had, which a caller comparing two exports — or
    building an export document — would then have to strip.
    """

    hass = HomeAssistant()
    store = DomainStore(hass, key="test_store_caller_payload")
    payload: dict[str, Any] = {"items": {}}

    await store.async_save(payload)

    assert payload == {"items": {}}
    assert "schema_version" not in payload
    assert (await store.async_load())["schema_version"] == CURRENT_SCHEMA_VERSION


@pytest.mark.asyncio
async def test_a_later_mutation_cannot_reach_what_was_stored() -> None:
    """Editing the inventory after a save does not rewrite the saved payload.

    The save copies one level deep, so the isolation comes from
    ``export_state`` building fresh collections rather than from the store
    duplicating them. This is the property that has to hold; if a future export
    starts handing out the repository's own dicts, this test is what fails.
    """

    hass = HomeAssistant()
    store = DomainStore(hass, key="test_store_post_save_mutation")
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Hammer", quantity=1))

    await store.async_save(repo.export_state())

    repo.update_item(str(item.id), {"name": "Renamed", "quantity": 99})
    repo.create_item(ItemCreate(name="Second", quantity=1))

    stored = await store.async_load()
    assert [entry["name"] for entry in stored["items"].values()] == ["Hammer"]
    assert next(iter(stored["items"].values()))["quantity"] == 1


@pytest.mark.asyncio
async def test_save_does_not_duplicate_the_dataset(monkeypatch) -> None:
    """What reaches Home Assistant's Store is the caller's collections, not copies.

    Copying them costs the event loop a second full pass over the inventory on
    every mutation, which is the whole reason the save copies one level and not
    more. A deep copy reintroduced here would pass every other test in this file
    and only show up as a growing stall on a large store.
    """

    hass = HomeAssistant()
    store = DomainStore(hass, key="test_store_no_duplication")
    seen: list[dict[str, Any]] = []

    async def _capture(payload: dict[str, Any]) -> None:
        seen.append(payload)

    monkeypatch.setattr(store._store, "async_save", _capture)
    repo = Repository()
    repo.create_item(ItemCreate(name="Hammer", quantity=1))
    payload = repo.export_state()

    await store.async_save(payload)

    assert len(seen) == 1
    for name in STORE_COLLECTIONS:
        assert seen[0][name] is payload[name], name


@pytest.mark.asyncio
async def test_the_backup_copies_the_file_as_it_is() -> None:
    """The corrupt-store repair needs the unreadable rows, not a cleaned-up version.

    `DomainStore` migrates, normalizes and refuses; a copy taken through it
    would leave out exactly what the user might want back, or refuse to take one
    at all. So the backup goes straight to Home Assistant's `Store`.
    """

    hass = HomeAssistant()
    source_key = "test_backup_source"
    backup_key = "test_backup_target"
    stored = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "locations": {},
        "items": {"not-a-uuid": {"id": "not-a-uuid", "name": "Broken"}},
    }
    await HAStore(hass, 1, source_key).async_save(deepcopy(stored))

    assert await async_backup_store(hass, source_key=source_key, backup_key=backup_key) is True

    assert await HAStore(hass, 1, backup_key).async_load() == stored
    # And the original is where it was: the copy is a copy, not a move.
    assert await HAStore(hass, 1, source_key).async_load() == stored


@pytest.mark.asyncio
async def test_the_backup_reports_that_there_was_nothing_to_copy() -> None:
    """No stored file means no guard to offer, which the caller has to be able to see."""

    hass = HomeAssistant()

    assert await async_backup_store(hass, source_key="test_backup_absent") is False
