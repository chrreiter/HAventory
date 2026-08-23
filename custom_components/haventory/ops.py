"""One operation per write, for the two surfaces that write.

A `haventory/*` command, an `items/bulk` row and a `haventory.*` service that do
the same thing run the same function here, so one payload gets one answer
whichever door it arrived through. An op takes the payload as a plain dict —
whatever the surface's schema let through, minus its envelope — makes the
repository call and returns the `Written` its caller finishes with.

What a surface still owns is its ingress and its answer: the command schemas and
the service schemas type their own fields, `ws.py` replies on the wire and
`services.py` answers a `response_variable`. What they share is everything
between: the write, the event the write earns, and the order the two happen in.

That order is fixed and the same everywhere — persist, then `announce`, then
reply. Announcing first would tell subscribers about a change the caller is
about to be told failed, and which a restart then erases.
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
from .models import ItemCreate, ItemUpdate, normalize_string_list, validate_quantity
from .repository import UNSET, Repository
from .runtime import loaded_runtime
from .serialization import serialize_item, serialize_location

#: What a save that rewrote no field did. No `locations` event carries it —
#: `announce` sends the counts alone — but every write has a name for what it did.
UNCHANGED = "unchanged"


@dataclass(frozen=True, slots=True)
class Written:
    """What one write leaves for the surface that ran it.

    ``action`` is the event the write earns, or ``UNCHANGED`` for the one write
    that earns none. ``repaint`` is the locations half: False for the edit that
    re-anchors a subtree without moving a path.
    """

    noun: Literal["item", "location"]
    entity: dict[str, Any]
    action: str
    repaint: bool = True


Op = Callable[[HomeAssistant, dict[str, Any]], Written]


def _repo(hass: HomeAssistant) -> Repository:
    """The repository of a loaded entry, or `NotLoadedError`.

    Home Assistant can unregister neither a WebSocket command nor a service, so
    both surfaces keep answering after the entry is unloaded, disabled or
    removed, and this lookup is what makes them stop.
    """

    return loaded_runtime(hass).repository


def _payload_item_id(payload: dict[str, Any]) -> str:
    """Extract a validated item_id from an (unschema'd) op payload."""
    value = payload.get("item_id")
    if not isinstance(value, str) or not value:
        raise ValidationError("item_id must be a non-empty string")
    return value


def _payload_tags(payload: dict[str, Any]) -> list[str]:
    """Extract a normalized tag list from an (unschema'd) op payload.

    The item-side caps are left to the write these ops build, which weighs them
    against the tags the item already carries: a payload that removes an
    over-cap legacy list must not be refused for naming that many tags.
    """
    return normalize_string_list(payload.get("tags"), field_name="tags", casefold=True)


def _payload_int(payload: dict[str, Any], key: str) -> int:
    """Extract a required integer field from an (unschema'd) op payload."""
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{key} must be an integer")
    return value


def _op_item_create(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    item = _repo(hass).create_item(cast("ItemCreate", payload))
    return Written("item", serialize_item(hass, item), "created")


def _op_item_update(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    exclude_keys = {"item_id", "expected_version"}
    update = cast("ItemUpdate", {k: v for k, v in payload.items() if k not in exclude_keys})
    updated = repo.update_item(item_id, update, expected_version=expected)
    # A call that carried a location moved the item, whatever else it carried:
    # a subscriber filtered by location acts on `moved` and not on `updated`.
    action = "moved" if "location_id" in update else "updated"
    return Written("item", serialize_item(hass, updated), action)


def _op_item_delete(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    before = repo.get_item(item_id)
    serialized_before = serialize_item(hass, before)
    repo.delete_item(item_id, expected_version=expected)
    return Written("item", serialized_before, "deleted")


def _op_item_move(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    updated = repo.update_item(
        item_id, ItemUpdate(location_id=payload.get("location_id")), expected_version=expected
    )
    return Written("item", serialize_item(hass, updated), "moved")


def _op_item_adjust_quantity(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.adjust_quantity(
        item_id, _payload_int(payload, "delta"), expected_version=payload.get("expected_version")
    )
    return Written("item", serialize_item(hass, updated), "quantity_changed")


def _op_item_set_quantity(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    # The quantity before the item id: a payload wrong about both is answered on
    # the value, which is the answer all of this op's callers give.
    quantity = validate_quantity(payload.get("quantity"))
    item_id = _payload_item_id(payload)
    updated = repo.set_quantity(item_id, quantity, expected_version=payload.get("expected_version"))
    return Written("item", serialize_item(hass, updated), "quantity_changed")


def _op_item_check_out(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.check_out(
        item_id, due_date=payload.get("due_date"), expected_version=payload.get("expected_version")
    )
    return Written("item", serialize_item(hass, updated), "checked_out")


def _op_item_check_in(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.check_in(item_id, expected_version=payload.get("expected_version"))
    return Written("item", serialize_item(hass, updated), "checked_in")


def _op_item_add_tags(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    tags = _payload_tags(payload)
    current = repo.get_item(item_id)
    new_tags = list(dict.fromkeys(list(current.tags) + list(tags)))
    updated = repo.update_item(item_id, ItemUpdate(tags=new_tags), expected_version=expected)
    return Written("item", serialize_item(hass, updated), "updated")


def _op_item_remove_tags(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    to_remove = set(_payload_tags(payload))
    current = repo.get_item(item_id)
    new_tags = [t for t in list(current.tags) if t not in to_remove]
    updated = repo.update_item(item_id, ItemUpdate(tags=new_tags), expected_version=expected)
    return Written("item", serialize_item(hass, updated), "updated")


def _op_item_update_custom_fields(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    update: ItemUpdate = {}
    set_value = payload.get("set")
    if set_value is not None:
        if not isinstance(set_value, dict):
            raise ValidationError("set must be an object")
        update["custom_fields_set"] = dict(set_value)
    unset_value = payload.get("unset")
    if unset_value is not None:
        if not isinstance(unset_value, list):
            raise ValidationError("unset must be a list")
        update["custom_fields_unset"] = list(unset_value)
    updated = repo.update_item(item_id, update, expected_version=expected)
    return Written("item", serialize_item(hass, updated), "updated")


def _op_item_set_low_stock_threshold(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    updated = repo.update_item(
        item_id,
        ItemUpdate(low_stock_threshold=payload.get("low_stock_threshold")),
        expected_version=expected,
    )
    return Written("item", serialize_item(hass, updated), "updated")


def _op_reminder_bump(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.bump_reminder(
        item_id,
        # The instance's local day, the one every other surface runs on — the
        # calendar, the counts, the sensors and the card's chips. A reminder is
        # a household-facing date rather than a timestamp, and bumping is what
        # somebody does in the evening: west of Greenwich that is already
        # tomorrow in UTC, so counting from a UTC day would skip the occurrence
        # their own calendar is showing them for tomorrow.
        today=dt_util.now().date(),
        expected_version=payload.get("expected_version"),
    )
    return Written("item", serialize_item(hass, updated), "updated")


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
    # The area a location sits in is resolved through its tree, not read off the
    # row: a tree's area lives on its root, so an area set on a nested location
    # moves the root's `area_id` and leaves the edited row's at None. Comparing
    # the resolved value catches both, and it is the value the items under the
    # location report as `effective_area_id`.
    was_anchored_at = (before.parent_id, repo.effective_area_id(location_key))
    loc = repo.update_location(
        location_id, name=payload.get("name"), new_parent_id=new_parent, area_id=area_id
    )
    # One event per call, decided by what changed rather than by which keys the
    # call carried: an editor that sends every field on every save would
    # otherwise announce a move on a plain rename, and one carrying both a new
    # parent and a new area would announce two.
    #
    # An area reassignment is a move: it re-anchors the whole subtree, so every
    # item under it gets a new effective_area_id, which is exactly what a client
    # filtered by area re-lists on. No item events accompany it — the items
    # themselves did not change.
    is_anchored_at = (loc.parent_id, repo.effective_area_id(location_key))
    renamed = loc.name != before.name
    if is_anchored_at != was_anchored_at:
        action = "moved"
    elif renamed:
        action = "renamed"
    else:
        action = UNCHANGED
    # Only the two edits that rewrite a path repaint: an area reassignment
    # re-anchors the subtree without changing what any path reads.
    repaint = renamed or loc.parent_id != before.parent_id
    return Written("location", serialize_location(loc), action, repaint=repaint)


def _op_location_delete(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    location_id = payload["location_id"]
    # Read the body before removing it: after the delete there is nothing left
    # to answer with, and an unknown id raises here exactly as the delete would.
    removed = serialize_location(repo.get_location(location_id))
    repo.delete_location(location_id)
    return Written("location", removed, "deleted")


#: Every write both surfaces can make, by the name they both call it.
#: `haventory/<path>` and `haventory.<name>` reach the same entry.
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

#: The subset a `haventory/items/bulk` row may name, which the contract
#: enumerates. The rest are writes a batch cannot make: one that creates has no
#: item to report a version conflict on, and the two location verbs are not
#: item operations at all.
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

    op = OPS.get(name)
    if op is None:
        raise ValidationError("unknown operation kind")
    return op(hass, payload)


async def announce(hass: HomeAssistant, written: Written) -> None:
    """Free what the write orphaned, then announce it — after the persist.

    The files first, because they belong to a body that is already gone from a
    store that has already been written; the event afterwards, because it is
    what tells a subscriber the write is durable.
    """

    if written.action == UNCHANGED:
        # A save that rewrote no field announces nothing and repaints nothing;
        # the counts still go out, as they do after every other write.
        notify_counts(hass)
    elif written.noun == "item":
        # `deleted` is the action the delete op alone returns, so it names
        # exactly the body whose files nothing references any more.
        if written.action == "deleted":
            await media_mod.async_delete_item_files(hass, [written.entity])
        notify_mutation(hass, action=written.action, item=written.entity)
    else:
        notify_location_mutation(
            hass, action=written.action, location=written.entity, repaint=written.repaint
        )
