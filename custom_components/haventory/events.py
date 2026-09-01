"""Announcing a mutation — to WebSocket subscribers, to the bus, to the sensors.

Every write path announces itself through one of the doors here, and each door
covers all three surfaces at once. A path that reached `subscriptions.py`
directly would tell a card what it never told the bus, so the two would disagree
about the same edit.

- `notify_mutation`, after the durable write of one item: it broadcasts the
  `items` event, fires `haventory_item_changed` on the bus, diffs the low-stock
  set to fire `haventory_low_stock`, dispatches the signal the sensors repaint
  on, and broadcasts the fresh `stats` counts.
- `notify_bulk_mutation`, for a command that rewrote many items: one `items`
  event and one counts event for the batch, a bus event per item, one diff and
  one repaint.
- `notify_dataset_replaced`, for an import: a `reloaded` event on both item
  topics, and no per-row announcement anywhere.
- `notify_location_mutation`, which broadcasts the `locations` event and the
  counts and repaints, but announces nothing on the bus — no item changed, only
  the tree the items are counted and pathed against. `notify_location_changed`
  is the repaint on its own, for the paths that have already broadcast.
- `notify_status_mutation`, for the status vocabulary: the `statuses` topic and
  nothing else, because a label is neither an item nor a count.

One thing announced here follows no mutation at all: `async_track_day_rollover`
broadcasts the counts at the instance's local midnight, because five of them are
derived from today's date and so move on their own.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change

from .const import (
    DOMAIN,
    EVENT_ITEM_CHANGED,
    EVENT_LOW_STOCK,
    SIGNAL_INVENTORY_CHANGED,
)
from .logs import context_logger
from .models import iso_utc_now
from .runtime import HAventoryRuntime, find_runtime
from .subscriptions import broadcast_counts, broadcast_event

LOGGER = context_logger(__name__)


def seed_low_stock_snapshot(hass: HomeAssistant) -> None:
    """Record which items are low at setup, so a restart re-announces nothing.

    Called once the runtime is on the entry. Without it the first mutation after
    every restart would diff against an empty set and fire `entered` for every
    item that was already low before the restart.
    """

    runtime = find_runtime(hass)
    if runtime is None:
        return
    runtime.low_stock_ids = runtime.repository.low_stock_item_ids


def async_track_day_rollover(hass: HomeAssistant) -> Callable[[], None]:
    """Broadcast the counts at the instance's local midnight; returns the unsub.

    Five of the counts are derived from today's date rather than from stored
    state, so they move on the day boundary with nothing having been mutated.
    The date-derived sensors and `calendar.haventory` each track that instant
    already; a `stats` subscriber hears about mutations only, so without this a
    card left open across midnight shows yesterday's figures until somebody
    edits something, while the sensors beside it on the same dashboard move.

    Local midnight, not UTC: the stored dates are calendar days as the household
    wrote them, which is the boundary every other surface measures against.

    The counts alone. The sensors and the calendar hold their own trackers, and
    `SIGNAL_INVENTORY_CHANGED` from here would rewrite the counts that cannot
    have moved. Nothing is scheduled or stored either — the tick is a re-read of
    what the repository already derives on demand.
    """

    @callback
    def _rollover(_now: datetime) -> None:
        try:
            broadcast_counts(hass)
        except Exception:
            # Best-effort, as every announcement here is, and for a sharper
            # reason: an exception escaping into the tracker can take the next
            # day's tick with it, and the counts would then stay stale until a
            # restart rather than for one day.
            LOGGER.exception(
                "Failed to broadcast the counts at the day rollover",
                extra={"domain": DOMAIN, "op": "day_rollover"},
            )

    return async_track_time_change(hass, _rollover, hour=0, minute=0, second=0)


def notify_mutation(
    hass: HomeAssistant,
    *,
    action: str,
    item: dict[str, Any] | None = None,
    counts: bool = True,
) -> None:
    """Announce a mutation to subscribers and to Home Assistant, and repaint.

    Call it **after** the persist, on every path: the contract's "an event
    implies a durable write" rule holds on the bus and on the wire alike.

    ``item`` is the serialized item the mutation produced — for a delete, the
    body as it last stood. A path that rewrote the dataset wholesale passes
    none, which broadcasts no `items` event and fires nothing on the bus, but
    still diffs the low-stock set, still repaints the sensors and still
    broadcasts the counts.

    ``counts`` False is for a command emitting many item mutations in a row: it
    calls ``notify_counts`` once when the batch is through, rather than sending
    a whole counts object per row and charging a token for each.

    Best-effort: a mutation that is already written must not fail because
    something downstream of it did.
    """

    try:
        runtime = find_runtime(hass)
        if runtime is None:
            # The entry tore down between the write and this call. Nothing to
            # notify and nothing to diff against.
            return

        if item is not None:
            broadcast_event(hass, topic="items", action=action, payload={"item": item})
            _fire_item_changed(hass, action, item)

        _fire_low_stock_transitions(hass, runtime, item=item)

        async_dispatcher_send(hass, SIGNAL_INVENTORY_CHANGED)

        if counts:
            broadcast_counts(hass)
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to notify a mutation",
            extra={"domain": DOMAIN, "op": "notify_mutation", "action": action},
        )


def notify_counts(hass: HomeAssistant) -> None:
    """Broadcast the counts alone, for a batch that suppressed them per row."""

    broadcast_counts(hass)


def notify_bulk_mutation(
    hass: HomeAssistant, *, action: str, items: Sequence[dict[str, Any]]
) -> None:
    """Announce one command that rewrote many items, after the persist.

    One `haventory_item_changed` per item, because an automation subscribed to it
    is watching items rather than commands — a bulk command that announced
    nothing would be the one hole in "fired on every path". One WebSocket `items`
    event, one low-stock diff, one repaint and one counts event for the whole
    batch, because each describes the inventory as a whole and running them per
    row would repeat the same work once per row.
    """

    try:
        runtime = find_runtime(hass)
        if runtime is None:
            return

        # One `items` event for the batch, carrying no row: a subscriber is
        # being told its list is stale, not which rows moved, and a payload per
        # row would be a whole inventory on the wire.
        broadcast_event(hass, topic="items", action=action, payload=None)

        for item in items:
            _fire_item_changed(hass, action, item)

        # `item=None`: the diff covers the batch, and no single row is the one
        # a crossing should be attributed to.
        _fire_low_stock_transitions(hass, runtime, item=None)

        async_dispatcher_send(hass, SIGNAL_INVENTORY_CHANGED)
        broadcast_counts(hass)
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to notify a bulk mutation",
            extra={"domain": DOMAIN, "op": "notify_bulk_mutation", "action": action},
        )


def notify_dataset_replaced(hass: HomeAssistant) -> None:
    """Announce that the whole dataset was rewritten, after the persist.

    One `reloaded` event per topic and no per-item announcement at all: an
    import replaces items and locations wholesale, and both an automation and a
    card want one signal rather than one per row. Passing no item to
    ``notify_mutation`` leaves it the rest of its job — the low-stock diff still
    runs, so a restock done by import announces itself, the sensors repaint, and
    the counts go out.
    """

    broadcast_event(hass, topic="items", action="reloaded", payload=None)
    broadcast_event(hass, topic="locations", action="reloaded", payload=None)
    notify_mutation(hass, action="reloaded")


def notify_location_mutation(
    hass: HomeAssistant,
    *,
    action: str,
    location: dict[str, Any],
    repaint: bool = True,
) -> None:
    """Announce a location change to subscribers, and repaint what reads the tree.

    The counterpart of ``notify_mutation`` for the other topic, and it exists for
    the same reason: every write path announces through a door here, so a
    `haventory.location_*` service reaches the subscribers the WebSocket command
    beside it reaches.

    Nothing is fired on the bus — the documented action vocabulary is about
    items, and no item changed. ``repaint`` is False for the one edit that
    announces a change without moving anything an entity reads: reassigning a
    subtree's area re-anchors it for a client filtered by area, while
    `locations_total` and every `location_path` stay exactly as they were.
    """

    broadcast_event(hass, topic="locations", action=action, payload={"location": location})
    if repaint:
        notify_location_changed(hass)
    broadcast_counts(hass)


def notify_location_changed(hass: HomeAssistant) -> None:
    """Repaint what reads the location tree, without announcing an item mutation.

    Two kinds of change need it, and nothing else invalidates either until local
    midnight or until some item happens to be edited. A create or a delete moves
    `locations_total`, which is a sensor. A rename or a re-parent rewrites the
    denormalized `location_path` on every item underneath, which the calendar
    renders each event's description from.

    The dispatcher signal only: `haventory_item_changed` stays unfired, because
    no item changed — a derived-path rewrite deliberately moves neither an item's
    `version` nor its `updated_at` — and the documented action vocabulary has no
    location word.
    """

    try:
        if find_runtime(hass) is None:
            return
        async_dispatcher_send(hass, SIGNAL_INVENTORY_CHANGED)
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to repaint after a location change",
            extra={"domain": DOMAIN, "op": "notify_location_changed"},
        )


def notify_status_mutation(
    hass: HomeAssistant,
    *,
    action: str,
    status: dict[str, Any] | None = None,
    statuses: list[dict[str, Any]] | None = None,
) -> None:
    """Announce a change to the status vocabulary, after the persist.

    The `statuses` topic alone. A status is a label items may carry: defining,
    renaming or removing one moves no item, no count and nothing an entity
    renders, so there is nothing to fire on the bus and nothing to repaint. A
    delete that reassigns the items off the slug announces those beside this
    call, as the ordinary bulk item mutation they are.

    ``statuses`` carries the whole vocabulary for a reorder, which is the one
    action that describes the list rather than an entry of it; ``status``
    carries the single entry for the rest.
    """

    payload = {"statuses": statuses} if statuses is not None else {"status": status}
    broadcast_event(hass, topic="statuses", action=action, payload=payload)


def _fire_item_changed(hass: HomeAssistant, action: str, item: dict[str, Any]) -> None:
    _fire(
        hass,
        EVENT_ITEM_CHANGED,
        {
            "action": action,
            "item_id": item.get("id"),
            "name": item.get("name"),
            "quantity": item.get("quantity"),
            "location_id": item.get("location_id"),
            "location_path": (item.get("location_path") or {}).get("display_path"),
            "effective_area_id": item.get("effective_area_id"),
            "version": item.get("version"),
            "ts": iso_utc_now(),
        },
    )


def _fire_low_stock_transitions(
    hass: HomeAssistant, runtime: HAventoryRuntime, *, item: dict[str, Any] | None
) -> None:
    """Fire `entered` / `cleared` for the ids that crossed the threshold.

    A set diff rather than a per-handler check: one place then covers single
    mutations, `haventory/items/bulk` and import execute alike, and no handler
    needs a pre-mutation read of its own.
    """

    repo = runtime.repository
    previous = runtime.low_stock_ids
    current = repo.low_stock_item_ids
    if current == previous:
        return
    runtime.low_stock_ids = current

    for item_id in current - previous:
        _fire(hass, EVENT_LOW_STOCK, _low_stock_payload(repo, item_id, "entered", item))
    for item_id in previous - current:
        # A deleted item is gone by the time the diff runs, so `cleared` for it
        # carries the id and a null name rather than a lookup that would raise.
        _fire(hass, EVENT_LOW_STOCK, _low_stock_payload(repo, item_id, "cleared", item))


def _low_stock_payload(
    repo: Any, item_id: str, action: str, mutated: dict[str, Any] | None
) -> dict[str, Any]:
    if mutated is not None and mutated.get("id") == item_id:
        name = mutated.get("name")
        quantity = mutated.get("quantity")
        threshold = mutated.get("low_stock_threshold")
    else:
        try:
            stored = repo.get_item(item_id)
        except Exception:
            name = quantity = threshold = None
        else:
            name = stored.name
            quantity = stored.quantity
            threshold = stored.low_stock_threshold
    return {
        "action": action,
        "item_id": item_id,
        "name": name,
        "quantity": quantity,
        "low_stock_threshold": threshold,
        "ts": iso_utc_now(),
    }


def _fire(hass: HomeAssistant, event_type: str, payload: dict[str, Any]) -> None:
    hass.bus.async_fire(event_type, payload)
