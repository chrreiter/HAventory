"""Persistent storage manager for HAventory.

Wraps Home Assistant's Store with schema-aware load/save and migrations.

Data shape persisted (Phase 1):
    {
        "schema_version": int,
        "items": {id -> ItemDict},
        "locations": {id -> LocationDict},
    }

The manager ensures first load initializes an empty dataset and applies
forward-only migrations when an older schema payload is encountered.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Final, cast

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import migrations
from .const import DOMAIN
from .exceptions import (
    CorruptSchemaVersionError,
    NotLoadedError,
    SchemaDowngradeError,
    StorageError,
)
from .models import seed_status_definitions, serialize_status_definition

_LOGGER = logging.getLogger(__name__)

# Current schema version for persisted payloads
CURRENT_SCHEMA_VERSION: Final[int] = 6

# Storage key under which the persisted dataset is saved
STORAGE_KEY: Final[str] = "haventory_store"

# Debounce delay for persistence operations (seconds)
PERSIST_DEBOUNCE_DELAY: Final[float] = 1.0

# How much of a corrupt ``schema_version`` the refusal quotes back. The value is
# whatever the file holds, and the message reaches the config entry's error state
# in the UI, so a misplaced items dict landing on that key must not paste the
# whole inventory into it.
_MAX_REPORTED_VERSION_CHARS: Final[int] = 60


# Every top-level collection the stored payload carries, in one place because
# three call sites have to agree about the set: `_empty_payload`, `async_load`'s
# backfill, and `async_save`'s.
#
# The load path is wider than the save path by construction — `async_load` keeps
# whatever the file holds, while a save writes exactly what
# `Repository.export_state()` produced. A collection listed here that the
# repository does not emit is therefore read back correctly at boot and erased by
# the first save afterwards, with nothing logged. `tests/test_storage_offline.py`
# pins `export_state()` to this tuple so that mistake fails a test instead.
STORE_COLLECTIONS: Final[tuple[str, ...]] = ("items", "locations", "statuses")


def _empty_payload() -> dict[str, Any]:
    """Create a new empty payload matching the current schema.

    Returns a fresh dict each time to avoid shared mutation across callers.
    A fresh install starts with the built-in statuses seeded, which is also what
    an absent ``statuses`` section means everywhere else.
    """

    payload: dict[str, Any] = {"schema_version": CURRENT_SCHEMA_VERSION}
    payload.update({name: {} for name in STORE_COLLECTIONS})
    payload["statuses"] = {
        slug: serialize_status_definition(definition)
        for slug, definition in seed_status_definitions().items()
    }
    return payload


def schema_downgrade_message(*, stored_version: int, supported_version: int) -> str:
    """Build the refusal shown when stored data outranks this build.

    Shared by the storage layer and setup validation so both refusal paths tell
    the user the same thing.
    """

    return (
        f"stored data uses schema version {stored_version}, which is newer than this "
        f"build supports ({supported_version}); HAventory will not downgrade it. "
        "Upgrade HAventory to a version that understands this data, or restore a backup "
        "taken with this version. The stored data was left unchanged."
    )


def _corrupt_schema_version_message(value: object) -> str:
    """Build the refusal shown when ``schema_version`` is not an integer."""

    shown = repr(value)
    if len(shown) > _MAX_REPORTED_VERSION_CHARS:
        shown = shown[: _MAX_REPORTED_VERSION_CHARS - 1] + "…"
    return (
        f"stored data has a corrupt schema_version ({shown}); expected an integer. "
        "HAventory will not guess which schema this data uses. Repair the stored file "
        "or restore a backup, then reload HAventory. The stored data was left unchanged."
    )


def read_schema_version(payload: Mapping[str, Any], *, missing: int) -> int:
    """Read ``schema_version`` out of a stored payload, refusing to guess.

    A hand-edited or truncated store can hold anything under this key, and
    ``int()`` treats the two failure modes inconsistently: it raises on ``None``
    or ``"abc"``, and silently invents a version for anything it can parse —
    ``"4"`` becoming 4, ``True`` becoming 1 — so the data would be read, and
    rewritten, under a version the file never claimed. Only a genuine ``int`` is
    a version here; ``missing`` is what an absent key means to the caller.
    """

    if "schema_version" not in payload:
        return missing
    value = payload["schema_version"]
    if isinstance(value, bool) or not isinstance(value, int):
        raise CorruptSchemaVersionError(_corrupt_schema_version_message(value))
    return value


def _get_persist_lock(hass: HomeAssistant) -> asyncio.Lock:
    """Get or create the persistence lock for this hass instance.

    Returns a per-hass-instance asyncio.Lock to serialize persistence operations
    and prevent race conditions from concurrent saves.
    """
    bucket = hass.data.setdefault(DOMAIN, {})
    if "persist_lock" not in bucket:
        bucket["persist_lock"] = asyncio.Lock()
    return cast("asyncio.Lock", bucket["persist_lock"])


class DomainStore:
    """Schema-aware wrapper around Home Assistant's Store for HAventory.

    This class centralizes storage access and schema migrations. It should be
    exposed via ``hass.data[DOMAIN]["store"]``.

    Note: HA's Store version is fixed at 1 to avoid HA's internal migration
    mechanism. All versioning is handled via `schema_version` in the payload.
    """

    # HA Store wrapper version - always 1 to avoid HA's migration mechanism
    _HA_STORE_VERSION: Final[int] = 1

    def __init__(
        self, hass: HomeAssistant, *, key: str = STORAGE_KEY, version: int = CURRENT_SCHEMA_VERSION
    ) -> None:
        self._hass = hass
        # Use constant HA Store version; our schema_version handles migrations
        self._store: Store[dict[str, Any]] = Store(hass, self._HA_STORE_VERSION, key)
        self._schema_version = version

    @property
    def schema_version(self) -> int:
        return self._schema_version

    @property
    def key(self) -> str:
        # Store exposes ``key`` in tests via stub; keep a stable attribute here
        return getattr(self._store, "key", STORAGE_KEY)

    async def async_load(self) -> dict[str, Any]:
        """Load the persisted dataset, applying migrations if needed.

        Returns a copy of the data to prevent external mutation of the cached
        object inside the storage layer.
        """

        raw = await self._store.async_load()
        if raw is None:
            return _empty_payload()

        # Defensive: missing schema_version means treat as version 0
        from_version = read_schema_version(raw, missing=0) if isinstance(raw, dict) else 0

        if from_version != self._schema_version:
            migrated = await self.async_migrate_if_needed(raw)
            return deepcopy(migrated)

        # Ensure required keys exist (older stubs or external mutations)
        data: dict[str, Any] = {"schema_version": self._schema_version}
        data.update({name: {} for name in STORE_COLLECTIONS})
        if isinstance(raw, dict):
            data.update(raw)
        return deepcopy(data)

    async def async_save(self, data: dict[str, Any]) -> None:
        """Persist the dataset, ensuring schema_version is up to date.

        The copy is one level deep: enough that the defaults below land on this
        method's dict rather than the caller's, and no deeper. The collections
        underneath are handed over, not duplicated — ``Repository.export_state``
        builds every one of them fresh on each call and keeps no reference, so a
        deep copy would rebuild the whole dataset a second time on the event
        loop for nothing. At a thousand items that copy measured longer than
        building the payload and encoding it put together, and it grows with the
        inventory the way both of those do.
        """

        payload = dict(data) if isinstance(data, dict) else {}
        payload.setdefault("schema_version", self._schema_version)
        for name in STORE_COLLECTIONS:
            payload.setdefault(name, {})
        await self._store.async_save(payload)

    async def async_migrate_if_needed(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Migrate ``raw`` payload to the current schema iff needed.

        If a migration occurs, persist the migrated payload back to storage.
        Returns the migrated (or original) payload.

        Raises ``SchemaDowngradeError`` when ``raw`` was written by a newer schema
        version than this build supports, and ``CorruptSchemaVersionError`` when
        it carries no readable version at all. Both leave the stored payload
        untouched.
        """

        if not isinstance(raw, dict):  # Corrupted or unexpected
            _LOGGER.error(
                "Corrupted storage payload: expected dict, got %s",
                type(raw).__name__,
                extra={
                    "domain": DOMAIN,
                    "op": "migrate",
                    "from_version": None,
                    "to_version": self._schema_version,
                    "storage_key": self.key,
                },
            )
            raise StorageError("corrupted storage payload: not a dict")

        from_version = read_schema_version(raw, missing=0)
        to_version = self._schema_version
        if from_version == to_version:
            # Normalize missing keys even when versions match
            normalized: dict[str, Any] = {"schema_version": to_version}
            normalized.update({name: {} for name in STORE_COLLECTIONS})
            normalized.update(raw)
            return normalized

        if from_version > to_version:
            # Migrations are forward-only, so a newer payload would pass through
            # untouched and then be stamped with (and saved under) this build's
            # version — relabelling data we cannot read. Refuse without writing.
            _LOGGER.error(
                "Refusing to load storage written by a newer schema version",
                extra={
                    "domain": DOMAIN,
                    "op": "migrate",
                    "from_version": from_version,
                    "to_version": to_version,
                    "storage_key": self.key,
                },
            )
            raise SchemaDowngradeError(
                schema_downgrade_message(stored_version=from_version, supported_version=to_version)
            )

        try:
            migrated = migrations.migrate(raw, from_version=from_version, to_version=to_version)
        except Exception as exc:  # pragma: no cover - exercised via tests
            # Do not overwrite on-disk payload; surface as a typed error
            _LOGGER.error(
                "Storage migration failed",
                extra={
                    "domain": DOMAIN,
                    "op": "migrate",
                    "from_version": from_version,
                    "to_version": to_version,
                    "storage_key": self.key,
                },
                exc_info=True,
            )
            raise StorageError("storage migration failed") from exc
        if not isinstance(migrated, dict):
            _LOGGER.error(
                "Storage migration returned invalid payload type",
                extra={
                    "domain": DOMAIN,
                    "op": "migrate",
                    "from_version": from_version,
                    "to_version": to_version,
                    "storage_key": self.key,
                },
            )
            raise StorageError("storage migration returned non-dict payload")
        # Guarantee required fields and version
        for name in STORE_COLLECTIONS:
            migrated.setdefault(name, {})
        migrated["schema_version"] = to_version

        await self._store.async_save(migrated)
        return migrated


async def async_persist_repo(hass: HomeAssistant) -> None:
    """Persist the current repository state via DomainStore with exclusive locking.

    Looks up both the storage manager and repository in hass.data[DOMAIN].
    Fails fast with StorageError if prerequisites are missing to avoid
    silent data loss. Callers should ensure setup completed successfully.

    Uses an asyncio.Lock to serialize concurrent persistence operations and
    prevent race conditions from multiple handlers attempting to save simultaneously.
    """

    lock = _get_persist_lock(hass)
    async with lock:
        bucket = hass.data.get(DOMAIN) or {}
        store = bucket.get("store")
        repo = bucket.get("repository")
        if store is None:
            raise NotLoadedError("storage manager not initialized; run integration setup")
        if repo is None:
            raise NotLoadedError("repository not initialized; run integration setup")

        start_time = time.monotonic()
        generation = getattr(repo, "generation", None)
        _LOGGER.debug(
            "Persisting repository state",
            extra={
                "domain": DOMAIN,
                "op": "persist_start",
                "generation": generation,
            },
        )

        payload = repo.export_state()
        try:
            await store.async_save(payload)
            elapsed = time.monotonic() - start_time
            _LOGGER.debug(
                "Repository persisted successfully",
                extra={
                    "domain": DOMAIN,
                    "op": "persist_complete",
                    "generation": generation,
                    "elapsed_ms": int(elapsed * 1000),
                },
            )
        except Exception as exc:  # pragma: no cover - mapped at boundaries
            elapsed = time.monotonic() - start_time
            _LOGGER.error(
                "Failed to persist repository",
                extra={
                    "domain": DOMAIN,
                    "op": "persist_failed",
                    "generation": generation,
                    "elapsed_ms": int(elapsed * 1000),
                },
                exc_info=True,
            )
            raise StorageError("failed to persist repository") from exc


def cancel_pending_persist(hass: HomeAssistant, *, op: str = "persist_cancel") -> None:
    """Cancel a scheduled debounced persist, if one is pending.

    Anything about to write itself — or about to take away the repository the
    write would read — has to clear the pending task first, or it fires against
    state that has moved on.
    """
    bucket = hass.data.setdefault(DOMAIN, {})

    existing_task = bucket.get("persist_task")
    if existing_task is None or existing_task.done():
        return

    existing_task.cancel()
    _LOGGER.debug(
        "Cancelled pending persist task",
        extra={"domain": DOMAIN, "op": op},
    )


async def async_request_persist(hass: HomeAssistant) -> None:
    """Request a debounced persistence operation.

    Cancels any pending persist task and schedules a new one — as a Home
    Assistant tracked background task — after the debounce delay. This coalesces
    rapid changes into a single persistence operation, reducing disk I/O while
    maintaining data safety.

    The debounce delay is PERSIST_DEBOUNCE_DELAY (1.0 seconds by default).
    """
    bucket = hass.data.setdefault(DOMAIN, {})

    cancel_pending_persist(hass, op="persist_debounce_cancel")

    async def _delayed_persist() -> None:
        """Execute persistence after debounce delay."""
        try:
            await asyncio.sleep(PERSIST_DEBOUNCE_DELAY)
            await async_persist_repo(hass)
        except asyncio.CancelledError:
            # Task was cancelled, this is expected
            _LOGGER.debug(
                "Debounced persist task cancelled",
                extra={"domain": DOMAIN, "op": "persist_debounce_cancelled"},
            )
        except Exception:  # pragma: no cover - defensive
            _LOGGER.error(
                "Debounced persist task failed",
                extra={"domain": DOMAIN, "op": "persist_debounce_failed"},
                exc_info=True,
            )

    _LOGGER.debug(
        "Persist requested, debouncing",
        extra={
            "domain": DOMAIN,
            "op": "persist_debounce_request",
            "delay_s": PERSIST_DEBOUNCE_DELAY,
        },
    )

    # Schedule through HA rather than asyncio directly: hass tracks the task and
    # cancels/awaits it during shutdown, so a pending debounce cannot outlive the
    # event loop.
    bucket["persist_task"] = hass.async_create_background_task(
        _delayed_persist(), name=f"{DOMAIN} debounced persist"
    )


async def async_persist_immediate(hass: HomeAssistant) -> None:
    """Persist immediately, bypassing debounce.

    Cancels any pending debounced persist task and executes persistence
    synchronously. Use this for critical paths like shutdown where we need
    to ensure data is written to disk before the process exits.
    """
    cancel_pending_persist(hass, op="persist_immediate_cancel")

    _LOGGER.debug(
        "Immediate persist requested",
        extra={"domain": DOMAIN, "op": "persist_immediate_request"},
    )

    await async_persist_repo(hass)
