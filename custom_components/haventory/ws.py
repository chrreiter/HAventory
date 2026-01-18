"""WebSocket command handlers for HAventory.

Implements CRUD and helper commands for items and locations.
Adheres to the envelope: input {id, type, ...payload}, output result_message/error_message.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, TypedDict

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import storage as storage_mod
from .areas import async_get_area_registry
from .const import DOMAIN, INTEGRATION_VERSION
from .exceptions import ConflictError, NotFoundError, StorageError, ValidationError
from .models import ItemUpdate, normalize_tags
from .repository import UNSET, Repository
from .storage import CURRENT_SCHEMA_VERSION

LOGGER = logging.getLogger(__name__)


def _repo(hass: HomeAssistant) -> Repository:
    bucket = hass.data.get(DOMAIN) or {}
    repo = bucket.get("repository")
    if repo is None:
        raise StorageError("repository not initialized; run integration setup")
    return repo  # type: ignore[return-value]


def _error_code(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return "validation_error"
    if isinstance(exc, NotFoundError):
        return "not_found"
    if isinstance(exc, ConflictError):
        return "conflict"
    if isinstance(exc, StorageError):
        return "storage_error"
    return "unknown_error"


def _ctx(op: str, **extra: Any) -> dict[str, Any]:
    """Build a structured logging context for WS operations.

    Ensures the `op` field is always present and merges any additional fields.
    """
    base: dict[str, Any] = {"op": op}
    if extra:
        base.update(extra)
    return base


def _error_message(hass: HomeAssistant, _id: int, exc: Exception, *, context: dict[str, Any]):
    level = logging.WARNING
    if isinstance(exc, ConflictError | StorageError):
        level = logging.ERROR
    LOGGER.log(level, str(exc), extra={"domain": DOMAIN, **(context or {})}, exc_info=True)
    return websocket_api.error_message(_id, _error_code(exc), str(exc), context or None)


# -----------------------------
# Unified exception handling for WS handlers
# -----------------------------

_WSHandler = Callable[[HomeAssistant, Any, dict], Awaitable[Any]]


def _context_from_msg(op: str, msg: dict, fields: tuple[str, ...]) -> dict[str, Any]:
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
        async def wrapper(hass: HomeAssistant, conn, msg):  # type: ignore[override]
            try:
                return await func(hass, conn, msg)
            except (ValidationError, NotFoundError, ConflictError, StorageError) as exc:
                ctx = _context_from_msg(op, msg, context_fields)
                # In real Home Assistant, handlers must send on the connection.
                # Returning a dict is only supported by our offline test stub.
                err = _error_message(hass, msg.get("id", 0), exc, context=ctx)
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
                # Always return the envelope for offline tests and stubs
                return err

        return wrapper

    return decorator


# -----------------------------
# Shared op helpers (single and bulk)
# -----------------------------


_SUPPORTED_BULK_KINDS: set[str] = {
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


def _validate_bulk_ops(operations: Any) -> list[dict]:
    if not isinstance(operations, list):
        raise ValidationError("operations must be a list")
    validated: list[dict] = []
    for _idx, op in enumerate(operations):
        if not isinstance(op, dict):
            raise ValidationError("each operation must be an object")
        if "op_id" not in op:
            raise ValidationError("operation missing op_id")
        op_id = op.get("op_id")
        if not isinstance(op_id, str | int):
            raise ValidationError("op_id must be a string or integer")
        kind = op.get("kind")
        # Do not reject unknown kinds at schema-level; allow mixed results.
        if not isinstance(kind, str):
            raise ValidationError("kind must be a string")
        payload = op.get("payload")
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            raise ValidationError("operation.payload must be an object")
        validated.append({"op_id": str(op_id), "kind": str(kind), "payload": payload})
    return validated


def _op_item_update(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    expected = payload.get("expected_version")
    exclude_keys = {"item_id", "expected_version"}
    update: ItemUpdate = {k: v for k, v in payload.items() if k not in exclude_keys}
    updated = repo.update_item(item_id, update, expected_version=expected)
    serialized = _serialize_item(hass, updated)
    action = "moved" if "location_id" in update else "updated"
    return serialized, action


def _op_item_delete(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    expected = payload.get("expected_version")
    before = repo.get_item(item_id)
    serialized_before = _serialize_item(hass, before)
    repo.delete_item(item_id, expected_version=expected)
    return serialized_before, "deleted"


def _op_item_move(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    expected = payload.get("expected_version")
    updated = repo.update_item(
        item_id, ItemUpdate(location_id=payload.get("location_id")), expected_version=expected
    )
    return _serialize_item(hass, updated), "moved"


def _op_item_adjust_quantity(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    updated = repo.adjust_quantity(
        item_id, payload.get("delta"), expected_version=payload.get("expected_version")
    )
    return _serialize_item(hass, updated), "quantity_changed"


def _op_item_set_quantity(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    qty = payload.get("quantity")
    updated = repo.set_quantity(item_id, qty, expected_version=payload.get("expected_version"))
    return _serialize_item(hass, updated), "quantity_changed"


def _op_item_check_out(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    updated = repo.check_out(
        item_id, due_date=payload.get("due_date"), expected_version=payload.get("expected_version")
    )
    return _serialize_item(hass, updated), "checked_out"


def _op_item_check_in(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    updated = repo.check_in(item_id, expected_version=payload.get("expected_version"))
    return _serialize_item(hass, updated), "checked_in"


def _op_item_add_tags(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    expected = payload.get("expected_version")
    tags = normalize_tags(payload.get("tags"))
    current = repo.get_item(item_id)
    new_tags = list(dict.fromkeys(list(current.tags) + list(tags)))
    updated = repo.update_item(item_id, ItemUpdate(tags=new_tags), expected_version=expected)
    return _serialize_item(hass, updated), "updated"


def _op_item_remove_tags(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    expected = payload.get("expected_version")
    to_remove = set(normalize_tags(payload.get("tags")))
    current = repo.get_item(item_id)
    new_tags = [t for t in list(current.tags) if t not in to_remove]
    updated = repo.update_item(item_id, ItemUpdate(tags=new_tags), expected_version=expected)
    return _serialize_item(hass, updated), "updated"


def _op_item_update_custom_fields(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    expected = payload.get("expected_version")
    update: ItemUpdate = {}
    if "set" in payload and payload.get("set") is not None:
        update["custom_fields_set"] = dict(payload.get("set"))
    if "unset" in payload and payload.get("unset") is not None:
        update["custom_fields_unset"] = list(payload.get("unset"))
    updated = repo.update_item(item_id, update, expected_version=expected)
    return _serialize_item(hass, updated), "updated"


def _op_item_set_low_stock_threshold(hass: HomeAssistant, payload: dict) -> tuple[dict, str]:
    repo = _repo(hass)
    item_id = payload.get("item_id")
    expected = payload.get("expected_version")
    updated = repo.update_item(
        item_id,
        ItemUpdate(low_stock_threshold=payload.get("low_stock_threshold")),
        expected_version=expected,
    )
    return _serialize_item(hass, updated), "updated"


def _execute_item_op(hass: HomeAssistant, kind: str, payload: dict) -> tuple[dict, str]:
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
    include_subtree: bool


def _subs_bucket(hass: HomeAssistant) -> dict[object, dict[int, _Subscription]]:
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
    return subs


def _cleanup_subscriptions_for_conn(hass: HomeAssistant, conn: object) -> None:
    """Remove all subscriptions for a given connection."""

    subs_all = _subs_bucket(hass)
    subs_all.pop(conn, None)


def _register_close_listener(hass: HomeAssistant, conn: object) -> None:
    """Attach cleanup to a connection close callback when available."""

    if getattr(conn, "_haventory_close_registered", False):
        return

    closer = getattr(conn, "on_close", None)
    if not callable(closer):
        closer = getattr(conn, "add_close_callback", None)
    if callable(closer):
        try:
            closer(lambda: _cleanup_subscriptions_for_conn(hass, conn))
            conn._haventory_close_registered = True
        except Exception:  # pragma: no cover - defensive
            LOGGER.debug(
                "Failed to register WS close listener",
                extra={"domain": DOMAIN, "op": "subscribe_close_hook"},
                exc_info=True,
            )


def _now_ts() -> str:
    return datetime.now(UTC).isoformat()


def _send_event_message(conn, subscription_id: int, event_payload: dict[str, Any]) -> None:
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


def _item_matches_filter(item: dict[str, Any], sub: _Subscription) -> bool:
    loc_filter = sub.get("location_id")
    if not loc_filter:
        return True
    include_subtree = bool(sub.get("include_subtree", True))
    if include_subtree:
        # Match if the filter id is anywhere in the id_path
        path = item.get("location_path", {}).get("id_path", [])
        return loc_filter in path
    # Direct-only
    return item.get("location_id") == loc_filter


def _location_matches_filter(location: dict[str, Any], sub: _Subscription) -> bool:
    loc_filter = sub.get("location_id")
    if not loc_filter:
        return True
    include_subtree = bool(sub.get("include_subtree", True))
    if include_subtree:
        # If subtree, match if this location is the filter or under it
        path = location.get("path", {}).get("id_path", [])
        return loc_filter in path or location.get("id") == loc_filter
    # Direct-only: only the exact location
    return location.get("id") == loc_filter


def _broadcast_event(
    hass: HomeAssistant,
    *,
    topic: str,
    action: str,
    payload: dict[str, Any] | None = None,
) -> None:
    event: dict[str, Any] = {
        "domain": DOMAIN,
        "topic": topic,
        "action": action,
        "ts": _now_ts(),
    }
    if payload:
        event.update(payload)

    subs_all = _subs_bucket(hass)
    # Iterate over a snapshot to avoid mutation issues
    for conn, subs in list(subs_all.items()):
        for sub_id, sub in list(subs.items()):
            if sub.get("topic") != topic:
                continue
            item_obj = (payload or {}).get("item") if payload else None
            location_obj = (payload or {}).get("location") if payload else None
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
            _send_event_message(conn, sub_id, event)


def _broadcast_counts(hass: HomeAssistant) -> None:
    counts_payload = _repo(hass).get_counts()
    _broadcast_event(
        hass,
        topic="stats",
        action="counts",
        payload={"counts": counts_payload},
    )


async def _persist_repo(hass: HomeAssistant) -> None:
    # Use immediate persistence to ensure storage errors propagate to clients.
    # Debounced persistence (async_request_persist) swallows errors in background
    # tasks, breaking the @ws_guard error mapping contract.
    await storage_mod.async_persist_repo(hass)


# -----------------------------
# Utility commands
# -----------------------------


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/ping", vol.Optional("echo"): object}
)
@websocket_api.async_response
async def ws_ping(hass: HomeAssistant, conn, msg):
    result = {"echo": msg.get("echo"), "ts": _now_ts()}
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


def _schema_version_from_hass(hass: HomeAssistant) -> int:
    bucket = hass.data.get(DOMAIN) or {}
    ver = getattr(bucket.get("store"), "schema_version", None)
    return ver if isinstance(ver, int) else int(CURRENT_SCHEMA_VERSION)


@websocket_api.websocket_command({"type": "haventory/version"})
@websocket_api.async_response
async def ws_version(hass: HomeAssistant, conn, msg):
    result = {
        "integration_version": INTEGRATION_VERSION,
        "schema_version": _schema_version_from_hass(hass),
    }
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


@websocket_api.websocket_command({"type": "haventory/stats"})
@websocket_api.async_response
async def ws_stats(hass: HomeAssistant, conn, msg):
    counts = _repo(hass).get_counts()
    conn.send_message(websocket_api.result_message(msg.get("id", 0), counts))


def _health_indexes(repo: Repository) -> dict[str, object]:
    idx = repo._debug_get_internal_indexes()  # type: ignore[attr-defined]
    return idx


def _collect_item_issues(item_id: str, item, idx: dict) -> list[str]:  # noqa: PLR0912
    issues: list[str] = []
    items_by_location_id = idx["items_by_location_id"]  # type: ignore[index]
    locations_by_id = idx["locations_by_id"]  # type: ignore[index]
    created_at_bucket = idx["created_at_bucket"]  # type: ignore[index]
    updated_at_bucket = idx["updated_at_bucket"]  # type: ignore[index]
    checked_out_item_ids = idx["checked_out_item_ids"]  # type: ignore[index]
    low_stock_item_ids = idx["low_stock_item_ids"]  # type: ignore[index]

    # Normalize types for comparison (UUID vs string)
    if str(getattr(item, "id", "")) != item_id:
        issues.append("item_id_key_mismatch")

    loc_id = getattr(item, "location_id", None)
    loc_key = str(loc_id) if loc_id is not None else None
    if loc_key is not None and loc_key not in locations_by_id:
        issues.append("item_references_missing_location")

    if loc_key is not None:
        bucket_ids = items_by_location_id.get(loc_key, set())
        if item_id not in bucket_ids:
            issues.append("item_missing_from_items_by_location_index")

    created_key = getattr(item, "created_at", None)
    updated_key = getattr(item, "updated_at", None)
    if created_key not in created_at_bucket or item_id not in created_at_bucket.get(
        created_key, set()
    ):
        issues.append("item_missing_from_created_at_bucket")
    if updated_key not in updated_at_bucket or item_id not in updated_at_bucket.get(
        updated_key, set()
    ):
        issues.append("item_missing_from_updated_at_bucket")

    if bool(getattr(item, "checked_out", False)):
        if item_id not in checked_out_item_ids:
            issues.append("checked_out_item_missing_from_index")
    elif item_id in checked_out_item_ids:
        issues.append("non_checked_out_item_present_in_index")

    thr = getattr(item, "low_stock_threshold", None)
    is_low = False
    try:
        is_low = thr is not None and int(getattr(item, "quantity", 0)) <= int(thr)
    except (TypeError, ValueError):  # pragma: no cover - defensive
        is_low = False
    if is_low:
        if item_id not in low_stock_item_ids:
            issues.append("low_stock_item_missing_from_index")
    elif item_id in low_stock_item_ids:
        issues.append("non_low_stock_item_present_in_index")
    return issues


def _check_items_consistency(idx: dict) -> list[str]:
    issues: list[str] = []
    items_by_id = idx["items_by_id"]  # type: ignore[index]
    for item_id, item in items_by_id.items():
        issues.extend(_collect_item_issues(item_id, item, idx))
    return issues


def _check_index_references(idx: dict) -> list[str]:
    issues: list[str] = []
    items_by_id = idx["items_by_id"]  # type: ignore[index]
    tags_to_item_ids = idx["tags_to_item_ids"]  # type: ignore[index]
    category_to_item_ids = idx["category_to_item_ids"]  # type: ignore[index]
    checked_out_item_ids = idx["checked_out_item_ids"]  # type: ignore[index]
    low_stock_item_ids = idx["low_stock_item_ids"]  # type: ignore[index]
    items_by_location_id = idx["items_by_location_id"]  # type: ignore[index]
    created_at_bucket = idx["created_at_bucket"]  # type: ignore[index]
    updated_at_bucket = idx["updated_at_bucket"]  # type: ignore[index]
    locations_by_id = idx["locations_by_id"]  # type: ignore[index]

    def _assert_known_ids(name: str, ids: set[str]) -> None:
        unknown = [x for x in ids if x not in items_by_id]
        if unknown:
            issues.append(f"{name}_references_unknown_item_ids")

    for _tag, ids in list(tags_to_item_ids.items()):
        _assert_known_ids("tags_index", set(ids))
    for _cat, ids in list(category_to_item_ids.items()):
        _assert_known_ids("category_index", set(ids))

    _assert_known_ids("checked_out_index", set(checked_out_item_ids))
    _assert_known_ids("low_stock_index", set(low_stock_item_ids))

    for loc_id, ids in list(items_by_location_id.items()):
        if loc_id is not None and loc_id not in locations_by_id:
            issues.append("items_by_location_references_missing_location")
        _assert_known_ids("items_by_location_index", set(ids))
        for iid in list(ids):
            item = items_by_id.get(iid)
            if item is not None and (
                (
                    str(getattr(item, "location_id", None))
                    if getattr(item, "location_id", None) is not None
                    else None
                )
                != loc_id
            ):
                issues.append("items_by_location_bucket_mismatch")

    for _t, ids in list(created_at_bucket.items()):
        _assert_known_ids("created_at_bucket", set(ids))
    for _t, ids in list(updated_at_bucket.items()):
        _assert_known_ids("updated_at_bucket", set(ids))

    return issues


def _check_locations_consistency(*, locations_by_id) -> list[str]:
    issues: list[str] = []
    for loc_id, loc in locations_by_id.items():
        # Normalize types for comparison (UUID vs string)
        if str(getattr(loc, "id", "")) != loc_id:
            issues.append("location_id_key_mismatch")
    return issues


def _collect_health_issues(repo: Repository) -> tuple[list[str], dict[str, int]]:
    idx = _health_indexes(repo)
    issues: list[str] = []
    issues.extend(_check_items_consistency(idx))
    issues.extend(_check_index_references(idx))
    issues.extend(_check_locations_consistency(locations_by_id=idx["locations_by_id"]))

    counts = repo.get_counts()
    items_by_id = idx["items_by_id"]  # type: ignore[index]
    locations_by_id = idx["locations_by_id"]  # type: ignore[index]
    checked_out_item_ids = idx["checked_out_item_ids"]  # type: ignore[index]
    low_stock_item_ids = idx["low_stock_item_ids"]  # type: ignore[index]
    if counts.get("items_total") != len(items_by_id):
        issues.append("items_total_count_mismatch")
    if counts.get("locations_total") != len(locations_by_id):
        issues.append("locations_total_count_mismatch")
    if counts.get("checked_out_count") != len(checked_out_item_ids):
        issues.append("checked_out_count_mismatch")
    if counts.get("low_stock_count") != len(low_stock_item_ids):
        issues.append("low_stock_count_mismatch")
    return issues, counts


@websocket_api.websocket_command({"type": "haventory/health"})
@websocket_api.async_response
async def ws_health(hass: HomeAssistant, conn, msg):
    repo = _repo(hass)
    issues, counts = _collect_health_issues(repo)
    healthy = len(issues) == 0
    result = {"healthy": healthy, "issues": issues, "counts": counts, "generation": repo.generation}
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


# -----------------------------
# Subscription commands
# -----------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/subscribe",
        vol.Required("topic"): str,
        vol.Optional("location_id"): object,
        vol.Optional("include_subtree"): bool,
    }
)
@websocket_api.async_response
async def ws_subscribe(hass: HomeAssistant, conn, msg):
    topic = msg.get("topic")
    if topic not in {"items", "locations", "stats"}:
        raise ValidationError("topic must be one of: items, locations, stats")
    sub: _Subscription = {
        "topic": topic,
    }
    if "location_id" in msg:
        sub["location_id"] = msg.get("location_id")
    if "include_subtree" in msg:
        sub["include_subtree"] = bool(msg.get("include_subtree"))
    subs_all = _subs_bucket(hass)
    subs_for_conn = subs_all.setdefault(conn, {})
    subs_for_conn[int(msg.get("id", 0))] = sub
    _register_close_listener(hass, conn)
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
async def ws_unsubscribe(hass: HomeAssistant, conn, msg):
    sub_id = msg.get("subscription")
    subs_all = _subs_bucket(hass)
    removed = False
    subs_for_conn = subs_all.get(conn)
    if subs_for_conn:
        removed = subs_for_conn.pop(int(sub_id), None) is not None
        if not subs_for_conn:
            subs_all.pop(conn, None)
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
        vol.Required("name"): str,
        vol.Optional("description"): object,
        vol.Optional("quantity"): int,
        vol.Optional("checked_out"): bool,
        vol.Optional("due_date"): vol.Any(str, None),
        vol.Optional("inspection_date"): vol.Any(str, None),
        vol.Optional("location_id"): object,
        vol.Optional("tags"): [str],
        vol.Optional("category"): object,
        vol.Optional("low_stock_threshold"): object,
        vol.Optional("custom_fields"): {str: object},
    }
)
@websocket_api.async_response
@ws_guard("item_create", ("name",))
async def ws_item_create(hass: HomeAssistant, conn, msg):
    payload = {k: v for k, v in msg.items() if k not in {"id", "type"}}
    item = _repo(hass).create_item(payload)  # type: ignore[arg-type]
    serialized = _serialize_item(hass, item)
    _broadcast_event(hass, topic="items", action="created", payload={"item": serialized})
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/item/get", vol.Required("item_id"): object}
)
@websocket_api.async_response
@ws_guard("item_get", ("item_id",))
async def ws_item_get(hass: HomeAssistant, conn, msg):
    item = _repo(hass).get_item(msg.get("item_id"))
    conn.send_message(websocket_api.result_message(msg.get("id", 0), _serialize_item(hass, item)))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/update",
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        # ItemUpdate fields (all optional)
        vol.Optional("name"): object,
        vol.Optional("description"): object,
        vol.Optional("quantity"): int,
        vol.Optional("checked_out"): bool,
        vol.Optional("due_date"): vol.Any(str, None),
        vol.Optional("inspection_date"): vol.Any(str, None),
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
async def ws_item_update(hass: HomeAssistant, conn, msg):
    item_id = msg.get("item_id")
    expected = msg.get("expected_version")
    update: ItemUpdate = {
        k: v
        for k, v in msg.items()
        if k
        not in {
            "id",
            "type",
            "item_id",
            "expected_version",
        }
    }
    updated = _repo(hass).update_item(item_id, update, expected_version=expected)
    serialized = _serialize_item(hass, updated)
    action = "moved" if "location_id" in update else "updated"
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    await _persist_repo(hass)
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
async def ws_item_delete(hass: HomeAssistant, conn, msg):
    item_id = msg.get("item_id")
    repo = _repo(hass)
    before = repo.get_item(item_id)
    serialized_before = _serialize_item(hass, before)
    repo.delete_item(item_id, expected_version=msg.get("expected_version"))
    _broadcast_event(
        hass,
        topic="items",
        action="deleted",
        payload={"item": serialized_before},
    )
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), None))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/adjust_quantity",
        vol.Required("item_id"): object,
        vol.Required("delta"): int,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_adjust_quantity", ("item_id", "delta", "expected_version"))
async def ws_item_adjust_quantity(hass: HomeAssistant, conn, msg):
    item = _repo(hass).adjust_quantity(
        msg.get("item_id"), msg.get("delta"), expected_version=msg.get("expected_version")
    )
    serialized = _serialize_item(hass, item)
    _broadcast_event(hass, topic="items", action="quantity_changed", payload={"item": serialized})
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/set_quantity",
        vol.Required("item_id"): object,
        vol.Required("quantity"): int,
        vol.Optional("expected_version"): int,
    }
)
@websocket_api.async_response
@ws_guard("item_set_quantity", ("item_id", "quantity", "expected_version"))
async def ws_item_set_quantity(hass: HomeAssistant, conn, msg):
    qty = msg.get("quantity")
    # Validate upfront so schema errors surface as validation_error even when id is bad
    if not isinstance(qty, int) or qty < 0:
        raise ValidationError("quantity must be an integer >= 0")
    item = _repo(hass).set_quantity(
        msg.get("item_id"), qty, expected_version=msg.get("expected_version")
    )
    serialized = _serialize_item(hass, item)
    _broadcast_event(hass, topic="items", action="quantity_changed", payload={"item": serialized})
    await _persist_repo(hass)
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
async def ws_item_check_out(hass: HomeAssistant, conn, msg):
    item = _repo(hass).check_out(
        msg.get("item_id"),
        due_date=msg.get("due_date"),
        expected_version=msg.get("expected_version"),
    )
    serialized = _serialize_item(hass, item)
    _broadcast_event(hass, topic="items", action="checked_out", payload={"item": serialized})
    await _persist_repo(hass)
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
async def ws_item_check_in(hass: HomeAssistant, conn, msg):
    item = _repo(hass).check_in(msg.get("item_id"), expected_version=msg.get("expected_version"))
    serialized = _serialize_item(hass, item)
    _broadcast_event(hass, topic="items", action="checked_in", payload={"item": serialized})
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


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
async def ws_item_add_tags(hass: HomeAssistant, conn, msg):
    serialized, action = _execute_item_op(
        hass,
        "item_add_tags",
        {
            "item_id": msg.get("item_id"),
            "expected_version": msg.get("expected_version"),
            "tags": msg.get("tags"),
        },
    )
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    await _persist_repo(hass)
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
async def ws_item_remove_tags(hass: HomeAssistant, conn, msg):
    serialized, action = _execute_item_op(
        hass,
        "item_remove_tags",
        {
            "item_id": msg.get("item_id"),
            "expected_version": msg.get("expected_version"),
            "tags": msg.get("tags"),
        },
    )
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    await _persist_repo(hass)
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
async def ws_item_update_custom_fields(hass: HomeAssistant, conn, msg):
    serialized, action = _execute_item_op(
        hass,
        "item_update_custom_fields",
        {
            "item_id": msg.get("item_id"),
            "expected_version": msg.get("expected_version"),
            "set": msg.get("set"),
            "unset": msg.get("unset"),
        },
    )
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    await _persist_repo(hass)
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
async def ws_item_set_low_stock_threshold(hass: HomeAssistant, conn, msg):
    serialized, action = _execute_item_op(
        hass,
        "item_set_low_stock_threshold",
        {
            "item_id": msg.get("item_id"),
            "expected_version": msg.get("expected_version"),
            "low_stock_threshold": msg.get("low_stock_threshold"),
        },
    )
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    await _persist_repo(hass)
    _broadcast_counts(hass)
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
async def ws_item_move(hass: HomeAssistant, conn, msg):
    serialized, action = _execute_item_op(
        hass,
        "item_move",
        {
            "item_id": msg.get("item_id"),
            "expected_version": msg.get("expected_version"),
            "location_id": msg.get("location_id"),
        },
    )
    _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/items/bulk", vol.Required("operations"): list}
)
@websocket_api.async_response
@ws_guard("items_bulk", ())
async def ws_items_bulk(hass: HomeAssistant, conn, msg):
    operations = _validate_bulk_ops(msg.get("operations"))
    results: dict[str, dict[str, object]] = {}

    # Capture initial state for logging
    repo = _repo(hass)
    initial_generation = repo.generation
    successful_ops: list[tuple[str, dict, str]] = []  # (op_id, serialized, action)

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

            LOGGER.error(
                "Bulk operation failed, continuing with remaining ops",
                extra={
                    "domain": DOMAIN,
                    "op": "items_bulk_op_failed",
                    **ctx,
                },
                exc_info=True,
            )

            results[op_id] = {
                "success": False,
                "error": {"code": _error_code(exc), "message": str(exc), "context": ctx},
            }

    if successful_ops:
        # Log summary of bulk operation
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

        # Broadcast all successful operations
        for _op_id, serialized, action in successful_ops:
            _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})

        # Persist with debouncing (moved broadcasts before persist)
        await _persist_repo(hass)
        _broadcast_counts(hass)
    else:
        LOGGER.warning(
            "Bulk operation completed with no successful operations",
            extra={
                "domain": DOMAIN,
                "op": "items_bulk",
                "total_ops": len(operations),
            },
        )

    conn.send_message(websocket_api.result_message(msg.get("id", 0), {"results": results}))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/item/list",
        vol.Optional("filter"): dict,
        vol.Optional("sort"): dict,
        vol.Optional("limit"): int,
        vol.Optional("cursor"): str,
    }
)
@websocket_api.async_response
@ws_guard("item_list", ())
async def ws_item_list(hass: HomeAssistant, conn, msg):
    # Accept filter/sort/limit/cursor passthrough
    flt = msg.get("filter")
    sort = msg.get("sort")
    limit = msg.get("limit")
    cursor = msg.get("cursor")
    page = _repo(hass).list_items(flt=flt, sort=sort, limit=limit, cursor=cursor)
    result = {
        "items": [_serialize_item(hass, it) for it in page["items"]],
        "next_cursor": page.get("next_cursor"),
    }
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


# -----------------------------
# Locations
# -----------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/location/create",
        vol.Required("name"): str,
        vol.Optional("parent_id"): object,
        vol.Optional("area_id"): object,
    }
)
@websocket_api.async_response
@ws_guard("location_create", ("name", "parent_id"))
async def ws_location_create(hass: HomeAssistant, conn, msg):
    # Validate area_id against HA area registry when provided
    area_id = msg.get("area_id") if "area_id" in msg else None
    if area_id is not None:
        reg = await async_get_area_registry(hass)
        if reg.async_get_area(area_id) is None:
            raise ValidationError("unknown area_id")
    loc = _repo(hass).create_location(
        name=msg.get("name"), parent_id=msg.get("parent_id"), area_id=area_id
    )
    serialized = _serialize_location(loc)
    _broadcast_event(hass, topic="locations", action="created", payload={"location": serialized})
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/location/get", vol.Required("location_id"): object}
)
@websocket_api.async_response
@ws_guard("location_get", ("location_id",))
async def ws_location_get(hass: HomeAssistant, conn, msg):
    loc = _repo(hass).get_location(msg.get("location_id"))
    conn.send_message(websocket_api.result_message(msg.get("id", 0), _serialize_location(loc)))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "haventory/location/update",
        vol.Required("location_id"): object,
        vol.Optional("new_parent_id"): object,
        vol.Optional("name"): str,
        vol.Optional("area_id"): object,
    }
)
@websocket_api.async_response
@ws_guard("location_update", ("location_id", "new_parent_id", "name"))
async def ws_location_update(hass: HomeAssistant, conn, msg):
    new_parent = msg["new_parent_id"] if "new_parent_id" in msg else UNSET
    area_id = msg["area_id"] if "area_id" in msg else UNSET
    if area_id is not UNSET and area_id is not None:
        reg = await async_get_area_registry(hass)
        if reg.async_get_area(area_id) is None:
            raise ValidationError("unknown area_id")
    loc = _repo(hass).update_location(
        msg.get("location_id"), name=msg.get("name"), new_parent_id=new_parent, area_id=area_id
    )
    serialized = _serialize_location(loc)
    # If parent changed emit moved; if name changed emit renamed
    # (move takes precedence when both)
    if "new_parent_id" in msg:
        _broadcast_event(hass, topic="locations", action="moved", payload={"location": serialized})
    if "name" in msg:
        _broadcast_event(
            hass, topic="locations", action="renamed", payload={"location": serialized}
        )
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/location/delete", vol.Required("location_id"): object}
)
@websocket_api.async_response
@ws_guard("location_delete", ("location_id",))
async def ws_location_delete(hass: HomeAssistant, conn, msg):
    loc_id = msg.get("location_id")
    repo = _repo(hass)
    before = repo.get_location(loc_id)
    serialized_before = _serialize_location(before)
    repo.delete_location(loc_id)
    _broadcast_event(
        hass,
        topic="locations",
        action="deleted",
        payload={"location": serialized_before},
    )
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), None))


@websocket_api.websocket_command({"type": "haventory/location/list"})
@websocket_api.async_response
async def ws_location_list(hass: HomeAssistant, conn, msg):
    repo = _repo(hass)
    # Return flat list
    data = [
        _serialize_location(repo.get_location(loc_id))
        for loc_id in repo._debug_get_internal_indexes()["locations_by_id"].keys()
    ]  # type: ignore[index]
    conn.send_message(websocket_api.result_message(msg.get("id", 0), data))


@websocket_api.websocket_command({"type": "haventory/location/tree"})
@websocket_api.async_response
async def ws_location_tree(hass: HomeAssistant, conn, msg):
    # Build a naive tree from repo children mapping
    repo = _repo(hass)
    indexes = repo._debug_get_internal_indexes()  # pragma: no cover - only used in tests
    locs_by_id = indexes["locations_by_id"]  # type: ignore[index]
    children_by_parent = repo._children_ids_by_parent_id  # type: ignore[attr-defined]

    def build_node(loc_id: str) -> dict[str, Any]:
        loc = locs_by_id[loc_id]
        return {
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
            "children": [build_node(cid) for cid in sorted(children_by_parent.get(loc_id, set()))],
        }

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
async def ws_location_move_subtree(hass: HomeAssistant, conn, msg):
    new_parent = msg.get("new_parent_id") if "new_parent_id" in msg else UNSET
    loc = _repo(hass).update_location(msg.get("location_id"), new_parent_id=new_parent)
    serialized = _serialize_location(loc)
    _broadcast_event(hass, topic="locations", action="moved", payload={"location": serialized})
    await _persist_repo(hass)
    _broadcast_counts(hass)
    conn.send_message(websocket_api.result_message(msg.get("id", 0), serialized))


# -----------------------------
# Serialization helpers
# -----------------------------


def _effective_area_id_for_item(hass: HomeAssistant, item) -> str | None:
    """Resolve the effective area id for an item via its location ancestry."""
    try:
        if getattr(item, "location_id", None) is None:
            return None
        repo = _repo(hass)
        return repo._resolve_effective_area_id_for_location(str(item.location_id))  # type: ignore[attr-defined]
    except Exception:
        return None


def _serialize_item(hass: HomeAssistant, item) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "name": item.name,
        "description": item.description,
        "quantity": item.quantity,
        "checked_out": item.checked_out,
        "due_date": item.due_date,
        "location_id": str(item.location_id) if item.location_id is not None else None,
        "tags": list(item.tags),
        "category": item.category,
        "low_stock_threshold": item.low_stock_threshold,
        "custom_fields": dict(item.custom_fields),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "version": item.version,
        "effective_area_id": _effective_area_id_for_item(hass, item),
        "location_path": {
            "id_path": [str(x) for x in item.location_path.id_path],
            "name_path": item.location_path.name_path,
            "display_path": item.location_path.display_path,
            "sort_key": item.location_path.sort_key,
        },
    }


def _serialize_location(loc) -> dict[str, Any]:
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


@websocket_api.websocket_command({"type": "haventory/areas/list"})
@websocket_api.async_response
@ws_guard("areas_list", ())
async def ws_areas_list(hass: HomeAssistant, conn, msg):
    reg = await async_get_area_registry(hass)
    entries = reg.async_list_areas()
    areas = [{"id": a.id, "name": a.name} for a in entries]
    conn.send_message(websocket_api.result_message(msg.get("id", 0), {"areas": areas}))


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
        ws_stats,
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
        ws_item_add_tags,
        ws_item_remove_tags,
        ws_item_update_custom_fields,
        ws_item_set_low_stock_threshold,
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
        ws_areas_list,
    ]

    for h in handlers:
        websocket_api.async_register_command(hass, h)

    # Track our handlers for test stubs cleanup during unload
    bucket["ws_handlers"] = handlers
    bucket["ws_registered"] = True
