"""Home Assistant bus events and the sensor nudge behind them.

The WebSocket broadcasts in `ws.py` reach subscribed clients; these reach the
rest of Home Assistant. Every mutation path — WebSocket handler, `haventory.*`
service, bulk operation, import — calls `notify_mutation` after its durable
write, which fires `haventory_item_changed`, diffs the low-stock set to fire
`haventory_low_stock`, and dispatches the signal the sensors repaint on.

Bus events bypass the rate limiter: it budgets WebSocket subscription traffic,
and these are internal to Home Assistant.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    DATA_LOW_STOCK_SNAPSHOT,
    DOMAIN,
    EVENT_ITEM_CHANGED,
    EVENT_LOW_STOCK,
    SIGNAL_COUNTS_UPDATED,
)
from .models import iso_utc_now

LOGGER = logging.getLogger(__name__)

# The WebSocket items vocabulary, reused verbatim: an automation and a card
# client describe the same mutation with the same word.
ITEM_ACTIONS: frozenset[str] = frozenset(
    {"created", "updated", "moved", "quantity_changed", "checked_out", "checked_in", "deleted"}
)


def seed_low_stock_snapshot(hass: HomeAssistant) -> None:
    """Record which items are low at setup, so a restart re-announces nothing.

    Called once the repository is in the bucket. Without it the first mutation
    after every restart would diff against an empty set and fire `entered` for
    every item that was already low before the restart.
    """

    bucket = hass.data.get(DOMAIN)
    if bucket is None:
        return
    repo = bucket.get("repository")
    bucket[DATA_LOW_STOCK_SNAPSHOT] = repo.low_stock_item_ids if repo is not None else frozenset()


def notify_mutation(
    hass: HomeAssistant,
    *,
    action: str,
    item: dict[str, Any] | None = None,
) -> None:
    """Announce a mutation on the HA bus and repaint the sensors.

    Call it **after** the persist, on every path: the contract's "an event
    implies a durable write" rule holds on the bus as well as on the wire.

    ``item`` is the serialized item the mutation produced — for a delete, the
    body as it last stood. A bulk path that rewrote many items at once passes
    none, which still diffs the low-stock set and still repaints the sensors.

    Best-effort, like the WebSocket broadcasts: a mutation that is already
    written must not fail because something downstream of it did.
    """

    try:
        bucket = hass.data.get(DOMAIN)
        if bucket is None:
            # The entry tore down between the write and this call. Nothing to
            # notify and nothing to diff against.
            return

        if item is not None:
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

        _fire_low_stock_transitions(hass, bucket, item=item)

        async_dispatcher_send(hass, SIGNAL_COUNTS_UPDATED)
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to notify a mutation",
            extra={"domain": DOMAIN, "op": "notify_mutation", "action": action},
        )


def _fire_low_stock_transitions(
    hass: HomeAssistant, bucket: dict[str, Any], *, item: dict[str, Any] | None
) -> None:
    """Fire `entered` / `cleared` for the ids that crossed the threshold.

    A set diff rather than a per-handler check: one place then covers single
    mutations, `haventory/items/bulk` and import execute alike, and no handler
    needs a pre-mutation read of its own.
    """

    repo = bucket.get("repository")
    if repo is None:
        return

    previous: frozenset[str] = bucket.get(DATA_LOW_STOCK_SNAPSHOT) or frozenset()
    current = repo.low_stock_item_ids
    if current == previous:
        return
    bucket[DATA_LOW_STOCK_SNAPSHOT] = current

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
    bus = getattr(hass, "bus", None)
    fire = getattr(bus, "async_fire", None)
    if fire is None:
        return
    fire(event_type, payload)
