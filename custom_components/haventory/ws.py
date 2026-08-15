"""WebSocket command handlers for HAventory.

Implements CRUD and helper commands for items and locations.
Adheres to the envelope: input {id, type, ...payload}, output result_message/error_message.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from typing import Any, TypedDict, cast

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

try:
    from homeassistant.components.file_upload import process_uploaded_file
except ImportError:  # pragma: no cover - offline harness without the component
    process_uploaded_file = None

from . import import_export, todo_bridge
from . import media as media_mod
from . import storage as storage_mod
from .areas import async_get_area_registry
from .calendar_projection import next_occurrence_after
from .const import (
    ATTACHMENT_MANUAL_MIME_TYPES,
    ATTACHMENT_PICTURE_MIME_TYPES,
    DEFAULT_CARD_TITLE,
    DOMAIN,
    INTEGRATION_VERSION,
    MAX_ATTACHMENT_BYTES,
    MAX_MANUALS_PER_ITEM,
    MAX_PICTURES_PER_ITEM,
)
from .events import notify_mutation
from .exceptions import (
    ConflictError,
    NotFoundError,
    NotLoadedError,
    StorageError,
    ValidationError,
    error_code,
    log_exc_info,
    log_severity,
)
from .health import collect_health_issues
from .import_export import POLICIES, Policy
from .models import (
    ATTACHMENT_KINDS,
    AttachmentMeta,
    ItemUpdate,
    iso_utc_now,
    new_uuid4,
    normalize_tags,
    serialize_status_definition,
    today_utc_date,
    validate_attachment_meta,
    validate_item_filter,
    validate_sort,
)
from .rate_limit import RateLimiter
from .repository import UNSET, Repository
from .serialization import serialize_item, serialize_location
from .storage import CURRENT_SCHEMA_VERSION

LOGGER = logging.getLogger(__name__)


def _repo(hass: HomeAssistant) -> Repository:
    bucket = hass.data.get(DOMAIN) or {}
    repo = bucket.get("repository")
    if repo is None:
        raise NotLoadedError("repository not initialized; run integration setup")
    return cast("Repository", repo)


def _require_loaded(hass: HomeAssistant) -> None:
    """Refuse the command when no config entry owns the data.

    Home Assistant cannot unregister a WebSocket command, so these keep
    listening after the integration is unloaded, disabled or removed — and each
    of those empties the domain bucket for exactly this check to find. It sits in
    the guard rather than in the handlers so the whole surface goes quiet at
    once: the commands that read no inventory (ping, version, config) would
    otherwise keep answering for a backend that owns nothing.
    """

    _repo(hass)


def _rate_limiter(hass: HomeAssistant) -> RateLimiter | None:
    """Return the configured rate limiter, or None when limiting is off."""
    bucket = hass.data.get(DOMAIN) or {}
    limiter = bucket.get("rate_limiter")
    return limiter if isinstance(limiter, RateLimiter) else None


def _ctx(op: str, **extra: Any) -> dict[str, Any]:
    """Build a structured logging context for WS operations.

    Ensures the `op` field is always present and merges any additional fields.
    """
    base: dict[str, Any] = {"op": op}
    if extra:
        base.update(extra)
    return base


# Sent to clients when a non-domain exception escapes a handler. Deliberately
# generic: internal details (exception text, stack traces) stay in the server
# log and never reach the wire.
UNEXPECTED_ERROR_MESSAGE = "unexpected error; see Home Assistant logs"

# Sent to clients when a command exceeds the configured rate limit.
RATE_LIMITED_MESSAGE = "rate limit exceeded; retry later"


def _error_envelope(
    iden: int, code: str, message: str, context: dict[str, Any] | None
) -> dict[str, Any]:
    """Build the contract's error envelope (with ``data`` context) directly.

    Deliberately NOT ``websocket_api.error_message``: HA's helper has no
    data/context parameter (its 4th positional is ``translation_key``), so
    building the envelope ourselves keeps the structured ``data`` context
    identical on real Home Assistant and in the offline stub.
    """
    error: dict[str, Any] = {"code": code, "message": message}
    if context:
        error["data"] = context
    return {"id": iden, "type": "result", "success": False, "error": error}


def _error_message(_id: int, exc: Exception, *, context: dict[str, Any]) -> dict[str, Any]:
    code = error_code(exc)
    LOGGER.log(
        log_severity(code, exc),
        str(exc),
        extra={"domain": DOMAIN, **(context or {})},
        exc_info=log_exc_info(code, exc),
    )
    return _error_envelope(_id, code, str(exc), context or None)


# -----------------------------
# Unified exception handling for WS handlers
# -----------------------------

_WSHandler = Callable[
    [HomeAssistant, "websocket_api.ActiveConnection", dict[str, Any]], Awaitable[Any]
]


def _context_from_msg(op: str, msg: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for field in fields:
        if field not in msg:
            continue
        value = msg.get(field)
        key = field
        # Avoid reserved LogRecord key 'name' by using domain-specific names
        if field == "name":
            if op.startswith("item_"):
                key = "item_name"
            elif op.startswith("location_"):
                key = "location_name"
            else:
                key = "ctx_name"
        payload[key] = value
    return _ctx(op, **payload)


def ws_guard(
    op: str, context_fields: tuple[str, ...] = ()
) -> Callable[
    [
        _WSHandler,
    ],
    _WSHandler,
]:
    """Decorator to map known domain exceptions to unified WS errors.

    Builds a structured context from selected fields in the incoming message and
    returns a Home Assistant websocket error envelope with {code, message, context}.
    """

    def decorator(func: _WSHandler) -> _WSHandler:
        def _send_error(conn: websocket_api.ActiveConnection, err: dict[str, Any]) -> None:
            try:
                send = getattr(conn, "send_message", None)
                if callable(send):
                    send(err)
            except Exception:  # pragma: no cover - defensive logging only
                LOGGER.debug(
                    "Failed to send WS error message",
                    extra={
                        "domain": DOMAIN,
                        "op": op,
                        "handler": getattr(func, "__name__", "?"),
                    },
                    exc_info=True,
                )

        @functools.wraps(func)
        async def wrapper(
            hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
        ) -> Any:
            limiter = _rate_limiter(hass)
            if limiter is not None and not limiter.allow_command(conn):
                err = _error_envelope(
                    msg.get("id", 0), "rate_limited", RATE_LIMITED_MESSAGE, _ctx(op)
                )
                _send_error(conn, err)
                return err
            try:
                _require_loaded(hass)
                return await func(hass, conn, msg)
            except (ValidationError, NotFoundError, ConflictError, StorageError) as exc:
                ctx = _context_from_msg(op, msg, context_fields)
                # In real Home Assistant, handlers must send on the connection.
                # Returning a dict is only supported by our offline test stub.
                err = _error_message(msg.get("id", 0), exc, context=ctx)
                _send_error(conn, err)
                # Always return the envelope for offline tests and stubs
                return err
            except Exception:
                # Final safety net: any non-domain exception maps to the
                # contract's unknown_error with a generic message; the real
                # exception (with traceback) only goes to the server log.
                ctx = _context_from_msg(op, msg, context_fields)
                LOGGER.exception(
                    "Unexpected error in WS handler",
                    extra={"domain": DOMAIN, **ctx},
                )
                err = _error_envelope(
                    msg.get("id", 0), "unknown_error", UNEXPECTED_ERROR_MESSAGE, ctx
                )
                _send_error(conn, err)
                return err

        # Structural marker: tests assert every registered command is guarded.
        wrapper._haventory_ws_guard = True  # type: ignore[attr-defined]
        return wrapper

    return decorator


# -----------------------------
# Shared op helpers (single and bulk)
# -----------------------------


def _validate_bulk_ops(operations: Any) -> list[dict[str, Any]]:
    # The command schema types `operations` as `object` so a wrong type answers
    # `validation_error` here instead of an HA-core schema rejection that never
    # reaches `ws_guard` — which makes this check the only one there is.
    if not isinstance(operations, list):
        raise ValidationError("operations must be a list")
    validated: list[dict[str, Any]] = []
    seen_op_ids: set[str] = set()
    for _idx, op in enumerate(operations):
        if not isinstance(op, dict):
            raise ValidationError("each operation must be an object")
        if "op_id" not in op:
            raise ValidationError("operation missing op_id")
        op_id = op.get("op_id")
        if not isinstance(op_id, str | int):
            raise ValidationError("op_id must be a string or integer")
        # Results are keyed by op_id, so a repeat would leave the caller holding
        # one verdict for two operations with no way to tell which it belongs
        # to. Compared after `str()`, the same normalization the result map uses
        # — so `1` and `"1"` are one id, not two.
        normalized_op_id = str(op_id)
        if normalized_op_id in seen_op_ids:
            raise ValidationError(f"duplicate op_id in operations: {normalized_op_id}")
        seen_op_ids.add(normalized_op_id)
        kind = op.get("kind")
        # Do not reject unknown kinds at schema-level; allow mixed results.
        if not isinstance(kind, str):
            raise ValidationError("kind must be a string")
        payload = op.get("payload")
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            raise ValidationError("operation.payload must be an object")
        validated.append({"op_id": normalized_op_id, "kind": str(kind), "payload": payload})
    return validated


def _payload_item_id(payload: dict[str, Any]) -> str:
    """Extract a validated item_id from an (unschema'd) op payload."""
    value = payload.get("item_id")
    if not isinstance(value, str) or not value:
        raise ValidationError("item_id must be a non-empty string")
    return value


def _payload_int(payload: dict[str, Any], key: str) -> int:
    """Extract a required integer field from an (unschema'd) op payload."""
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{key} must be an integer")
    return value


def _op_item_update(hass: HomeAssistant, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    exclude_keys = {"item_id", "expected_version"}
    update = cast("ItemUpdate", {k: v for k, v in payload.items() if k not in exclude_keys})
    updated = repo.update_item(item_id, update, expected_version=expected)
    serialized = serialize_item(hass, updated)
    action = "moved" if "location_id" in update else "updated"
    return serialized, action


def _op_item_delete(hass: HomeAssistant, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    before = repo.get_item(item_id)
    serialized_before = serialize_item(hass, before)
    repo.delete_item(item_id, expected_version=expected)
    return serialized_before, "deleted"


def _op_item_move(hass: HomeAssistant, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    updated = repo.update_item(
        item_id, ItemUpdate(location_id=payload.get("location_id")), expected_version=expected
    )
    return serialize_item(hass, updated), "moved"


def _op_item_adjust_quantity(
    hass: HomeAssistant, payload: dict[str, Any]
) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.adjust_quantity(
        item_id, _payload_int(payload, "delta"), expected_version=payload.get("expected_version")
    )
    return serialize_item(hass, updated), "quantity_changed"


def _op_item_set_quantity(
    hass: HomeAssistant, payload: dict[str, Any]
) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    qty = _payload_int(payload, "quantity")
    updated = repo.set_quantity(item_id, qty, expected_version=payload.get("expected_version"))
    return serialize_item(hass, updated), "quantity_changed"


def _op_item_check_out(hass: HomeAssistant, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.check_out(
        item_id, due_date=payload.get("due_date"), expected_version=payload.get("expected_version")
    )
    return serialize_item(hass, updated), "checked_out"


def _op_item_check_in(hass: HomeAssistant, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    updated = repo.check_in(item_id, expected_version=payload.get("expected_version"))
    return serialize_item(hass, updated), "checked_in"


def _op_item_add_tags(hass: HomeAssistant, payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    tags = normalize_tags(payload.get("tags"))
    current = repo.get_item(item_id)
    new_tags = list(dict.fromkeys(list(current.tags) + list(tags)))
    updated = repo.update_item(item_id, ItemUpdate(tags=new_tags), expected_version=expected)
    return serialize_item(hass, updated), "updated"


def _op_item_remove_tags(
    hass: HomeAssistant, payload: dict[str, Any]
) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    to_remove = set(normalize_tags(payload.get("tags")))
    current = repo.get_item(item_id)
    new_tags = [t for t in list(current.tags) if t not in to_remove]
    updated = repo.update_item(item_id, ItemUpdate(tags=new_tags), expected_version=expected)
    return serialize_item(hass, updated), "updated"


def _op_item_update_custom_fields(
    hass: HomeAssistant, payload: dict[str, Any]
) -> tuple[dict[str, Any], str]:
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
    return serialize_item(hass, updated), "updated"


def _op_item_set_low_stock_threshold(
    hass: HomeAssistant, payload: dict[str, Any]
) -> tuple[dict[str, Any], str]:
    repo = _repo(hass)
    item_id = _payload_item_id(payload)
    expected = payload.get("expected_version")
    updated = repo.update_item(
        item_id,
        ItemUpdate(low_stock_threshold=payload.get("low_stock_threshold")),
        expected_version=expected,
    )
    return serialize_item(hass, updated), "updated"


def _execute_item_op(
    hass: HomeAssistant, kind: str, payload: dict[str, Any]
) -> tuple[dict[str, Any], str]:
    """Execute one item operation via a dispatch table."""

    dispatch = {
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
    }
    handler = dispatch.get(kind)
    if not handler:
        raise ValidationError("unknown operation kind")
    return handler(hass, payload)


# -----------------------------
# Subscriptions & Events
# -----------------------------


class _Subscription(TypedDict, total=False):
    topic: str
    location_id: str | None
    location_ids: list[str]
    area_id: str | None
    include_subtree: bool
    inspection_overdue_only: bool


def _subscription_location_ids(sub: _Subscription) -> list[str]:
    """The locations a subscription is scoped to, scalar and list unioned.

    The same union rule ``models.selected_location_ids`` applies to an
    ``ItemFilter``, kept here because a subscription is not one: it carries a
    payload matcher, not a query.
    """

    selection: list[str] = []
    scalar = sub.get("location_id")
    if scalar:
        selection.append(str(scalar).strip())
    for raw in sub.get("location_ids") or []:
        value = str(raw).strip()
        if value and value not in selection:
            selection.append(value)
    return [value for value in selection if value]


def _subs_bucket(
    hass: HomeAssistant,
) -> dict[websocket_api.ActiveConnection, dict[int, _Subscription]]:
    """Get or create the subscriptions bucket.

    Note: We use a regular dict (not WeakKeyDictionary) because HA's
    ActiveConnection doesn't support weak references. Cleanup is handled
    via the close callback registered in _register_close_listener.
    """
    bucket = hass.data.setdefault(DOMAIN, {})
    subs = bucket.get("subscriptions")
    if subs is None:
        subs = {}
        bucket["subscriptions"] = subs
    return cast("dict[websocket_api.ActiveConnection, dict[int, _Subscription]]", subs)


def _cleanup_subscriptions_for_conn(hass: HomeAssistant, conn: object) -> None:
    """Remove all subscriptions for a given connection."""

    subs_all = _subs_bucket(hass)
    subs_all.pop(cast("websocket_api.ActiveConnection", conn), None)


def _drop_subscription(hass: HomeAssistant, conn: object, sub_id: int) -> None:
    """Remove a single subscription from the per-connection bucket.

    Registered as the zero-arg teardown callback in HA's ``connection.subscriptions``
    registry (see ``_register_framework_unsub``). Safe to call repeatedly and after
    the connection bucket has already been cleaned up.
    """

    subs_all = _subs_bucket(hass)
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

    The ``getattr``/``isinstance`` probe mirrors ``_register_close_listener`` so the
    offline test stubs (which expose no ``subscriptions`` dict) are unaffected.
    """

    subscriptions = getattr(conn, "subscriptions", None)
    if isinstance(subscriptions, dict):
        subscriptions[sub_id] = functools.partial(_drop_subscription, hass, conn, sub_id)


def _unregister_framework_unsub(conn: websocket_api.ActiveConnection, sub_id: int) -> None:
    """Drop the HA-registry entry for a subscription torn down via our own command.

    Keeps ``haventory/unsubscribe`` and HA core's ``unsubscribe_events`` symmetric so
    a subscription removed through the dedicated command leaves no stale callback in
    ``connection.subscriptions``.
    """

    subscriptions = getattr(conn, "subscriptions", None)
    if isinstance(subscriptions, dict):
        subscriptions.pop(sub_id, None)


def _register_close_listener(hass: HomeAssistant, conn: websocket_api.ActiveConnection) -> None:
    """Attach cleanup to a connection close callback when available.

    On real Home Assistant, ``ActiveConnection`` exposes a ``subscriptions``
    dict whose values are invoked when the connection closes — registering
    there is what prevents disconnected clients from leaking subscription
    state. The ``on_close``/``add_close_callback`` probes support the offline
    test stubs.

    Idempotency is derived from the state itself, not stamped on the connection:
    real HA's ``ActiveConnection`` is ``__slots__``-based (no ``__dict__``), so a
    ``conn._haventory_close_registered = True`` marker raises ``AttributeError`` on
    every subscribe there — a benign-but-noisy exception the offline stubs never
    surface because they carry a ``__dict__``. Our ``"haventory/cleanup"`` key and
    the idempotent ``_cleanup_subscriptions_for_conn`` make repeat registration a
    harmless no-op, so no marker is needed.
    """

    subscriptions = getattr(conn, "subscriptions", None)
    if isinstance(subscriptions, dict):
        # Real-HA path. String key cannot collide with HA's integer subscription
        # ids; its presence is also the "already registered" marker.
        if "haventory/cleanup" not in subscriptions:
            subscriptions["haventory/cleanup"] = functools.partial(
                _cleanup_subscriptions_for_conn, hass, conn
            )
        return

    # Offline-stub path: connections expose on_close / add_close_callback instead of
    # a subscriptions dict. `_cleanup_subscriptions_for_conn` is idempotent, so even a
    # repeat registration here only ever removes the (already-removed) bucket.
    closer = getattr(conn, "on_close", None)
    if not callable(closer):
        closer = getattr(conn, "add_close_callback", None)
    if callable(closer):
        try:
            closer(lambda: _cleanup_subscriptions_for_conn(hass, conn))
        except Exception:  # pragma: no cover - defensive
            LOGGER.debug(
                "Failed to register WS close listener",
                extra={"domain": DOMAIN, "op": "subscribe_close_hook"},
                exc_info=True,
            )


def _now_ts() -> str:
    return datetime.now(UTC).isoformat()


def _send_event_message(
    conn: websocket_api.ActiveConnection, subscription_id: int, event_payload: dict[str, Any]
) -> None:
    try:
        msg = {"id": subscription_id, "type": "event", "event": event_payload}
        send = getattr(conn, "send_message", None)
        if callable(send):
            send(msg)
            return
        async_send = getattr(conn, "async_send_message", None)
        if callable(async_send):  # pragma: no cover - alternate interface
            # Fire and forget in tests; assume sync in stub
            async_send(msg)
    except Exception:  # pragma: no cover - defensive logging only
        LOGGER.debug(
            "Failed to send WS event message",
            extra={"domain": DOMAIN, "op": "send_event", "subscription_id": subscription_id},
            exc_info=True,
        )


def _payload_inspection_is_overdue(item: dict[str, Any]) -> bool:
    """Whether a serialized item is past its next-inspection date.

    The matcher is handed the event payload rather than the stored ``Item``, so
    it cannot call ``item_inspection_is_overdue`` — but it must agree with it,
    and with ``inspection_overdue_only`` on ``item/list``. Same comparison:
    YYYY-MM-DD text, strictly before today in UTC.
    """

    date = item.get("inspection_date")
    if not isinstance(date, str) or not date:
        return False
    return date < today_utc_date()


def _item_matches_filter(item: dict[str, Any], sub: _Subscription) -> bool:
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


def _location_matches_filter(location: dict[str, Any], sub: _Subscription) -> bool:
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
    for conn, subs in list(_subs_bucket(hass).items()):
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


def _broadcast_event(
    hass: HomeAssistant,
    *,
    topic: str,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
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

        limiter = _rate_limiter(hass)
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


# Action every open subscription receives when the config entry serving it goes
# away. A subscription is bound to a WebSocket connection, which outlives the
# entry, so without it nothing on the wire marks the end: no further event ever
# arrives and a client cannot tell that from an inventory nobody is editing.
BACKEND_UNAVAILABLE_ACTION = "unavailable"


def notify_backend_unavailable(hass: HomeAssistant) -> None:
    """Tell every open subscription that it has stopped delivering.

    Teardown calls this while the registry is still populated; the subscriptions
    themselves go with the rest of the runtime immediately after.

    Deliberately not routed through ``_broadcast_event``: this is a lifecycle
    signal rather than inventory traffic, so it ignores the rate limiter. A
    connection whose event budget happened to be spent would otherwise be the one
    client left believing its topics are still live.
    """

    for conn, subs in list(_subs_bucket(hass).items()):
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


def _broadcast_counts(hass: HomeAssistant) -> None:
    try:
        counts_payload = _repo(hass).get_counts()
    except Exception:  # pragma: no cover - defensive
        LOGGER.exception(
            "Failed to broadcast counts", extra={"domain": DOMAIN, "op": "broadcast_counts"}
        )
        return
    _broadcast_event(
        hass,
        topic="stats",
        action="counts",
        payload={"counts": counts_payload},
    )


async def _persist_repo(hass: HomeAssistant) -> None:
    """Write the repository to disk, propagating failure to the caller.

    Uses immediate persistence so storage errors reach clients: debounced
    persistence (``async_request_persist``) swallows errors in background tasks,
    breaking the ``@ws_guard`` error mapping contract.

    **Every mutation handler awaits this before it broadcasts or replies.** That
    ordering is the whole guarantee an event carries: a subscriber that receives
    ``items/created`` knows the write behind it succeeded. Broadcasting first
    would tell subscribers about a change the originating client is about to be
    told failed, and which a restart then erases. Bulk import
    (``ws_import_execute``) additionally rolls the dataset back, because a
    wholesale swap has more to undo than one entity does.
    """

    await storage_mod.async_persist_repo(hass)


# -----------------------------
# Utility commands
# -----------------------------


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/ping", vol.Optional("echo"): object}
)
@websocket_api.async_response
@ws_guard("ping", ())
async def ws_ping(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    result = {"echo": msg.get("echo"), "ts": _now_ts()}
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


def _schema_version_from_hass(hass: HomeAssistant) -> int:
    bucket = hass.data.get(DOMAIN) or {}
    ver = getattr(bucket.get("store"), "schema_version", None)
    return ver if isinstance(ver, int) else int(CURRENT_SCHEMA_VERSION)


@websocket_api.websocket_command({"type": "haventory/version"})
@websocket_api.async_response
@ws_guard("version", ())
async def ws_version(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    result = {
        "integration_version": INTEGRATION_VERSION,
        "schema_version": _schema_version_from_hass(hass),
    }
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


@websocket_api.websocket_command({"type": "haventory/config"})
@websocket_api.async_response
@ws_guard("config", ())
async def ws_config(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Return the settings the frontend renders, not the whole options set.

    Rate-limit tunables stay server-side. What is here is what the card cannot
    know on its own: the configured heading, which quick-filter pills to offer,
    the status vocabulary items are labelled with, and the attachment caps —
    reported so the picker can refuse an oversized file before it is sent, never
    so the backend can trust that it did.
    """
    bucket = hass.data.get(DOMAIN) or {}
    title = bucket.get("card_title")
    pills = bucket.get("quick_filters")
    result = {
        "card_title": title if isinstance(title, str) and title else DEFAULT_CARD_TITLE,
        # `null` is a value here, not an omission: it says the integration has
        # no opinion, which leaves a dashboard's own `quick_filters:` — and
        # then the card's every-pill default — to decide. An empty list is the
        # opposite, an explicit choice of no pills, so the two never collapse.
        "quick_filters": list(pills) if isinstance(pills, list) else None,
        "statuses": [serialize_status_definition(d) for d in _repo(hass).list_statuses()],
        # The route itself is not here: it is a constant on both sides, pinned
        # across the language boundary by tests/test_frontend_registration.py.
        # What the card cannot derive is the caps and the accepted types.
        "media": {
            "picture_mime_types": list(ATTACHMENT_PICTURE_MIME_TYPES),
            "max_pictures_per_item": MAX_PICTURES_PER_ITEM,
            "manual_mime_types": list(ATTACHMENT_MANUAL_MIME_TYPES),
            "max_manuals_per_item": MAX_MANUALS_PER_ITEM,
            "max_attachment_bytes": MAX_ATTACHMENT_BYTES,
        },
    }
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


@websocket_api.websocket_command({"type": "haventory/stats"})
@websocket_api.async_response
@ws_guard("stats", ())
async def ws_stats(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    counts = _repo(hass).get_counts()
    conn.send_message(websocket_api.result_message(msg.get("id", 0), counts))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/distinct_values", vol.Optional("filter"): object}
)
@websocket_api.async_response
@ws_guard("distinct_values", ())
async def ws_distinct_values(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    # With a filter, every value also reports how much of it the filter keeps, so
    # a sidebar can read "4 / 37" the way the location tree already does. The
    # list itself never shrinks — the same payload feeds autocomplete and the
    # organize dialog.
    item_filter = msg.get("filter")
    validate_item_filter(item_filter)
    result = _repo(hass).get_distinct_field_values(item_filter)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


@websocket_api.websocket_command({"type": "haventory/health"})
@websocket_api.async_response
@ws_guard("health", ())
async def ws_health(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    repo = _repo(hass)
    issues, counts = collect_health_issues(repo)
    healthy = len(issues) == 0
    limiter = _rate_limiter(hass)
    rate_limit = {
        "enabled": bool(limiter is not None and limiter.enabled),
        "dropped_commands": limiter.dropped_commands if limiter is not None else 0,
        "dropped_events": limiter.dropped_events if limiter is not None else 0,
    }
    result = {
        "healthy": healthy,
        "issues": issues,
        "counts": counts,
        "generation": repo.generation,
        "rate_limit": rate_limit,
    }
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


# -----------------------------
# Subscription commands
# -----------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/subscribe",
        vol.Required("topic"): str,
        vol.Optional("location_id"): object,
        # Multi-select beside the scalar, unioned with it. `object` throughout
        # for the reason below.
        vol.Optional("location_ids"): object,
        # `object` rather than `str`, matching `location_id`: an explicit null
        # clears the filter instead of being refused by HA core's schema.
        vol.Optional("area_id"): object,
        vol.Optional("include_subtree"): bool,
        vol.Optional("inspection_overdue_only"): bool,
    }
)
@websocket_api.async_response
@ws_guard("subscribe", ("topic",))
async def ws_subscribe(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    topic = msg.get("topic")
    if topic not in {"items", "locations", "stats", "statuses"}:
        raise ValidationError("topic must be one of: items, locations, stats, statuses")
    sub: _Subscription = {
        "topic": topic,
    }
    if "location_id" in msg:
        sub["location_id"] = msg.get("location_id")
    if "location_ids" in msg:
        raw_ids = msg.get("location_ids")
        if raw_ids is not None and not isinstance(raw_ids, list):
            raise ValidationError("location_ids must be a list of strings")
        sub["location_ids"] = [str(value) for value in raw_ids or []]
    if "area_id" in msg:
        sub["area_id"] = msg.get("area_id")
    if "include_subtree" in msg:
        sub["include_subtree"] = bool(msg.get("include_subtree"))
    if "inspection_overdue_only" in msg:
        sub["inspection_overdue_only"] = bool(msg.get("inspection_overdue_only"))
    sub_id = int(msg.get("id", 0))
    subs_all = _subs_bucket(hass)
    subs_for_conn = subs_all.setdefault(conn, {})
    subs_for_conn[sub_id] = sub
    _register_close_listener(hass, conn)
    # Let HA core's generic `unsubscribe_events` (the path the frontend uses) tear
    # this subscription down cleanly, instead of replying "Subscription not found".
    _register_framework_unsub(hass, conn, sub_id)
    LOGGER.debug(
        "Subscribed",
        extra={
            "domain": DOMAIN,
            "op": "subscribe",
            "subscription_id": msg.get("id", 0),
            "topic": topic,
        },
    )
    conn.send_message(websocket_api.result_message(msg.get("id", 0), None))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/unsubscribe", vol.Required("subscription"): object}
)
@websocket_api.async_response
@ws_guard("unsubscribe", ("subscription",))
async def ws_unsubscribe(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    sub_id_raw = msg.get("subscription")
    if isinstance(sub_id_raw, bool) or not isinstance(sub_id_raw, int | str):
        raise ValidationError("subscription must be an integer")
    try:
        sub_id = int(sub_id_raw)
    except ValueError:
        raise ValidationError("subscription must be an integer") from None
    subs_all = _subs_bucket(hass)
    removed = False
    subs_for_conn = subs_all.get(conn)
    if subs_for_conn:
        removed = subs_for_conn.pop(sub_id, None) is not None
        if not subs_for_conn:
            subs_all.pop(conn, None)
    # Keep HA's own subscription registry in sync with this explicit teardown.
    _unregister_framework_unsub(conn, sub_id)
    LOGGER.debug(
        "Unsubscribed",
        extra={
            "domain": DOMAIN,
            "op": "unsubscribe",
            "subscription_id": sub_id,
            "removed": bool(removed),
        },
    )
    conn.send_message(websocket_api.result_message(msg.get("id", 0), None))


# -----------------------------
# Items
# -----------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/create",
        # ItemCreate fields (name required; others optional)
        vol.Required("name"): object,
        vol.Optional("description"): object,
        vol.Optional("quantity"): object,
        # Widened to object so the model layer rejects bad values as a typed
        # validation_error instead of HA core logging a schema ERROR.
        vol.Optional("status"): object,
        vol.Optional("checked_out"): bool,
        vol.Optional("due_date"): vol.Any(str, None),
        vol.Optional("inspection_date"): vol.Any(str, None),
        vol.Optional("reminder_date"): vol.Any(str, None),
        vol.Optional("reminder_interval"): vol.Any(dict, None),
        vol.Optional("location_id"): object,
        vol.Optional("tags"): [str],
        vol.Optional("category"): object,
        vol.Optional("low_stock_threshold"): object,
        vol.Optional("custom_fields"): {str: object},
    }
)
@websocket_api.async_response
@ws_guard("item_create", ("name",))
async def ws_item_create(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    payload = {k: v for k, v in msg.items() if k not in {"id", "type"}}
    item = _repo(hass).create_item(payload)  # type: ignore[arg-type]
    serialized = serialize_item(hass, item)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="created", payload={"item": serialized})
    notify_mutation(hass, action="created", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/item/get", vol.Required("item_id"): object}
)
@websocket_api.async_response
@ws_guard("item_get", ("item_id",))
async def ws_item_get(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    item = _repo(hass).get_item(msg["item_id"])
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialize_item(hass, item)))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/update",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        # ItemUpdate fields (all optional)
        vol.Optional("name"): object,
        vol.Optional("description"): object,
        vol.Optional("quantity"): object,
        vol.Optional("status"): object,
        vol.Optional("checked_out"): bool,
        vol.Optional("due_date"): vol.Any(str, None),
        vol.Optional("inspection_date"): vol.Any(str, None),
        vol.Optional("reminder_date"): vol.Any(str, None),
        vol.Optional("reminder_interval"): vol.Any(dict, None),
        vol.Optional("location_id"): object,
        vol.Optional("tags"): object,
        vol.Optional("category"): object,
        vol.Optional("low_stock_threshold"): object,
        vol.Optional("custom_fields_set"): {str: object},
        vol.Optional("custom_fields_unset"): [str],
    }
)
@websocket_api.async_response
@ws_guard("item_update", ("item_id", "expected_version"))
async def ws_item_update(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    item_id = msg["item_id"]
    expected = msg.get("expected_version")
    update = cast(
        "ItemUpdate",
        {k: v for k, v in msg.items() if k not in {"id", "type", "item_id", "expected_version"}},
    )
    updated = _repo(hass).update_item(item_id, update, expected_version=expected)
    serialized = serialize_item(hass, updated)
    action = "moved" if "location_id" in update else "updated"
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    notify_mutation(hass, action=action, item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/delete",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_delete", ("item_id", "expected_version"))
async def ws_item_delete(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    item_id = msg["item_id"]
    repo = _repo(hass)
    before = repo.get_item(item_id)
    serialized_before = serialize_item(hass, before)
    repo.delete_item(item_id, expected_version=msg.get("expected_version"))
    await _persist_repo(hass)
    # After the save, for the same reason attachment/remove deletes last: an
    # orphaned file is swept at setup, while a file deleted ahead of a failed
    # save would leave stored metadata pointing at nothing.
    await media_mod.async_delete_attachments(
        hass, [(str(before.id), a) for a in before.attachments]
    )
    _broadcast_event(
        hass,
        topic="items",
        action="deleted",
        payload={"item": serialized_before},
    )
    notify_mutation(hass, action="deleted", item=serialized_before)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), None))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/adjust_quantity",
        vol.Required("item_id"): object,
        vol.Required("delta"): object,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_adjust_quantity", ("item_id", "delta", "expected_version"))
async def ws_item_adjust_quantity(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    # The schema types `delta` as `object`, so the integer check lives here and
    # answers `validation_error` rather than an HA-core schema rejection.
    item = _repo(hass).adjust_quantity(
        msg["item_id"], _payload_int(msg, "delta"), expected_version=msg.get("expected_version")
    )
    serialized = serialize_item(hass, item)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="quantity_changed", payload={"item": serialized})
    notify_mutation(hass, action="quantity_changed", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/set_quantity",
        vol.Required("item_id"): object,
        vol.Required("quantity"): object,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_set_quantity", ("item_id", "quantity", "expected_version"))
async def ws_item_set_quantity(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    # Validated here, not in the schema: `quantity` is typed `object` so a wrong
    # type answers `validation_error` instead of an HA-core schema rejection,
    # and validating upfront keeps the answer about the quantity even when the
    # item id is also bad.
    qty = _payload_int(msg, "quantity")
    if qty < 0:
        raise ValidationError("quantity must be an integer >= 0")
    item = _repo(hass).set_quantity(
        msg["item_id"], qty, expected_version=msg.get("expected_version")
    )
    serialized = serialize_item(hass, item)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="quantity_changed", payload={"item": serialized})
    notify_mutation(hass, action="quantity_changed", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/check_out",
        vol.Required("item_id"): object,
        vol.Optional("due_date"): vol.Any(str, None),
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_check_out", ("item_id", "due_date", "expected_version"))
async def ws_item_check_out(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    item = _repo(hass).check_out(
        msg["item_id"],
        due_date=msg.get("due_date"),
        expected_version=msg.get("expected_version"),
    )
    serialized = serialize_item(hass, item)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="checked_out", payload={"item": serialized})
    notify_mutation(hass, action="checked_out", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/check_in",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_check_in", ("item_id", "expected_version"))
async def ws_item_check_in(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    item = _repo(hass).check_in(msg["item_id"], expected_version=msg.get("expected_version"))
    serialized = serialize_item(hass, item)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="checked_in", payload={"item": serialized})
    notify_mutation(hass, action="checked_in", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


async def _apply_reminder(
    hass: HomeAssistant,
    conn: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    update: ItemUpdate,
) -> None:
    """Write a reminder change as the ordinary item edit it is.

    Setting a reminder bumps `version` and `updated_at` and answers the same
    `conflict` a name edit would: unlike the derived `location_path`, a reminder
    is something the household chose.
    """

    item = _repo(hass).update_item(
        msg["item_id"], update, expected_version=msg.get("expected_version")
    )
    serialized = serialize_item(hass, item)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="updated", payload={"item": serialized})
    notify_mutation(hass, action="updated", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/reminder/set",
        vol.Required("item_id"): object,
        vol.Required("reminder_date"): str,
        vol.Optional("reminder_interval"): vol.Any(dict, None),
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("reminder_set", ("item_id", "reminder_date", "expected_version"))
async def ws_reminder_set(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    # `reminder_interval` absent means "no recurrence", not "leave the stored
    # one": the command names the whole reminder, so an omitted interval is the
    # caller saying this is a one-off.
    update = cast(
        "ItemUpdate",
        {
            "reminder_date": msg["reminder_date"],
            "reminder_interval": msg.get("reminder_interval"),
        },
    )
    await _apply_reminder(hass, conn, msg, update)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/reminder/clear",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("reminder_clear", ("item_id", "expected_version"))
async def ws_reminder_clear(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    update = cast("ItemUpdate", {"reminder_date": None, "reminder_interval": None})
    await _apply_reminder(hass, conn, msg, update)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/reminder/bump",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("reminder_bump", ("item_id", "expected_version"))
async def ws_reminder_bump(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Move a reminder on to its next occurrence — "I have just done this".

    The whole series moves with the anchor, which is why bumping is one command
    rather than the client working out the next date and writing it back: two
    clients bumping the same reminder land on the same answer.

    Counted from the later of the anchor and today, so a reminder bumped on the
    day it came round advances by exactly one interval, and one nobody bumped
    for a year lands on its next *future* occurrence instead of another date
    already past. Today is the UTC one, the same day `overdue_only` and the two
    date-derived counts are measured against.
    """

    item = _repo(hass).get_item(msg["item_id"])
    if item.reminder_date is None:
        raise ValidationError("item has no reminder to bump")
    try:
        anchor = date.fromisoformat(item.reminder_date)
    except ValueError as exc:
        # Only a hand-edited store can hold one. Naming it beats the
        # `unknown_error` a raw parse failure would answer with.
        raise ValidationError(
            f"stored reminder_date {item.reminder_date!r} is not a date this build can read; "
            "set the reminder again to replace it"
        ) from exc
    following = next_occurrence_after(
        anchor, item.reminder_interval, max(anchor, date.fromisoformat(today_utc_date()))
    )
    if following is None:
        raise ValidationError(
            "a reminder with no interval has no next occurrence; clear it instead"
        )
    update = cast("ItemUpdate", {"reminder_date": following.isoformat()})
    await _apply_reminder(hass, conn, msg, update)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/add_tags",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("tags"): [str],
    }
)
@websocket_api.async_response
@ws_guard("item_add_tags", ("item_id", "expected_version"))
async def ws_item_add_tags(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    serialized, action = _execute_item_op(
        hass,
        "item_add_tags",
        {
            "item_id": msg["item_id"],
            "expected_version": msg.get("expected_version"),
            "tags": msg.get("tags"),
        },
    )
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    notify_mutation(hass, action=action, item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/remove_tags",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("tags"): [str],
    }
)
@websocket_api.async_response
@ws_guard("item_remove_tags", ("item_id", "expected_version"))
async def ws_item_remove_tags(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    serialized, action = _execute_item_op(
        hass,
        "item_remove_tags",
        {
            "item_id": msg["item_id"],
            "expected_version": msg.get("expected_version"),
            "tags": msg.get("tags"),
        },
    )
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    notify_mutation(hass, action=action, item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/update_custom_fields",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("set"): dict,
        vol.Optional("unset"): [str],
    }
)
@websocket_api.async_response
@ws_guard("item_update_custom_fields", ("item_id", "expected_version"))
async def ws_item_update_custom_fields(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    serialized, action = _execute_item_op(
        hass,
        "item_update_custom_fields",
        {
            "item_id": msg["item_id"],
            "expected_version": msg.get("expected_version"),
            "set": msg.get("set"),
            "unset": msg.get("unset"),
        },
    )
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    notify_mutation(hass, action=action, item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/set_low_stock_threshold",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("low_stock_threshold"): object,
    }
)
@websocket_api.async_response
@ws_guard("item_set_low_stock_threshold", ("item_id", "expected_version"))
async def ws_item_set_low_stock_threshold(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    serialized, action = _execute_item_op(
        hass,
        "item_set_low_stock_threshold",
        {
            "item_id": msg["item_id"],
            "expected_version": msg.get("expected_version"),
            "low_stock_threshold": msg.get("low_stock_threshold"),
        },
    )
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    notify_mutation(hass, action=action, item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/attachment/add",
        vol.Required("item_id"): object,
        # The handle core's `/api/file_upload` hands back after the POST.
        vol.Required("file_id"): str,
        vol.Optional("kind"): str,
        # What the user's file was called. Display only — the stored name is
        # derived from the attachment id and the sniffed type.
        vol.Optional("filename"): str,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_attachment_add", ("item_id", "kind", "expected_version"))
async def ws_item_attachment_add(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Consume an uploaded file and attach it to an item.

    The upload rides core's ``file_upload``, so the bytes never cross the
    WebSocket. Everything the client claimed about the file — its content type,
    its size — is re-derived here: the accepted type comes from sniffing the
    file's own leading bytes, and both caps are enforced regardless of whether
    the card checked them first.
    """

    if process_uploaded_file is None:  # pragma: no cover - real HA always has it
        raise StorageError("Home Assistant's file_upload component is unavailable")

    kind = msg.get("kind", "picture")
    if kind not in ATTACHMENT_KINDS:
        raise ValidationError(f"kind must be one of: {', '.join(ATTACHMENT_KINDS)}")

    repo = _repo(hass)
    item_id = msg["item_id"]
    expected = msg.get("expected_version")
    # Read the item — and its version — before the upload is consumed: the temp
    # file is destroyed either way, so failing after eating it would cost the
    # user the upload as well as the round trip.
    current = repo.get_item(item_id)
    if expected is not None and current.version != expected:
        raise ConflictError(f"version conflict: expected {expected}, actual {current.version}")

    attachment_id = new_uuid4()
    # `file_upload` hands back a synchronous context manager whose teardown
    # walks the upload's temp directory and deletes it, so both halves are
    # dispatched to the executor: run on the loop, that walk stalls every other
    # connection for as long as it takes — longest for the multi-megabyte photo
    # bursts this command exists to carry.
    upload_handle = process_uploaded_file(hass, msg["file_id"])
    try:
        # Only *this* call is guarded: a `ValueError` from anywhere else must not
        # be relabelled as a missing upload. `file_upload` raises it for an id it
        # does not know — an expired handle, or one an earlier call consumed.
        source = await hass.async_add_executor_job(upload_handle.__enter__)
    except ValueError as exc:
        raise NotFoundError("uploaded file not found; upload it again") from exc

    try:
        mime, size = await media_mod.async_consume_upload(
            hass,
            source=source,
            kind=kind,
            item_id=str(current.id),
            attachment_id=str(attachment_id),
        )
    finally:
        # The temp directory must not outlive the command on any path — accepted
        # bytes, refused ones, or a client that drops the connection mid-upload.
        # Shielded so a cancelled command still tears its upload down: nothing
        # else collects these files.
        await asyncio.shield(hass.async_add_executor_job(upload_handle.__exit__, None, None, None))

    meta = AttachmentMeta(
        id=attachment_id,
        kind=kind,
        filename=str(msg.get("filename") or f"{attachment_id}"),
        mime=mime,
        size=size,
        uploaded_at=iso_utc_now(),
    )
    updated = repo.add_attachment(
        item_id,
        meta,
        max_per_kind=media_mod.max_per_item(kind),
        expected_version=expected,
    )
    serialized = serialize_item(hass, updated)
    # A failed persist leaves the file on disk with no saved metadata; setup's
    # orphan sweep is what collects it, so there is nothing to undo here beyond
    # letting the error through the way every other mutation does.
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="updated", payload={"item": serialized})
    notify_mutation(hass, action="updated", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/attachment/remove",
        vol.Required("item_id"): object,
        vol.Required("attachment_id"): object,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_attachment_remove", ("item_id", "attachment_id", "expected_version"))
async def ws_item_attachment_remove(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Detach one file from an item and delete its bytes."""

    repo = _repo(hass)
    item_id = msg["item_id"]
    updated, removed = repo.remove_attachment(
        item_id,
        str(msg["attachment_id"]),
        expected_version=msg.get("expected_version"),
    )
    serialized = serialize_item(hass, updated)
    # Persist before unlinking: a failed save with the file still there leaves
    # an orphan the sweep collects, while the reverse order would leave stored
    # metadata pointing at bytes that are already gone.
    await _persist_repo(hass)
    await media_mod.async_delete_attachments(hass, [(str(updated.id), removed)])
    _broadcast_event(hass, topic="items", action="updated", payload={"item": serialized})
    notify_mutation(hass, action="updated", item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/attachment/update",
        vol.Required("item_id"): object,
        vol.Required("attachment_id"): object,
        vol.Required("title"): str,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_attachment_update", ("item_id", "attachment_id", "expected_version"))
async def ws_item_attachment_update(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Retitle one attachment. The file on disk is untouched."""

    repo = _repo(hass)
    updated = repo.update_attachment(
        msg["item_id"],
        str(msg["attachment_id"]),
        title=msg["title"],
        expected_version=msg.get("expected_version"),
    )
    serialized = serialize_item(hass, updated)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="updated", payload={"item": serialized})
    notify_mutation(hass, action="updated", item=serialized)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/attachment/reorder",
        vol.Required("item_id"): object,
        vol.Required("kind"): str,
        vol.Required("attachment_ids"): [str],
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_attachment_reorder", ("item_id", "kind", "expected_version"))
async def ws_item_attachment_reorder(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Renumber one kind's attachments; the first named becomes position 0.

    A picture at position 0 is the item's cover, so "make cover" is this command
    rather than a flag of its own.
    """

    repo = _repo(hass)
    updated = repo.reorder_attachments(
        msg["item_id"],
        msg["kind"],
        list(msg["attachment_ids"]),
        expected_version=msg.get("expected_version"),
    )
    serialized = serialize_item(hass, updated)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action="updated", payload={"item": serialized})
    notify_mutation(hass, action="updated", item=serialized)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/move",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("location_id"): object,
    }
)
@websocket_api.async_response
@ws_guard("item_move", ("item_id", "location_id", "expected_version"))
async def ws_item_move(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    serialized, action = _execute_item_op(
        hass,
        "item_move",
        {
            "item_id": msg["item_id"],
            "expected_version": msg.get("expected_version"),
            "location_id": msg.get("location_id"),
        },
    )
    await _persist_repo(hass)
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    notify_mutation(hass, action=action, item=serialized)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/items/bulk", vol.Required("operations"): object}
)
@websocket_api.async_response
@ws_guard("items_bulk", ())
async def ws_items_bulk(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    operations = _validate_bulk_ops(msg.get("operations"))
    results: dict[str, dict[str, object]] = {}

    # Capture initial state for logging
    repo = _repo(hass)
    initial_generation = repo.generation
    successful_ops: list[tuple[str, dict[str, Any], str]] = []  # (op_id, serialized, action)

    for op in operations:
        op_id = op["op_id"]
        kind = op["kind"]
        payload = op["payload"]
        try:
            serialized, action = _execute_item_op(hass, kind, payload)
            results[op_id] = {"success": True, "result": serialized}
            successful_ops.append((op_id, serialized, action))
        except (ValidationError, NotFoundError, ConflictError, StorageError) as exc:
            # Log error with full context for debugging
            ctx = {
                "op_id": op_id,
                "kind": kind,
                "error": str(exc),
            }
            for k in (
                "item_id",
                "expected_version",
                "location_id",
                "due_date",
                "quantity",
                "delta",
                "low_stock_threshold",
                "tags",
                "set",
                "unset",
            ):
                if k in payload:
                    ctx[k] = payload.get(k)

            # One rejected op is classified on its own code, not on the batch:
            # a stale version inside a bulk is no more of a fault than it is
            # on its own.
            code = error_code(exc)
            LOGGER.log(
                log_severity(code, exc),
                "Bulk operation failed, continuing with remaining ops",
                extra={
                    "domain": DOMAIN,
                    "op": "items_bulk_op_failed",
                    **ctx,
                },
                exc_info=log_exc_info(code, exc),
            )

            results[op_id] = {
                "success": False,
                "error": {"code": code, "message": str(exc), "context": ctx},
            }
        except Exception:
            # A malformed payload must fail only its own op, never the batch,
            # and internal details stay out of the client-visible message.
            LOGGER.exception(
                "Bulk operation failed unexpectedly, continuing with remaining ops",
                extra={
                    "domain": DOMAIN,
                    "op": "items_bulk_op_failed",
                    "op_id": op_id,
                    "kind": kind,
                },
            )
            results[op_id] = {
                "success": False,
                "error": {
                    "code": "unknown_error",
                    "message": UNEXPECTED_ERROR_MESSAGE,
                    "context": {"op_id": op_id, "kind": kind},
                },
            }

    # Only a batch that changed something writes or announces anything. An
    # all-failed batch deliberately logs no summary of its own: each op already
    # logged its op_id and reason above, which is what an operator acts on, and a
    # line repeating "none of them worked" only doubles the log on the worst path.
    if successful_ops:
        # Persist immediately so storage errors surface through @ws_guard, and
        # before anything else so neither the summary nor an event describes a
        # batch that never reached disk. The whole batch shares this one write.
        await _persist_repo(hass)

        LOGGER.info(
            "Bulk operation completed",
            extra={
                "domain": DOMAIN,
                "op": "items_bulk",
                "total_ops": len(operations),
                "successful": len(successful_ops),
                "failed": len(operations) - len(successful_ops),
                "initial_generation": initial_generation,
                "final_generation": repo.generation,
            },
        )

        for _op_id, serialized, action in successful_ops:
            _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
            notify_mutation(hass, action=action, item=serialized)

        _broadcast_counts(hass)

    conn.send_message(websocket_api.result_message(msg.get("id", 0), {"results": results}))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/list",
        vol.Optional("filter"): object,
        vol.Optional("sort"): object,
        vol.Optional("limit"): object,
        vol.Optional("cursor"): object,
    }
)
@websocket_api.async_response
@ws_guard("item_list", ())
async def ws_item_list(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    flt = msg.get("filter")
    sort = msg.get("sort")
    limit = msg.get("limit")
    cursor = msg.get("cursor")
    validate_item_filter(flt)
    validate_sort(sort)
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int)):
        raise ValidationError("limit must be an integer")
    if cursor is not None and (not isinstance(cursor, str) or not cursor):
        # An empty cursor is a client bug rather than "start from the
        # beginning" — omitting the key is how a caller asks for page one.
        raise ValidationError("cursor must be a non-empty string")
    page = _repo(hass).list_items(flt=flt, sort=sort, limit=limit, cursor=cursor)
    result = {
        "items": [serialize_item(hass, it) for it in page["items"]],
        "next_cursor": page.get("next_cursor"),
        "total": page["total"],
    }
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


# -----------------------------
# Locations
# -----------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/location/create",
        vol.Required("name"): object,
        vol.Optional("parent_id"): object,
        vol.Optional("area_id"): object,
    }
)
@websocket_api.async_response
@ws_guard("location_create", ("name", "parent_id"))
async def ws_location_create(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    # Validate area_id against HA area registry when provided
    area_id = msg.get("area_id") if "area_id" in msg else None
    if area_id is not None:
        reg = await async_get_area_registry(hass)
        if reg.async_get_area(area_id) is None:
            raise ValidationError("unknown area_id")
    loc = _repo(hass).create_location(
        name=msg["name"], parent_id=msg.get("parent_id"), area_id=area_id
    )
    serialized = serialize_location(loc)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="locations", action="created", payload={"location": serialized})
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/location/get", vol.Required("location_id"): object}
)
@websocket_api.async_response
@ws_guard("location_get", ("location_id",))
async def ws_location_get(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    loc = _repo(hass).get_location(msg["location_id"])
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialize_location(loc)))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/location/update",
        vol.Required("location_id"): object,
        vol.Optional("new_parent_id"): object,
        vol.Optional("name"): object,
        vol.Optional("area_id"): object,
    }
)
@websocket_api.async_response
@ws_guard("location_update", ("location_id", "new_parent_id", "name"))
async def ws_location_update(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    new_parent = msg["new_parent_id"] if "new_parent_id" in msg else UNSET
    area_id = msg["area_id"] if "area_id" in msg else UNSET
    if area_id is not UNSET and area_id is not None:
        reg = await async_get_area_registry(hass)
        if reg.async_get_area(area_id) is None:
            raise ValidationError("unknown area_id")
    repo = _repo(hass)
    before = repo.get_location(msg["location_id"])
    location_key = str(before.id)
    # The area a location sits in is resolved through its tree, not read off the
    # row: a tree's area lives on its root, so an area set on a nested location
    # moves the root's `area_id` and leaves the edited row's at None. Comparing
    # the resolved value catches both, and it is the value the items under the
    # location report as `effective_area_id`.
    was_anchored_at = (before.parent_id, repo.effective_area_id(location_key))
    was_named = before.name
    loc = repo.update_location(
        msg["location_id"], name=msg.get("name"), new_parent_id=new_parent, area_id=area_id
    )
    serialized = serialize_location(loc)
    await _persist_repo(hass)
    # One event per call, decided by what changed rather than by which keys the
    # request carried: an editor that sends every field on every save would
    # otherwise announce a move on a plain rename, and one carrying both a new
    # parent and a new area would announce two.
    #
    # An area reassignment is a move: it re-anchors the whole subtree, so every
    # item under it gets a new effective_area_id, which is exactly what a client
    # filtered by area re-lists on. No item events accompany it — the items
    # themselves did not change.
    is_anchored_at = (loc.parent_id, repo.effective_area_id(location_key))
    if is_anchored_at != was_anchored_at:
        _broadcast_event(hass, topic="locations", action="moved", payload={"location": serialized})
    elif loc.name != was_named:
        _broadcast_event(
            hass, topic="locations", action="renamed", payload={"location": serialized}
        )
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/location/delete", vol.Required("location_id"): object}
)
@websocket_api.async_response
@ws_guard("location_delete", ("location_id",))
async def ws_location_delete(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    loc_id = msg["location_id"]
    repo = _repo(hass)
    before = repo.get_location(loc_id)
    serialized_before = serialize_location(before)
    repo.delete_location(loc_id)
    await _persist_repo(hass)
    _broadcast_event(
        hass,
        topic="locations",
        action="deleted",
        payload={"location": serialized_before},
    )
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), None))


@websocket_api.websocket_command({"type": "haventory/location/list"})
@websocket_api.async_response
@ws_guard("location_list", ())
async def ws_location_list(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    repo = _repo(hass)
    # Return flat list
    data = [
        serialize_location(repo.get_location(loc_id))
        for loc_id in repo._debug_get_internal_indexes()["locations_by_id"]
    ]
    conn.send_message(websocket_api.result_message(msg.get("id", 0), data))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/location/tree", vol.Optional("filter"): object}
)
@websocket_api.async_response
@ws_guard("location_tree", ())
async def ws_location_tree(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    # Build a naive tree from repo children mapping
    repo = _repo(hass)
    indexes = repo._debug_get_internal_indexes()
    locs_by_id = indexes["locations_by_id"]
    children_by_parent = repo._children_ids_by_parent_id

    # With a filter, every node also reports how much of it the filter keeps, so
    # a sidebar can read "4 / 37" instead of a total that never moves. Counted
    # once here and rolled up, rather than one query per location.
    item_filter = msg.get("filter")
    validate_item_filter(item_filter)
    matching_direct = (
        repo.count_matching_by_location(item_filter) if item_filter is not None else None
    )

    def build_node(loc_id: str) -> dict[str, Any]:
        loc = locs_by_id[loc_id]
        counts = repo.get_location_item_counts(loc_id)
        children = [build_node(cid) for cid in sorted(children_by_parent.get(loc_id, set()))]
        node = {
            "id": str(loc.id),
            "name": loc.name,
            "parent_id": str(loc.parent_id) if loc.parent_id is not None else None,
            "area_id": str(loc.area_id) if loc.area_id is not None else None,
            "path": {
                "id_path": [str(x) for x in loc.path.id_path],
                "name_path": loc.path.name_path,
                "display_path": loc.path.display_path,
                "sort_key": loc.path.sort_key,
            },
            "direct_item_count": counts["direct"],
            "subtree_item_count": counts["subtree"],
            "children": children,
        }
        if matching_direct is not None:
            direct = matching_direct.get(loc_id, 0)
            node["matching_direct_count"] = direct
            node["matching_subtree_count"] = direct + sum(
                int(c["matching_subtree_count"]) for c in children
            )
        return node

    roots = sorted(children_by_parent.get(None, set()))
    tree = [build_node(r) for r in roots]
    conn.send_message(websocket_api.result_message(msg.get("id", 0), tree))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/location/move_subtree",
        vol.Required("location_id"): object,
        vol.Optional("new_parent_id"): object,
    }
)
@websocket_api.async_response
@ws_guard("location_move_subtree", ("location_id", "new_parent_id"))
async def ws_location_move_subtree(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    new_parent = msg.get("new_parent_id") if "new_parent_id" in msg else UNSET
    loc = _repo(hass).update_location(msg["location_id"], new_parent_id=new_parent)
    serialized = serialize_location(loc)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="locations", action="moved", payload={"location": serialized})
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command({"type": "haventory/status/list"})
@websocket_api.async_response
@ws_guard("status_list", ())
async def ws_status_list(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """The status vocabulary in display order."""

    data = [serialize_status_definition(d) for d in _repo(hass).list_statuses()]
    conn.send_message(websocket_api.result_message(msg.get("id", 0), data))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/status/create",
        vol.Required("slug"): str,
        vol.Required("label"): str,
        vol.Optional("color"): str,
        vol.Optional("icon"): str,
        vol.Optional("order"): int,
    }
)
@websocket_api.async_response
@ws_guard("status_create", ("slug",))
async def ws_status_create(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Define a new status."""

    repo = _repo(hass)
    doc: dict[str, Any] = {
        k: msg[k] for k in ("slug", "label", "color", "icon", "order") if k in msg
    }
    created = repo.create_status(doc)
    serialized = serialize_status_definition(created)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="statuses", action="created", payload={"status": serialized})
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/status/update",
        vol.Required("slug"): str,
        vol.Optional("label"): str,
        vol.Optional("color"): str,
        vol.Optional("icon"): str,
        vol.Optional("order"): int,
    }
)
@websocket_api.async_response
@ws_guard("status_update", ("slug",))
async def ws_status_update(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Edit a status's presentation.

    No item is touched and no item version moves: the slug is the identity, and
    a label or colour is presentation — the same reasoning that keeps a location
    rename out of an item's version.
    """

    repo = _repo(hass)
    changes: dict[str, Any] = {k: msg[k] for k in ("label", "color", "icon", "order") if k in msg}
    updated = repo.update_status(msg["slug"], changes)
    serialized = serialize_status_definition(updated)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="statuses", action="updated", payload={"status": serialized})
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/status/reorder",
        vol.Required("slugs"): [str],
    }
)
@websocket_api.async_response
@ws_guard("status_reorder", ())
async def ws_status_reorder(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Rewrite display order from a full permutation of the live slugs."""

    repo = _repo(hass)
    ordered = repo.reorder_statuses(list(msg["slugs"]))
    serialized = [serialize_status_definition(d) for d in ordered]
    await _persist_repo(hass)
    _broadcast_event(hass, topic="statuses", action="reordered", payload={"statuses": serialized})
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/status/delete",
        vol.Required("slug"): str,
        vol.Optional("reassign_to"): str,
    }
)
@websocket_api.async_response
@ws_guard("status_delete", ("slug", "reassign_to"))
async def ws_status_delete(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Remove a status, optionally moving the items that carry it.

    Refuses while items still reference the slug and no target is given. With a
    target the items move first, in the same call, so no client can observe a
    state where an item names a status that no longer exists.
    """

    repo = _repo(hass)
    removed, reassigned = repo.delete_status(msg["slug"], reassign_to=msg.get("reassign_to"))
    serialized = serialize_status_definition(removed)
    await _persist_repo(hass)
    _broadcast_event(hass, topic="statuses", action="deleted", payload={"status": serialized})
    if reassigned:
        # Two topics on purpose: one card is showing the vocabulary, another is
        # showing the items that just moved underneath it.
        _broadcast_event(hass, topic="items", action="updated", payload=None)
        _broadcast_counts(hass)
    conn.send_message(
        websocket_api.result_message(
            msg.get("id", 0), {"status": serialized, "reassigned": reassigned}
        )
    )


@websocket_api.websocket_command({"type": "haventory/areas/list"})
@websocket_api.async_response
@ws_guard("areas_list", ())
async def ws_areas_list(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    reg = await async_get_area_registry(hass)
    entries = reg.async_list_areas()
    areas = [{"id": a.id, "name": a.name} for a in entries]
    conn.send_message(websocket_api.result_message(msg.get("id", 0), {"areas": areas}))


# -----------------------------
# Import / Export (data safety)
# -----------------------------


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/export", vol.Optional("filter"): object}
)
@websocket_api.async_response
@ws_guard("export", ())
async def ws_export(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    item_filter = msg.get("filter") if "filter" in msg else None
    validate_item_filter(item_filter)
    document = import_export.build_export_document(
        _repo(hass),
        item_filter=item_filter,
        schema_version=_schema_version_from_hass(hass),
    )
    conn.send_message(websocket_api.result_message(msg.get("id", 0), document))


async def _count_missing_attachments(hass: HomeAssistant, target: dict[str, Any]) -> dict[str, int]:
    """How many attachment references the planned dataset has no file for.

    A JSON export carries metadata and not bytes, so importing one onto a fresh
    install leaves references pointing at nothing. That is a caveat rather than
    an error — the card renders a "file missing" state — so preview reports the
    number instead of refusing the document.
    """

    pairs = import_export.referenced_attachments(target)
    if not pairs:
        return {"referenced": 0, "missing": 0}

    root = media_mod.media_root(hass)

    def _count() -> int:
        missing = 0
        for item_id, entry in pairs:
            try:
                meta = validate_attachment_meta(entry)
                path = media_mod.attachment_path(root, item_id, str(meta.id), meta.mime)
            except ValidationError:  # pragma: no cover - planning validated these
                missing += 1
                continue
            if not path.is_file():
                missing += 1
        return missing

    return {"referenced": len(pairs), "missing": await hass.async_add_executor_job(_count)}


def _import_policy(msg: dict[str, Any]) -> Policy:
    policy = msg.get("policy", "merge")
    if policy not in POLICIES:
        raise ValidationError(f"policy must be one of: {', '.join(POLICIES)}")
    return cast("Policy", policy)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/import/preview",
        vol.Required("document"): dict,
        vol.Optional("policy"): str,
    }
)
@websocket_api.async_response
@ws_guard("import_preview", ())
async def ws_import_preview(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    policy = _import_policy(msg)
    report, target = import_export.plan_import(
        _repo(hass),
        msg.get("document"),
        policy=policy,
        current_schema_version=_schema_version_from_hass(hass),
    )
    if target is not None:
        report["attachments"] = await _count_missing_attachments(hass, target)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), report))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/import/execute",
        vol.Required("document"): dict,
        vol.Optional("policy"): str,
    }
)
@websocket_api.async_response
@ws_guard("import_execute", ())
async def ws_import_execute(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    policy = _import_policy(msg)
    repo = _repo(hass)
    report, target = import_export.plan_import(
        repo,
        msg.get("document"),
        policy=policy,
        current_schema_version=_schema_version_from_hass(hass),
    )
    if not report.get("valid") or target is None:
        # Invalid document: surface structured errors without mutating state.
        err = _error_envelope(
            msg.get("id", 0),
            "validation_error",
            "import document is invalid",
            {"op": "import_execute", "errors": report.get("errors", [])},
        )
        LOGGER.warning(
            "Import rejected: invalid document",
            extra={
                "domain": DOMAIN,
                "op": "import_execute",
                "error_count": len(report.get("errors", [])),
            },
        )
        conn.send_message(err)
        return

    # Snapshot for rollback, then swap the whole dataset atomically.
    snapshot = repo.export_state()
    repo.load_state(target)
    try:
        await _persist_repo(hass)
    except Exception:
        # A failed persist must never leave partial in-memory state.
        repo.load_state(snapshot)
        LOGGER.error(
            "Import failed during persist; rolled back",
            extra={"domain": DOMAIN, "op": "import_execute"},
            exc_info=True,
        )
        raise

    # `replace` overwrites an item's attachment list wholesale, so an entry the
    # incoming document does not carry has just lost its only reference — and
    # that metadata was the only record of where the file is. Sweeping against
    # the new metadata deletes exactly those, and costs a directory walk that
    # finds nothing at all on an install with no attachments.
    await media_mod.async_sweep_orphans(hass, repo.iter_attachments())

    # Tell every subscriber the dataset was replaced wholesale.
    _broadcast_event(hass, topic="items", action="reloaded", payload=None)
    _broadcast_event(hass, topic="locations", action="reloaded", payload=None)
    _broadcast_counts(hass)
    # No per-item bus event — an import rewrites the dataset and an automation
    # wants one signal, not one per row. The low-stock diff still runs, so a
    # restock done by import announces itself, and the sensors still repaint.
    notify_mutation(hass, action="reloaded")
    # And the shopping list explicitly, because that diff is the only bus signal
    # a wholesale swap produces: a document that renames items or changes their
    # quantities without moving the low-stock set fires nothing at all.
    await todo_bridge.async_reconcile(hass)

    summary = {
        "applied": True,
        "policy": policy,
        "items": report["counts"]["items"],
        "locations": report["counts"]["locations"],
        "totals": repo.get_counts(),
    }
    LOGGER.info(
        "Import applied",
        extra={
            "domain": DOMAIN,
            "op": "import_execute",
            "policy": policy,
            "items_total": summary["items"]["total"],
            "locations_total": summary["locations"]["total"],
        },
    )
    conn.send_message(websocket_api.result_message(msg.get("id", 0), summary))


# -----------------------------
# Registration
# -----------------------------


def setup(hass: HomeAssistant) -> None:
    # Idempotent: avoid duplicate registration across reloads
    bucket = hass.data.setdefault(DOMAIN, {})
    if bucket.get("ws_registered"):
        return

    handlers = [
        ws_ping,
        ws_version,
        ws_config,
        ws_stats,
        ws_distinct_values,
        ws_health,
        ws_subscribe,
        ws_unsubscribe,
        ws_item_create,
        ws_item_get,
        ws_item_update,
        ws_item_delete,
        ws_item_adjust_quantity,
        ws_item_set_quantity,
        ws_item_check_out,
        ws_item_check_in,
        ws_reminder_set,
        ws_reminder_clear,
        ws_reminder_bump,
        ws_item_add_tags,
        ws_item_remove_tags,
        ws_item_update_custom_fields,
        ws_item_set_low_stock_threshold,
        ws_item_attachment_add,
        ws_item_attachment_remove,
        ws_item_attachment_update,
        ws_item_attachment_reorder,
        ws_item_move,
        ws_items_bulk,
        ws_item_list,
        ws_location_create,
        ws_location_get,
        ws_location_update,
        ws_location_delete,
        ws_location_list,
        ws_location_tree,
        ws_location_move_subtree,
        ws_status_list,
        ws_status_create,
        ws_status_update,
        ws_status_reorder,
        ws_status_delete,
        ws_areas_list,
        ws_export,
        ws_import_preview,
        ws_import_execute,
    ]

    for h in handlers:
        websocket_api.async_register_command(hass, h)

    # Track our handlers for test stubs cleanup during unload
    bucket["ws_handlers"] = handlers
    bucket["ws_registered"] = True
