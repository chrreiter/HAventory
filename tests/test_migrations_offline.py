"""Offline tests for HAventory storage migrations.

Scenarios:
- Older version N → current version: transformed shape and version update
- No-op when already current; idempotency on repeated runs
- Empty file / missing keys → safe defaults
- Corrupt payload / loader exception → logged with context and safe fallback
"""

from __future__ import annotations

import logging
from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.migrations import migrate
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
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
async def test_downgrade_returns_original(caplog: pytest.LogCaptureFixture) -> None:
    """Downgrade returns original payload; migrate stays quiet."""

    caplog.set_level(logging.DEBUG)
    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    # Act: request a downgrade path (from_version > to_version)
    result = migrate(
        payload, from_version=CURRENT_SCHEMA_VERSION, to_version=CURRENT_SCHEMA_VERSION - 1
    )

    # Assert: original returned unchanged; we don't enforce specific log content
    assert result is payload or result == payload
    # No strict log assertion since migrate() intentionally stays quiet for downgrades


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
