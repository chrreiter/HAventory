"""Area registry helper functions for HAventory.

Provides read-only access to Home Assistant's area registry. These utilities
are intentionally limited to lookup operations; they never create or modify
areas.
"""

from __future__ import annotations

import inspect

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar


async def async_get_area_registry(hass: HomeAssistant):
    """Return Home Assistant's area registry instance.

    This is a thin wrapper around ``homeassistant.helpers.area_registry.async_get``
    to provide a stable import location for the integration and tests.
    """

    # HA's async_get returns the registry synchronously; the offline test stub
    # returns an awaitable. Support both to avoid runtime type errors online.
    reg = ar.async_get(hass)
    if inspect.isawaitable(reg):
        return await reg
    return reg
