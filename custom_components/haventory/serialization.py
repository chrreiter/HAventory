"""Canonical wire shapes for items and locations.

One serializer per entity, shared by the two surfaces that hand entities to a
caller: the WebSocket API and the ``haventory.*`` services. Both emit the shapes
`docs/data_shapes.md` specifies, so a script reading a service's
``response_variable`` and a card reading a WebSocket result parse the same dict.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from .models import Item, Location
from .runtime import find_runtime


def effective_area_id_for_item(hass: HomeAssistant, item: Item) -> str | None:
    """Resolve the effective area id for an item via its location ancestry.

    Best-effort: an item with no location, a torn-down runtime, or a location
    whose ancestry no longer resolves all answer ``None`` rather than failing a
    serialization that is otherwise complete.
    """
    try:
        if getattr(item, "location_id", None) is None:
            return None
        runtime = find_runtime(hass)
        if runtime is None:
            return None
        return runtime.repository.effective_area_id(str(item.location_id))
    except Exception:
        return None


def serialize_item(hass: HomeAssistant, item: Item) -> dict[str, Any]:
    """The canonical Item shape: what the store holds, plus the derived area.

    ``effective_area_id`` is resolved from the location tree for this request
    and never persisted, so it is added at this boundary rather than inside
    ``Item.to_dict()`` — which is what keeps the stored and exported shapes free
    of a field no store can answer for.
    """
    return {**item.to_dict(), "effective_area_id": effective_area_id_for_item(hass, item)}


def serialize_location(loc: Location) -> dict[str, Any]:
    """The canonical Location shape, which is the stored one unchanged.

    Named rather than inlined at the call sites: this is the wire surface, and a
    location acquiring a derived field would gain it here.
    """
    return loc.to_dict()
