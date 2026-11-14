"""Announcing a mutation — to WebSocket subscribers, to the bus, to the sensors.

Every write path announces itself through one of the doors here, and each door
covers all three surfaces at once, so a card and the bus never disagree about
the same edit. Call a door **after** the persist: an event implies a durable
write. The announcements are best-effort, because a write that is already on
disk must not fail over something downstream of it.

`async_track_day_rollover` is the one announcement that follows no mutation:
five counts are derived from today's date and move at local midnight.

Each announcement computes the counts once and hands that one set both to the
`stats` topic and, as the dispatcher signal's argument, to the sensors, so a
write costs one pass over the inventory however many entities repaint.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change

from .const import (
    EVENT_ITEM_CHANGED,
    EVENT_LOW_STOCK,
    SIGNAL_INVENTORY_CHANGED,
)
from .exceptions import NotFoundError
from .logs import context_logger
from .repository import Repository
from .runtime import HAventoryRuntime, find_runtime
from .subscriptions import broadcast_counts, broadcast_event
from .timestamps import iso_utc_now

LOGGER = context_logger(__name__)


def seed_low_stock_snapshot(hass: HomeAssistant) -> None:
    """Record which items are low at setup, so a restart re-announces nothing."""

    runtime = find_runtime(hass)
    if runtime is None:
        return
    runtime.low_stock_ids = runtime.repository.low_stock_item_ids


def async_track_day_rollover(hass: HomeAssistant) -> Callable[[], None]:
    """Broadcast the counts at the instance's local midnight; returns the unsub.

    A `stats` subscriber otherwise hears about mutations only, so a card left
    open across midnight would show yesterday's figures. The counts alone: the
    sensors and the calendar hold their own trackers.
    """

    @callback
    def _rollover(_now: datetime) -> None:
        broadcast_counts(hass)

    return async_track_time_change(hass, _rollover, hour=0, minute=0, second=0)


def notify_mutation(
    hass: HomeAssistant,
    *,
    action: str,
    item: dict[str, Any] | None = None,
    counts: bool = True,
    batch_row: bool = False,
) -> None:
    """Announce one item mutation: `items` event, bus event, low-stock diff, repaint, counts.

    ``item`` is the serialized item, or for a delete the body as it last stood.
    Without one, nothing goes on the `items` topic or the bus, but the rest
    still runs. ``counts`` False is for a write that moves no count. A
    ``batch_row`` holds back the low-stock diff, the repaint and the counts,
    and the batch sends them once at the end through ``notify_batch_settled``.
    """

    try:
        runtime = find_runtime(hass)
        if runtime is None:
            # The entry tore down between the write and this call.
            return

        if item is not None:
            broadcast_event(hass, topic="items", action=action, payload={"item": item})
            _fire_item_changed(hass, action, item)

        if batch_row:
            return
        _fire_low_stock_transitions(hass, runtime, bodies=_by_id([item] if item else []))
        _repaint_and_count(hass, runtime, repaint=True, counts=counts)
    # The announcement runs after the save; a failure here must not turn a saved write
    # into an error.
    except Exception:
        LOGGER.exception(
            "Failed to notify a mutation",
            extra={"op": "notify_mutation", "action": action},
        )


def notify_counts(hass: HomeAssistant) -> None:
    """Broadcast the counts alone, for a save that changed nothing."""

    broadcast_counts(hass)


def notify_batch_settled(hass: HomeAssistant, items: Sequence[dict[str, Any]]) -> None:
    """The one low-stock diff, repaint and counts event for a batch whose rows held them back.

    ``items`` is every successful row's body. The diff needs them because a row
    that deleted a low item leaves nothing in the repository to name it by.
    """

    runtime = find_runtime(hass)
    if runtime is not None:
        _fire_low_stock_transitions(hass, runtime, bodies=_by_id(items))
        _repaint_and_count(hass, runtime, repaint=True, counts=True)


def notify_bulk_mutation(
    hass: HomeAssistant, *, action: str, items: Sequence[dict[str, Any]]
) -> None:
    """Announce one command that rewrote many items.

    One `haventory_item_changed` per item, because an automation watches items
    rather than commands. One row-less `items` event, one low-stock diff, one
    repaint and one counts event for the batch: a subscriber is told its list is
    stale, not which rows moved.
    """

    try:
        runtime = find_runtime(hass)
        if runtime is None:
            return

        broadcast_event(hass, topic="items", action=action, payload=None)

        for item in items:
            _fire_item_changed(hass, action, item)

        _fire_low_stock_transitions(hass, runtime, bodies=_by_id(items))

        _repaint_and_count(hass, runtime, repaint=True, counts=True)
    # The announcement runs after the save; a failure here must not turn a saved write
    # into an error.
    except Exception:
        LOGGER.exception(
            "Failed to notify a bulk mutation",
            extra={"op": "notify_bulk_mutation", "action": action},
        )


def notify_dataset_replaced(hass: HomeAssistant) -> None:
    """Announce an import: one `reloaded` event per topic and no per-row events.

    The low-stock diff, the repaint and the counts still run, so a restock done
    by import announces itself.
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
    """Announce a location change on the `locations` topic, repaint, and send the counts.

    Nothing is fired on the bus: no item changed, and a derived-path rewrite
    moves no item's `version`. The repaint is what moves `locations_total` and
    the calendar's rendered paths. ``repaint`` is False for an area
    reassignment, which re-anchors a subtree without changing any path or count.
    """

    broadcast_event(hass, topic="locations", action=action, payload={"location": location})
    runtime = find_runtime(hass)
    if runtime is not None:
        _repaint_and_count(hass, runtime, repaint=repaint, counts=True)


def notify_status_mutation(
    hass: HomeAssistant,
    *,
    action: str,
    status: dict[str, Any] | None = None,
    statuses: list[dict[str, Any]] | None = None,
) -> None:
    """Announce a change to the status vocabulary on the `statuses` topic alone.

    A label moves no item, count or entity. ``statuses`` carries the whole
    vocabulary for a reorder; ``status`` the single entry otherwise.
    """

    payload = {"statuses": statuses} if statuses is not None else {"status": status}
    broadcast_event(hass, topic="statuses", action=action, payload=payload)


def _repaint_and_count(
    hass: HomeAssistant, runtime: HAventoryRuntime, *, repaint: bool, counts: bool
) -> None:
    """Send the repaint and the counts event from one computed set of counts.

    The set rides the dispatcher signal, so a sensor reads its value off it
    rather than walking the inventory again.
    """

    if not (repaint or counts):
        return
    snapshot = runtime.repository.get_counts()
    if repaint:
        async_dispatcher_send(hass, SIGNAL_INVENTORY_CHANGED, snapshot)
    if counts:
        broadcast_counts(hass, snapshot)


def _fire_item_changed(hass: HomeAssistant, action: str, item: dict[str, Any]) -> None:
    hass.bus.async_fire(
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


def _by_id(items: Sequence[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The bodies keyed by id; a later row for the same item wins, as in the store."""

    return {str(item["id"]): item for item in items if item.get("id") is not None}


def _fire_low_stock_transitions(
    hass: HomeAssistant, runtime: HAventoryRuntime, *, bodies: dict[str, dict[str, Any]]
) -> None:
    """Fire `entered` / `cleared` for the ids that crossed the threshold.

    A set diff, so one place covers single writes, bulk and import alike.
    ``bodies`` are the written items' own bodies, which name a deleted item the
    repository can no longer read.
    """

    repo = runtime.repository
    previous = runtime.low_stock_ids
    current = repo.low_stock_item_ids
    if current == previous:
        return
    runtime.low_stock_ids = current

    for item_id in current - previous:
        hass.bus.async_fire(
            EVENT_LOW_STOCK, _low_stock_payload(repo, item_id, "entered", bodies.get(item_id))
        )
    for item_id in previous - current:
        hass.bus.async_fire(
            EVENT_LOW_STOCK, _low_stock_payload(repo, item_id, "cleared", bodies.get(item_id))
        )


def _low_stock_payload(
    repo: Repository, item_id: str, action: str, mutated: dict[str, Any] | None
) -> dict[str, Any]:
    if mutated is not None:
        name = mutated.get("name")
        quantity = mutated.get("quantity")
        threshold = mutated.get("low_stock_threshold")
    else:
        try:
            stored = repo.get_item(item_id)
        except NotFoundError:
            # A deleted item is gone by the time the diff runs.
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
