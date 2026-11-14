"""HAventory integration setup and teardown.

Stands the store, the repository and the runtime that carries them up, serves the
card bundle and the media view, and registers the sidebar panel. Per-entry state
lives on `entry.runtime_data`; `hass.data[DOMAIN]` keeps only the registrations
Home Assistant cannot hand back, which outlive an entry and must not be made
twice.

The order inside `async_setup_entry` is a constraint: each step needs the ones
before it.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv

from . import events, stale_files
from . import media as media_mod
from . import services as services_mod
from . import todo_bridge as todo_mod
from . import ws as ws_mod
from .config_flow import clean_card_title, clean_quick_filters
from .const import (
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CORRUPT_BACKUP_STORAGE_KEY,
    DOMAIN,
    ISSUE_CORRUPT_SCHEMA_VERSION,
    ISSUE_SCHEMA_DOWNGRADE,
    PLATFORMS,
)
from .exceptions import CorruptSchemaVersionError, SchemaDowngradeError, StorageError
from .frontend_registration import (
    async_apply_sidebar_panel,
    async_register_frontend_module,
    async_unregister_frontend_module,
    release_extra_js_url,
    remove_sidebar_panel,
)
from .logs import context_logger
from .repair_issues import (
    clear_lossy_load_option,
    corrupt_store_message,
    create_corrupt_store_issue,
    create_refusal_issue,
    delete_refusal_issues,
    lossy_load_allowed,
)
from .repository import Repository
from .runtime import HAventoryConfigEntry, HAventoryRuntime, find_runtime
from .storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_backup_item_ids,
    async_persist_immediate,
)
from .subscriptions import notify_backend_unavailable

LOGGER = context_logger(__name__)

# hass.data[DOMAIN] key that outlives a config entry. aiohttp cannot unregister a
# route, so a reload must not add the media view twice.
_MEDIA_VIEW_KEY = "media_view_registered"


# This integration is config-entry only; no YAML configuration is accepted.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Register the `haventory.*` services, once per Home Assistant run.

    Here rather than per entry so an automation that names a service still
    validates while the entry is unloaded or failed; each handler refuses
    through `loaded_runtime` until an entry is loaded again.
    """

    services_mod.setup(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: HAventoryConfigEntry) -> bool:
    """Set up HAventory from a config entry."""
    # First, so a retired bundle is gone before the card directory is served.
    await stale_files.async_sweep_retired_files(hass)
    await stale_files.async_sweep_stale_chunks(hass)

    store = DomainStore(hass, key=STORAGE_KEY, version=CURRENT_SCHEMA_VERSION)
    repository = await _async_load_repository(hass, entry, store)

    # Before anything that reads it: every module resolves the runtime through
    # `hass.config_entries`.
    entry.runtime_data = HAventoryRuntime(
        store=store,
        repository=repository,
        card_title=clean_card_title(entry.options.get(CONF_CARD_TITLE)),
        quick_filters=_resolve_quick_filters(entry),
    )

    await _async_settle_lossy_load(hass, repository)

    # Whatever the previous boot left in Repairs no longer describes this store.
    delete_refusal_issues(hass)

    # Before anything can mutate, or the first mutation after a restart would
    # announce `entered` for every item that was already low.
    events.seed_low_stock_snapshot(hass)

    # Tell `stats` subscribers when the day turns over.
    entry.async_on_unload(events.async_track_day_rollover(hass))

    _register_media_view(hass)
    await _async_sweep_orphaned_media(hass, repository)

    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    # After the update listener above, which an options change has to reach.
    await todo_mod.async_setup(hass, entry)

    ws_mod.setup(hass)

    await hass.config_entries.async_forward_entry_setups(entry, list(PLATFORMS))

    # Serve the bundled card and point the frontend at it
    await async_register_frontend_module(hass)

    # The sidebar entry loads the same bundle, so it can only be registered once
    # that bundle is being served.
    await async_apply_sidebar_panel(hass, entry)

    return True


async def _async_load_repository(
    hass: HomeAssistant, entry: ConfigEntry, store: DomainStore
) -> Repository:
    """Read the store into a repository, or stop setup and say why in Repairs.

    A newer or unreadable `schema_version`, or rows this build cannot read, each
    raise `ConfigEntryError` with a Repairs card; only the last is fixable. A
    store that cannot be read at all right now is transient and gets a retry.
    """

    try:
        payload = await store.async_load()
        _log_storage_health(payload, schema_version=store.schema_version)
    except SchemaDowngradeError as exc:
        LOGGER.error(
            "Refusing to set up against storage whose schema version this build cannot read",
            extra={"op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        create_refusal_issue(hass, ISSUE_SCHEMA_DOWNGRADE, exc, store_key=store.key)
        # ConfigEntryError, not ConfigEntryNotReady: retrying cannot teach this build
        # another schema, and the message reaches the user in the entry's error state.
        raise ConfigEntryError(str(exc)) from exc
    except CorruptSchemaVersionError as exc:
        LOGGER.error(
            "Refusing to set up against storage whose schema_version is unreadable",
            extra={"op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        create_refusal_issue(hass, ISSUE_CORRUPT_SCHEMA_VERSION, exc, store_key=store.key)
        raise ConfigEntryError(str(exc)) from exc
    except StorageError as exc:
        LOGGER.error(
            "Storage validation failed during setup",
            extra={"op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        raise ConfigEntryNotReady("storage validation failed") from exc
    except Exception as exc:
        # `Store.async_load` raises HomeAssistantError for a file it cannot read, and
        # KeyError or a migration's error for a hand-edited one; each gets a retry.
        LOGGER.error(
            "Failed to load storage during setup",
            extra={"op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        raise ConfigEntryNotReady("storage load failed") from exc
    repository = Repository.from_state(payload)
    load_report = repository.last_load_report
    if load_report.has_corruption:
        allowed = lossy_load_allowed(entry)
        LOGGER.log(
            logging.WARNING if allowed else logging.ERROR,
            (
                "Loading a store this build cannot fully read, as the repair asked"
                if allowed
                else "Refusing to set up against a store this build cannot fully read"
            ),
            extra={
                "op": "setup_storage",
                "dropped_items": len(load_report.dropped_item_ids),
                "dropped_locations": len(load_report.dropped_location_ids),
                "cyclic_locations": len(load_report.cyclic_location_ids),
                "unrooted_locations": len(load_report.unrooted_location_ids),
            },
        )
        if not allowed:
            # Every write persists immediately, so a partial load would rewrite the
            # store without the unreadable rows on the first mutation. Refusing
            # leaves the file intact; the repairs issue copies it, then sets the
            # option this branch reads.
            create_corrupt_store_issue(hass, load_report, store_key=store.key)
            raise ConfigEntryError(corrupt_store_message(load_report, store_key=store.key))
    # Spend the opt-in on any load that reaches here, or a store that reads fine
    # (a backup restored by hand) leaves it armed for the next corruption. Ahead
    # of the update listener, so clearing it cannot trigger a reload.
    clear_lossy_load_option(hass, entry)
    return repository


async def _async_settle_lossy_load(hass: HomeAssistant, repository: Repository) -> None:
    """Write the store back the way it was just read, when rows had to be dropped.

    Otherwise the unreadable rows stay on disk and the refusal returns on the next
    restart. The rows this overwrites are in the copy `repairs.py` took before it
    set the lossy-load option.
    """

    if not repository.last_load_report.has_corruption:
        return

    await async_persist_immediate(hass)
    LOGGER.warning(
        "Rewrote the HAventory store without the rows this build cannot read",
        extra={
            "op": "settle_lossy_load",
            "dropped_items": len(repository.last_load_report.dropped_item_ids),
            "dropped_locations": len(repository.last_load_report.dropped_location_ids),
            "backup_key": CORRUPT_BACKUP_STORAGE_KEY,
        },
    )


def _register_media_view(hass: HomeAssistant) -> None:
    """Serve `/api/haventory/media/...`, at most once per Home Assistant run."""
    bucket = hass.data.setdefault(DOMAIN, {})
    if bucket.get(_MEDIA_VIEW_KEY):
        return

    try:
        hass.http.register_view(media_mod.HaventoryMediaView())
    except RuntimeError, ValueError:
        # What aiohttp's router raises adding a route.
        # WARNING, not ERROR: the inventory works without it, but every
        # attachment on every card is a broken image until it is fixed.
        LOGGER.warning(
            "Failed to register the HAventory media view; attachments will not load",
            extra={"op": "media_register"},
            exc_info=True,
        )
        return

    bucket[_MEDIA_VIEW_KEY] = True
    LOGGER.debug(
        "Serving HAventory item attachments",
        extra={"op": "media_register"},
    )


async def _async_sweep_orphaned_media(hass: HomeAssistant, repository: Repository) -> None:
    """Delete attachment files no stored metadata references.

    At setup, the one moment the metadata is complete and nothing is mid-write.
    A failure costs disk, not data, so it never stops the entry from loading.

    The corrupt-store repair loads without the rows it could not read and then
    rewrites the store clean, so from that boot on nothing here names their
    files. For as long as its backup exists, the files of every item the backup
    holds and the store does not are kept, so restoring the backup brings the
    pictures and manuals back with the items. A backup that cannot be read
    raises, which skips the sweep rather than guessing.
    """
    try:
        if repository.get_counts()["items_total"] == 0:
            # A missing or unwritten store looks like this too, and there the
            # files are the only copy left; sweeping would take the whole root.
            await media_mod.async_report_unswept(hass)
            return
        held = await async_backup_item_ids(hass) - repository.item_ids()
        if held:
            LOGGER.info(
                "Keeping the attachment files of items only the corrupt-store backup holds",
                extra={
                    "op": "attachment_sweep",
                    "held_items": len(held),
                    "backup_key": CORRUPT_BACKUP_STORAGE_KEY,
                },
            )
        await media_mod.async_sweep_orphans(hass, repository.iter_attachments(), held_item_ids=held)
    except Exception:  # Costs disk, not data, so it never stops the entry from loading.
        LOGGER.warning(
            "Could not sweep orphaned attachment files",
            extra={"op": "media_sweep"},
            exc_info=True,
        )


def _resolve_quick_filters(entry: ConfigEntry) -> list[str] | None:
    """The configured pills, or `None` when none was chosen: the dashboard decides."""
    chosen = entry.options.get(CONF_QUICK_FILTERS)
    return clean_quick_filters(chosen) if isinstance(chosen, list) else None


async def _async_options_updated(hass: HomeAssistant, entry: HAventoryConfigEntry) -> None:
    """Apply changed options: card title, pills, sidebar panel, shopping list."""
    runtime = find_runtime(hass)
    if runtime is not None:
        runtime.card_title = clean_card_title(entry.options.get(CONF_CARD_TITLE))
        runtime.quick_filters = _resolve_quick_filters(entry)
    # Covers the toggle and a renamed card alike: the sidebar entry carries the
    # card title, and re-registering is how a changed one reaches the sidebar.
    await async_apply_sidebar_panel(hass, entry)
    # A changed shopping list is applied by converging on it: the pass takes the
    # lines off whichever list they were written to and puts them on the new one.
    todo_mod.apply_options(hass, entry)
    await todo_mod.async_reconcile(hass)
    LOGGER.info(
        "Applied updated HAventory options",
        extra={"op": "options_updated"},
    )


async def _async_flush_pending_writes(hass: HomeAssistant, *, op: str) -> None:
    """Write out whatever is still unsaved, before the state that holds it goes."""

    if find_runtime(hass) is None:
        return

    try:
        await async_persist_immediate(hass)
    except StorageError:  # `async_persist_repo` maps every save failure to this.
        LOGGER.error(
            "Failed to persist during teardown",
            extra={"op": op},
            exc_info=True,
        )


async def _async_teardown_entry(hass: HomeAssistant, *, op: str, release_panel: bool) -> None:
    """Give up everything the config entry owns, in the order that keeps it safe.

    The entry is already not loaded here, so every step goes through
    `find_runtime` (see `runtime.py`). Flush while the repository is reachable,
    tell subscribers while the registry lists them, then hand back the frontend
    registrations. `release_panel` is false for a reload, which would otherwise
    throw a browser on the panel back to the default dashboard.
    """

    await _async_flush_pending_writes(hass, op=op)
    notify_backend_unavailable(hass)
    # The static route stays with its flag: aiohttp cannot unregister a route.
    release_extra_js_url(hass)
    if release_panel:
        remove_sidebar_panel(hass)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry; the WebSocket commands refuse until setup runs again.

    Home Assistant sets `disabled_by` before it unloads a disabled entry and
    leaves it alone on a reload, which is how the two tell the panel apart.
    """

    # Platforms first, while the repository the entities read is still there.
    unloaded = bool(await hass.config_entries.async_unload_platforms(entry, list(PLATFORMS)))
    await _async_teardown_entry(hass, op="unload", release_panel=entry.disabled_by is not None)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, _entry: ConfigEntry) -> None:
    """Take back the Lovelace resource and module URL, then tear down as unload does.

    The `Store` file is kept, so re-adding the integration restores the inventory.
    """

    await async_unregister_frontend_module(hass)
    await _async_teardown_entry(hass, op="remove", release_panel=True)


def _log_storage_health(payload: dict[str, Any], *, schema_version: int) -> None:
    """Log what the store came back with, at DEBUG: an empty store is a healthy one."""

    items = payload.get("items")
    locations = payload.get("locations")
    item_count = len(items) if isinstance(items, dict) else 0
    location_count = len(locations) if isinstance(locations, dict) else 0

    LOGGER.debug(
        "Storage health",
        extra={
            "op": "setup_storage_health",
            "schema_version": schema_version,
            "items_count": item_count,
            "locations_count": location_count,
        },
    )
