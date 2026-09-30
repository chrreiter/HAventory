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
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from homeassistant.components.frontend import (
    add_extra_js_url,
    async_remove_panel,
    remove_extra_js_url,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace import LOVELACE_DATA
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import issue_registry as ir

from . import events, stale_files
from . import media as media_mod
from . import services as services_mod
from . import todo_bridge as todo_mod
from . import ws as ws_mod
from .const import (
    CONF_ALLOW_LOSSY_LOAD,
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CONF_SIDEBAR_PANEL_ENABLED,
    CORRUPT_BACKUP_STORAGE_KEY,
    DEFAULT_CARD_TITLE,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
    DOMAIN,
    INTEGRATION_VERSION,
    ISSUE_CORRUPT_SCHEMA_VERSION,
    ISSUE_CORRUPT_STORE,
    ISSUE_SCHEMA_DOWNGRADE,
    PANEL_ELEMENT_NAME,
    PANEL_ICON,
    PANEL_URL_PATH,
    PLATFORMS,
    QUICK_FILTER_KEYS,
    REPAIR_ISSUE_IDS,
)
from .exceptions import CorruptSchemaVersionError, SchemaDowngradeError, StorageError
from .logs import context_logger
from .repository import LoadReport, Repository
from .runtime import HAventoryConfigEntry, HAventoryRuntime, find_runtime
from .storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_persist_immediate,
)
from .subscriptions import notify_backend_unavailable

LOGGER = context_logger(__name__)

# The card bundle ships inside the integration package — the only tree HACS
# copies for an integration-category repo — and is served from there.
_CARD_FILENAME = "haventory-card.js"
_WWW_DIR = Path(__file__).parent / "www"
_CARD_BUNDLE_PATH = _WWW_DIR / _CARD_FILENAME
_STATIC_URL_PATH = "/haventory_static"
_CARD_URL_PATH = f"{_STATIC_URL_PATH}/{_CARD_FILENAME}"

# hass.data[DOMAIN] keys that outlive a config entry. aiohttp cannot unregister a
# route, so a reload must not add the static path or the media view twice; the
# module URL has to be removed as the exact string it was registered under.
_STATIC_PATH_KEY = "static_path_registered"
_EXTRA_JS_URL_KEY = "extra_js_url"
_MEDIA_VIEW_KEY = "media_view_registered"

# The (title, module URL) the sidebar panel is registered with, or absent. It
# outlives a plain unload because a reload passes through one, and a browser on
# `/haventory` is sent to the default dashboard once the panel leaves `hass.panels`.
_PANEL_STATE_KEY = "panel_state"

# How many ids of each kind the corrupt-store refusal quotes. Enough to grep the
# file with, few enough that a wholesale corruption does not paste thousands of
# uuids into the config entry's error state.
_CORRUPT_SAMPLE_IDS = 3


# This integration is config-entry only; no YAML configuration is accepted.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup_entry(hass: HomeAssistant, entry: HAventoryConfigEntry) -> bool:
    """Set up HAventory from a config entry."""
    # First, so a retired bundle is gone before the card directory is served.
    await stale_files.async_sweep_retired_files(hass)

    store = DomainStore(hass, key=STORAGE_KEY, version=CURRENT_SCHEMA_VERSION)
    repository = await _async_load_repository(hass, entry, store)

    # Before anything that reads it: every module resolves the runtime through
    # `hass.config_entries`.
    entry.runtime_data = HAventoryRuntime(
        store=store,
        repository=repository,
        card_title=_resolve_card_title(entry),
        quick_filters=_resolve_quick_filters(entry),
    )

    await _async_settle_lossy_load(hass, repository)

    # Whatever the previous boot left in Repairs no longer describes this store.
    _delete_refusal_issues(hass)

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

    services_mod.setup(hass)
    ws_mod.setup(hass)

    await hass.config_entries.async_forward_entry_setups(entry, list(PLATFORMS))

    # Serve the bundled card and point the frontend at it
    await _register_frontend_module(hass)

    # The sidebar entry loads the same bundle, so it can only be registered once
    # that bundle is being served.
    await _async_apply_sidebar_panel(hass, entry)

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
            extra={"domain": DOMAIN, "op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        _create_refusal_issue(hass, ISSUE_SCHEMA_DOWNGRADE, exc, store_key=store.key)
        # ConfigEntryError, not ConfigEntryNotReady: retrying cannot teach this build
        # another schema, and the message reaches the user in the entry's error state.
        raise ConfigEntryError(str(exc)) from exc
    except CorruptSchemaVersionError as exc:
        LOGGER.error(
            "Refusing to set up against storage whose schema_version is unreadable",
            extra={"domain": DOMAIN, "op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        _create_refusal_issue(hass, ISSUE_CORRUPT_SCHEMA_VERSION, exc, store_key=store.key)
        raise ConfigEntryError(str(exc)) from exc
    except StorageError as exc:
        LOGGER.error(
            "Storage validation failed during setup",
            extra={"domain": DOMAIN, "op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        raise ConfigEntryNotReady("storage validation failed") from exc
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.error(
            "Failed to load storage during setup",
            extra={"domain": DOMAIN, "op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        raise ConfigEntryNotReady("storage load failed") from exc
    repository = Repository.from_state(payload)
    load_report = repository.last_load_report
    if load_report.has_corruption:
        allowed = _lossy_load_allowed(entry)
        LOGGER.log(
            logging.WARNING if allowed else logging.ERROR,
            (
                "Loading a store this build cannot fully read, as the repair asked"
                if allowed
                else "Refusing to set up against a store this build cannot fully read"
            ),
            extra={
                "domain": DOMAIN,
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
            _create_corrupt_store_issue(hass, load_report, store_key=store.key)
            raise ConfigEntryError(_corrupt_store_message(load_report, store_key=store.key))
    # Spend the opt-in on any load that reaches here, or a store that reads fine
    # (a backup restored by hand) leaves it armed for the next corruption. Ahead
    # of the update listener, so clearing it cannot trigger a reload.
    _clear_lossy_load_option(hass, entry)
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
            "domain": DOMAIN,
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
    except Exception:
        # WARNING, not ERROR: the inventory works without it, but every
        # attachment on every card is a broken image until it is fixed.
        LOGGER.warning(
            "Failed to register the HAventory media view; attachments will not load",
            extra={"domain": DOMAIN, "op": "media_register"},
            exc_info=True,
        )
        return

    bucket[_MEDIA_VIEW_KEY] = True
    LOGGER.debug(
        "Serving HAventory item attachments",
        extra={"domain": DOMAIN, "op": "media_register"},
    )


async def _async_sweep_orphaned_media(hass: HomeAssistant, repository: Repository) -> None:
    """Delete attachment files no stored metadata references.

    At setup, the one moment the metadata is complete and nothing is mid-write.
    A failure costs disk, not data, so it never stops the entry from loading.
    """
    try:
        if repository.get_counts()["items_total"] == 0:
            # A missing or unwritten store looks like this too, and there the
            # files are the only copy left; sweeping would take the whole root.
            await media_mod.async_report_unswept(hass)
            return
        await media_mod.async_sweep_orphans(hass, repository.iter_attachments())
    except Exception:
        LOGGER.warning(
            "Could not sweep orphaned attachment files",
            extra={"domain": DOMAIN, "op": "media_sweep"},
            exc_info=True,
        )


def _resolve_card_title(entry: ConfigEntry) -> str:
    """Read the configured card title; an unset or blank one is the default."""
    title = entry.options.get(CONF_CARD_TITLE)
    if isinstance(title, str) and title.strip():
        return title.strip()
    return DEFAULT_CARD_TITLE


def _resolve_quick_filters(entry: ConfigEntry) -> list[str] | None:
    """Read the configured quick-filter pills, or `None` when none was chosen.

    `None` leaves the choice to the dashboard, while `[]` means no pills
    anywhere. Names this build does not know are dropped.
    """
    chosen = entry.options.get(CONF_QUICK_FILTERS)
    if not isinstance(chosen, list):
        return None
    known = {entry_name for entry_name in chosen if isinstance(entry_name, str)}
    return [key for key in QUICK_FILTER_KEYS if key in known]


async def _async_options_updated(hass: HomeAssistant, entry: HAventoryConfigEntry) -> None:
    """Apply changed options: card title, pills, sidebar panel, shopping list."""
    runtime = find_runtime(hass)
    if runtime is not None:
        runtime.card_title = _resolve_card_title(entry)
        runtime.quick_filters = _resolve_quick_filters(entry)
    # Covers the toggle and a renamed card alike: the sidebar entry carries the
    # card title, and re-registering is how a changed one reaches the sidebar.
    await _async_apply_sidebar_panel(hass, entry)
    # A changed shopping list is applied by converging on it: the pass takes the
    # lines off whichever list they were written to and puts them on the new one.
    todo_mod.apply_options(hass, entry)
    await todo_mod.async_reconcile(hass)
    LOGGER.info(
        "Applied updated HAventory options",
        extra={"domain": DOMAIN, "op": "options_updated"},
    )


async def _async_flush_pending_writes(hass: HomeAssistant, *, op: str) -> None:
    """Write out whatever is still unsaved, before the state that holds it goes."""

    if find_runtime(hass) is None:
        return

    try:
        await async_persist_immediate(hass)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error(
            "Failed to persist during teardown",
            extra={"domain": DOMAIN, "op": op},
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
    _remove_extra_js_url(hass)
    if release_panel:
        _remove_sidebar_panel(hass)


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

    await _unregister_frontend_module(hass)
    await _async_teardown_entry(hass, op="remove", release_panel=True)


def _card_url() -> str:
    """The one URL both frontend loaders receive, versioned as `?v=`.

    The bundle is served without `Cache-Control`, so a browser falls back to
    heuristic freshness and may hold an old bundle for days after an update; a
    version bump is a new URL no cache can satisfy.
    """
    return f"{_CARD_URL_PATH}?v={quote(INTEGRATION_VERSION, safe='')}"


def _points_at_card(resource_url: Any) -> bool:
    """Does an already-registered Lovelace resource serve the HAventory card?

    Paths, not whole URLs: matching the `?v=` too would register a second entry
    for the same module, and the second `customElements.define` throws.
    """
    if not isinstance(resource_url, str):
        return False
    return urlsplit(resource_url).path == _CARD_URL_PATH


async def _async_lovelace_resources(hass: HomeAssistant, *, op: str) -> Any:
    """Return the loaded Lovelace resource collection, or None if out of reach."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace_data, "resources", None) if lovelace_data else None
    if resources is None:
        LOGGER.debug(
            "Lovelace not initialized or resources unavailable",
            extra={"domain": DOMAIN, "op": op},
        )
        return None

    # `async_items` is sync and reports nothing until the collection is loaded.
    # `async_load` leaves `loaded` False, and the next write would then load and
    # re-add every item, so the flag is set here too.
    if not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True

    return resources


async def _async_register_static_path(hass: HomeAssistant) -> bool:
    """Serve the card directory over HTTP, at most once per Home Assistant run."""
    bucket = hass.data.setdefault(DOMAIN, {})
    if bucket.get(_STATIC_PATH_KEY):
        return True

    try:
        # No Cache-Control, so a rebuild that kept the version is revalidated.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(_STATIC_URL_PATH, str(_WWW_DIR), cache_headers=False)]
        )
    except Exception:
        # ERROR: without the route neither card loader has anything to load.
        LOGGER.error(
            "Failed to serve the HAventory card directory; the card cannot load",
            extra={"domain": DOMAIN, "op": "frontend_register", "path": str(_WWW_DIR)},
            exc_info=True,
        )
        return False

    bucket[_STATIC_PATH_KEY] = True
    LOGGER.debug(
        "Serving the HAventory card bundle",
        extra={
            "domain": DOMAIN,
            "op": "frontend_register",
            "url": _STATIC_URL_PATH,
            "path": str(_WWW_DIR),
        },
    )
    return True


def _register_extra_js_url(hass: HomeAssistant, url: str) -> None:
    """Have the frontend load the card as an extra module on every dashboard.

    This loader reaches YAML resource mode; HA Cast ignores it, which is what the
    Lovelace resource is for.
    """
    try:
        add_extra_js_url(hass, url)
    except Exception:
        LOGGER.debug(
            "Frontend not ready for an extra module URL; the card relies on the Lovelace resource",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
            exc_info=True,
        )
        return

    hass.data.setdefault(DOMAIN, {})[_EXTRA_JS_URL_KEY] = url
    LOGGER.debug(
        "Registered the HAventory card as a frontend module URL",
        extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
    )


def _remove_extra_js_url(hass: HomeAssistant, fallback_url: str | None = None) -> None:
    """Hand back the module URL registered at setup.

    The stored string wins: it carries the version the card was registered
    under, which an update may have moved on from.
    """
    url = hass.data.setdefault(DOMAIN, {}).pop(_EXTRA_JS_URL_KEY, None) or fallback_url
    if url is None:
        return

    try:
        remove_extra_js_url(hass, url)
    except Exception:
        LOGGER.debug(
            "Could not remove the frontend module URL",
            extra={"domain": DOMAIN, "op": "frontend_unregister", "url": url},
            exc_info=True,
        )
        return

    LOGGER.debug(
        "Removed the HAventory card frontend module URL",
        extra={"domain": DOMAIN, "op": "frontend_unregister", "url": url},
    )


def _sidebar_panel_enabled(entry: ConfigEntry) -> bool:
    """Whether the config entry asks for a sidebar entry; an unset option reads as on."""
    return bool(entry.options.get(CONF_SIDEBAR_PANEL_ENABLED, DEFAULT_SIDEBAR_PANEL_ENABLED))


def _remove_sidebar_panel(hass: HomeAssistant) -> None:
    """Take the sidebar entry back, whether or not one is registered."""
    hass.data.setdefault(DOMAIN, {}).pop(_PANEL_STATE_KEY, None)
    try:
        async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    except Exception:  # pragma: no cover - defensive
        LOGGER.debug(
            "Could not remove the HAventory sidebar panel",
            extra={"domain": DOMAIN, "op": "panel_unregister", "url": PANEL_URL_PATH},
            exc_info=True,
        )


async def _async_apply_sidebar_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Converge the sidebar entry on what the options and the build ask for.

    A registration already in place is left as it is. Changing one means removing
    it first, because `panel_custom.async_register_panel` does not forward
    `update` and raises `Overwriting panel`, and while the panel is gone the
    frontend sends whoever is on its page back to the default dashboard. So only
    the sidebar toggle and a rename pay that cost.
    """
    bucket = hass.data.setdefault(DOMAIN, {})

    def give_back() -> None:
        """Drop the panel if there is one; say nothing when there never was."""
        if bucket.get(_PANEL_STATE_KEY) is not None:
            _remove_sidebar_panel(hass)

    if not _sidebar_panel_enabled(entry):
        give_back()
        LOGGER.debug(
            "Sidebar panel disabled in the options; not registering",
            extra={"domain": DOMAIN, "op": "panel_register"},
        )
        return

    # The panel element lives in the card bundle.
    if not os.path.isfile(_CARD_BUNDLE_PATH):  # noqa: ASYNC240
        give_back()
        LOGGER.debug(
            "Card bundle not built; skipping sidebar panel registration",
            extra={
                "domain": DOMAIN,
                "op": "panel_register",
                "path": str(_CARD_BUNDLE_PATH),
            },
        )
        return

    title = _resolve_card_title(entry)
    # The exact string both card loaders receive, or the element is defined twice.
    url = _card_url()
    wanted = (title, url)

    if bucket.get(_PANEL_STATE_KEY) == wanted:
        LOGGER.debug(
            "Sidebar panel already registered as asked; leaving it in place",
            extra={
                "domain": DOMAIN,
                "op": "panel_register",
                "url": PANEL_URL_PATH,
                "module_url": url,
            },
        )
        return

    give_back()

    try:
        await async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_ELEMENT_NAME,
            sidebar_title=title,
            sidebar_icon=PANEL_ICON,
            module_url=url,
            embed_iframe=False,
            trust_external=False,
            config={"title": title},
            require_admin=False,
        )
    except Exception:
        LOGGER.warning(
            "Failed to register the HAventory sidebar panel",
            extra={"domain": DOMAIN, "op": "panel_register", "url": PANEL_URL_PATH},
            exc_info=True,
        )
        return

    bucket[_PANEL_STATE_KEY] = wanted
    LOGGER.debug(
        "Registered the HAventory sidebar panel",
        extra={
            "domain": DOMAIN,
            "op": "panel_register",
            "url": PANEL_URL_PATH,
            "module_url": url,
        },
    )


async def _rewrite_card_resource(resources: Any, stale: dict[str, Any], url: str) -> None:
    """Point an existing card entry at the current URL, rather than adding a second."""
    stale_id = stale.get("id")
    # No update API means YAML mode, where resources are user-managed; no id means
    # the entry cannot be addressed. Either way, leave it as it stands.
    if stale_id is None or not hasattr(resources, "async_update_item"):
        LOGGER.debug(
            "Cannot rewrite the registered card resource; leaving it as-is",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": stale.get("url")},
        )
        return

    try:
        await resources.async_update_item(stale_id, {"res_type": "module", "url": url})
        LOGGER.info(
            "Updated HAventory card Lovelace resource to the current version",
            extra={
                "domain": DOMAIN,
                "op": "frontend_register",
                "url": url,
                "previous_url": stale.get("url"),
            },
        )
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to update frontend resource",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
            exc_info=True,
        )


async def _create_card_resource(resources: Any, url: str) -> None:
    """Add the card to the Lovelace resource list, where that list is writable."""
    if not hasattr(resources, "async_create_item"):
        LOGGER.debug(
            "Lovelace in YAML mode; the card loads through the frontend module URL instead",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
        )
        return

    try:
        await resources.async_create_item({"res_type": "module", "url": url})
        LOGGER.info(
            "Registered HAventory card as Lovelace resource",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
        )
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to register frontend resource",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
            exc_info=True,
        )


async def _delete_card_resource(resources: Any, item: dict[str, Any], *, op: str) -> None:
    """Remove one Lovelace resource entry for the card."""
    item_id = item.get("id")
    if item_id is None or not hasattr(resources, "async_delete_item"):  # pragma: no cover
        return

    try:
        await resources.async_delete_item(item_id)
        LOGGER.info(
            "Removed HAventory card Lovelace resource",
            extra={
                "domain": DOMAIN,
                "op": op,
                "url": item.get("url"),
                "resource_id": item_id,
            },
        )
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to remove frontend resource",
            extra={
                "domain": DOMAIN,
                "op": op,
                "url": item.get("url"),
                "resource_id": item_id,
            },
            exc_info=True,
        )


async def _async_register_lovelace_resource(hass: HomeAssistant, url: str) -> None:
    """Leave exactly one Lovelace resource for the card, pointing at `url`."""
    resources = await _async_lovelace_resources(hass, op="frontend_register")
    if resources is None:
        return

    ours = [item for item in (resources.async_items() or []) if _points_at_card(item.get("url"))]
    if not ours:
        await _create_card_resource(resources, url)
        return

    keep, *duplicates = ours
    if keep.get("url") == url:
        LOGGER.debug(
            "HAventory card resource already registered at the current version",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
        )
    else:
        await _rewrite_card_resource(resources, keep, url)

    # Anything beyond the first entry defines the same element a second time.
    for item in duplicates:
        await _delete_card_resource(resources, item, op="frontend_register")


async def _register_frontend_module(hass: HomeAssistant) -> None:
    """Serve the built card and hand the same URL to both frontend loaders."""
    # A single stat at setup is not worth an executor round-trip.
    if not os.path.isfile(_CARD_BUNDLE_PATH):  # noqa: ASYNC240
        LOGGER.debug(
            "Card bundle not built; skipping frontend registration",
            extra={
                "domain": DOMAIN,
                "op": "frontend_register",
                "path": str(_CARD_BUNDLE_PATH),
            },
        )
        return

    if not await _async_register_static_path(hass):
        return

    url = _card_url()
    _register_extra_js_url(hass, url)
    await _async_register_lovelace_resource(hass, url)


async def _unregister_frontend_module(hass: HomeAssistant) -> None:
    """Take back both frontend registrations for the card."""
    _remove_extra_js_url(hass, _card_url())

    resources = await _async_lovelace_resources(hass, op="frontend_unregister")
    if resources is None:
        return

    # YAML mode: resources come from configuration.yaml and the collection is
    # read-only, so an entry there is the user's to remove.
    if not hasattr(resources, "async_delete_item"):
        LOGGER.info(
            "Lovelace in YAML mode; remove any HAventory card resource from configuration.yaml",
            extra={"domain": DOMAIN, "op": "frontend_unregister", "url": _CARD_URL_PATH},
        )
        return

    # Snapshot the collection: deleting mutates what async_items() reflects.
    for item in list(resources.async_items() or []):
        if _points_at_card(item.get("url")):
            await _delete_card_resource(resources, item, op="frontend_unregister")


def _create_refusal_issue(
    hass: HomeAssistant, issue_id: str, exc: Exception, *, store_key: str
) -> None:
    """Put a schema refusal in Settings → Repairs as well as the entry's error state.

    Not persistent: the issue describes the last setup attempt, and a stored copy
    would outlive a store the user has since restored.
    """

    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.ERROR,
        translation_key=issue_id,
        translation_placeholders={"error": str(exc), "storage_key": store_key},
    )


def _create_corrupt_store_issue(hass: HomeAssistant, report: LoadReport, *, store_key: str) -> None:
    """Offer the guarded "load anyway" for a store with unreadable rows; `repairs.py` runs it."""

    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_CORRUPT_STORE,
        is_fixable=True,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_CORRUPT_STORE,
        translation_placeholders={
            "items": str(len(report.dropped_item_ids)),
            "locations": str(len(report.dropped_location_ids)),
            "cyclic_locations": str(len(report.cyclic_location_ids)),
            "storage_key": store_key,
            "backup_key": CORRUPT_BACKUP_STORAGE_KEY,
        },
    )


def _delete_refusal_issues(hass: HomeAssistant) -> None:
    """Clear every repairs issue setup can raise. Deleting an absent one is not an error."""

    for issue_id in REPAIR_ISSUE_IDS:
        ir.async_delete_issue(hass, DOMAIN, issue_id)


def _lossy_load_allowed(entry: ConfigEntry) -> bool:
    """Whether the corrupt-store repair has been run and its reload is now arriving."""

    return bool(entry.options.get(CONF_ALLOW_LOSSY_LOAD))


def _clear_lossy_load_option(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Take the one-boot opt-in back off the entry, without rewriting an unchanged one."""

    if not _lossy_load_allowed(entry):
        return

    options = {key: value for key, value in entry.options.items() if key != CONF_ALLOW_LOSSY_LOAD}
    hass.config_entries.async_update_entry(entry, options=options)


def _corrupt_store_message(report: LoadReport, *, store_key: str) -> str:
    """Explain a refused load: counts, a few ids labelled by kind, and the file."""

    parts: list[str] = []
    if report.dropped_item_ids:
        parts.append(f"{len(report.dropped_item_ids)} item(s)")
    if report.dropped_location_ids:
        parts.append(f"{len(report.dropped_location_ids)} location(s)")
    if report.cyclic_location_ids:
        cycle = f"{len(report.cyclic_location_ids)} location(s) in a parent cycle"
        if report.unrooted_location_ids:
            cycle += f" (blocking {len(report.unrooted_location_ids)} below them)"
        parts.append(cycle)

    # Cycle members only. A location merely sitting below a cycle needs no edit,
    # so naming it sends the user to a row where there is nothing to change.
    sample = [
        *(f"item {i}" for i in report.dropped_item_ids[:_CORRUPT_SAMPLE_IDS]),
        *(f"location {i}" for i in report.dropped_location_ids[:_CORRUPT_SAMPLE_IDS]),
        *(f"location {i} (parent_id)" for i in report.cyclic_location_ids[:_CORRUPT_SAMPLE_IDS]),
    ]
    detail = f" First affected ids: {'; '.join(sample)}." if sample else ""
    return (
        f"HAventory could not read {' and '.join(parts)} from .storage/{store_key}, "
        f"so setup stopped instead of loading a partial inventory and overwriting the "
        f"file on the next change.{detail} The store has been left untouched — restore "
        f"it from a backup, or repair those entries, then reload the integration. "
        f"Removing and re-adding the integration will not help: it leaves the file "
        f"exactly as it is, so setup stops here again."
    )


def _log_storage_health(payload: dict[str, Any], *, schema_version: int) -> None:
    """Log what the store came back with, at DEBUG: an empty store is a healthy one."""

    items = payload.get("items")
    locations = payload.get("locations")
    item_count = len(items) if isinstance(items, dict) else 0
    location_count = len(locations) if isinstance(locations, dict) else 0

    LOGGER.debug(
        "Storage health",
        extra={
            "domain": DOMAIN,
            "op": "setup_storage_health",
            "schema_version": schema_version,
            "items_count": item_count,
            "locations_count": location_count,
        },
    )
