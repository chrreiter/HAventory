"""HAventory integration bootstrap.

This module initializes the integration, prepares persistent storage, and sets up
the core data structures in hass.data.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import services as services_mod
from .const import DOMAIN
from .repository import Repository
from .storage import DomainStore

STORAGE_VERSION = 1


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
    hass.data[DOMAIN]["store"] = DomainStore(hass, key="haventory_store", version=STORAGE_VERSION)

    # Initialize in-memory repository for services and APIs
    if "repository" not in hass.data[DOMAIN]:
        hass.data[DOMAIN]["repository"] = Repository()

    # Register services
    services_mod.setup(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return True
