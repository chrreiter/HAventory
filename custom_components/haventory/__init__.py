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

from . import services as services_mod
from . import ws as ws_mod
from .const import CONF_CARD_TITLE, DEFAULT_CARD_TITLE, DOMAIN
from .exceptions import SchemaDowngradeError, StorageError
from .rate_limit import RateLimitConfig, RateLimiter
from .repository import Repository
from .storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_persist_immediate,
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
    hass.data[DOMAIN]["repository"] = Repository.from_state(payload)

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

    return True


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
    """Apply changed options: card title plus a rebuilt WS rate limiter."""
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["card_title"] = _resolve_card_title(entry)
    bucket["rate_limiter"] = RateLimiter(
        RateLimitConfig.from_options(getattr(entry, "options", None))
    )
    LOGGER.info(
        "Applied updated HAventory options",
        extra={"domain": DOMAIN, "op": "options_updated"},
    )


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry.

    Clears idempotent registration flags and ephemeral data such as WS
    subscriptions. If the test websocket stub is present, remove our
    registered handlers from its registry.
    """

    bucket = hass.data.get(DOMAIN) or {}

    # Ensure any pending changes are persisted before unload
    try:
        await async_persist_immediate(hass)
    except Exception:  # pragma: no cover - defensive
        # Unload is the last chance to write; a failure here silently drops
        # whatever was still unsaved, which nobody but an operator can recover.
        LOGGER.error(
            "Failed to persist during unload",
            extra={"domain": DOMAIN, "op": "unload"},
            exc_info=True,
        )

    # Hand back the frontend module URL; setup re-adds it on the next load. The
    # static route stays, along with the flag that records it: aiohttp cannot
    # unregister a route, and a reload must not try to add it twice.
    _remove_extra_js_url(hass)

    # Clear registration flags
    bucket.pop("services_registered", None)
    bucket.pop("ws_registered", None)

    # Drop ephemeral data
    bucket.pop("subscriptions", None)
    bucket.pop("rate_limiter", None)
    bucket.pop("card_title", None)

    # Test stub cleanup: remove our handlers from __ws_commands__
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

    bucket.pop("ws_handlers", None)

    return True


async def async_remove_entry(hass: HomeAssistant, _entry: ConfigEntry) -> None:
    """Clean up after the config entry has been removed from Home Assistant.

    Removal takes back what setup put into other components' state: the Lovelace
    resource registered for the card and the frontend's extra module URL. Left
    behind, either points at an asset that disappears with the integration, and
    a dead `module` URL fails to load on every dashboard render.

    The HA `Store` file is deliberately kept, so re-adding the integration
    restores the inventory. Purging it is a manual step (README → Installation
    → "Removing HAventory").
    """

    await _unregister_frontend_module(hass)


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

    if hasattr(resources, "loaded") and not resources.loaded:
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
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to serve the HAventory card directory",
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


def _validate_storage_payload(payload: dict[str, Any], *, schema_version: int) -> None:
    """Validate loaded storage payload shape and version."""

    if not isinstance(payload, dict):
        raise StorageError("storage payload is not a dict")

    stored_version = int(payload.get("schema_version", -1))
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
