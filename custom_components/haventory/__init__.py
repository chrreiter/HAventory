"""HAventory integration bootstrap.

This module initializes the integration, prepares persistent storage, and sets up
the core data structures in hass.data.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import issue_registry as ir
from homeassistant.loader import async_get_integration

try:
    from homeassistant.components.lovelace import LOVELACE_DATA
except ImportError:  # pragma: no cover - older HA versions
    LOVELACE_DATA = None  # type: ignore[misc, assignment]

try:
    from homeassistant.components.http import StaticPathConfig
except ImportError:  # pragma: no cover - minimal harness without the http component
    StaticPathConfig = None  # type: ignore[misc, assignment]

try:
    from homeassistant.components.frontend import add_extra_js_url, remove_extra_js_url
except ImportError:  # pragma: no cover - minimal harness without the frontend component
    add_extra_js_url = None  # type: ignore[assignment]
    remove_extra_js_url = None  # type: ignore[assignment]

# Separate from the import above so a frontend that carries only one of the two
# still hands us the other, rather than losing both to a single ImportError.
try:
    from homeassistant.components.frontend import async_remove_panel
except ImportError:  # pragma: no cover - minimal harness without the frontend component
    async_remove_panel = None  # type: ignore[assignment]

try:
    from homeassistant.components.panel_custom import async_register_panel
except ImportError:  # pragma: no cover - minimal harness without panel_custom
    async_register_panel = None  # type: ignore[assignment]

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
from .rate_limit import RateLimitConfig, RateLimiter
from .repository import LoadReport, Repository
from .runtime import HAventoryConfigEntry, HAventoryRuntime, find_runtime
from .storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_backup_store,
    async_persist_immediate,
    read_schema_version,
    schema_downgrade_message,
)

LOGGER = context_logger(__name__)

_MANIFEST_PATH = Path(__file__).with_name("manifest.json")

# The card bundle ships inside the integration package — the only tree HACS
# copies for an integration-category repo — and is served from there.
_CARD_FILENAME = "haventory-card.js"
_WWW_DIR = Path(__file__).parent / "www"
_CARD_BUNDLE_PATH = _WWW_DIR / _CARD_FILENAME
_STATIC_URL_PATH = "/haventory_static"
_CARD_URL_PATH = f"{_STATIC_URL_PATH}/{_CARD_FILENAME}"

# Installs predating the move loaded the card from a copy in the config `www/`
# tree. That copy goes away with the integration, so such an entry is ours to
# rewrite rather than somebody else's resource to leave alone.
_LEGACY_CARD_URL_PATH = "/local/haventory/haventory-card.js"
_CARD_URL_PATHS = frozenset({_CARD_URL_PATH, _LEGACY_CARD_URL_PATH})

# hass.data[DOMAIN] keys that outlive a config entry: the static route cannot be
# unregistered, and the module URL has to be removed as the exact string it was
# registered under.
_STATIC_PATH_KEY = "static_path_registered"
_EXTRA_JS_URL_KEY = "extra_js_url"

# Whether the authenticated media view has been registered in this Home
# Assistant run. Outlives the config entry for the same reason as the static
# route: aiohttp cannot unregister a route, so a reload must not add a second.
_MEDIA_VIEW_KEY = "media_view_registered"

# What the sidebar panel is registered with right now — the title and the module
# URL, the only two inputs that can change while Home Assistant runs — or absent
# when no panel is registered. Written and cleared together with the frontend's
# own registry by the two functions at the bottom of this module, so the two
# never disagree. It outlives a plain unload on purpose: a reload passes through
# one, and a browser standing on `/haventory` is sent to the default dashboard
# the moment the panel leaves `hass.panels`.
_PANEL_STATE_KEY = "panel_state"

# How many ids of each kind the corrupt-store refusal quotes. Enough to grep the
# file with, few enough that a wholesale corruption does not paste thousands of
# uuids into the config entry's error state.
_CORRUPT_SAMPLE_IDS = 3


# This integration is config-entry only; no YAML configuration is accepted.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup_entry(hass: HomeAssistant, entry: HAventoryConfigEntry) -> bool:
    """Set up HAventory from a config entry."""
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}

    # An upgrade extracts over the install directory without clearing it, so
    # anything an earlier version shipped and this one dropped is still on disk.
    # First, so a retired bundle is gone before the card directory is served.
    await stale_files.async_sweep_retired_files(hass)

    store = DomainStore(hass, key=STORAGE_KEY, version=CURRENT_SCHEMA_VERSION)
    repository = await _async_load_repository(hass, entry, store)

    # Onto the entry, before anything that reads it: every module resolves the
    # runtime through `hass.config_entries`, so nothing below this line would
    # find a repository without it. Home Assistant clears it again on unload.
    entry.runtime_data = HAventoryRuntime(
        store=store,
        repository=repository,
        # Heading and pill choice served to the card by `haventory/config`.
        card_title=_resolve_card_title(entry),
        quick_filters=_resolve_quick_filters(entry),
        # WebSocket rate limiting (off by default; configured via the options flow)
        rate_limiter=RateLimiter(RateLimitConfig.from_options(getattr(entry, "options", None))),
    )

    # A load that had to leave rows behind has to reach the file, or the next
    # restart meets the same rows and refuses all over again.
    await _async_settle_lossy_load(hass, store, repository)

    # Whatever the previous boot left in Settings → Repairs described a store this
    # one just read, so none of it is true any more.
    _delete_refusal_issues(hass)

    # Which items are already low, before anything can mutate. Without this the
    # first mutation after every restart would announce `entered` for every item
    # that was low before it.
    events.seed_low_stock_snapshot(hass)

    # Tell `stats` subscribers when the day turns over, the way the date-derived
    # sensors and the calendar already rewrite themselves there. Cancelled with
    # the entry: a tracker outliving it would broadcast counts nothing owns.
    entry.async_on_unload(events.async_track_day_rollover(hass))

    # Serve attachment files, and collect the ones nothing references any more.
    # Both need the repository, so both come after the runtime is on the entry.
    _register_media_view(hass)
    await _async_sweep_orphaned_media(hass, repository)

    # Re-read the options when they change. Guarded with getattr so the
    # minimal offline-test ConfigEntry stubs keep working.
    add_listener = getattr(entry, "add_update_listener", None)
    on_unload = getattr(entry, "async_on_unload", None)
    if callable(add_listener) and callable(on_unload):
        on_unload(add_listener(_async_options_updated))

    # The shopping-list bridge, after the repository it reads and the update
    # listener above: its first pass needs the low-stock set, and an options
    # change has to reach it.
    await todo_mod.async_setup(hass, entry)

    # Register services
    services_mod.setup(hass)

    # Register WebSocket commands
    ws_mod.setup(hass)

    # Entity platforms, after the repository is in the bucket the entities read
    # so the first state write has data. Guarded like the update-listener wiring
    # below: the offline HomeAssistant stub has no `config_entries`.
    await _async_forward_platforms(hass, entry)

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

    Four conditions end setup here. Two are refusals about the whole file —
    written by a newer build, or carrying a `schema_version` that is not a
    number — and one is about rows inside it this build cannot read; each puts
    a card in Settings → Repairs beside the entry's error state, and only the
    last is fixable. The fourth, a store that cannot be read at all right now,
    is transient and gets a retry rather than a card.
    """

    try:
        payload = await store.async_load()
        _validate_storage_payload(payload, schema_version=store.schema_version)
        _log_storage_health(payload, schema_version=store.schema_version)
    except SchemaDowngradeError as exc:
        LOGGER.error(
            "Refusing to set up against storage written by a newer HAventory version",
            extra={"domain": DOMAIN, "op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        _create_refusal_issue(hass, ISSUE_SCHEMA_DOWNGRADE, exc, store_key=store.key)
        # ConfigEntryError, not ConfigEntryNotReady: retrying cannot teach this build
        # a newer schema, and the message reaches the user in the entry's error state.
        raise ConfigEntryError(str(exc)) from exc
    except CorruptSchemaVersionError as exc:
        LOGGER.error(
            "Refusing to set up against storage whose schema_version is unreadable",
            extra={"domain": DOMAIN, "op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
        _create_refusal_issue(hass, ISSUE_CORRUPT_SCHEMA_VERSION, exc, store_key=store.key)
        # Same reasoning as the downgrade above: no number of retries turns a
        # corrupt version into a readable one, so the entry stops with the
        # specific message instead of backing off behind a generic one.
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
            # Refuse rather than load what could be read. Every WS and service handler
            # persists immediately, so a loaded entry rewrites the store without the
            # unreadable rows on the very first mutation — a notification would narrate
            # the loss, not prevent it. Refusing leaves the file intact for repair, and
            # matches the two schema refusals above: retrying cannot fix any of them.
            # The repairs issue is the way back in: it takes a copy first, then sets
            # the option this branch reads.
            _create_corrupt_store_issue(hass, load_report, store_key=store.key)
            raise ConfigEntryError(_corrupt_store_message(load_report, store_key=store.key))
    # Spend the opt-in on any load that reaches here, not only the corrupt one it
    # was set for. A reload landing on a store that reads fine — a backup put
    # back by hand before the button was pressed, or a later boot after the fix
    # flow's own reload failed — would otherwise leave it armed, and the next
    # corruption would then load lossily with nobody having asked. Ahead of the
    # update listener setup registers afterwards, so clearing it cannot bounce
    # the entry through a reload of its own.
    _clear_lossy_load_option(hass, entry)
    return repository


async def _async_settle_lossy_load(
    hass: HomeAssistant, store: DomainStore, repository: Repository
) -> None:
    """Write the store back the way it was just read, when rows had to be dropped.

    A lossy load leaves the unreadable rows on disk, so the refusal and its card
    come back on the next restart unless something happens to persist first — the
    repair would hold only until the household restarts Home Assistant, and the
    copy it took would be the only sign it ever ran.

    A copy is taken here as well as in the repair flow, so no path can write the
    readable remainder over the file while the rows it left out exist nowhere. It
    is the same raw copy under the same key: the store has not changed since the
    flow took its own, so the second write is the same bytes.
    """

    if not repository.last_load_report.has_corruption:
        return

    try:
        copied = await async_backup_store(hass, source_key=store.key)
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to copy the HAventory store aside after loading it with unreadable rows",
            extra={"domain": DOMAIN, "op": "settle_lossy_load"},
        )
        copied = False
    if not copied:
        # Leaving the file as it is keeps the rows recoverable, at the price of
        # meeting the same refusal on the next restart. The alternative writes
        # the only copy of them away.
        LOGGER.error(
            "Loaded a store with unreadable rows but could not copy it aside, so it "
            "was left as it is; the same rows will stop the next start-up",
            extra={"domain": DOMAIN, "op": "settle_lossy_load"},
        )
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


async def _async_forward_platforms(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Set up the entity platforms this entry owns, where there are any."""

    config_entries = getattr(hass, "config_entries", None)
    forward = getattr(config_entries, "async_forward_entry_setups", None)
    if forward is None:
        return
    await forward(entry, list(PLATFORMS))


async def _async_unload_platforms(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Take the entity platforms down before the bucket they read is emptied."""

    config_entries = getattr(hass, "config_entries", None)
    unload = getattr(config_entries, "async_unload_platforms", None)
    if unload is None:
        return True
    return bool(await unload(entry, list(PLATFORMS)))


def _register_media_view(hass: HomeAssistant) -> None:
    """Serve `/api/haventory/media/...`, at most once per Home Assistant run.

    Same shape as `_async_register_static_path`, and for the same reason:
    aiohttp cannot unregister a route, so the guard flag has to outlive the
    config entry or a reload would register a second view for one URL.
    """
    bucket = hass.data.setdefault(DOMAIN, {})
    if bucket.get(_MEDIA_VIEW_KEY):
        return

    register = getattr(getattr(hass, "http", None), "register_view", None)
    if register is None:
        LOGGER.debug(
            "HTTP component unavailable; item attachments cannot be served",
            extra={"domain": DOMAIN, "op": "media_register"},
        )
        return

    try:
        register(media_mod.HaventoryMediaView())
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

    Runs at setup because that is the one moment the metadata is known to be
    complete and nothing is mid-write. A failure here costs disk, not data, so
    it never stops the entry from loading.
    """
    try:
        await media_mod.async_sweep_orphans(hass, repository.iter_attachments())
    except Exception:
        LOGGER.warning(
            "Could not sweep orphaned attachment files",
            extra={"domain": DOMAIN, "op": "media_sweep"},
            exc_info=True,
        )


def _resolve_card_title(entry: ConfigEntry) -> str:
    """Read the configured card title, falling back to the default.

    Entries created before the option existed simply have no value for it, so
    an unset or blank title is the default rather than an empty heading.
    """
    options = getattr(entry, "options", None) or {}
    title = options.get(CONF_CARD_TITLE)
    if isinstance(title, str) and title.strip():
        return title.strip()
    return DEFAULT_CARD_TITLE


def _resolve_quick_filters(entry: ConfigEntry) -> list[str] | None:
    """Read the configured quick-filter pills, or `None` when none was chosen.

    `None` and `[]` are different answers and stay that way: an entry that never
    chose leaves the decision to the dashboard's own `quick_filters:`, and after
    that to the card's "every pill" default, while an empty list is a household
    saying it wants no pills anywhere. Names this build does not know are
    dropped rather than passed on — the card would drop them too, and dropping
    them here keeps the wire payload to the vocabulary both sides share.
    """
    options = getattr(entry, "options", None) or {}
    chosen = options.get(CONF_QUICK_FILTERS)
    if not isinstance(chosen, list):
        return None
    known = {entry_name for entry_name in chosen if isinstance(entry_name, str)}
    return [key for key in QUICK_FILTER_KEYS if key in known]


async def _async_options_updated(hass: HomeAssistant, entry: HAventoryConfigEntry) -> None:
    """Apply changed options: card title, pills, sidebar panel, WS rate limiter."""
    runtime = find_runtime(hass)
    if runtime is not None:
        runtime.card_title = _resolve_card_title(entry)
        runtime.quick_filters = _resolve_quick_filters(entry)
        runtime.rate_limiter = RateLimiter(
            RateLimitConfig.from_options(getattr(entry, "options", None))
        )
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
    """Write out whatever is still unsaved, before the state that holds it goes.

    With no runtime there is nothing to write: the repository the write would
    read is already gone.
    """

    if find_runtime(hass) is None:
        return

    try:
        await async_persist_immediate(hass)
    except Exception:  # pragma: no cover - defensive
        # This is the last chance to write; a failure here silently drops
        # whatever was still unsaved, which nobody but an operator can recover.
        LOGGER.error(
            "Failed to persist during teardown",
            extra={"domain": DOMAIN, "op": op},
            exc_info=True,
        )


async def _async_teardown_entry(hass: HomeAssistant, *, op: str, release_panel: bool) -> None:
    """Give up everything the config entry owns, in the order that keeps it safe.

    Every step here runs while the entry is **not** loaded — Home Assistant marks
    it `UNLOAD_IN_PROGRESS` before calling `async_unload_entry` — so each reads
    the runtime through `find_runtime` rather than through the loaded check a
    client-facing command uses. A flush routed through that check would write
    nothing and drop whatever was still unsaved.

    Flush first, while the repository is still reachable; then tell open
    subscribers, while the subscription registry still lists them; then hand back
    the frontend registrations, which read the URL the bucket recorded. Home
    Assistant clears `runtime_data` itself once this returns.

    `release_panel` says whether the sidebar entry goes with them; the callers
    decide, because only they can tell an entry that is coming straight back from
    one that is not.
    """

    await _async_flush_pending_writes(hass, op=op)

    ws_mod.notify_backend_unavailable(hass)

    # Hand back the frontend module URL; setup re-adds it on the next load. The
    # static route stays, along with the flag that records it: aiohttp cannot
    # unregister a route, and a reload must not try to add it twice.
    _remove_extra_js_url(hass)

    # A sidebar entry outliving the backend it opens is a link to a page that
    # cannot load — but a reload comes through here too, and the page a browser
    # has open is what disappears with the panel. So it is handed back only when
    # the entry is not coming back on its own, and setup converges it otherwise.
    if release_panel:
        _remove_sidebar_panel(hass)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry.

    An unloaded entry owns nothing, so it serves nothing: the runtime goes the
    way it does on removal, and the WebSocket commands — which Home Assistant
    cannot unregister — refuse from here until setup runs again. That covers a
    disabled entry, which stays in this state, and a reload, which passes through
    it for as long as setup takes.

    The sidebar entry is the one thing those two want handled differently, so
    they are told apart here: Home Assistant sets `disabled_by` before it
    unloads, and a reload leaves it alone.
    """

    # Ahead of the teardown that gives up the repository the entities read: an
    # entity still registered against a released one reports unavailable rather
    # than being gone.
    unloaded = await _async_unload_platforms(hass, entry)

    disabled = getattr(entry, "disabled_by", None) is not None
    await _async_teardown_entry(hass, op="unload", release_panel=disabled)

    return unloaded


async def async_remove_entry(hass: HomeAssistant, _entry: ConfigEntry) -> None:
    """Clean up after the config entry has been removed from Home Assistant.

    Removal takes back what setup put into other components' state: the Lovelace
    resource registered for the card and the frontend's extra module URL. Left
    behind, either points at an asset that disappears with the integration, and
    a dead `module` URL fails to load on every dashboard render.

    It then runs the same teardown an unload does, so the API stops answering for
    an integration that is gone rather than serving on until the next restart.
    Home Assistant unloads before it removes, so that teardown has usually
    already run and finds nothing left to give up.

    The HA `Store` file is deliberately kept, so re-adding the integration
    restores the inventory. Purging it is a manual step (README → Installation
    → "Removing HAventory").
    """

    await _unregister_frontend_module(hass)
    await _async_teardown_entry(hass, op="remove", release_panel=True)


def _read_manifest_version() -> str:
    """Parse the version out of the shipped manifest file. Blocks — run it in the executor."""
    try:
        manifest = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return ""
    raw = manifest.get("version")
    return raw if isinstance(raw, str) else ""


async def _async_manifest_version(hass: HomeAssistant) -> str:
    """Version this integration declares, or `""` when it cannot be determined.

    Home Assistant parses `manifest.json` when it loads the integration and keeps
    the result, so the version is already in memory. Reading the file here instead
    would be blocking I/O on the event loop, which HA's loop protection reports as
    a warning with a full stack trace on every startup. The executor read is the
    fallback for the case where the loader has no manifest to hand us.
    """
    try:
        integration = await async_get_integration(hass, DOMAIN)
        raw = integration.manifest.get("version")
    except Exception:
        LOGGER.debug(
            "Integration manifest unavailable from the loader; reading the file instead",
            extra={"domain": DOMAIN, "op": "frontend_register"},
        )
    else:
        if isinstance(raw, str) and raw:
            return raw

    try:
        return await hass.async_add_executor_job(_read_manifest_version)
    except Exception:
        LOGGER.debug(
            "Could not read the integration manifest; registering the card unversioned",
            extra={"domain": DOMAIN, "op": "frontend_register", "path": str(_MANIFEST_PATH)},
        )
        return ""


async def _async_card_url(hass: HomeAssistant) -> str:
    """The one URL both frontend loaders receive, versioned as `?v=`.

    The bundle is served without a `Cache-Control` header, so a browser — or the
    companion app's webview, which is harder to clear — falls back to *heuristic*
    freshness and may hold a long-unchanged bundle for days after an update,
    running an old card against a new backend. A version bump is a new URL, which
    no cache can satisfy. Falls back to the bare path if the version cannot be
    determined, since a missing cache-buster must not stop the card from loading
    at all.
    """
    version = await _async_manifest_version(hass)
    if not version:
        return _CARD_URL_PATH
    return f"{_CARD_URL_PATH}?v={quote(version, safe='')}"


def _points_at_card(resource_url: Any) -> bool:
    """Does an already-registered Lovelace resource serve the HAventory card?

    Compare paths, not whole URLs: a resource carries a cache-busting `?v=`
    query, and matching the full string would treat a versioned entry as
    somebody else's resource and register a second one for the same module — the
    card then loads twice and the second `customElements.define` throws. The
    legacy `/local` path counts as ours for the same reason: an install that
    predates the move must end up with one entry, not two.
    """
    if not isinstance(resource_url, str):
        return False
    return urlsplit(resource_url).path in _CARD_URL_PATHS


async def _async_lovelace_resources(hass: HomeAssistant, *, op: str) -> Any:
    """Return the loaded Lovelace resource collection, or None if out of reach.

    Lovelace may be missing entirely (older HA), not yet initialized, or set up
    without a resource collection. None of those are errors for us — the card is
    optional and the caller simply has nothing to do.
    """
    if LOVELACE_DATA is None:
        LOGGER.debug(
            "Lovelace component not available",
            extra={"domain": DOMAIN, "op": op},
        )
        return None

    lovelace_data = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace_data, "resources", None) if lovelace_data else None
    if resources is None:
        LOGGER.debug(
            "Lovelace not initialized or resources unavailable",
            extra={"domain": DOMAIN, "op": op},
        )
        return None

    # The collection's create/update/delete each load storage on demand, but
    # `async_items` cannot — it is a sync callback over an in-memory dict, so an
    # unloaded collection reports no resources at all. Both callers read it
    # first: register would add a second entry for a card already registered,
    # unregister would leave ours behind. Setting the flag is part of the
    # contract rather than bookkeeping — `async_load` leaves it False, and the
    # collection's next write would then load and re-add every item again.
    if not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True

    return resources


async def _async_register_static_path(hass: HomeAssistant) -> bool:
    """Serve the card directory over HTTP, at most once per Home Assistant run.

    aiohttp cannot unregister a route, so the guard flag lives in the domain
    bucket — which unload leaves in place — rather than in anything tied to the
    config entry's lifetime; a reload would otherwise register the same route a
    second time. Registering the *directory* rather than the file keeps that
    second attempt from depending on the order overlapping routes resolve in.
    """
    bucket = hass.data.setdefault(DOMAIN, {})
    if bucket.get(_STATIC_PATH_KEY):
        return True

    register = getattr(getattr(hass, "http", None), "async_register_static_paths", None)
    if StaticPathConfig is None or register is None:
        LOGGER.debug(
            "HTTP component unavailable; the card bundle cannot be served",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": _STATIC_URL_PATH},
        )
        return False

    try:
        # cache_headers=False: no Cache-Control, so the browser revalidates and
        # picks up a rebuild that did not change the version — which is every
        # rebuild during development. The `?v=` on the URL covers the other
        # direction (see _async_card_url).
        await register([StaticPathConfig(_STATIC_URL_PATH, str(_WWW_DIR), cache_headers=False)])
    except Exception:
        # ERROR, not WARNING: this return short-circuits both card loaders below,
        # so the bundle is served by nothing and the card cannot load at all. The
        # integration keeps working headlessly, which is what keeps it out of the
        # error taxonomy, but an operator has to act.
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

    This is the loader that reaches YAML resource mode, where the resource
    collection is read-only, and it persists nothing. HA Cast ignores it,
    which is what the Lovelace resource is still there for.
    """
    if add_extra_js_url is None:
        LOGGER.debug(
            "Frontend component not available; the card relies on the Lovelace resource",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
        )
        return

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

    The stored string wins over any recomputed one: it carries the manifest
    version the card was registered under, and an entry registered before an
    update would survive a removal aimed at the new version's URL.
    """
    url = hass.data.setdefault(DOMAIN, {}).pop(_EXTRA_JS_URL_KEY, None) or fallback_url
    if remove_extra_js_url is None or url is None:
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
    """Whether the config entry asks for a sidebar entry.

    Entries created before the option existed carry no value for it, and the
    panel is what makes a fresh install discoverable — so absence reads as on.
    Only an explicit opt-out turns it off.
    """
    options = getattr(entry, "options", None) or {}
    return bool(options.get(CONF_SIDEBAR_PANEL_ENABLED, DEFAULT_SIDEBAR_PANEL_ENABLED))


def _remove_sidebar_panel(hass: HomeAssistant) -> None:
    """Take the sidebar entry back, whether or not one is registered.

    `warn_if_unknown=False`: this also runs as the first half of replacing a
    registration, and on the first setup of an install there is nothing there to
    remove.
    """
    hass.data.setdefault(DOMAIN, {}).pop(_PANEL_STATE_KEY, None)
    if async_remove_panel is None:
        return

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

    A registration already in place is left exactly as it is. Changing one means
    removing it first — `panel_custom.async_register_panel` does not forward
    `frontend.async_register_built_in_panel`'s `update` argument, so registering
    over a path already taken raises `ValueError: Overwriting panel haventory` —
    and for the moment the panel is missing from `hass.panels`, the frontend
    sends whoever is standing on its page back to the default dashboard. That
    cost belongs to the two changes that need it, the sidebar toggle and the
    rename, and to nothing else: not to a reload, and not to an options save that
    leaves the panel's own settings alone.

    Both calls fire the frontend's panel-update event, so the sidebar follows
    without a restart.
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

    # The panel is the card bundle's second element, so without a build there is
    # nothing for it to load — same graceful skip the card loaders take.
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

    if async_register_panel is None:
        give_back()
        LOGGER.debug(
            "panel_custom component not available; HAventory gets no sidebar entry",
            extra={"domain": DOMAIN, "op": "panel_register", "url": PANEL_URL_PATH},
        )
        return

    title = _resolve_card_title(entry)
    # The exact string both card loaders receive: a second URL for the same
    # module defeats the browser's module map and defines the element twice.
    url = await _async_card_url(hass)
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
            # The panel element reads its heading from here, the way the card
            # reads it from `haventory/config`.
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
    """Point an entry left over from an earlier version at the current card URL.

    Rewriting rather than adding: a second entry for the same file loads the card
    module twice, and the second `customElements.define` throws.
    """
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
    """Serve the built card and hand its URL to both frontend loaders.

    The bundle rides along inside the integration package, so it exists exactly
    when the integration does — nothing is written to the config `www/` tree and
    nothing is orphaned there on uninstall. Both loaders get the *same* string:
    two different URLs for one module would define the element twice.
    """
    # One-shot existence check at setup; a single stat is not worth an executor
    # round-trip. A dev checkout that has not built the card lands here.
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

    url = await _async_card_url(hass)
    _register_extra_js_url(hass, url)
    await _async_register_lovelace_resource(hass, url)


async def _unregister_frontend_module(hass: HomeAssistant) -> None:
    """Take back both frontend registrations for the card."""
    _remove_extra_js_url(hass, await _async_card_url(hass))

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

    The refusal message is handed over whole rather than picked apart into
    version numbers: it is written for the user, it already names whatever
    disagreed, and one wording for both places is one wording to keep true.

    Not fixable and not persistent. Nothing HAventory can offer repairs a store
    it must not touch, and the issue describes the last setup attempt — a stored
    copy would outlive a store the user has since restored.
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
    """Offer the guarded "load anyway" for a store with unreadable rows.

    A warning rather than an error, and the only fixable one: the data that can
    be read is intact, and the decision to go on without the rest is the
    household's to make. `repairs.py` runs the fix.
    """

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

    options = getattr(entry, "options", None) or {}
    return bool(options.get(CONF_ALLOW_LOSSY_LOAD))


def _clear_lossy_load_option(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Take the one-boot opt-in back off the entry, where one is still on it.

    Returns early when there is nothing to spend, so the ordinary boot — every
    boot — does not write the entry back unchanged.

    Guarded with getattr for the offline test harness, whose HomeAssistant stub
    has no config-entry registry — the same reason the platform forwarding is.
    """

    if not _lossy_load_allowed(entry):
        return

    config_entries = getattr(hass, "config_entries", None)
    update = getattr(config_entries, "async_update_entry", None)
    if not callable(update):
        return

    options = {
        key: value
        for key, value in (getattr(entry, "options", None) or {}).items()
        if key != CONF_ALLOW_LOSSY_LOAD
    }
    update(entry, options=options)


def _corrupt_store_message(report: LoadReport, *, store_key: str) -> str:
    """Explain a refused load in terms of the file the user has to fix.

    The message reaches the config entry's error state, so it names counts, a few
    ids to grep for, and the file itself — a bare "corrupt storage" would leave
    the user with nowhere to look. Ids are labelled by kind, because they are the
    key to search under and an unlabelled mixed list says which to try only by
    luck.
    """

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


def _validate_storage_payload(payload: dict[str, Any], *, schema_version: int) -> None:
    """Validate loaded storage payload shape and version."""

    if not isinstance(payload, dict):
        raise StorageError("storage payload is not a dict")

    stored_version = read_schema_version(payload, missing=-1)
    if stored_version > int(schema_version):
        raise SchemaDowngradeError(
            schema_downgrade_message(
                stored_version=stored_version, supported_version=int(schema_version)
            )
        )
    if stored_version != int(schema_version):
        raise StorageError("storage payload schema_version mismatch")

    items = payload.get("items")
    locations = payload.get("locations")
    if not isinstance(items, dict) or not isinstance(locations, dict):
        raise StorageError("storage payload missing required collections")


def _log_storage_health(payload: dict[str, Any], *, schema_version: int) -> None:
    """Log storage health summary after validation.

    Always DEBUG, whatever the counts. An empty store is what every fresh
    install and every household that cleared its inventory boots with, and HA
    surfaces WARNING with no logger configuration, so warning on 0/0 made a new
    user's first line about HAventory a warning about a healthy state. A store
    that did not load is a different case with its own refusals, its own
    `corrupt_store` repair and its own ERROR lines.
    """

    items = payload.get("items")
    locations = payload.get("locations")
    item_count = len(items) if isinstance(items, dict) else 0
    location_count = len(locations) if isinstance(locations, dict) else 0

    # The three numbers are the context's, not the message's: it is rendered into
    # the line either way, and formatting them here as well printed each twice.
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
