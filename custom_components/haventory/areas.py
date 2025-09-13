"""Area registry helper functions for HAventory.

Provides read-only helpers to resolve areas by id or name using Home
Assistant's area registry. These utilities are intentionally limited to
lookup operations; they never create or modify areas.
"""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar


async def async_get_area_registry(hass: HomeAssistant):
    """Return Home Assistant's area registry instance.

    This is a thin wrapper around ``homeassistant.helpers.area_registry.async_get``
    to provide a stable import location for the integration and tests.
    """

    return await ar.async_get(hass)


async def resolve_area_name(hass: HomeAssistant, area_id: str | None) -> str | None:
    """Resolve an area's name given its id.

    Args:
        hass: Home Assistant instance.
        area_id: Area id to look up. When ``None`` or empty, returns ``None``.

    Returns:
        The area's name if found; otherwise ``None``.
    """

    if not area_id:
        return None

    registry = await async_get_area_registry(hass)
    entry = registry.async_get_area(area_id)
    if entry is None:
        return None
    return getattr(entry, "name", None)


async def resolve_area_id_by_name(hass: HomeAssistant, name: str | None) -> str | None:
    """Resolve an area's id given its name (case-insensitive).

    Args:
        hass: Home Assistant instance.
        name: Area name to resolve. When ``None`` or empty, returns ``None``.

    Returns:
        The area's id if a case-insensitive match is found; otherwise ``None``.
    """

    if not name:
        return None

    search = name.casefold()
    registry = await async_get_area_registry(hass)

    # Prefer HA's by-name lookup when exact match; fall back to case-insensitive
    # scan across all areas to support flexible inputs.
    direct = registry.async_get_area_by_name(name)
    if direct is not None:
        return getattr(direct, "id", None)

    for area in registry.async_list_areas():
        if getattr(area, "name", "").casefold() == search:
            return getattr(area, "id", None)
    return None
