"""One operation per write, shared by the WebSocket commands, bulk rows and services.

An op takes the payload as a plain dict (whatever the surface's schema let
through, minus its envelope), makes the repository call and returns the
`Written` its caller finishes with. Each surface keeps its own schemas and its
own answer.

The order is the same everywhere: persist, then `announce`, then reply.
Announcing first would tell subscribers about a change the caller is about to
be told failed, and which a restart then erases.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, cast

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from . import media as media_mod
from .events import notify_counts, notify_location_mutation, notify_mutation
from .exceptions import ValidationError
from .models import (
    Item,
    ItemCreate,
    ItemUpdate,
    normalize_string_list,
    require_string_list,
    validate_quantity,
)
from .repository import UNSET, Repository
from .runtime import loaded_runtime
from .serialization import serialize_item, serialize_location

#: The action of a save that rewrote no field; `announce` sends only the counts.
UNCHANGED = "unchanged"


@dataclass(frozen=True, slots=True)
class Written:
    """What one write leaves for its surface.

    ``action`` is the event the write earns, or ``UNCHANGED``. ``repaint`` is
    False for the edit that re-anchors a subtree without moving a path.
    """

    noun: Literal["item", "location"]
    entity: dict[str, Any]
    action: str
    repaint: bool = True


Op = Callable[[HomeAssistant, dict[str, Any]], Written]


def _repo(hass: HomeAssistant) -> Repository:
    # Neither a command nor a service can be unregistered, so this lookup is
    # what makes both refuse once the entry is not loaded.
    return loaded_runtime(hass).repository


def _payload_item_id(payload: dict[str, Any]) -> str:
    value = payload.get("item_id")
    if not isinstance(value, str) or not value:
        raise ValidationError("item_id must be a non-empty string")
    return value


def _payload_tags(payload: dict[str, Any]) -> list[str]:
    # The item-side caps are weighed by the write against the item's own tags,
    # so a payload removing an over-cap legacy list is not refused for its size.
    return normalize_string_list(payload.get("tags"), field_name="tags", casefold=True)


def _item(hass: HomeAssistant, item: Item, action: str = "updated") -> Written:
    return Written("item", serialize_item(hass, item), action)


def _update(
    hass: HomeAssistant,
    payload: dict[str, Any],
    item_id: str,
    update: ItemUpdate,
    action: str = "updated",
) -> Written:
    expected = payload.get("expected_version")
    return _item(hass, _repo(hass).update_item(item_id, update, expected_version=expected), action)


def _op_item_create(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    return _item(hass, _repo(hass).create_item(cast("ItemCreate", payload)), "created")


def _op_item_update(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    item_id = _payload_item_id(payload)
    exclude_keys = {"item_id", "expected_version"}
    update = cast("ItemUpdate", {k: v for k, v in payload.items() if k not in exclude_keys})
    # A call that carried a location moved the item, whatever else it carried:
    # a subscriber filtered by location acts on `moved` and not on `updated`.
    return _update(
        hass, payload, item_id, update, "moved" if "location_id" in update else "updated"
    )


def _op_item_delete(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    before = _item(hass, repo.get_item(item_id), "deleted")
    repo.delete_item(item_id, expected_version=payload.get("expected_version"))
    return before


def _op_item_move(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    update = ItemUpdate(location_id=payload.get("location_id"))
    return _update(hass, payload, _payload_item_id(payload), update, "moved")


def _op_item_adjust_quantity(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    updated = repo.adjust_quantity(
        _payload_item_id(payload),
        payload.get("delta"),
        expected_version=payload.get("expected_version"),
    )
    return _item(hass, updated, "quantity_changed")


def _op_item_set_quantity(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    # The quantity first: a payload wrong about both is answered on the value.
    quantity = validate_quantity(payload.get("quantity"))
    item_id = _payload_item_id(payload)
    updated = repo.set_quantity(item_id, quantity, expected_version=payload.get("expected_version"))
    return _item(hass, updated, "quantity_changed")


def _op_item_check_out(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    updated = repo.check_out(
        _payload_item_id(payload),
        due_date=payload.get("due_date"),
        expected_version=payload.get("expected_version"),
    )
    return _item(hass, updated, "checked_out")


def _op_item_check_in(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.check_in(item_id, expected_version=payload.get("expected_version"))
    return _item(hass, updated, "checked_in")


def _op_item_add_tags(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    tags = _payload_tags(payload)
    new_tags = list(dict.fromkeys([*repo.get_item(item_id).tags, *tags]))
    return _update(hass, payload, item_id, ItemUpdate(tags=new_tags))


def _op_item_remove_tags(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    to_remove = set(_payload_tags(payload))
    new_tags = [t for t in repo.get_item(item_id).tags if t not in to_remove]
    return _update(hass, payload, item_id, ItemUpdate(tags=new_tags))


def _op_item_update_custom_fields(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    item_id = _payload_item_id(payload)
    update: ItemUpdate = {}
    set_value = payload.get("set")
    if set_value is not None:
        if not isinstance(set_value, dict):
            raise ValidationError("set must be an object")
        update["custom_fields_set"] = dict(set_value)
    unset_value = payload.get("unset")
    if unset_value is not None:
        update["custom_fields_unset"] = require_string_list(unset_value, field_name="unset")
    return _update(hass, payload, item_id, update)


def _op_item_set_low_stock_threshold(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    update = ItemUpdate(low_stock_threshold=payload.get("low_stock_threshold"))
    return _update(hass, payload, _payload_item_id(payload), update)


def _op_reminder_bump(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    updated = repo.bump_reminder(
        _payload_item_id(payload),
        # The instance's local day, as the calendar and the card use: counting
        # from the UTC day would skip tomorrow's occurrence for an evening bump
        # west of Greenwich.
        today=dt_util.now().date(),
        expected_version=payload.get("expected_version"),
    )
    return _item(hass, updated)


def _op_location_create(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    loc = _repo(hass).create_location(
        name=payload["name"], parent_id=payload.get("parent_id"), area_id=payload.get("area_id")
    )
    return Written("location", serialize_location(loc), "created")


def _op_location_update(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    location_id = payload["location_id"]
    new_parent = payload["new_parent_id"] if "new_parent_id" in payload else UNSET
    area_id = payload["area_id"] if "area_id" in payload else UNSET
    before = repo.get_location(location_id)
    location_key = str(before.id)
    # Compare the resolved area, not the row's: an area set on a nested
    # location lands on the tree's root.
    was_anchored_at = (before.parent_id, repo.effective_area_id(location_key))
    loc = repo.update_location(
        location_id, name=payload.get("name"), new_parent_id=new_parent, area_id=area_id
    )
    # One event per call, decided by what changed rather than by which keys were
    # sent. An area reassignment is a move: every item under it gets a new
    # `effective_area_id`, which is what a client filtered by area re-lists on.
    is_anchored_at = (loc.parent_id, repo.effective_area_id(location_key))
    renamed = loc.name != before.name
    if is_anchored_at != was_anchored_at:
        action = "moved"
    elif renamed:
        action = "renamed"
    else:
        action = UNCHANGED
    # Only a rename or a re-parent rewrites a path, so only those repaint.
    repaint = renamed or loc.parent_id != before.parent_id
    return Written("location", serialize_location(loc), action, repaint=repaint)


def _op_location_delete(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    location_id = payload["location_id"]
    # Read the body first: after the delete there is nothing to answer with.
    removed = serialize_location(repo.get_location(location_id))
    repo.delete_location(location_id)
    return Written("location", removed, "deleted")


#: Every write, by the name both surfaces call it: `haventory/<path>` and
#: `haventory.<name>` reach the same entry.
OPS: dict[str, Op] = {
    "item_create": _op_item_create,
    "item_update": _op_item_update,
    "item_delete": _op_item_delete,
    "item_move": _op_item_move,
    "item_adjust_quantity": _op_item_adjust_quantity,
    "item_set_quantity": _op_item_set_quantity,
    "item_check_out": _op_item_check_out,
    "item_check_in": _op_item_check_in,
    "item_add_tags": _op_item_add_tags,
    "item_remove_tags": _op_item_remove_tags,
    "item_update_custom_fields": _op_item_update_custom_fields,
    "item_set_low_stock_threshold": _op_item_set_low_stock_threshold,
    "reminder_bump": _op_reminder_bump,
    "location_create": _op_location_create,
    "location_update": _op_location_update,
    "location_delete": _op_location_delete,
}

#: The subset a `haventory/items/bulk` row may name, as the contract enumerates.
BULK_KINDS = frozenset(
    {
        "item_update",
        "item_delete",
        "item_move",
        "item_adjust_quantity",
        "item_set_quantity",
        "item_check_out",
        "item_check_in",
        "item_add_tags",
        "item_remove_tags",
        "item_update_custom_fields",
        "item_set_low_stock_threshold",
    }
)


def run(hass: HomeAssistant, name: str, payload: dict[str, Any]) -> Written:
    """Execute one operation by name; persist and `announce` are the caller's."""

    return OPS[name](hass, payload)


async def announce(hass: HomeAssistant, written: Written) -> None:
    """After the persist: free the files a delete orphaned, then announce."""

    if written.action == UNCHANGED:
        notify_counts(hass)
    elif written.noun == "item":
        if written.action == "deleted":
            await media_mod.async_delete_item_files(hass, [written.entity])
        notify_mutation(hass, action=written.action, item=written.entity)
    else:
        notify_location_mutation(
            hass, action=written.action, location=written.entity, repaint=written.repaint
        )
