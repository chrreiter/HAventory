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

from . import media as media_mod
from . import services as services_mod
from . import stale_files
from . import ws as ws_mod
from .const import (
    CONF_CARD_TITLE,
    CONF_SIDEBAR_PANEL_ENABLED,
    DEFAULT_CARD_TITLE,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
    DOMAIN,
    PANEL_ELEMENT_NAME,
    PANEL_ICON,
    PANEL_URL_PATH,
)
from .exceptions import CorruptSchemaVersionError, SchemaDowngradeError, StorageError
from .rate_limit import RateLimitConfig, RateLimiter
from .repository import LoadReport, Repository
from .storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_persist_immediate,
    cancel_pending_persist,
    read_schema_version,
    schema_downgrade_message,
)

LOGGER = logging.getLogger(__name__)

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

# Whether the sidebar panel is currently registered. Entry-scoped: unload takes
# the panel back, so a reload starts from nothing registered.
_PANEL_REGISTERED_KEY = "panel_registered"

# How many ids of each kind the corrupt-store refusal quotes. Enough to grep the
# file with, few enough that a wholesale corruption does not paste thousands of
# uuids into the config entry's error state.
_CORRUPT_SAMPLE_IDS = 3


# This integration is config-entry only; no YAML configuration is accepted.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, _config: dict) -> bool:
    """Set up the HAventory domain at Home Assistant startup.

    Initializes an empty domain bucket in hass.data with no side effects.
    """
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HAventory from a config entry."""
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}

    # An upgrade extracts over the install directory without clearing it, so
    # anything an earlier version shipped and this one dropped is still on disk.
    # First, so a retired bundle is gone before the card directory is served.
    await stale_files.async_sweep_retired_files(hass)

    # Expose storage manager via hass.data[DOMAIN]["store"]. Keep name compatible
    # with tests while upgrading to a schema-aware wrapper.
    store = DomainStore(hass, key=STORAGE_KEY, version=CURRENT_SCHEMA_VERSION)
    hass.data[DOMAIN]["store"] = store

    # Initialize in-memory repository for services and APIs by loading persisted state
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
        # ConfigEntryError, not ConfigEntryNotReady: retrying cannot teach this build
        # a newer schema, and the message reaches the user in the entry's error state.
        raise ConfigEntryError(str(exc)) from exc
    except CorruptSchemaVersionError as exc:
        LOGGER.error(
            "Refusing to set up against storage whose schema_version is unreadable",
            extra={"domain": DOMAIN, "op": "setup_storage", "schema_version": store.schema_version},
            exc_info=True,
        )
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
        LOGGER.error(
            "Refusing to set up against a store this build cannot fully read",
            extra={
                "domain": DOMAIN,
                "op": "setup_storage",
                "dropped_items": len(load_report.dropped_item_ids),
                "dropped_locations": len(load_report.dropped_location_ids),
                "cyclic_locations": len(load_report.cyclic_location_ids),
                "unrooted_locations": len(load_report.unrooted_location_ids),
            },
        )
        # Refuse rather than load what could be read. Every WS and service handler
        # persists immediately, so a loaded entry rewrites the store without the
        # unreadable rows on the very first mutation — a notification would narrate
        # the loss, not prevent it. Refusing leaves the file intact for repair, and
        # matches the two schema refusals above: retrying cannot fix any of them.
        raise ConfigEntryError(_corrupt_store_message(load_report, store_key=store.key))
    hass.data[DOMAIN]["repository"] = repository

    # Serve attachment files, and collect the ones nothing references any more.
    # Both need the repository, so both come after it is in the bucket.
    _register_media_view(hass)
    await _async_sweep_orphaned_media(hass, repository)

    # Heading served to the card by `haventory/config`.
    hass.data[DOMAIN]["card_title"] = _resolve_card_title(entry)

    # WebSocket rate limiting (off by default; configured via the options flow)
    hass.data[DOMAIN]["rate_limiter"] = RateLimiter(
        RateLimitConfig.from_options(getattr(entry, "options", None))
    )
    # Re-read the options when they change. Guarded with getattr so the
    # minimal offline-test ConfigEntry stubs keep working.
    add_listener = getattr(entry, "add_update_listener", None)
    on_unload = getattr(entry, "async_on_unload", None)
    if callable(add_listener) and callable(on_unload):
        on_unload(add_listener(_async_options_updated))

    # Register services
    services_mod.setup(hass)

    # Register WebSocket commands
    ws_mod.setup(hass)

    # Serve the bundled card and point the frontend at it
    await _register_frontend_module(hass)

    # The sidebar entry loads the same bundle, so it can only be registered once
    # that bundle is being served.
    await _async_apply_sidebar_panel(hass, entry)

    return True


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


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Apply changed options: card title, sidebar panel, rebuilt WS rate limiter."""
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["card_title"] = _resolve_card_title(entry)
    bucket["rate_limiter"] = RateLimiter(
        RateLimitConfig.from_options(getattr(entry, "options", None))
    )
    # Covers the toggle and a renamed card alike: the sidebar entry carries the
    # card title, and re-registering is how a changed one reaches the sidebar.
    await _async_apply_sidebar_panel(hass, entry)
    LOGGER.info(
        "Applied updated HAventory options",
        extra={"domain": DOMAIN, "op": "options_updated"},
    )


async def _async_flush_pending_writes(hass: HomeAssistant, *, op: str) -> None:
    """Write out whatever is still unsaved, before the state that holds it goes.

    A pending debounce is cleared either way: with nothing loaded there is
    nothing to write, and leaving the task scheduled would only fire it against
    a repository that is on its way out.
    """

    bucket = hass.data.get(DOMAIN) or {}
    if bucket.get("store") is None or bucket.get("repository") is None:
        cancel_pending_persist(hass, op=op)
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


def _cleanup_ws_test_stub_registry(hass: HomeAssistant) -> None:
    """Take our handlers back out of the offline stub's command registry.

    Real Home Assistant has no API for this, which is why teardown drops the
    runtime instead; the stub does, and leaving handlers in its list would carry
    them into the next test.
    """

    bucket = hass.data.get(DOMAIN) or {}
    try:  # pragma: no cover - exercised in offline tests only
        registry = hass.data.get("__ws_commands__")
        handlers = bucket.get("ws_handlers") or []
        if isinstance(registry, list) and handlers:
            for h in handlers:
                try:
                    while h in registry:
                        registry.remove(h)
                except ValueError:  # pragma: no cover - defensive
                    LOGGER.debug(
                        "Failed to remove a WS handler from test stub registry",
                        extra={"domain": DOMAIN, "op": "unload_ws_stub_cleanup"},
                    )
                    break
    except Exception:  # pragma: no cover - defensive
        LOGGER.debug(
            "Failed to cleanup WS handlers from test stub registry",
            extra={"domain": DOMAIN, "op": "unload_ws_stub_cleanup"},
            exc_info=True,
        )


async def _async_teardown_entry(hass: HomeAssistant, *, op: str) -> None:
    """Give up everything the config entry owns, in the order that keeps it safe.

    Flush first, while the repository is still reachable; then tell open
    subscribers, while the subscription registry still lists them; then hand back
    the frontend registrations, which read the URL the bucket recorded; and only
    then empty the bucket.
    """

    await _async_flush_pending_writes(hass, op=op)

    ws_mod.notify_backend_unavailable(hass)

    # Hand back the frontend module URL; setup re-adds it on the next load. The
    # static route stays, along with the flag that records it: aiohttp cannot
    # unregister a route, and a reload must not try to add it twice.
    _remove_extra_js_url(hass)

    # A sidebar entry outliving the backend it opens is a link to a page that
    # cannot load; setup registers it again.
    _remove_sidebar_panel(hass)

    _drop_entry_runtime(hass)


async def async_unload_entry(hass: HomeAssistant, _entry: ConfigEntry) -> bool:
    """Unload a config entry.

    An unloaded entry owns nothing, so it serves nothing: the runtime goes the
    way it does on removal, and the WebSocket commands — which Home Assistant
    cannot unregister — refuse from here until setup runs again. That covers a
    disabled entry, which stays in this state, and a reload, which passes through
    it for as long as setup takes.
    """

    # Ahead of the teardown, which empties the bucket the handler list lives in.
    _cleanup_ws_test_stub_registry(hass)

    await _async_teardown_entry(hass, op="unload")

    return True


def _drop_entry_runtime(hass: HomeAssistant) -> None:
    """Leave the domain bucket holding only what outlives the config entry.

    Home Assistant has no API for unregistering a WebSocket command, so ours go
    on listening whether the entry is unloaded, disabled or removed. Emptying the
    bucket is what makes them refuse: `ws._repo` raises `NotLoadedError` without a
    repository, so every command answers the contract's `storage_error` envelope
    instead of letting a dashboard left open read — and write — state the entry
    no longer owns. The same lookup backs the `haventory.*` service handlers.

    `_STATIC_PATH_KEY` and `_MEDIA_VIEW_KEY` are kept: each records an aiohttp
    route, which cannot be unregistered and so outlives every entry. Dropping
    either flag would make the next setup in the same run register the same
    route a second time.
    """

    bucket = hass.data.get(DOMAIN)
    if not isinstance(bucket, dict):
        return

    kept = {key: bucket[key] for key in (_STATIC_PATH_KEY, _MEDIA_VIEW_KEY) if key in bucket}
    bucket.clear()
    bucket.update(kept)


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
    await _async_teardown_entry(hass, op="remove")


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

    `warn_if_unknown=False`: this also runs as the first half of a register, and
    on the first setup of an install there is nothing there to remove.
    """
    hass.data.setdefault(DOMAIN, {}).pop(_PANEL_REGISTERED_KEY, None)
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

    Removing first makes every path — first setup, reload, options toggle,
    rename — the same one call, and is what keeps a second registration from
    raising `ValueError: Overwriting panel haventory`. Both calls fire the
    frontend's panel-update event, so the sidebar follows without a restart.
    """
    bucket = hass.data.setdefault(DOMAIN, {})
    _remove_sidebar_panel(hass)

    if not _sidebar_panel_enabled(entry):
        LOGGER.debug(
            "Sidebar panel disabled in the options; not registering",
            extra={"domain": DOMAIN, "op": "panel_register"},
        )
        return

    # The panel is the card bundle's second element, so without a build there is
    # nothing for it to load — same graceful skip the card loaders take.
    if not os.path.isfile(_CARD_BUNDLE_PATH):  # noqa: ASYNC240
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
        LOGGER.debug(
            "panel_custom component not available; HAventory gets no sidebar entry",
            extra={"domain": DOMAIN, "op": "panel_register", "url": PANEL_URL_PATH},
        )
        return

    title = _resolve_card_title(entry)
    # The exact string both card loaders receive: a second URL for the same
    # module defeats the browser's module map and defines the element twice.
    url = await _async_card_url(hass)

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

    bucket[_PANEL_REGISTERED_KEY] = True
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
    """Log storage health summary after validation."""

    items = payload.get("items")
    locations = payload.get("locations")
    item_count = len(items) if isinstance(items, dict) else 0
    location_count = len(locations) if isinstance(locations, dict) else 0

    level = logging.WARNING if item_count == 0 and location_count == 0 else logging.DEBUG
    LOGGER.log(
        level,
        "Storage health: schema_version=%s items=%s locations=%s",
        schema_version,
        item_count,
        location_count,
        extra={
            "domain": DOMAIN,
            "op": "setup_storage_health",
            "schema_version": schema_version,
            "items_count": item_count,
            "locations_count": location_count,
        },
    )
