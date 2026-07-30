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

from . import services as services_mod
from . import ws as ws_mod
from .const import DOMAIN
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
_CARD_URL_PATH = "/local/haventory/haventory-card.js"
_CARD_FILENAME = "haventory-card.js"
# The card ships inside the integration directory because that is the only thing
# HACS copies for an Integration-category repository. It is served from
# `config/www/`, which nothing copies it into, so setup does that itself.
_BUNDLED_CARD_PATH = Path(__file__).with_name(_CARD_FILENAME)


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

    # WebSocket rate limiting (off by default; configured via the options flow)
    hass.data[DOMAIN]["rate_limiter"] = RateLimiter(
        RateLimitConfig.from_options(getattr(entry, "options", None))
    )
    # Rebuild the limiter when options change. Guarded with getattr so the
    # minimal offline-test ConfigEntry stubs keep working.
    add_listener = getattr(entry, "add_update_listener", None)
    on_unload = getattr(entry, "async_on_unload", None)
    if callable(add_listener) and callable(on_unload):
        on_unload(add_listener(_async_options_updated))

    # Register services
    services_mod.setup(hass)

    # Register WebSocket commands
    ws_mod.setup(hass)

    # Install the bundled card into www/, then register it. Order matters: the
    # registration below is a no-op unless the file is already on disk.
    await _async_deploy_card_asset(hass)
    await _register_frontend_module(hass)

    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Apply changed options by rebuilding the WS rate limiter."""
    hass.data.setdefault(DOMAIN, {})["rate_limiter"] = RateLimiter(
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

    # Clear registration flags
    bucket.pop("services_registered", None)
    bucket.pop("ws_registered", None)

    # Drop ephemeral data
    bucket.pop("subscriptions", None)
    bucket.pop("rate_limiter", None)

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

    Removal takes back the one thing setup put into another component's state:
    the Lovelace resource registered for the card. Left behind it points at an
    asset that disappears with the integration, and a dead `module` resource
    fails to load on every dashboard render.

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


async def _async_card_resource_url(hass: HomeAssistant) -> str:
    """`/local` URL for the card bundle, carrying the manifest version as `?v=`.

    `/local/` is served with a month-long `max-age`, so without the query a browser
    — or the companion app's webview, which is harder to clear — keeps serving the
    bundle from before an integration update and runs an old card against a new
    backend. Falls back to the bare path if the version cannot be determined, since
    a missing cache-buster must not stop the card from being registered at all.
    """
    version = await _async_manifest_version(hass)
    if not version:
        return _CARD_URL_PATH
    return f"{_CARD_URL_PATH}?v={quote(version, safe='')}"


def _points_at_card(resource_url: Any, card_url: str) -> bool:
    """Does an already-registered Lovelace resource serve the HAventory card?

    Compare paths, not whole URLs: a resource may carry a cache-busting query
    (`?v=<hash>`), and `/local/` is served with a month-long `max-age`, so that
    query is the only way to make a browser pick up a rebuilt bundle. Matching
    the full string would treat a versioned entry as somebody else's resource
    and register a second one for the same file — the card module then loads
    twice and the second `customElements.define` throws.
    """
    if not isinstance(resource_url, str):
        return False
    return urlsplit(resource_url).path == urlsplit(card_url).path


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


def _sync_card_asset(bundled: Path, destination: Path) -> bool:
    """Copy the bundled card to `destination` when it differs. Blocks — use the executor.

    Returns True when the file was written. Compares content rather than mtime:
    an install copies the bundle around, so timestamps say nothing about which
    build a file holds, and rewriting 400 KiB on every start would be wasteful
    where an upgrade is the only time the bytes actually change.
    """
    if not bundled.is_file():
        return False
    payload = bundled.read_bytes()
    if destination.is_file() and destination.read_bytes() == payload:
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return True


async def _async_deploy_card_asset(hass: HomeAssistant) -> None:
    """Put the card the integration ships where Home Assistant serves it from.

    HACS installs an Integration-category repository by copying
    `custom_components/<domain>/` and nothing else — it never writes to
    `config/www/`. Without this the card would simply never appear: the resource
    registration below finds no file, skips, and the only symptom is an empty
    card picker.

    A failure here is not fatal. The integration is fully usable over its
    services and WebSocket API without the card, so a read-only or full
    `config/www` costs the dashboard, not the inventory.
    """
    try:
        destination = Path(hass.config.path("www", "haventory", _CARD_FILENAME))
    except AttributeError:
        LOGGER.debug(
            "hass.config not available; skipping card deployment",
            extra={"domain": DOMAIN, "op": "frontend_deploy"},
        )
        return

    try:
        written = await hass.async_add_executor_job(
            _sync_card_asset, _BUNDLED_CARD_PATH, destination
        )
    except OSError:
        LOGGER.warning(
            "Could not copy the HAventory card into the www folder; "
            "the card will not load until it is placed there by hand",
            extra={"domain": DOMAIN, "op": "frontend_deploy", "path": str(destination)},
            exc_info=True,
        )
        return

    if written:
        LOGGER.info(
            "Installed the HAventory card into the www folder",
            extra={"domain": DOMAIN, "op": "frontend_deploy", "path": str(destination)},
        )


async def _register_frontend_module(hass: HomeAssistant) -> None:
    """Register the built HAventory card asset as a Lovelace resource if present."""
    url = await _async_card_resource_url(hass)

    # Get filesystem path - handle missing config gracefully for tests
    try:
        fs_path = hass.config.path("www", "haventory", "haventory-card.js")
    except AttributeError:
        LOGGER.debug(
            "hass.config not available; skipping frontend registration",
            extra={"domain": DOMAIN, "op": "frontend_register"},
        )
        return

    # One-shot existence check at setup; not worth an executor round-trip (and the
    # test Hass stub has no async_add_executor_job).
    if not os.path.exists(fs_path):  # noqa: ASYNC240
        LOGGER.debug(
            "Frontend asset not found; skipping registration",
            extra={"domain": DOMAIN, "op": "frontend_register", "path": fs_path},
        )
        return

    resources = await _async_lovelace_resources(hass, op="frontend_register")
    if resources is None:
        return

    # Check if resource already exists
    existing = resources.async_items() or []
    registered = [item for item in existing if _points_at_card(item.get("url"), url)]

    if registered:
        if any(item.get("url") == url for item in registered):
            LOGGER.debug(
                "HAventory card resource already registered at the current version",
                extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
            )
        else:
            await _rewrite_card_resource(resources, registered[0], url)
        return

    # Create the resource (only works for storage mode, not YAML mode)
    if not hasattr(resources, "async_create_item"):
        LOGGER.debug(
            "Lovelace in YAML mode; manual resource configuration required",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
        )
        return

    try:
        await resources.async_create_item({"res_type": "module", "url": url})
        LOGGER.info(
            "Registered HAventory card as Lovelace resource",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url, "path": fs_path},
        )
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to register frontend resource",
            extra={"domain": DOMAIN, "op": "frontend_register", "url": url, "path": fs_path},
            exc_info=True,
        )


async def _unregister_frontend_module(hass: HomeAssistant) -> None:
    """Drop the Lovelace resource entries that serve the HAventory card."""
    resources = await _async_lovelace_resources(hass, op="frontend_unregister")
    if resources is None:
        return

    # YAML mode: resources come from configuration.yaml and the collection is
    # read-only, so the entry is the user's to remove.
    if not hasattr(resources, "async_delete_item"):
        LOGGER.info(
            "Lovelace in YAML mode; remove the HAventory card resource manually",
            extra={"domain": DOMAIN, "op": "frontend_unregister", "url": _CARD_URL_PATH},
        )
        return

    # Snapshot the collection: deleting mutates what async_items() reflects.
    for item in list(resources.async_items() or []):
        if not _points_at_card(item.get("url"), _CARD_URL_PATH):
            continue
        item_id = item.get("id")
        if item_id is None:  # pragma: no cover - defensive
            continue
        try:
            await resources.async_delete_item(item_id)
            LOGGER.info(
                "Removed HAventory card Lovelace resource",
                extra={
                    "domain": DOMAIN,
                    "op": "frontend_unregister",
                    "url": item.get("url"),
                    "resource_id": item_id,
                },
            )
        except Exception:  # pragma: no cover - defensive
            LOGGER.warning(
                "Failed to remove frontend resource",
                extra={
                    "domain": DOMAIN,
                    "op": "frontend_unregister",
                    "url": item.get("url"),
                    "resource_id": item_id,
                },
                exc_info=True,
            )


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
