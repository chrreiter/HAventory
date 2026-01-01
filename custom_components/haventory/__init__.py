"""HAventory integration bootstrap.

This module initializes the integration, prepares persistent storage, and sets up
the core data structures in hass.data.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv

try:
    from homeassistant.components.lovelace import LOVELACE_DATA
except ImportError:  # pragma: no cover - older HA versions
    LOVELACE_DATA = None  # type: ignore[misc, assignment]

from . import services as services_mod
from . import ws as ws_mod
from .const import DOMAIN
from .exceptions import StorageError
from .repository import Repository
from .storage import CURRENT_SCHEMA_VERSION, DomainStore, async_persist_immediate

STORAGE_VERSION = CURRENT_SCHEMA_VERSION
LOGGER = logging.getLogger(__name__)


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
    store = DomainStore(hass, key="haventory_store", version=STORAGE_VERSION)
    hass.data[DOMAIN]["store"] = store

    # Initialize in-memory repository for services and APIs by loading persisted state
    try:
        payload = await store.async_load()
        _validate_storage_payload(payload, schema_version=store.schema_version)
        _log_storage_health(payload, schema_version=store.schema_version)
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

    # Register services
    services_mod.setup(hass)

    # Register WebSocket commands
    ws_mod.setup(hass)

    # Auto-register frontend card asset if present
    await _register_frontend_module(hass)

    return True


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


async def _register_frontend_module(hass: HomeAssistant) -> None:
    """Register the built HAventory card asset as a Lovelace resource if present."""
    url = "/local/haventory/haventory-card.js"

    # Get filesystem path - handle missing config gracefully for tests
    try:
        fs_path = hass.config.path("www", "haventory", "haventory-card.js")
    except AttributeError:
        LOGGER.debug(
            "hass.config not available; skipping frontend registration",
            extra={"domain": DOMAIN, "op": "frontend_register"},
        )
        return

    if not os.path.exists(fs_path):
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
    for item in existing:
        if item.get("url") == url:
            LOGGER.debug(
                "HAventory card resource already registered",
                extra={"domain": DOMAIN, "op": "frontend_register", "url": url},
            )
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

    if int(payload.get("schema_version", -1)) != int(schema_version):
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
