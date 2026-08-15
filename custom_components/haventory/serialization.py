"""Canonical wire shapes for items and locations.

One serializer per entity, shared by the two surfaces that hand entities to a
caller: the WebSocket API and the ``haventory.*`` services. Both emit the shapes
`docs/data_shapes.md` specifies, so a script reading a service's
``response_variable`` and a card reading a WebSocket result parse the same dict.
"""

from __future__ import annotations

from typing import Any, cast

from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .models import Item, Location, serialize_attachment_meta, serialize_reminder_interval
from .repository import Repository


def effective_area_id_for_item(hass: HomeAssistant, item: Item) -> str | None:
    """Resolve the effective area id for an item via its location ancestry.

    Best-effort: an item with no location, a torn-down runtime, or a location
    whose ancestry no longer resolves all answer ``None`` rather than failing a
    serialization that is otherwise complete.
    """
    try:
        if getattr(item, "location_id", None) is None:
            return None
        bucket = hass.data.get(DOMAIN) or {}
        repo = cast("Repository", bucket["repository"])
        return repo.effective_area_id(str(item.location_id))
    except Exception:
        return None


def serialize_item(hass: HomeAssistant, item: Item) -> dict[str, Any]:
    """The canonical Item shape."""
    return {
        "id": str(item.id),
        "name": item.name,
        "description": item.description,
        "quantity": item.quantity,
        "status": item.status,
        "checked_out": item.checked_out,
        "due_date": item.due_date,
        "inspection_date": item.inspection_date,
        "reminder_date": item.reminder_date,
        "reminder_anchor": item.reminder_anchor,
        "reminder_interval": serialize_reminder_interval(item.reminder_interval),
        "location_id": str(item.location_id) if item.location_id is not None else None,
        "tags": list(item.tags),
        "category": item.category,
        "low_stock_threshold": item.low_stock_threshold,
        "custom_fields": dict(item.custom_fields),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "version": item.version,
        "effective_area_id": effective_area_id_for_item(hass, item),
        "location_path": {
            "id_path": [str(x) for x in item.location_path.id_path],
            "name_path": item.location_path.name_path,
            "display_path": item.location_path.display_path,
            "sort_key": item.location_path.sort_key,
        },
        "attachments": [serialize_attachment_meta(a) for a in item.attachments],
    }


def serialize_location(loc: Location) -> dict[str, Any]:
    """The canonical Location shape."""
    return {
        "id": str(loc.id),
        "name": loc.name,
        "parent_id": str(loc.parent_id) if loc.parent_id is not None else None,
        "area_id": str(loc.area_id) if getattr(loc, "area_id", None) is not None else None,
        "path": {
            "id_path": [str(x) for x in loc.path.id_path],
            "name_path": loc.path.name_path,
            "display_path": loc.path.display_path,
            "sort_key": loc.path.sort_key,
        },
    }
