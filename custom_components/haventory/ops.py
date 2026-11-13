"""One operation per write, and the one place a write is committed.

An op takes the payload as a plain dict (whatever the surface's schema let
through, minus its envelope), makes the repository call and returns the
`Written` that says what the write earns. A surface never runs an op itself:
it calls `commit` (one write) or `commit_batch` (a `haventory/items/bulk`
batch), which run the op, persist, free what the saved write orphaned, then
announce. Each surface keeps its own schemas, envelope and the shape of its
answer.

The order is the same for every write: persist, then free files, then
announce, then reply. Announcing first would tell subscribers about a change
the caller is about to be told failed; a file unlinked before the save would
leave stored metadata naming nothing if the save then failed.

A write whose save fails is undone. Every save writes the whole repository, so
a failed change left in memory would reach disk with the next unrelated write
that succeeds, and nobody would have been told about it. The undo restores a
snapshot taken before the op, which is only sound while no other write can
change the repository between that snapshot and the save settling: the
runtime's `write_lock` is held across the op, the save and the undo. The ops
are synchronous, so the only wait it adds is queueing behind another write's
save, which the store's own lock already imposed.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.util import dt as dt_util

from . import media as media_mod
from . import todo_bridge
from .events import (
    notify_batch_settled,
    notify_bulk_mutation,
    notify_counts,
    notify_dataset_replaced,
    notify_location_mutation,
    notify_mutation,
    notify_status_mutation,
)
from .exceptions import ValidationError
from .item_writes import ItemCreate, ItemUpdate
from .logs import context_logger
from .models import (
    AttachmentMeta,
    Item,
    serialize_status_definition,
)
from .repository import UNSET, Repository, RepositorySnapshot
from .runtime import loaded_runtime
from .serialization import serialize_item, serialize_location
from .storage import async_persist_repo
from .validation import normalize_string_list, require_string_list, validate_quantity

LOGGER = context_logger(__name__)

#: The action of a save that rewrote no field; `announce` sends only the counts.
UNCHANGED = "unchanged"


@dataclass(frozen=True, slots=True)
class Written:
    """What one write earns once it is saved: the event, and what to do first.

    ``noun`` picks the topic, ``entity`` is the body the event carries and the
    surface answers with, and ``action`` is the event, or ``UNCHANGED``.

    The rest is set only by the writes that need it. ``repaint`` is False for
    the location edit that re-anchors a subtree without moving a path.
    ``counts`` is False for an item edit that moves no count. ``detached`` are
    the attachments whose bytes go once the save lands. ``reassigned`` are the
    items a status delete rewrote, as saved.
    """

    noun: Literal["item", "location", "status", "dataset"]
    entity: Any
    action: str
    repaint: bool = True
    counts: bool = True
    detached: tuple[tuple[str, AttachmentMeta], ...] = ()
    reassigned: tuple[dict[str, Any], ...] = ()


Op = Callable[[HomeAssistant, dict[str, Any]], Written]


def _repo(hass: HomeAssistant) -> Repository:
    # A WebSocket command cannot be unregistered and the services are kept
    # registered on purpose, so this lookup is what makes both refuse while the
    # entry is not loaded.
    return loaded_runtime(hass).repository


def _payload_item_id(payload: dict[str, Any]) -> str:
    value = payload.get("item_id")
    if not isinstance(value, str) or not value:
        raise ValidationError("item_id must be a non-empty string", key="item_id_required")
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


def _reminder_update(hass: HomeAssistant, payload: dict[str, Any], update: ItemUpdate) -> Written:
    # An ordinary item edit: it bumps `version` and answers `conflict` like one.
    item = _repo(hass).update_item(
        payload["item_id"], update, expected_version=payload.get("expected_version")
    )
    return _item(hass, item)


def _op_reminder_set(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    # The command names the whole reminder, so an omitted interval means a
    # one-off rather than "keep the stored one".
    update = cast(
        "ItemUpdate",
        {
            "reminder_date": payload["reminder_date"],
            "reminder_interval": payload.get("reminder_interval"),
        },
    )
    return _reminder_update(hass, payload, update)


def _op_reminder_clear(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    update = cast("ItemUpdate", {"reminder_date": None, "reminder_interval": None})
    return _reminder_update(hass, payload, update)


def _op_item_attachment_add(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    """Record an attachment whose bytes the surface already wrote.

    ``meta`` is the `AttachmentMeta` the surface built from the consumed upload.
    A failed save leaves the file with no saved metadata, which setup's orphan
    sweep collects.
    """

    meta: AttachmentMeta = payload["meta"]
    updated = _repo(hass).add_attachment(
        payload["item_id"],
        meta,
        max_per_kind=media_mod.max_per_item(meta.kind),
        expected_version=payload.get("expected_version"),
    )
    return _item(hass, updated)


def _op_item_attachment_remove(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    updated, removed = _repo(hass).remove_attachment(
        payload["item_id"],
        str(payload["attachment_id"]),
        expected_version=payload.get("expected_version"),
    )
    serialized = serialize_item(hass, updated)
    return Written("item", serialized, "updated", detached=((str(updated.id), removed),))


def _op_item_attachment_update(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    updated = _repo(hass).update_attachment(
        payload["item_id"],
        str(payload["attachment_id"]),
        title=payload["title"],
        expected_version=payload.get("expected_version"),
    )
    # A title moves no count.
    return Written("item", serialize_item(hass, updated), "updated", counts=False)


def _op_item_attachment_reorder(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    updated = _repo(hass).reorder_attachments(
        payload["item_id"],
        payload["kind"],
        payload["attachment_ids"],
        expected_version=payload.get("expected_version"),
    )
    # The order of attachments moves no count.
    return Written("item", serialize_item(hass, updated), "updated", counts=False)


def _require_known_area(hass: HomeAssistant, area_id: Any) -> None:
    """Refuse an `area_id` Home Assistant has no area for; areas are HA's."""

    if area_id is None:
        return
    if not isinstance(area_id, str) or ar.async_get(hass).async_get_area(area_id) is None:
        raise ValidationError("unknown area_id", key="area_not_found")


def _op_location_create(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    _require_known_area(hass, payload.get("area_id"))
    loc = _repo(hass).create_location(
        name=payload["name"], parent_id=payload.get("parent_id"), area_id=payload.get("area_id")
    )
    return Written("location", serialize_location(loc), "created")


def _op_location_update(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    location_id = payload["location_id"]
    new_parent = payload["new_parent_id"] if "new_parent_id" in payload else UNSET
    _require_known_area(hass, payload.get("area_id"))
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


def _op_location_move_subtree(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    new_parent = payload.get("new_parent_id") if "new_parent_id" in payload else UNSET
    was_below = repo.get_location(payload["location_id"]).parent_id
    loc = repo.update_location(payload["location_id"], new_parent_id=new_parent)
    # Always `moved`, as the command is named; only a new parent repaints.
    return Written("location", serialize_location(loc), "moved", repaint=loc.parent_id != was_below)


def _op_import_execute(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    _repo(hass).load_state(payload["target"])
    return Written("dataset", None, "reloaded")


def _op_status_create(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    doc: dict[str, Any] = {
        k: payload[k] for k in ("slug", "label", "color", "icon", "order") if k in payload
    }
    created = _repo(hass).create_status(doc)
    return Written("status", serialize_status_definition(created), "created")


def _op_status_update(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    changes: dict[str, Any] = {
        k: payload[k] for k in ("label", "color", "icon", "order") if k in payload
    }
    updated = _repo(hass).update_status(payload["slug"], changes)
    return Written("status", serialize_status_definition(updated), "updated")


def _op_status_reorder(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    ordered = _repo(hass).reorder_statuses(payload["slugs"])
    return Written("status", [serialize_status_definition(d) for d in ordered], "reordered")


def _op_status_delete(hass: HomeAssistant, payload: dict[str, Any]) -> Written:
    repo = _repo(hass)
    removed, reassigned_ids = repo.delete_status(
        payload["slug"], reassign_to=payload.get("reassign_to")
    )
    # Each rewritten item took a new version, so each is an ordinary item
    # edit that `haventory_item_changed` automations must see.
    reassigned = tuple(serialize_item(hass, repo.get_item(i)) for i in reassigned_ids)
    return Written("status", serialize_status_definition(removed), "deleted", reassigned=reassigned)


#: Every write, by the name its surfaces call it: `haventory/<path>` and
#: `haventory.<name>` reach the same entry. Some have a command and no service.
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
    "reminder_set": _op_reminder_set,
    "reminder_clear": _op_reminder_clear,
    "reminder_bump": _op_reminder_bump,
    "item_attachment_add": _op_item_attachment_add,
    "item_attachment_remove": _op_item_attachment_remove,
    "item_attachment_update": _op_item_attachment_update,
    "item_attachment_reorder": _op_item_attachment_reorder,
    "location_create": _op_location_create,
    "location_update": _op_location_update,
    "location_delete": _op_location_delete,
    "location_move_subtree": _op_location_move_subtree,
    "status_create": _op_status_create,
    "status_update": _op_status_update,
    "status_reorder": _op_status_reorder,
    "status_delete": _op_status_delete,
    "import_execute": _op_import_execute,
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


async def commit(hass: HomeAssistant, name: str, payload: dict[str, Any]) -> Written:
    """Run one op, persist, free what it orphaned, announce; return what it wrote."""

    runtime = loaded_runtime(hass)
    async with runtime.write_lock:
        before = runtime.repository.snapshot()
        written = OPS[name](hass, payload)
        await _save(hass, runtime.repository, name, before)
    await _free_files(hass, [written])
    await _announce(hass, written)
    return written


async def commit_batch(
    hass: HomeAssistant,
    rows: Sequence[tuple[str, dict[str, Any]]],
    *,
    refused: Callable[[int, Exception], None],
) -> list[Written | None]:
    """Run a `haventory/items/bulk` batch: every row, one save, then the events.

    A row that raises, or names a kind outside `BULK_KINDS`, is handed to
    ``refused`` with its index as it fails and reads None in the result; it
    stops no other row. A batch with no successful row saves and announces
    nothing. A failed save undoes every row. The events are each row's own with
    the repaint and the counts held back, then one of each for the batch.
    """

    runtime = loaded_runtime(hass)
    results: list[Written | None] = []
    async with runtime.write_lock:
        before = runtime.repository.snapshot()
        for index, (name, payload) in enumerate(rows):
            try:
                if name not in BULK_KINDS:
                    raise ValidationError("unknown operation kind")
                results.append(OPS[name](hass, payload))
            except Exception as exc:
                # Whatever it was, it fails its own row and no other.
                refused(index, exc)
                results.append(None)
        successful = [w for w in results if w is not None]
        if successful:
            await _save(hass, runtime.repository, "items_bulk", before)

    if successful:
        await _free_files(hass, successful)
        for written in successful:
            await _announce(hass, written, batch_row=True)
        notify_batch_settled(hass)
    return results


async def _save(
    hass: HomeAssistant, repo: Repository, name: str, before: RepositorySnapshot
) -> None:
    """Persist, or put ``before`` back and re-raise; the caller holds `write_lock`."""

    try:
        await async_persist_repo(hass)
    except Exception:
        repo.restore(before)
        # The storage layer logged the failure itself, at ERROR with the trace.
        LOGGER.warning("Undid a write whose save failed", extra={"op": name})
        raise


async def _free_files(hass: HomeAssistant, writes: Sequence[Written]) -> None:
    """After the save: delete the bytes nothing saved points at any more."""

    deleted = [w.entity for w in writes if w.noun == "item" and w.action == "deleted"]
    if deleted:
        await media_mod.async_delete_item_files(hass, deleted)
    detached = [pair for w in writes for pair in w.detached]
    if detached:
        await media_mod.async_delete_attachments(hass, detached)
    # `replace` can drop an attachment's only reference, and that metadata was
    # the only record of where its file is; sweeping against the new metadata
    # deletes exactly those files.
    if any(w.noun == "dataset" for w in writes):
        await media_mod.async_sweep_orphans(hass, _repo(hass).iter_attachments())


async def _announce(hass: HomeAssistant, written: Written, *, batch_row: bool = False) -> None:
    """Send the events a saved write earns; a batch row holds back the repaint and counts."""

    if written.action == UNCHANGED:
        notify_counts(hass)
    elif written.noun == "item":
        notify_mutation(
            hass,
            action=written.action,
            item=written.entity,
            counts=written.counts and not batch_row,
            repaint=not batch_row,
        )
    elif written.noun == "location":
        notify_location_mutation(
            hass, action=written.action, location=written.entity, repaint=written.repaint
        )
    elif written.noun == "status":
        if written.action == "reordered":
            notify_status_mutation(hass, action=written.action, statuses=written.entity)
        else:
            notify_status_mutation(hass, action=written.action, status=written.entity)
        if written.reassigned:
            notify_bulk_mutation(hass, action="updated", items=list(written.reassigned))
    elif written.noun == "dataset":
        notify_dataset_replaced(hass)
        # The shopping list explicitly: a swap that leaves the low-stock set as it
        # was fires no bus signal the bridge would react to.
        await todo_bridge.async_reconcile(hass)
