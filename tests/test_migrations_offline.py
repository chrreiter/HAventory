"""Offline tests for HAventory schema handling."""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import SchemaDowngradeError, StorageError
from custom_components.haventory.migrations import PRE_COLLAPSE_SCHEMA_VERSIONS, migrate
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore


def test_older_version_is_stamped_with_the_current_one() -> None:
    """A payload below the current version comes back carrying it."""

    payload: dict[str, Any] = {"schema_version": 0, "items": {}, "locations": {}}

    migrated = migrate(payload, from_version=0, to_version=CURRENT_SCHEMA_VERSION)

    assert migrated["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated["items"] == {}
    assert migrated["locations"] == {}


def test_noop_when_already_current_and_idempotent() -> None:
    """Current-version payload is preserved and repeated applications are idempotent."""

    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

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

    assert migrated1 == payload
    assert migrated2 == payload


def test_the_driver_does_not_alias_or_crash_on_what_it_is_given() -> None:
    """A caller's dict is never the stamped one, and a non-dict is tolerated."""

    payload: dict[str, Any] = {"schema_version": 0, "items": {"i1": {"id": "i1"}}}

    migrated = migrate(payload, from_version=0, to_version=CURRENT_SCHEMA_VERSION)
    migrated["items"]["i1"]["name"] = "Screws"

    assert "name" not in payload["items"]["i1"]
    assert payload["schema_version"] == 0

    migrated_non_dict = migrate("oops", from_version=0, to_version=CURRENT_SCHEMA_VERSION)  # type: ignore[arg-type]
    assert migrated_non_dict == {"schema_version": CURRENT_SCHEMA_VERSION}


def test_downgrade_is_refused_rather_than_relabelled() -> None:
    """A backwards migration raises instead of passing the payload through.

    Passing it through is the dangerous half: the caller stamps ``to_version``
    onto whatever comes back, so data written by a schema this build cannot read
    would be relabelled as one it can.
    """

    payload = {"schema_version": CURRENT_SCHEMA_VERSION + 1, "items": {}, "locations": {}}
    before = deepcopy(payload)

    with pytest.raises(SchemaDowngradeError) as excinfo:
        migrate(payload, from_version=CURRENT_SCHEMA_VERSION + 1, to_version=CURRENT_SCHEMA_VERSION)

    # Both versions named, so a caller's log says which direction was asked for.
    message = str(excinfo.value)
    assert str(CURRENT_SCHEMA_VERSION + 1) in message
    assert str(CURRENT_SCHEMA_VERSION) in message

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


def test_the_pre_collapse_set_starts_right_above_the_current_schema() -> None:
    """Every member is a refusal, and nothing at or below the current version is.

    The set decides which of the two refusals a stamp gets, so a member the
    forward path also claims would be told to install 0.8.x for a store this
    build reads perfectly well.
    """

    assert min(PRE_COLLAPSE_SCHEMA_VERSIONS) == CURRENT_SCHEMA_VERSION + 1
    assert 0 not in PRE_COLLAPSE_SCHEMA_VERSIONS
