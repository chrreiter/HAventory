"""The subscription registry and the fan-out that writes events onto the wire.

`haventory/subscribe` records a topic and its filters against the connection
that asked; every announcement is matched against those filters here. The
registry is a field of the runtime, so it goes when the config entry does.

A mutation announces through `events.py`, never through this module directly:
that door also fires the bus event and repaints the entities.

Delivery is best-effort: a broadcast runs after the mutation is persisted, so a
failure on one connection must not reach the client whose command succeeded,
nor stop the fan-out reaching the others.
"""

from __future__ import annotations

import functools
from datetime import UTC, datetime
from typing import Any, cast

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .logs import context_logger
from .models import today_local_date
from .runtime import Subscription, find_runtime, loaded_runtime

LOGGER = context_logger(__name__)


def open_subscriptions(
    hass: HomeAssistant,
) -> dict[websocket_api.ActiveConnection, dict[int, Subscription]]:
    """The open subscriptions, or an empty map when no runtime holds any.

    Not a WeakKeyDictionary: HA's `ActiveConnection` cannot be weakly
    referenced. Resolved without the loaded check, because a connection's close
    callback can fire long after the entry went and must not raise.
    """

    runtime = find_runtime(hass)
    if runtime is None:
        return {}
    return cast(
        "dict[websocket_api.ActiveConnection, dict[int, Subscription]]", runtime.subscriptions
    )


def register_subscription(
    hass: HomeAssistant,
    conn: websocket_api.ActiveConnection,
    sub_id: int,
    sub: Subscription,
) -> None:
    """Record one open subscription and arm both teardown paths for it."""

    open_subscriptions(hass).setdefault(conn, {})[sub_id] = sub
    _register_close_listener(hass, conn)
    # HA core's `unsubscribe_events`, which the frontend's `subscribeMessage`
    # tears down through, pops and calls this entry; without it every teardown
    # answers `not_found`.
    conn.subscriptions[sub_id] = functools.partial(_drop_subscription, hass, conn, sub_id)


def unregister_subscription(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, sub_id: int
) -> bool:
    """Drop one subscription on the client's request; True when it was open."""

    removed = sub_id in open_subscriptions(hass).get(conn, {})
    _drop_subscription(hass, conn, sub_id)
    # Keep HA's own registry in step with this teardown.
    conn.subscriptions.pop(sub_id, None)
    return removed


def _cleanup_subscriptions_for_conn(hass: HomeAssistant, conn: object) -> None:
    open_subscriptions(hass).pop(cast("websocket_api.ActiveConnection", conn), None)


def _drop_subscription(hass: HomeAssistant, conn: object, sub_id: int) -> None:
    """Remove one subscription; safe to call repeatedly and after cleanup."""

    subs_all = open_subscriptions(hass)
    subs_for_conn = subs_all.get(cast("websocket_api.ActiveConnection", conn))
    if subs_for_conn is None:
        return
    subs_for_conn.pop(sub_id, None)
    if not subs_for_conn:
        subs_all.pop(cast("websocket_api.ActiveConnection", conn), None)


def _register_close_listener(hass: HomeAssistant, conn: websocket_api.ActiveConnection) -> None:
    """Have the connection drop its subscriptions when it closes.

    HA calls every ``conn.subscriptions`` value on disconnect. The string key is
    the idempotency marker: it cannot collide with HA's integer ids, and the
    slotted ``ActiveConnection`` refuses an attribute set on it.
    """

    if "haventory/cleanup" not in conn.subscriptions:
        conn.subscriptions["haventory/cleanup"] = functools.partial(
            _cleanup_subscriptions_for_conn, hass, conn
        )


def _subscription_location_ids(sub: Subscription) -> list[str]:
    """The locations a subscription is scoped to, scalar and list unioned.

    The rule ``models.selected_location_ids`` applies to an ``ItemFilter``. The
    list arrives validated; the scalar is whatever the client sent.
    """

    selection: list[str] = []
    scalar = sub.get("location_id")
    if scalar:
        selection.append(str(scalar).strip())
    for value in sub.get("location_ids") or []:
        if value and value not in selection:
            selection.append(value)
    return [value for value in selection if value]


def _payload_inspection_is_overdue(item: dict[str, Any]) -> bool:
    """Whether a serialized item is past its next-inspection date.

    Must agree with ``item_inspection_is_overdue``: YYYY-MM-DD text, strictly
    before the instance's local day.
    """

    date = item.get("inspection_date")
    if not isinstance(date, str) or not date:
        return False
    return date < today_local_date()


def _item_matches_filter(item: dict[str, Any], sub: Subscription) -> bool:
    if sub.get("inspection_overdue_only") and not _payload_inspection_is_overdue(item):
        return False
    # Read off the payload, which `serialize_item` has already resolved; an item
    # with no location carries `None` and matches no area filter.
    area_filter = sub.get("area_id")
    if area_filter and item.get("effective_area_id") != area_filter:
        return False
    loc_filters = _subscription_location_ids(sub)
    if not loc_filters:
        return True
    if sub.get("include_subtree", True):
        path = item.get("location_path", {}).get("id_path", [])
        return any(loc in path for loc in loc_filters)
    return item.get("location_id") in loc_filters


def _location_matches_filter(location: dict[str, Any], sub: Subscription) -> bool:
    loc_filters = _subscription_location_ids(sub)
    if not loc_filters:
        return True
    if sub.get("include_subtree", True):
        path = location.get("path", {}).get("id_path", [])
        return any(loc in path or location.get("id") == loc for loc in loc_filters)
    return location.get("id") in loc_filters


def _collect_event_deliveries(
    hass: HomeAssistant, topic: str, payload: dict[str, Any] | None
) -> list[tuple[websocket_api.ActiveConnection, list[int]]]:
    """The (connection, subscription ids) pairs an event reaches, from a snapshot."""

    item_obj = (payload or {}).get("item")
    location_obj = (payload or {}).get("location")

    deliveries: list[tuple[websocket_api.ActiveConnection, list[int]]] = []
    for conn, subs in list(open_subscriptions(hass).items()):
        sub_ids: list[int] = []
        for sub_id, sub in list(subs.items()):
            if sub.get("topic") != topic:
                continue
            if (
                topic == "items"
                and item_obj is not None
                and not _item_matches_filter(item_obj, sub)
            ):
                continue
            if (
                topic == "locations"
                and location_obj is not None
                and not _location_matches_filter(location_obj, sub)
            ):
                continue
            sub_ids.append(sub_id)
        if sub_ids:
            deliveries.append((conn, sub_ids))
    return deliveries


def _now_ts() -> str:
    return datetime.now(UTC).isoformat()


def _send_event_message(
    conn: websocket_api.ActiveConnection, subscription_id: int, event_payload: dict[str, Any]
) -> None:
    # One dead connection must not stop the fan-out reaching the others.
    try:
        conn.send_message({"id": subscription_id, "type": "event", "event": event_payload})
    except Exception:  # pragma: no cover - defensive logging only
        LOGGER.debug(
            "Failed to send WS event message",
            extra={"domain": DOMAIN, "op": "send_event", "subscription_id": subscription_id},
            exc_info=True,
        )


def broadcast_event(
    hass: HomeAssistant,
    *,
    topic: str,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Deliver one event to every subscription that asked for it. Call via `events.py`."""

    # A broadcast failure must never turn the persisted command into an error.
    try:
        event: dict[str, Any] = {
            "domain": DOMAIN,
            "topic": topic,
            "action": action,
            "ts": _now_ts(),
        }
        if payload:
            event.update(payload)
        for conn, sub_ids in _collect_event_deliveries(hass, topic, payload):
            for sub_id in sub_ids:
                _send_event_message(conn, sub_id, event)
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to broadcast WS event",
            extra={"domain": DOMAIN, "op": "broadcast_event", "topic": topic, "action": action},
        )


def broadcast_counts(hass: HomeAssistant) -> None:
    """Send the whole counts object on the `stats` topic."""

    try:
        counts_payload = loaded_runtime(hass).repository.get_counts()
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to broadcast counts", extra={"domain": DOMAIN, "op": "broadcast_counts"}
        )
        return
    broadcast_event(hass, topic="stats", action="counts", payload={"counts": counts_payload})


# Sent to every open subscription when the entry serving it goes away: the
# connection outlives the entry, and a client cannot otherwise tell a dead
# backend from an inventory nobody is editing.
BACKEND_UNAVAILABLE_ACTION = "unavailable"


def notify_backend_unavailable(hass: HomeAssistant) -> None:
    """Tell every open subscription that it has stopped delivering.

    Called from teardown while the registry is still populated. Not a mutation,
    so it bypasses `events.py`: nothing changed and nothing repaints.
    """

    for conn, subs in list(open_subscriptions(hass).items()):
        for sub_id, sub in list(subs.items()):
            _send_event_message(
                conn,
                sub_id,
                {
                    "domain": DOMAIN,
                    "topic": sub.get("topic"),
                    "action": BACKEND_UNAVAILABLE_ACTION,
                    "ts": _now_ts(),
                },
            )
