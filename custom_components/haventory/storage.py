"""Persistent storage manager for HAventory.

Wraps Home Assistant's Store with schema-aware load/save and migrations. The
persisted payload is a ``schema_version`` stamp beside one id-keyed map per
entry in ``STORE_COLLECTIONS``.

A store stamped by a schema this build does not know is refused, never
rewritten. There are two such refusals, because there are two ways out: a stamp
from before the schema was collapsed to 1 is read by a 0.8.x build, and anything
above that by a newer HAventory.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Final

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import migrations
from .const import CORRUPT_BACKUP_STORAGE_KEY, DOMAIN
from .exceptions import (
    CorruptSchemaVersionError,
    NotLoadedError,
    SchemaDowngradeError,
    StorageError,
)
from .logs import context_logger
from .models import seed_status_definitions, serialize_status_definition
from .runtime import find_runtime

_LOGGER = context_logger(__name__)

CURRENT_SCHEMA_VERSION: Final[int] = 1

STORAGE_KEY: Final[str] = "haventory_store"

# The refusal reaches the config entry's error state in the UI, so a misplaced
# items dict under ``schema_version`` must not be pasted into it whole.
_MAX_REPORTED_VERSION_CHARS: Final[int] = 60


# Every top-level collection the stored payload carries. A load keeps whatever
# the file holds, while a save writes exactly what `Repository.export_state()`
# produced, so a collection listed here that the repository does not emit is
# erased by the first save. `tests/test_storage_offline.py` pins the two together.
STORE_COLLECTIONS: Final[tuple[str, ...]] = ("items", "locations", "statuses")

# The collections `Repository.from_state` walks as maps of rows.
_REQUIRED_COLLECTIONS: Final[tuple[str, ...]] = ("items", "locations")


def _normalized(payload: Mapping[str, Any], *, schema_version: int) -> dict[str, Any]:
    """A copy of ``payload`` carrying every collection and ``schema_version``.

    Keys this build does not know survive the trip. The copy is one level deep:
    deep-copying a large inventory costs more than encoding it, and no caller
    keeps a reference to the collections underneath.
    """

    normalized: dict[str, Any] = {"schema_version": schema_version}
    normalized.update({name: {} for name in STORE_COLLECTIONS})
    normalized.update(payload)
    normalized["schema_version"] = schema_version
    return normalized


def _empty_payload() -> dict[str, Any]:
    """A fresh install's payload: the built-in statuses and nothing else."""

    return _normalized(
        {
            "statuses": {
                slug: serialize_status_definition(definition)
                for slug, definition in seed_status_definitions().items()
            }
        },
        schema_version=CURRENT_SCHEMA_VERSION,
    )


def _corrupt_schema_version_message(value: object) -> str:
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

    Only a genuine ``int`` is a version: ``int()`` would read ``"4"`` as 4 and
    ``True`` as 1, and the data would be rewritten under a version the file
    never claimed. ``missing`` is what an absent key means to the caller.
    """

    if "schema_version" not in payload:
        return missing
    value = payload["schema_version"]
    if isinstance(value, bool) or not isinstance(value, int):
        raise CorruptSchemaVersionError(_corrupt_schema_version_message(value))
    return value


async def async_backup_store(
    hass: HomeAssistant,
    *,
    source_key: str = STORAGE_KEY,
    backup_key: str = CORRUPT_BACKUP_STORAGE_KEY,
) -> bool:
    """Copy the stored payload verbatim to a second key, returning whether there was one.

    Raw, around `DomainStore`, which would migrate, normalize or refuse the very
    payload the corrupt-store repair has to keep, unreadable rows included.
    """

    source: Store[dict[str, Any]] = Store(hass, DomainStore.HA_STORE_VERSION, source_key)
    raw = await source.async_load()
    if raw is None:
        return False

    backup: Store[dict[str, Any]] = Store(hass, DomainStore.HA_STORE_VERSION, backup_key)
    await backup.async_save(raw)
    _LOGGER.warning(
        "Copied the HAventory store aside before loading it with unreadable rows",
        extra={
            "domain": DOMAIN,
            "op": "backup_store",
            "storage_key": source_key,
            "backup_key": backup_key,
        },
    )
    return True


class DomainStore:
    """Schema-aware wrapper around Home Assistant's Store, one per config entry."""

    # Always 1, to stay out of HA's own migration mechanism. Public because
    # `async_backup_store` opens the same file under the same version.
    HA_STORE_VERSION: Final[int] = 1

    def __init__(
        self, hass: HomeAssistant, *, key: str = STORAGE_KEY, version: int = CURRENT_SCHEMA_VERSION
    ) -> None:
        self._hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, self.HA_STORE_VERSION, key)
        self._schema_version = version

    @property
    def schema_version(self) -> int:
        return self._schema_version

    @property
    def key(self) -> str:
        return self._store.key

    async def async_load(self) -> dict[str, Any]:
        """Load a copy of the persisted dataset, stamped with this build's version."""

        raw = await self._store.async_load()
        if raw is None:
            return _empty_payload()

        data = await self.async_migrate_if_needed(raw)
        # A hand-edited file can hold anything under these keys.
        for name in _REQUIRED_COLLECTIONS:
            if not isinstance(data.get(name), dict):
                raise StorageError(f"storage payload {name} is not a mapping")
        return deepcopy(data)

    async def async_save(self, data: dict[str, Any]) -> None:
        await self._store.async_save(_normalized(data, schema_version=self._schema_version))

    def _log_context(self, from_version: int | None) -> dict[str, Any]:
        return {
            "domain": DOMAIN,
            "op": "migrate",
            "from_version": from_version,
            "to_version": self._schema_version,
            "storage_key": self.key,
        }

    async def async_migrate_if_needed(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Bring ``raw`` to the current schema, or refuse it without writing.

        A payload below the current version is migrated and written back; one
        already carrying it is handed on without touching the file. Raises
        ``SchemaDowngradeError`` for a version above the current one, naming
        the way out, and ``CorruptSchemaVersionError`` for an unreadable one.
        """

        if not isinstance(raw, dict):
            _LOGGER.error(
                "Corrupted storage payload: expected dict, got %s",
                type(raw).__name__,
                extra=self._log_context(None),
            )
            raise StorageError("corrupted storage payload: not a dict")

        from_version = read_schema_version(raw, missing=0)
        to_version = self._schema_version
        if from_version > to_version:
            # The literal 1 is deliberate: these stamps name pre-collapse schemas
            # only while the current one is 1. From schema 2 on, a store stamped
            # 2 through 9 is indistinguishable from a newer one.
            if to_version == 1 and from_version in migrations.PRE_COLLAPSE_SCHEMA_VERSIONS:
                _LOGGER.error(
                    "Refusing to load a store stamped before the schema collapse",
                    extra=self._log_context(from_version),
                )
                raise SchemaDowngradeError(
                    f"stored data uses schema version {from_version}, which this build cannot "
                    f"read: it is neither the current schema ({to_version}) nor an older one "
                    "this build migrates forward, and no newer HAventory understands it either. "
                    "HAventory 0.8.x does: install 0.8.x, start Home Assistant once so it reads "
                    "and restamps the store, then upgrade again. The stored data was left "
                    "unchanged."
                )
            _LOGGER.error(
                "Refusing to load storage written by a newer schema version",
                extra=self._log_context(from_version),
            )
            raise SchemaDowngradeError(
                f"stored data uses schema version {from_version}, which is newer than this "
                f"build supports ({to_version}); HAventory will not downgrade it. "
                "Upgrade HAventory to a version that understands this data, or restore a "
                "backup taken with this version. The stored data was left unchanged."
            )

        if from_version == to_version:
            return _normalized(raw, schema_version=to_version)
        # Written back only when the version changed: every boot reads the store,
        # and rewriting an unchanged inventory on each of them buys nothing.
        migrated = _normalized(
            migrations.migrate(raw, from_version=from_version, to_version=to_version),
            schema_version=to_version,
        )
        await self._store.async_save(migrated)
        return migrated


async def async_persist_repo(hass: HomeAssistant) -> None:
    """Persist the current repository state, one writer at a time.

    Deliberately `find_runtime`, not the loaded-entry lookup: teardown flushes
    through here while the entry is `UNLOAD_IN_PROGRESS`. The lock is the
    runtime's, so it serializes exactly the writes to that entry's store file.
    """

    runtime = find_runtime(hass)
    if runtime is None:
        raise NotLoadedError("HAventory runtime not initialized; run integration setup")

    async with runtime.persist_lock:
        start_time = time.monotonic()
        _LOGGER.debug(
            "Persisting repository state",
            extra={"domain": DOMAIN, "op": "persist_start"},
        )
        payload = runtime.repository.export_state()
        try:
            await runtime.store.async_save(payload)
        except Exception as exc:  # pragma: no cover - mapped at boundaries
            _LOGGER.error(
                "Failed to persist repository",
                extra={
                    "domain": DOMAIN,
                    "op": "persist_failed",
                    "elapsed_ms": int((time.monotonic() - start_time) * 1000),
                },
                exc_info=True,
            )
            raise StorageError("failed to persist repository") from exc
        _LOGGER.debug(
            "Repository persisted successfully",
            extra={
                "domain": DOMAIN,
                "op": "persist_complete",
                "elapsed_ms": int((time.monotonic() - start_time) * 1000),
            },
        )


async def async_persist_immediate(hass: HomeAssistant) -> None:
    """Persist from a path with no client waiting, logging that it was attempted."""

    _LOGGER.debug(
        "Immediate persist requested",
        extra={"domain": DOMAIN, "op": "persist_immediate_request"},
    )
    await async_persist_repo(hass)
