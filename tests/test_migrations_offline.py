"""Offline tests for HAventory storage migrations.

Scenarios:
- Older version N → current version: transformed shape and version update
- No-op when already current; idempotency on repeated runs
- Empty file / missing keys → safe defaults
- Backwards migration → refused rather than passed through and relabelled
- Corrupt payload / loader exception → logged with context and safe fallback
"""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import SchemaDowngradeError, StorageError
from custom_components.haventory.migrations import migrate, migrate_5_to_6
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORE_COLLECTIONS,
    DomainStore,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore


@pytest.mark.asyncio
async def test_older_version_is_migrated_to_current() -> None:
    """Older payload is upgraded to the current schema with required keys."""

    # Arrange: simulate a v0 payload missing required keys
    payload: dict[str, Any] = {"schema_version": 0}

    # Act
    migrated = migrate(payload, from_version=0, to_version=CURRENT_SCHEMA_VERSION)

    # Assert
    assert migrated["schema_version"] == CURRENT_SCHEMA_VERSION
    assert isinstance(migrated.get("items"), dict)
    assert isinstance(migrated.get("locations"), dict)


@pytest.mark.asyncio
async def test_noop_when_already_current_and_idempotent() -> None:
    """Current-version payload is preserved and repeated applications are idempotent."""

    # Arrange
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    # Act
    migrated1 = migrate(
        payload,
        from_version=CURRENT_SCHEMA_VERSION,
        to_version=CURRENT_SCHEMA_VERSION,
    )
    migrated2 = migrate(
        migrated1,
        from_version=CURRENT_SCHEMA_VERSION,
        to_version=CURRENT_SCHEMA_VERSION,
    )

    # Assert: equal structure preserved and stable across repeated calls
    assert migrated1 == payload
    assert migrated2 == payload


@pytest.mark.asyncio
async def test_missing_keys_and_empty_payload_safe_defaults() -> None:
    """Migration fills in defaults when keys are missing or input is empty/invalid."""

    # Missing keys but has schema_version 0
    migrated_missing = migrate(
        {"schema_version": 0}, from_version=0, to_version=CURRENT_SCHEMA_VERSION
    )
    assert migrated_missing["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated_missing["items"] == {}
    assert migrated_missing["locations"] == {}

    # Empty dict without schema_version (treated as v0 by caller of migrate)
    migrated_empty = migrate({}, from_version=0, to_version=CURRENT_SCHEMA_VERSION)
    assert migrated_empty["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated_empty["items"] == {}
    assert migrated_empty["locations"] == {}

    # Non-dict payload input should be tolerated by step functions; driver normalizes
    migrated_non_dict = migrate("oops", from_version=0, to_version=CURRENT_SCHEMA_VERSION)  # type: ignore[arg-type]
    assert migrated_non_dict["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated_non_dict["items"] == {}
    assert migrated_non_dict["locations"] == {}


@pytest.mark.asyncio
async def test_downgrade_is_refused_rather_than_relabelled() -> None:
    """A backwards migration raises instead of passing the payload through.

    Passing it through is the dangerous half: the caller stamps ``to_version``
    onto whatever comes back, so data written by a schema this build cannot read
    would be relabelled as one it can.
    """

    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}
    before = deepcopy(payload)

    with pytest.raises(SchemaDowngradeError) as excinfo:
        migrate(payload, from_version=CURRENT_SCHEMA_VERSION, to_version=CURRENT_SCHEMA_VERSION - 1)

    # Both versions named, so a caller's log says which direction was asked for.
    message = str(excinfo.value)
    assert str(CURRENT_SCHEMA_VERSION) in message
    assert str(CURRENT_SCHEMA_VERSION - 1) in message

    # A refusal touches nothing.
    assert payload == before
    assert isinstance(excinfo.value, StorageError)


@pytest.mark.asyncio
async def test_log_context_on_corrupted_payload_via_storage(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Storage logs contextual fields when encountering corrupted payload (non-dict)."""

    # We exercise this via the DomainStore API because logging is implemented there.
    caplog.set_level(logging.ERROR)

    hass = HomeAssistant()
    key = "test_migrate_log_context_corrupt"
    store = DomainStore(hass, key=key)
    raw_store = HAStore(hass, 1, key)

    # Save a corrupted payload (string)
    await raw_store.async_save("oops")

    with pytest.raises(StorageError):
        await store.async_load()

    # Assert log record includes structured context
    found = False
    for rec in caplog.records:
        if (
            rec.levelno >= logging.ERROR
            and getattr(rec, "op", None) == "migrate"
            and getattr(rec, "domain", None) == DOMAIN
        ):
            found = True
            assert getattr(rec, "storage_key", None) == key
            assert getattr(rec, "to_version", None) == store.schema_version
            break
    assert found, "expected migration error log with context"


def test_the_migration_chain_produces_every_stored_collection() -> None:
    """A store crossing a version boundary arrives holding every collection.

    ``async_load`` backfills ``STORE_COLLECTIONS`` only on the branch where the
    stored version already matches; a payload that goes through ``migrate`` comes
    back as whatever the chain produced. So the chain, not the backfill, is what
    an *upgrading* store depends on — and the backfill deliberately does not cover
    it, because a new collection generally needs deriving rather than defaulting
    to empty, and a silent ``{}`` would hide the missing step exactly the way the
    erased-collection bug it guards against was hidden.

    Adding a name to ``STORE_COLLECTIONS`` without a migration step that produces
    it fails here.
    """

    migrated = migrate({}, from_version=0, to_version=CURRENT_SCHEMA_VERSION)

    missing = [name for name in STORE_COLLECTIONS if name not in migrated]
    assert not missing, (
        f"the 0 -> {CURRENT_SCHEMA_VERSION} chain produces no {missing}; an existing "
        f"store would finish migrating without them"
    )


# -----------------------------
# v5 -> v6: statuses + attachments (one step for the whole milestone)
# -----------------------------


def _v5_payload(**items: Any) -> dict[str, Any]:
    return {
        "schema_version": 5,
        "items": dict(items),
        "locations": {},
    }


def test_v5_to_v6_seeds_exactly_the_three_built_ins() -> None:
    out = migrate(_v5_payload(), from_version=5, to_version=6)

    assert out["statuses"] == {
        "ok": {"slug": "ok", "label": "OK", "order": 0},
        "missing": {"slug": "missing", "label": "Missing", "order": 1},
        "needs_repair": {"slug": "needs_repair", "label": "Needs repair", "order": 2},
    }


def test_v5_to_v6_backfills_attachments_on_every_item() -> None:
    payload = _v5_payload(
        i1={"id": "i1", "name": "Drill", "status": "ok"},
        i2={"id": "i2", "name": "Saw", "status": "missing"},
    )

    out = migrate(payload, from_version=5, to_version=6)

    assert out["items"]["i1"]["attachments"] == []
    assert out["items"]["i2"]["attachments"] == []


def test_v5_to_v6_leaves_an_item_that_already_carries_one_untouched() -> None:
    existing = [
        {
            "id": "3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f",
            "kind": "picture",
            "filename": "photo.png",
            "mime": "image/png",
            "size": 12,
            "uploaded_at": "2026-08-05T10:00:00Z",
        }
    ]
    payload = _v5_payload(i1={"id": "i1", "name": "Drill", "attachments": existing})

    out = migrate(payload, from_version=5, to_version=6)

    assert out["items"]["i1"]["attachments"] == existing


def test_v5_to_v6_keeps_a_status_definition_it_did_not_seed() -> None:
    """A hand-added or later-release definition survives the seeding step."""

    payload = _v5_payload()
    payload["statuses"] = {"lent_out": {"slug": "lent_out", "label": "Lent out", "order": 9}}

    out = migrate(payload, from_version=5, to_version=6)

    assert out["statuses"]["lent_out"] == {"slug": "lent_out", "label": "Lent out", "order": 9}
    assert set(out["statuses"]) == {"lent_out", "ok", "missing", "needs_repair"}


def test_v5_to_v6_is_idempotent() -> None:
    """The step itself, re-applied — not the driver, which would skip it."""

    payload = _v5_payload(i1={"id": "i1", "name": "Drill"})

    once = migrate_5_to_6(deepcopy(payload))
    twice = migrate_5_to_6(deepcopy(once))

    assert twice == once
