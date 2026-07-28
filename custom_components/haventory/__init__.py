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

    # Auto-register frontend card asset if present
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
        LOGGER.warning(
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


def _card_resource_url() -> str:
    """`/local` URL for the card bundle, carrying the manifest version as `?v=`.

    `/local/` is served with a month-long `max-age`, so without the query a browser
    — or the companion app's webview, which is harder to clear — keeps serving the
    bundle from before an integration update and runs an old card against a new
    backend. Falls back to the bare path if the manifest cannot be read, since a
    missing cache-buster must not stop the card from being registered at all.
    """
    version = ""
    # Blocking read of a file shipped inside the integration, once per setup; not
    # worth an executor round-trip (and the test Hass stub has no executor).
    try:
        manifest = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    except OSError, ValueError:
        LOGGER.debug(
            "Could not read the integration manifest; registering the card unversioned",
            extra={"domain": DOMAIN, "op": "frontend_register", "path": str(_MANIFEST_PATH)},
        )
    else:
        raw = manifest.get("version")
        version = raw if isinstance(raw, str) else ""

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


async def _register_frontend_module(hass: HomeAssistant) -> None:
    """Register the built HAventory card asset as a Lovelace resource if present."""
    url = _card_resource_url()

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

    # Access the Lovelace resource collection
    if LOVELACE_DATA is None:
        LOGGER.debug(
            "Lovelace component not available; skipping resource registration",
            extra={"domain": DOMAIN, "op": "frontend_register"},
        )
        return

    lovelace_data = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace_data, "resources", None) if lovelace_data else None
    if resources is None:
        LOGGER.debug(
            "Lovelace not initialized or resources unavailable; skipping registration",
            extra={"domain": DOMAIN, "op": "frontend_register"},
        )
        return

    # Ensure resources are loaded before checking
    if hasattr(resources, "loaded") and not resources.loaded:
        await resources.async_load()
        resources.loaded = True

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
