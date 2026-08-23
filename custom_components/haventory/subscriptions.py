"""The subscription registry and the fan-out that writes events onto the wire.

`haventory/subscribe` records a topic and its filters against the connection
that asked; every announcement is matched against those filters here and written
to the connections that want it. The registry itself is a field of the runtime,
so it goes when the config entry does.

This module is the wire, not the announcement. `events.py` holds the doors a
mutation calls — one per topic — and imports this at module scope; nothing here
imports `events.py` or `ws.py` back. A handler that broadcast from here directly
would reach subscribers without firing the bus event and repainting the entities
beside them, which is the split `events.py` exists to prevent.

Delivery is best-effort by contract: a broadcast runs after the mutation is
persisted, so a failure on one connection must not reach the client whose
command succeeded, nor stop the fan-out reaching the others.
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


# -----------------------------
# The registry
# -----------------------------


def open_subscriptions(
    hass: HomeAssistant,
) -> dict[websocket_api.ActiveConnection, dict[int, Subscription]]:
    """The open subscriptions, or an empty map when no runtime holds any.

    A regular dict rather than a WeakKeyDictionary, because HA's
    `ActiveConnection` does not support weak references; cleanup is the close
    callback registered in `_register_close_listener`. That callback fires when
    the *connection* closes, which can be long after the entry went — so this
    resolves without the loaded check and answers `{}` rather than raising out
    of a close callback.
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
    _register_framework_unsub(hass, conn, sub_id)


def unregister_subscription(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, sub_id: int
) -> bool:
    """Drop one subscription on the client's request; True when it was open."""

    subs_all = open_subscriptions(hass)
    removed = False
    subs_for_conn = subs_all.get(conn)
    if subs_for_conn:
        removed = subs_for_conn.pop(sub_id, None) is not None
        if not subs_for_conn:
            subs_all.pop(conn, None)
    # Keep HA's own subscription registry in sync with this explicit teardown.
    _unregister_framework_unsub(conn, sub_id)
    return removed


def _cleanup_subscriptions_for_conn(hass: HomeAssistant, conn: object) -> None:
    """Remove all subscriptions for a given connection."""

    subs_all = open_subscriptions(hass)
    subs_all.pop(cast("websocket_api.ActiveConnection", conn), None)


def _drop_subscription(hass: HomeAssistant, conn: object, sub_id: int) -> None:
    """Remove a single subscription from the per-connection bucket.

    Registered as the zero-arg teardown callback in HA's ``connection.subscriptions``
    registry (see ``_register_framework_unsub``). Safe to call repeatedly and after
    the connection bucket has already been cleaned up.
    """

    subs_all = open_subscriptions(hass)
    subs_for_conn = subs_all.get(cast("websocket_api.ActiveConnection", conn))
    if subs_for_conn is None:
        return
    subs_for_conn.pop(sub_id, None)
    if not subs_for_conn:
        subs_all.pop(cast("websocket_api.ActiveConnection", conn), None)


def _register_framework_unsub(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, sub_id: int
) -> None:
    """Register the subscription teardown in HA's own subscription registry.

    ``ActiveConnection.subscriptions`` maps a message id to a zero-arg unsubscribe
    callback, and HA core's generic ``unsubscribe_events`` command pops-and-calls
    it. The frontend's ``subscribeMessage`` lifecycle tears down via exactly that
    command, so without an entry here HA core replies ``not_found``
    ("Subscription not found.") on every teardown — surfacing as an unhandled
    rejection in the card. Registering the id makes the standard lifecycle work.
    """

    conn.subscriptions[sub_id] = functools.partial(_drop_subscription, hass, conn, sub_id)


def _unregister_framework_unsub(conn: websocket_api.ActiveConnection, sub_id: int) -> None:
    """Drop the HA-registry entry for a subscription torn down via our own command.

    Keeps ``haventory/unsubscribe`` and HA core's ``unsubscribe_events`` symmetric so
    a subscription removed through the dedicated command leaves no stale callback in
    ``connection.subscriptions``.
    """

    conn.subscriptions.pop(sub_id, None)


def _register_close_listener(hass: HomeAssistant, conn: websocket_api.ActiveConnection) -> None:
    """Have the connection drop its subscriptions when it closes.

    ``ActiveConnection.subscriptions`` holds zero-arg callbacks Home Assistant
    invokes on disconnect, so registering there is what keeps a client that
    vanishes from leaking subscription state.

    Idempotency is derived from the state itself, not stamped on the connection:
    real HA's ``ActiveConnection`` is ``__slots__``-based (no ``__dict__``), so a
    ``conn._haventory_close_registered = True`` marker would raise
    ``AttributeError`` on every subscribe. The ``"haventory/cleanup"`` key — a
    string, which cannot collide with HA's integer subscription ids — is the
    marker instead, and ``_cleanup_subscriptions_for_conn`` is idempotent.
    """

    if "haventory/cleanup" not in conn.subscriptions:
        conn.subscriptions["haventory/cleanup"] = functools.partial(
            _cleanup_subscriptions_for_conn, hass, conn
        )


# -----------------------------
# Matching
# -----------------------------


def _subscription_location_ids(sub: Subscription) -> list[str]:
    """The locations a subscription is scoped to, scalar and list unioned.

    The same union rule ``models.selected_location_ids`` applies to an
    ``ItemFilter``, kept here because a subscription is not one: it carries a
    payload matcher, not a query. The list arrives already trimmed and typed —
    ``haventory/subscribe`` refuses an entry that is not a string — while the
    scalar beside it is whatever the client sent.
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

    The matcher is handed the event payload rather than the stored ``Item``, so
    it cannot call ``item_inspection_is_overdue`` — but it must agree with it,
    and with ``inspection_overdue_only`` on ``item/list``. Same comparison and
    the same clock: YYYY-MM-DD text, strictly before the instance's local day.
    """

    date = item.get("inspection_date")
    if not isinstance(date, str) or not date:
        return False
    return date < today_local_date()


def _item_matches_filter(item: dict[str, Any], sub: Subscription) -> bool:
    if sub.get("inspection_overdue_only") and not _payload_inspection_is_overdue(item):
        return False
    # Read the area off the payload rather than resolving it from the repository:
    # the matcher runs once per subscription per event, and `serialize_item` has
    # already walked the location ancestry to compute the same value. An item with
    # no location carries `effective_area_id: None`, which matches no area filter.
    area_filter = sub.get("area_id")
    if area_filter and item.get("effective_area_id") != area_filter:
        return False
    loc_filters = _subscription_location_ids(sub)
    if not loc_filters:
        return True
    include_subtree = bool(sub.get("include_subtree", True))
    if include_subtree:
        # Match if any selected id is anywhere in the id_path
        path = item.get("location_path", {}).get("id_path", [])
        return any(loc in path for loc in loc_filters)
    # Direct-only
    return item.get("location_id") in loc_filters


def _location_matches_filter(location: dict[str, Any], sub: Subscription) -> bool:
    loc_filters = _subscription_location_ids(sub)
    if not loc_filters:
        return True
    include_subtree = bool(sub.get("include_subtree", True))
    if include_subtree:
        # If subtree, match if this location is a selected one or under one
        path = location.get("path", {}).get("id_path", [])
        return any(loc in path or location.get("id") == loc for loc in loc_filters)
    # Direct-only: only the exact locations
    return location.get("id") in loc_filters


def _collect_event_deliveries(
    hass: HomeAssistant, topic: str, payload: dict[str, Any] | None
) -> list[tuple[websocket_api.ActiveConnection, list[int]]]:
    """Return (connection, subscription ids) pairs the event would reach.

    Snapshots the subscription registry to avoid mutation issues.
    """
    item_obj = (payload or {}).get("item") if payload else None
    location_obj = (payload or {}).get("location") if payload else None

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


# -----------------------------
# The fan-out
# -----------------------------


def _now_ts() -> str:
    return datetime.now(UTC).isoformat()


def _send_event_message(
    conn: websocket_api.ActiveConnection, subscription_id: int, event_payload: dict[str, Any]
) -> None:
    # One dead connection must not stop the fan-out reaching the others, so the
    # failure is logged here rather than raised into the broadcast loop.
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
    """Deliver one event to every subscription that asked for it.

    Called from `events.py`, which announces the same mutation on the bus and to
    the entities in the same breath, so no write path can reach one surface and
    miss the others.
    """

    # Broadcasts are best-effort: they run after a mutation has been applied and
    # persisted, so a broadcast failure must never turn the originating command
    # into an error.
    try:
        event: dict[str, Any] = {
            "domain": DOMAIN,
            "topic": topic,
            "action": action,
            "ts": _now_ts(),
        }
        if payload:
            event.update(payload)

        # Collect matching deliveries first so budgets are only consumed for
        # events somebody would actually receive.
        deliveries = _collect_event_deliveries(hass, topic, payload)
        if not deliveries:
            return

        # The limiter is resolved without the loaded check: a broadcast can run
        # during teardown, while the entry is no longer `LOADED`.
        runtime = find_runtime(hass)
        limiter = runtime.rate_limiter if runtime is not None else None
        if limiter is not None and not limiter.allow_event_broadcast():
            # Global event budget exhausted: drop this event entirely.
            return

        for conn, sub_ids in deliveries:
            # One event delivered to a connection consumes one token,
            # regardless of how many of its subscriptions match.
            if limiter is not None and not limiter.allow_event_send(conn):
                continue
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
    broadcast_event(
        hass,
        topic="stats",
        action="counts",
        payload={"counts": counts_payload},
    )


# Action every open subscription receives when the config entry serving it goes
# away. A subscription is bound to a WebSocket connection, which outlives the
# entry, so without it nothing on the wire marks the end: no further event ever
# arrives and a client cannot tell that from an inventory nobody is editing.
BACKEND_UNAVAILABLE_ACTION = "unavailable"


def notify_backend_unavailable(hass: HomeAssistant) -> None:
    """Tell every open subscription that it has stopped delivering.

    Teardown calls this while the registry is still populated; the subscriptions
    themselves go with the rest of the runtime immediately after.

    The one announcement that is not a mutation, so it is written here rather
    than through a door in `events.py`: nothing changed, no entity repaints, and
    it ignores the rate limiter. A connection whose event budget happened to be
    spent would otherwise be the one client left believing its topics are still
    live.
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
