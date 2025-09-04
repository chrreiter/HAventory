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

from copy import deepcopy
from typing import Any, Final

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import migrations
from .const import DOMAIN

# Current schema version for persisted payloads
CURRENT_SCHEMA_VERSION: Final[int] = 1

# Storage key under which the persisted dataset is saved
STORAGE_KEY: Final[str] = "haventory_store"


def _empty_payload() -> dict[str, Any]:
    """Create a new empty payload matching the current schema.

    Returns a fresh dict each time to avoid shared mutation across callers.
    """

    return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}


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
            migrated = _empty_payload()
            await self._store.async_save(migrated)
            return migrated

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

        migrated = migrations.migrate(raw, from_version=from_version, to_version=to_version)
        # Guarantee required fields and version
        migrated.setdefault("items", {})
        migrated.setdefault("locations", {})
        migrated["schema_version"] = to_version

        await self._store.async_save(migrated)
        return migrated


async def async_persist_repo(hass: HomeAssistant) -> None:
    """Persist the current repository state via DomainStore.

    Looks up both the storage manager and repository in hass.data[DOMAIN].
    No-ops if either is missing. Logs are the caller's responsibility.
    """

    try:
        bucket = hass.data.get(DOMAIN) or {}
        store = bucket.get("store")
        repo = bucket.get("repository")
        if store is None or repo is None:
            return
        payload = repo.export_state()
        await store.async_save(payload)
    except Exception:  # pragma: no cover - defensive
        # Avoid importing logging here; callers already log context on failure
        return
