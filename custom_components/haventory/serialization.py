"""Canonical wire shapes for items and locations.

One serializer per entity, shared by the WebSocket API and the ``haventory.*``
services, so both answer with the shapes `docs/data_shapes.md` specifies.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from .models import Item, Location
from .runtime import find_runtime


def effective_area_id_for_item(hass: HomeAssistant, item: Item) -> str | None:
    """The item's area, inherited through its location; ``None`` without a runtime."""

    if item.location_id is None or (runtime := find_runtime(hass)) is None:
        return None
    return runtime.repository.effective_area_id(str(item.location_id))


def serialize_item(hass: HomeAssistant, item: Item) -> dict[str, Any]:
    """The stored shape plus ``effective_area_id``, which is resolved, never stored."""

    return {**item.to_dict(), "effective_area_id": effective_area_id_for_item(hass, item)}


def serialize_location(loc: Location) -> dict[str, Any]:
    """The stored shape unchanged; a derived location field would be added here."""

    return loc.to_dict()
