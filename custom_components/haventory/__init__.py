"""HAventory integration bootstrap.

This module initializes the integration, prepares persistent storage, and sets up
the core data structures in hass.data.
"""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from . import services as services_mod
from . import ws as ws_mod
from .const import DOMAIN
from .repository import Repository
from .storage import DomainStore, async_persist_immediate

STORAGE_VERSION = 1
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
    payload = await store.async_load()
    hass.data[DOMAIN]["repository"] = Repository.from_state(payload)

    # Register services
    services_mod.setup(hass)

    # Register WebSocket commands
    ws_mod.setup(hass)

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
