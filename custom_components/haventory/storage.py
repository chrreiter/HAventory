"""Persistent storage manager for HAventory.

Wraps Home Assistant's Store with schema-aware load/save and migrations.

Data shape persisted (Phase 1):
    {
        "schema_version": int,
        "items": {id -> ItemDict},
        "locations": {id -> LocationDict},
    }

The manager ensures first load initializes an empty dataset, gives a payload
every collection it predates, and refuses one written by a schema version this
build does not know. There are two such refusals, because there are two ways
out: a stamp this project used before the schema was collapsed to 1 is reached
by a 0.8.x build, and anything above them by a newer HAventory.
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

# Current schema version for persisted payloads
CURRENT_SCHEMA_VERSION: Final[int] = 1

# Storage key under which the persisted dataset is saved
STORAGE_KEY: Final[str] = "haventory_store"

# How much of a corrupt ``schema_version`` the refusal quotes back. The value is
# whatever the file holds, and the message reaches the config entry's error state
# in the UI, so a misplaced items dict landing on that key must not paste the
# whole inventory into it.
_MAX_REPORTED_VERSION_CHARS: Final[int] = 60


# Every top-level collection the stored payload carries, in one place because
# every payload this module hands out or writes has to agree about the set.
#
# The load path is wider than the save path by construction — `async_load` keeps
# whatever the file holds, while a save writes exactly what
# `Repository.export_state()` produced. A collection listed here that the
# repository does not emit is therefore read back correctly at boot and erased by
# the first save afterwards, with nothing logged. `tests/test_storage_offline.py`
# pins `export_state()` to this tuple so that mistake fails a test instead.
STORE_COLLECTIONS: Final[tuple[str, ...]] = ("items", "locations", "statuses")

# The collections `Repository.from_state` walks by key. A stored value of another
# type there is corruption the load path names rather than crashes on; the rest
# of `STORE_COLLECTIONS` is checked by the repository as it reads each row.
_REQUIRED_COLLECTIONS: Final[tuple[str, ...]] = ("items", "locations")


def _normalized(payload: Mapping[str, Any], *, schema_version: int) -> dict[str, Any]:
    """A copy of ``payload`` carrying every collection, defaulting the absent ones.

    What the payload holds wins, extra keys included: a store written by a build
    that knew a key this one does not has to survive the trip, and be handed back
    unchanged.

    The copy is one level deep on purpose: a deep copy of a thousand items
    measured longer than building the payload and encoding it put together. The
    collections underneath are handed over, not duplicated, and nothing reaches
    them through the result — the save path's caller builds them fresh on every
    call and keeps no reference, and the load path deep-copies what it hands out.
    """

    normalized: dict[str, Any] = {"schema_version": schema_version}
    normalized.update({name: {} for name in STORE_COLLECTIONS})
    normalized.update(payload)
    return normalized


def _empty_payload() -> dict[str, Any]:
    """Create a new empty payload matching the current schema.

    Returns a fresh dict each time to avoid shared mutation across callers.
    A fresh install starts with the built-in statuses seeded, which is also what
    an absent ``statuses`` section means everywhere else.
    """

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


async def async_backup_store(
    hass: HomeAssistant,
    *,
    source_key: str = STORAGE_KEY,
    backup_key: str = CORRUPT_BACKUP_STORAGE_KEY,
) -> bool:
    """Copy the stored payload verbatim to a second key, returning whether there was one.

    Deliberately raw: it goes around `DomainStore`, which migrates, normalizes
    and would refuse the very payloads worth copying. The caller is the
    corrupt-store repair, so what has to survive is exactly what is on disk —
    unreadable rows included, since those are what the user might want back.
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
    """Schema-aware wrapper around Home Assistant's Store for HAventory.

    This class centralizes storage access and schema migrations. One instance per
    config entry, held on the entry's runtime.

    Note: HA's Store version is fixed at 1 to avoid HA's internal migration
    mechanism. All versioning is handled via `schema_version` in the payload.
    """

    # HA Store wrapper version - always 1 to avoid HA's migration mechanism.
    # Public because the raw copy `async_backup_store` takes has to open the
    # same file under the same version this wrapper wrote it with.
    HA_STORE_VERSION: Final[int] = 1

    def __init__(
        self, hass: HomeAssistant, *, key: str = STORAGE_KEY, version: int = CURRENT_SCHEMA_VERSION
    ) -> None:
        self._hass = hass
        # Use constant HA Store version; our schema_version handles migrations
        self._store: Store[dict[str, Any]] = Store(hass, self.HA_STORE_VERSION, key)
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

        The payload comes back stamped with this build's schema version, whether
        it was migrated to get there or already carried it, so what the caller
        reads never disagrees with the store it came from.
        """

        raw = await self._store.async_load()
        if raw is None:
            return _empty_payload()

        data = await self.async_migrate_if_needed(raw)

        # A hand-edited file can hold anything under these keys, and the
        # repository walks them as maps of rows.
        for name in _REQUIRED_COLLECTIONS:
            if not isinstance(data.get(name), dict):
                raise StorageError(f"storage payload {name} is not a mapping")
        return deepcopy(data)

    async def async_save(self, data: dict[str, Any]) -> None:
        """Persist the dataset, ensuring schema_version is up to date."""

        payload = _normalized(
            data if isinstance(data, dict) else {}, schema_version=self._schema_version
        )
        await self._store.async_save(payload)

    async def _async_stamped(
        self, payload: dict[str, Any], *, from_version: int, to_version: int
    ) -> dict[str, Any]:
        """Hand back ``payload`` carrying every collection and this build's version.

        Nothing rewrites the rows underneath: an absent field reads as the value
        the build that introduced it writes, both in ``Item.from_dict`` and in
        the repository's ``statuses``, so a store predating a field reaches the
        repository correctly without being rewritten first. What has to be there
        is the collections themselves, which ``_normalized`` defaults.

        The file is written back only when the number changed. Every boot reads
        the store, and rewriting the whole inventory on each of them for a
        payload nothing altered is a cost paid for nothing.
        """

        normalized = _normalized(payload, schema_version=to_version)
        # The version is this build's, not whatever the payload carried: a
        # payload saved under a version it does not carry is one nothing can read
        # back correctly.
        normalized["schema_version"] = to_version
        if from_version != to_version:
            await self._store.async_save(normalized)
        return normalized

    async def async_migrate_if_needed(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Bring ``raw`` to the current schema, or refuse it.

        A payload below the current version is restamped and persisted back; one
        already carrying it is handed on without touching the file.

        Raises ``SchemaDowngradeError`` when ``raw`` carries a version above the
        current one, with the message that names the way out of the version it
        actually carries, and ``CorruptSchemaVersionError`` when it carries no
        readable version at all. Both leave the stored payload untouched.
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
            return await self._async_stamped(raw, from_version=from_version, to_version=to_version)

        if to_version == 1 and from_version in migrations.PRE_COLLAPSE_SCHEMA_VERSIONS:
            # The literal is deliberate: these numbers name this project's own
            # pre-collapse schemas only while the current one is 1. The schema
            # after the collapse takes 2, and from that build's side a store
            # stamped 2 through 9 is indistinguishable from a newer one, so it
            # gets the refusal below instead of advice about a 0.8.x build.
            _LOGGER.error(
                "Refusing to load a store stamped before the schema collapse",
                extra={
                    "domain": DOMAIN,
                    "op": "migrate",
                    "from_version": from_version,
                    "to_version": to_version,
                    "storage_key": self.key,
                },
            )
            raise SchemaDowngradeError(
                f"stored data uses schema version {from_version}, which this build cannot "
                f"read: it is neither the current schema ({to_version}) nor an older one this "
                "build migrates forward, and no newer HAventory understands it either. "
                "HAventory 0.8.x does: install 0.8.x, start Home Assistant once so it reads "
                "and restamps the store, then upgrade again. The stored data was left "
                "unchanged."
            )

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
                f"stored data uses schema version {from_version}, which is newer than this "
                f"build supports ({to_version}); HAventory will not downgrade it. "
                "Upgrade HAventory to a version that understands this data, or restore a "
                "backup taken with this version. The stored data was left unchanged."
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
        return await self._async_stamped(migrated, from_version=from_version, to_version=to_version)


async def async_persist_repo(hass: HomeAssistant) -> None:
    """Persist the current repository state, one writer at a time.

    Reads the store and the repository off the entry's runtime, and refuses with
    `NotLoadedError` when there is none rather than silently writing nothing.
    Deliberately **not** the loaded-entry lookup: teardown flushes through here
    while the entry is already `UNLOAD_IN_PROGRESS`, and a loaded check would
    turn the last write into a no-op.

    The lock is the runtime's, so it serializes exactly the writes that go to
    that entry's one store file.
    """

    runtime = find_runtime(hass)
    if runtime is None:
        raise NotLoadedError("HAventory runtime not initialized; run integration setup")

    async with runtime.persist_lock:
        store = runtime.store
        repo = runtime.repository

        start_time = time.monotonic()
        _LOGGER.debug(
            "Persisting repository state",
            extra={"domain": DOMAIN, "op": "persist_start"},
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
                    "elapsed_ms": int(elapsed * 1000),
                },
                exc_info=True,
            )
            raise StorageError("failed to persist repository") from exc


async def async_persist_immediate(hass: HomeAssistant) -> None:
    """Persist from a path with no client waiting on the answer.

    The rewrite after a lossy load and the teardown flush both write through
    here. Neither surfaces in a handler's reply, so this log line is what tells
    an operator reading the log that the write was attempted at all.
    """

    _LOGGER.debug(
        "Immediate persist requested",
        extra={"domain": DOMAIN, "op": "persist_immediate_request"},
    )

    await async_persist_repo(hass)
