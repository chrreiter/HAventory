"""HAventory integration bootstrap.

This module initializes the integration, prepares persistent storage, and sets up
the core data structures in hass.data.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

STORAGE_VERSION = 1
STORAGE_KEY = DOMAIN


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

    # Expose Store via hass.data[DOMAIN]["store"] as a shared resource
    hass.data[DOMAIN]["store"] = Store(hass, STORAGE_VERSION, STORAGE_KEY)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return True
