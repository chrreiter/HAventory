"""WebSocket command handlers for HAventory.

Implements CRUD and helper commands for items and locations.
Adheres to the envelope: input {id, type, ...payload}, output result_message/error_message.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, TypedDict

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN, INTEGRATION_VERSION
from .exceptions import ConflictError, NotFoundError, StorageError, ValidationError
from .models import ItemUpdate
from .repository import UNSET, Repository
from .storage import CURRENT_SCHEMA_VERSION, async_persist_repo

LOGGER = logging.getLogger(__name__)


def _repo(hass: HomeAssistant) -> Repository:
    bucket = hass.data.setdefault(DOMAIN, {})
    repo = bucket.get("repository")
    if repo is None:
        repo = Repository()
        bucket["repository"] = repo
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


def _error_message(hass: HomeAssistant, _id: int, exc: Exception, *, context: dict[str, Any]):
    LOGGER.log(
        logging.ERROR if isinstance(exc, ConflictError) else logging.WARNING,
        str(exc),
        extra={"domain": DOMAIN, **(context or {})},
    )
    return websocket_api.error_message(_id, _error_code(exc), str(exc), context or None)


# -----------------------------
# Subscriptions & Events
# -----------------------------


class _Subscription(TypedDict, total=False):
    topic: str
    location_id: str | None
    include_subtree: bool


def _subs_bucket(hass: HomeAssistant) -> dict[object, dict[int, _Subscription]]:
    bucket = hass.data.setdefault(DOMAIN, {})
    subs = bucket.get("subscriptions")
    if subs is None:
        subs = {}
        bucket["subscriptions"] = subs
    return subs  # type: ignore[return-value]


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
        LOGGER.warning(
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
    # Delegate to shared helper; retain local warning for visibility in logs
    try:
        await async_persist_repo(hass)
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to persist repository",
            extra={"domain": DOMAIN, "op": "persist_repo"},
            exc_info=True,
        )


# -----------------------------
# Utility commands
# -----------------------------


@websocket_api.websocket_command({"type": "haventory/ping"})
@websocket_api.async_response
async def ws_ping(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/ping":
            return None
        result = {"echo": msg.get("echo"), "ts": _now_ts()}
        return websocket_api.result_message(msg.get("id", 0), result)
    except Exception as exc:  # pragma: no cover - defensive
        return _error_message(hass, msg.get("id", 0), exc, context={"op": "ping"})


def _schema_version_from_hass(hass: HomeAssistant) -> int:
    try:
        bucket = hass.data.get(DOMAIN) or {}
        store = bucket.get("store")
        if store is not None:
            ver = getattr(store, "schema_version", None)
            if isinstance(ver, int):
                return ver
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to detect schema_version from hass store",
            extra={"domain": DOMAIN, "op": "schema_version_probe"},
            exc_info=True,
        )
    return int(CURRENT_SCHEMA_VERSION)


@websocket_api.websocket_command({"type": "haventory/version"})
@websocket_api.async_response
async def ws_version(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/version":
            return None
        result = {
            "integration_version": INTEGRATION_VERSION,
            "schema_version": _schema_version_from_hass(hass),
        }
        return websocket_api.result_message(msg.get("id", 0), result)
    except Exception as exc:  # pragma: no cover - defensive
        return _error_message(hass, msg.get("id", 0), exc, context={"op": "version"})


@websocket_api.websocket_command({"type": "haventory/stats"})
@websocket_api.async_response
async def ws_stats(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/stats":
            return None
        counts = _repo(hass).get_counts()
        return websocket_api.result_message(msg.get("id", 0), counts)
    except Exception as exc:  # pragma: no cover - defensive
        return _error_message(hass, msg.get("id", 0), exc, context={"op": "stats"})


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

    if getattr(item, "id", None) != item_id:
        issues.append("item_id_key_mismatch")

    loc_id = getattr(item, "location_id", None)
    if loc_id is not None and loc_id not in locations_by_id:
        issues.append("item_references_missing_location")

    if loc_id is not None:
        bucket_ids = items_by_location_id.get(loc_id, set())
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
    except Exception:  # pragma: no cover - defensive
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
            if item is not None and getattr(item, "location_id", None) != loc_id:
                issues.append("items_by_location_bucket_mismatch")

    for _t, ids in list(created_at_bucket.items()):
        _assert_known_ids("created_at_bucket", set(ids))
    for _t, ids in list(updated_at_bucket.items()):
        _assert_known_ids("updated_at_bucket", set(ids))

    return issues


def _check_locations_consistency(*, locations_by_id) -> list[str]:
    issues: list[str] = []
    for loc_id, loc in locations_by_id.items():
        if getattr(loc, "id", None) != loc_id:
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
async def ws_health(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/health":
            return None
        issues, counts = _collect_health_issues(_repo(hass))
        healthy = len(issues) == 0
        result = {"healthy": healthy, "issues": issues, "counts": counts}
        return websocket_api.result_message(msg.get("id", 0), result)
    except Exception as exc:
        return _error_message(hass, msg.get("id", 0), exc, context={"op": "health"})


# -----------------------------
# Subscription commands
# -----------------------------


@websocket_api.websocket_command({"type": "haventory/subscribe"})
@websocket_api.async_response
async def ws_subscribe(hass: HomeAssistant, conn, msg):
    try:
        if msg.get("type") != "haventory/subscribe":
            return None
        if conn is None:
            raise ValidationError("connection is required for subscriptions")
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
        LOGGER.debug(
            "Subscribed",
            extra={
                "domain": DOMAIN,
                "op": "subscribe",
                "subscription_id": msg.get("id", 0),
                "topic": topic,
            },
        )
        return websocket_api.result_message(msg.get("id", 0), None)
    except Exception as exc:
        ctx = {"op": "subscribe", "topic": msg.get("topic")}
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/unsubscribe"})
@websocket_api.async_response
async def ws_unsubscribe(hass: HomeAssistant, conn, msg):
    try:
        if msg.get("type") != "haventory/unsubscribe":
            return None
        sub_id = msg.get("subscription")
        subs_all = _subs_bucket(hass)
        removed = False
        if conn in subs_all:
            removed = subs_all[conn].pop(int(sub_id), None) is not None
            if not subs_all[conn]:
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
        return websocket_api.result_message(msg.get("id", 0), None)
    except Exception as exc:
        ctx = {"op": "unsubscribe", "subscription": msg.get("subscription")}
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


# -----------------------------
# Items
# -----------------------------


@websocket_api.websocket_command({"type": "haventory/item/create"})
@websocket_api.async_response
async def ws_item_create(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/create":
            return None
        payload = {k: v for k, v in msg.items() if k not in {"id", "type"}}
        item = _repo(hass).create_item(payload)  # type: ignore[arg-type]
        serialized = _serialize_item(item)
        _broadcast_event(hass, topic="items", action="created", payload={"item": serialized})
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), serialized)
    except Exception as exc:
        return _error_message(
            hass,
            msg.get("id", 0),
            exc,
            context={"op": "item_create", "item_name": msg.get("name")},
        )


@websocket_api.websocket_command({"type": "haventory/item/get"})
@websocket_api.async_response
async def ws_item_get(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/get":
            return None
        item = _repo(hass).get_item(msg.get("item_id"))
        return websocket_api.result_message(msg.get("id", 0), _serialize_item(item))
    except Exception as exc:
        return _error_message(
            hass, msg.get("id", 0), exc, context={"op": "item_get", "item_id": msg.get("item_id")}
        )


@websocket_api.websocket_command({"type": "haventory/item/update"})
@websocket_api.async_response
async def ws_item_update(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/update":
            return None
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
        serialized = _serialize_item(updated)
        action = "updated"
        if "location_id" in update:
            action = "moved"
        _broadcast_event(hass, topic="items", action=action, payload={"item": serialized})
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), serialized)
    except Exception as exc:
        ctx = {
            "op": "item_update",
            "item_id": msg.get("item_id"),
            "expected_version": msg.get("expected_version"),
        }
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/item/delete"})
@websocket_api.async_response
async def ws_item_delete(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/delete":
            return None
        # Capture item before deletion for event payload
        item_id = msg.get("item_id")
        try:
            before = _repo(hass).get_item(item_id)
            serialized_before = _serialize_item(before)
        except Exception:
            serialized_before = None  # pragma: no cover - item may not exist
        _repo(hass).delete_item(item_id, expected_version=msg.get("expected_version"))
        if serialized_before is not None:
            _broadcast_event(
                hass,
                topic="items",
                action="deleted",
                payload={"item": serialized_before},
            )
        else:
            _broadcast_event(
                hass,
                topic="items",
                action="deleted",
                payload={"item": {"id": item_id}},
            )
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), None)
    except Exception as exc:
        ctx = {
            "op": "item_delete",
            "item_id": msg.get("item_id"),
            "expected_version": msg.get("expected_version"),
        }
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/item/adjust_quantity"})
@websocket_api.async_response
async def ws_item_adjust_quantity(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/adjust_quantity":
            return None
        item = _repo(hass).adjust_quantity(
            msg.get("item_id"), msg.get("delta"), expected_version=msg.get("expected_version")
        )
        serialized = _serialize_item(item)
        _broadcast_event(
            hass, topic="items", action="quantity_changed", payload={"item": serialized}
        )
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), serialized)
    except Exception as exc:
        ctx = {
            "op": "item_adjust_quantity",
            "item_id": msg.get("item_id"),
            "delta": msg.get("delta"),
        }
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/item/set_quantity"})
@websocket_api.async_response
async def ws_item_set_quantity(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/set_quantity":
            return None
        item = _repo(hass).set_quantity(
            msg.get("item_id"), msg.get("quantity"), expected_version=msg.get("expected_version")
        )
        serialized = _serialize_item(item)
        _broadcast_event(
            hass, topic="items", action="quantity_changed", payload={"item": serialized}
        )
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), serialized)
    except Exception as exc:
        ctx = {
            "op": "item_set_quantity",
            "item_id": msg.get("item_id"),
            "quantity": msg.get("quantity"),
        }
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/item/check_out"})
@websocket_api.async_response
async def ws_item_check_out(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/check_out":
            return None
        item = _repo(hass).check_out(
            msg.get("item_id"),
            due_date=msg.get("due_date"),
            expected_version=msg.get("expected_version"),
        )
        serialized = _serialize_item(item)
        _broadcast_event(hass, topic="items", action="checked_out", payload={"item": serialized})
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), serialized)
    except Exception as exc:
        ctx = {
            "op": "item_check_out",
            "item_id": msg.get("item_id"),
            "due_date": msg.get("due_date"),
        }
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/item/check_in"})
@websocket_api.async_response
async def ws_item_check_in(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/check_in":
            return None
        item = _repo(hass).check_in(
            msg.get("item_id"), expected_version=msg.get("expected_version")
        )
        serialized = _serialize_item(item)
        _broadcast_event(hass, topic="items", action="checked_in", payload={"item": serialized})
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg["id"], serialized)
    except Exception as exc:
        ctx = {"op": "item_check_in", "item_id": msg.get("item_id")}
        return _error_message(hass, msg["id"], exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/item/list"})
@websocket_api.async_response
async def ws_item_list(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/item/list":
            return None
        # Accept filter/sort/limit/cursor passthrough
        flt = msg.get("filter")
        sort = msg.get("sort")
        limit = msg.get("limit")
        cursor = msg.get("cursor")
        page = _repo(hass).list_items(flt=flt, sort=sort, limit=limit, cursor=cursor)
        result = {
            "items": [_serialize_item(it) for it in page["items"]],
            "next_cursor": page.get("next_cursor"),
        }
        return websocket_api.result_message(msg.get("id", 0), result)
    except Exception as exc:
        return _error_message(hass, msg.get("id", 0), exc, context={"op": "item_list"})


# -----------------------------
# Locations
# -----------------------------


@websocket_api.websocket_command({"type": "haventory/location/create"})
@websocket_api.async_response
async def ws_location_create(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/create":
            return None
        loc = _repo(hass).create_location(name=msg.get("name"), parent_id=msg.get("parent_id"))
        serialized = _serialize_location(loc)
        _broadcast_event(
            hass, topic="locations", action="created", payload={"location": serialized}
        )
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), serialized)
    except Exception as exc:
        ctx = {
            "op": "location_create",
            "location_name": msg.get("name"),
            "parent_id": msg.get("parent_id"),
        }
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/location/get"})
@websocket_api.async_response
async def ws_location_get(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/get":
            return None
        loc = _repo(hass).get_location(msg.get("location_id"))
        return websocket_api.result_message(msg.get("id", 0), _serialize_location(loc))
    except Exception as exc:
        ctx = {"op": "location_get", "location_id": msg.get("location_id")}
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/location/update"})
@websocket_api.async_response
async def ws_location_update(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/update":
            return None
        new_parent = msg["new_parent_id"] if "new_parent_id" in msg else UNSET
        loc = _repo(hass).update_location(
            msg.get("location_id"), name=msg.get("name"), new_parent_id=new_parent
        )
        serialized = _serialize_location(loc)
        # If parent changed emit moved; if name changed emit renamed
        # (move takes precedence when both)
        if "new_parent_id" in msg:
            _broadcast_event(
                hass, topic="locations", action="moved", payload={"location": serialized}
            )
        if "name" in msg:
            _broadcast_event(
                hass, topic="locations", action="renamed", payload={"location": serialized}
            )
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg["id"], serialized)
    except Exception as exc:
        ctx = {"op": "location_update", "location_id": msg.get("location_id")}
        return _error_message(hass, msg["id"], exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/location/delete"})
@websocket_api.async_response
async def ws_location_delete(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/delete":
            return None
        # Capture before delete for payload
        loc_id = msg.get("location_id")
        try:
            before = _repo(hass).get_location(loc_id)
            serialized_before = _serialize_location(before)
        except Exception:
            serialized_before = None  # pragma: no cover
        _repo(hass).delete_location(loc_id)
        if serialized_before is not None:
            _broadcast_event(
                hass,
                topic="locations",
                action="deleted",
                payload={"location": serialized_before},
            )
        else:
            _broadcast_event(
                hass,
                topic="locations",
                action="deleted",
                payload={"location": {"id": loc_id}},
            )
        await _persist_repo(hass)
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), None)
    except Exception as exc:
        ctx = {"op": "location_delete", "location_id": msg.get("location_id")}
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/location/list"})
@websocket_api.async_response
async def ws_location_list(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/list":
            return None
        repo = _repo(hass)
        # Return flat list
        data = [
            _serialize_location(repo.get_location(loc_id))
            for loc_id in repo._debug_get_internal_indexes()["locations_by_id"].keys()
        ]  # type: ignore[index]
        return websocket_api.result_message(msg.get("id", 0), data)
    except Exception as exc:
        return _error_message(hass, msg.get("id", 0), exc, context={"op": "location_list"})


@websocket_api.websocket_command({"type": "haventory/location/tree"})
@websocket_api.async_response
async def ws_location_tree(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/tree":
            return None
        # Build a naive tree from repo children mapping
        repo = _repo(hass)
        indexes = repo._debug_get_internal_indexes()  # pragma: no cover - only used in tests
        locs_by_id = indexes["locations_by_id"]  # type: ignore[index]
        children_by_parent = repo._children_ids_by_parent_id  # type: ignore[attr-defined]

        def build_node(loc_id: str) -> dict[str, Any]:
            loc = locs_by_id[loc_id]
            return {
                "id": loc.id,
                "name": loc.name,
                "parent_id": loc.parent_id,
                "path": {
                    "id_path": loc.path.id_path,
                    "name_path": loc.path.name_path,
                    "display_path": loc.path.display_path,
                    "sort_key": loc.path.sort_key,
                },
                "children": [
                    build_node(cid) for cid in sorted(children_by_parent.get(loc_id, set()))
                ],
            }

        roots = sorted(children_by_parent.get(None, set()))
        tree = [build_node(r) for r in roots]
        return websocket_api.result_message(msg.get("id", 0), tree)
    except Exception as exc:
        return _error_message(hass, msg.get("id", 0), exc, context={"op": "location_tree"})


@websocket_api.websocket_command({"type": "haventory/location/move_subtree"})
@websocket_api.async_response
async def ws_location_move_subtree(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/move_subtree":
            return None
        new_parent = msg.get("new_parent_id") if "new_parent_id" in msg else UNSET
        loc = _repo(hass).update_location(msg.get("location_id"), new_parent_id=new_parent)
        serialized = _serialize_location(loc)
        _broadcast_event(hass, topic="locations", action="moved", payload={"location": serialized})
        _broadcast_counts(hass)
        return websocket_api.result_message(msg.get("id", 0), serialized)
    except Exception as exc:
        ctx = {
            "op": "location_move_subtree",
            "location_id": msg.get("location_id"),
            "new_parent_id": msg.get("new_parent_id"),
        }
        return _error_message(hass, msg.get("id", 0), exc, context=ctx)


# -----------------------------
# Serialization helpers
# -----------------------------


def _serialize_item(item) -> dict[str, Any]:
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "quantity": item.quantity,
        "checked_out": item.checked_out,
        "due_date": item.due_date,
        "location_id": item.location_id,
        "tags": list(item.tags),
        "category": item.category,
        "low_stock_threshold": item.low_stock_threshold,
        "custom_fields": dict(item.custom_fields),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "version": item.version,
        "location_path": {
            "id_path": item.location_path.id_path,
            "name_path": item.location_path.name_path,
            "display_path": item.location_path.display_path,
            "sort_key": item.location_path.sort_key,
        },
    }


def _serialize_location(loc) -> dict[str, Any]:
    return {
        "id": loc.id,
        "name": loc.name,
        "parent_id": loc.parent_id,
        "path": {
            "id_path": loc.path.id_path,
            "name_path": loc.path.name_path,
            "display_path": loc.path.display_path,
            "sort_key": loc.path.sort_key,
        },
    }


# -----------------------------
# Registration
# -----------------------------


def setup(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_ping)
    websocket_api.async_register_command(hass, ws_version)
    websocket_api.async_register_command(hass, ws_stats)
    websocket_api.async_register_command(hass, ws_health)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_unsubscribe)
    websocket_api.async_register_command(hass, ws_item_create)
    websocket_api.async_register_command(hass, ws_item_get)
    websocket_api.async_register_command(hass, ws_item_update)
    websocket_api.async_register_command(hass, ws_item_delete)
    websocket_api.async_register_command(hass, ws_item_adjust_quantity)
    websocket_api.async_register_command(hass, ws_item_set_quantity)
    websocket_api.async_register_command(hass, ws_item_check_out)
    websocket_api.async_register_command(hass, ws_item_check_in)
    websocket_api.async_register_command(hass, ws_item_list)

    websocket_api.async_register_command(hass, ws_location_create)
    websocket_api.async_register_command(hass, ws_location_get)
    websocket_api.async_register_command(hass, ws_location_update)
    websocket_api.async_register_command(hass, ws_location_delete)
    websocket_api.async_register_command(hass, ws_location_list)
    websocket_api.async_register_command(hass, ws_location_tree)
    websocket_api.async_register_command(hass, ws_location_move_subtree)
