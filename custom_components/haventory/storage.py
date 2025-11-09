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
from copy import deepcopy
from typing import Any, Final

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import migrations
from .const import DOMAIN
from .exceptions import StorageError

_LOGGER = logging.getLogger(__name__)

# Current schema version for persisted payloads
CURRENT_SCHEMA_VERSION: Final[int] = 1

# Storage key under which the persisted dataset is saved
STORAGE_KEY: Final[str] = "haventory_store"

# Debounce delay for persistence operations (seconds)
PERSIST_DEBOUNCE_DELAY: Final[float] = 1.0


def _empty_payload() -> dict[str, Any]:
    """Create a new empty payload matching the current schema.

    Returns a fresh dict each time to avoid shared mutation across callers.
    """

    return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}


def _get_persist_lock(hass: HomeAssistant) -> asyncio.Lock:
    """Get or create the persistence lock for this hass instance.

    Returns a per-hass-instance asyncio.Lock to serialize persistence operations
    and prevent race conditions from concurrent saves.
    """
    bucket = hass.data.setdefault(DOMAIN, {})
    if "persist_lock" not in bucket:
        bucket["persist_lock"] = asyncio.Lock()
    return bucket["persist_lock"]


class DomainStore:
    """Schema-aware wrapper around Home Assistant's Store for HAventory.

    This class centralizes storage access and schema migrations. It should be
    exposed via ``hass.data[DOMAIN]["store"]``.
    """

    def __init__(
        self, hass: HomeAssistant, *, key: str = STORAGE_KEY, version: int = CURRENT_SCHEMA_VERSION
    ) -> None:
        self._hass = hass
        self._store = Store(hass, version, key)
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
        from_version = int(raw.get("schema_version", 0)) if isinstance(raw, dict) else 0

        if from_version != self._schema_version:
            migrated = await self.async_migrate_if_needed(raw)
            return deepcopy(migrated)

        # Ensure required keys exist (older stubs or external mutations)
        data: dict[str, Any] = {
            "schema_version": self._schema_version,
            "items": {},
            "locations": {},
        }
        if isinstance(raw, dict):
            data.update(raw)
        return deepcopy(data)

    async def async_save(self, data: dict[str, Any]) -> None:
        """Persist the dataset ensuring schema_version is up-to-date."""

        payload = deepcopy(data) if isinstance(data, dict) else {}
        payload.setdefault("schema_version", self._schema_version)
        payload.setdefault("items", {})
        payload.setdefault("locations", {})
        await self._store.async_save(payload)

    async def async_migrate_if_needed(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Migrate ``raw`` payload to the current schema iff needed.

        If a migration occurs, persist the migrated payload back to storage.
        Returns the migrated (or original) payload.
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

        from_version = int(raw.get("schema_version", 0))
        to_version = self._schema_version
        if from_version == to_version:
            # Normalize missing keys even when versions match
            normalized = {
                "schema_version": to_version,
                "items": {},
                "locations": {},
            }
            normalized.update(raw)
            return normalized

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
        # Guarantee required fields and version
        migrated.setdefault("items", {})
        migrated.setdefault("locations", {})
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
            raise StorageError("storage manager not initialized; run integration setup")
        if repo is None:
            raise StorageError("repository not initialized; run integration setup")

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


async def async_request_persist(hass: HomeAssistant) -> None:
    """Request a debounced persistence operation.

    Cancels any pending persist task and schedules a new one after the debounce
    delay. This coalesces rapid changes into a single persistence operation,
    reducing disk I/O while maintaining data safety.

    The debounce delay is PERSIST_DEBOUNCE_DELAY (1.0 seconds by default).
    """
    bucket = hass.data.setdefault(DOMAIN, {})

    # Cancel any pending persist task
    existing_task = bucket.get("persist_task")
    if existing_task is not None and not existing_task.done():
        existing_task.cancel()
        _LOGGER.debug(
            "Cancelled pending persist task",
            extra={"domain": DOMAIN, "op": "persist_debounce_cancel"},
        )

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

    bucket["persist_task"] = asyncio.create_task(_delayed_persist())


async def async_persist_immediate(hass: HomeAssistant) -> None:
    """Persist immediately, bypassing debounce.

    Cancels any pending debounced persist task and executes persistence
    synchronously. Use this for critical paths like shutdown where we need
    to ensure data is written to disk before the process exits.
    """
    bucket = hass.data.setdefault(DOMAIN, {})

    # Cancel any pending debounced task
    existing_task = bucket.get("persist_task")
    if existing_task is not None and not existing_task.done():
        existing_task.cancel()
        _LOGGER.debug(
            "Cancelled pending persist task for immediate persist",
            extra={"domain": DOMAIN, "op": "persist_immediate_cancel"},
        )

    _LOGGER.debug(
        "Immediate persist requested",
        extra={"domain": DOMAIN, "op": "persist_immediate_request"},
    )

    await async_persist_repo(hass)
