"""WebSocket command handlers for HAventory.

Implements CRUD and helper commands for items and locations.
Adheres to the envelope: input {id, type, ...payload}, output result_message/error_message.

Handlers only. A mutation announces itself through a door in `events.py`, which
covers the bus and the entities as well as the wire; the subscription registry
and the fan-out behind that door are `subscriptions.py`.
"""

from __future__ import annotations

import asyncio
import functools
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, cast

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

try:
    from homeassistant.components.file_upload import process_uploaded_file
except ImportError:  # pragma: no cover - offline harness without the component
    process_uploaded_file = None

from . import import_export, ops, todo_bridge
from . import media as media_mod
from . import storage as storage_mod
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
from .events import (
    notify_bulk_mutation,
    notify_counts,
    notify_dataset_replaced,
    notify_location_mutation,
    notify_mutation,
    notify_status_mutation,
)
from .exceptions import (
    ConflictError,
    NotFoundError,
    StorageError,
    ValidationError,
    error_code,
    log_exc_info,
    log_severity,
)
from .health import collect_health_issues
from .import_export import POLICIES, Policy
from .logs import context_logger
from .models import (
    ATTACHMENT_KINDS,
    AttachmentMeta,
    ItemUpdate,
    iso_utc_now,
    new_uuid4,
    serialize_status_definition,
    validate_attachment_meta,
    validate_item_filter,
    validate_sort,
)
from .rate_limit import RateLimiter
from .repository import UNSET, Repository
from .runtime import Subscription, find_runtime, loaded_runtime
from .serialization import serialize_item, serialize_location
from .storage import CURRENT_SCHEMA_VERSION
from .subscriptions import register_subscription, unregister_subscription

LOGGER = context_logger(__name__)


def _repo(hass: HomeAssistant) -> Repository:
    return loaded_runtime(hass).repository


def _require_loaded(hass: HomeAssistant) -> None:
    """Refuse the command when no loaded config entry owns the data.

    Home Assistant cannot unregister a WebSocket command, so these keep
    listening after the integration is unloaded, disabled or removed — and in
    each of those states the entry is no longer `LOADED`, which is what
    `loaded_runtime` refuses on. It sits in the guard rather than in the handlers
    so the whole surface goes quiet at once: the commands that read no inventory
    (ping, version, config) would otherwise keep answering for a backend that
    owns nothing.
    """

    loaded_runtime(hass)


def _rate_limiter(hass: HomeAssistant) -> RateLimiter | None:
    """The configured rate limiter, or None when limiting is off.

    Resolved without the loaded check: the guard charges a command's token
    before it has asked whether an entry is loaded at all, so a refusal costs
    the same whichever answer the command was heading for.
    """

    runtime = find_runtime(hass)
    return runtime.rate_limiter if runtime is not None else None


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


def _log_rejection(exc: Exception, context: dict[str, Any]) -> tuple[str, str]:
    """Log one refused call at the level its code earns, and say what the wire carries.

    The severity, the traceback and the message a client is given are decided
    here for a whole command and for one row of a batch alike, so a rejection
    reads the same in the log whichever of the two carried it.
    """

    code = error_code(exc)
    LOGGER.log(
        log_severity(code, exc),
        str(exc),
        extra={"domain": DOMAIN, **(context or {})},
        exc_info=log_exc_info(code, exc),
    )
    return code, str(exc)


def _error_message(_id: int, exc: Exception, *, context: dict[str, Any]) -> dict[str, Any]:
    code, message = _log_rejection(exc, context)
    return _error_envelope(_id, code, message, context or None)


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
            # The envelope is returned to the caller whatever happens here: a
            # connection that cannot be written to must not swallow the error.
            try:
                conn.send_message(err)
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


#: The payload fields a rejected bulk row names, the way `ws_guard`'s
#: `context_fields` name a command's. One list for every kind, because a row
#: carries whichever of them its own kind takes.
_BULK_OP_CONTEXT_FIELDS = (
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
)


def _bulk_op_error(
    op_id: str, kind: str, payload: dict[str, Any], exc: Exception
) -> dict[str, object]:
    """Map one refused row to the verdict the caller reads under its `op_id`.

    Built from the same two pieces `ws_guard` builds a whole command's answer
    from, so a row and a command say the same thing about the same failure: one
    rejected row is classified on its own code — a stale version inside a batch
    is no more of a fault than it is on its own — and anything that is not a
    domain error answers the generic message with its details left in the log.
    """

    context = _context_from_msg("items_bulk_op_failed", payload, _BULK_OP_CONTEXT_FIELDS)
    context["op_id"] = op_id
    context["kind"] = kind
    if isinstance(exc, ValidationError | NotFoundError | ConflictError | StorageError):
        code, message = _log_rejection(exc, context)
    else:
        LOGGER.exception(
            "Unexpected error in a bulk operation", extra={"domain": DOMAIN, **context}
        )
        code, message = "unknown_error", UNEXPECTED_ERROR_MESSAGE
    return {"success": False, "error": {"code": code, "message": message, "context": context}}


async def _persist_repo(hass: HomeAssistant) -> None:
    """Write the repository to disk, propagating failure to the caller.

    The write is awaited rather than handed to a background task, because that
    is what puts a storage failure in front of ``@ws_guard`` and so in the
    client's reply as ``storage_error``.

    **Every mutation handler awaits this before it broadcasts or replies.** That
    ordering is the whole guarantee an event carries: a subscriber that receives
    ``items/created`` knows the write behind it succeeded. Broadcasting first
    would tell subscribers about a change the originating client is about to be
    told failed, and which a restart then erases. Bulk import
    (``ws_import_execute``) additionally rolls the dataset back, because a
    wholesale swap has more to undo than one entity does.
    """

    await storage_mod.async_persist_repo(hass)


async def _mutate(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any], name: str
) -> None:
    """Run one operation and answer for it: write, persist, announce, reply.

    The command's fields are the op's payload — the envelope's `id` and `type`
    are all that is stripped — so a command, the `items/bulk` row naming the same
    `kind` and the `haventory.<name>` service reach the repository through one
    function and answer alike.

    A delete answers `null`: its body is a pre-delete snapshot for the event
    rather than a row the caller could read back.
    """

    payload = {k: v for k, v in msg.items() if k not in {"id", "type"}}
    written = ops.run(hass, name, payload)
    await _persist_repo(hass)
    await ops.announce(hass, written)
    deleted = written.action == "deleted"
    conn.send_message(
        websocket_api.result_message(msg.get("id", 0), None if deleted else written.entity)
    )


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
    result = {"echo": msg.get("echo"), "ts": datetime.now(UTC).isoformat()}
    conn.send_message(websocket_api.result_message(msg.get("id", 0), result))


def _schema_version_from_hass(hass: HomeAssistant) -> int:
    runtime = find_runtime(hass)
    ver = getattr(runtime.store, "schema_version", None) if runtime is not None else None
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
    runtime = loaded_runtime(hass)
    title = runtime.card_title
    pills = runtime.quick_filters
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
    sub: Subscription = {
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
    register_subscription(hass, conn, int(msg.get("id", 0)), sub)
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
    removed = unregister_subscription(hass, conn, sub_id)
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
    await _mutate(hass, conn, msg, "item_create")


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
    await _mutate(hass, conn, msg, "item_update")


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
    await _mutate(hass, conn, msg, "item_delete")


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
    await _mutate(hass, conn, msg, "item_adjust_quantity")


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
    await _mutate(hass, conn, msg, "item_set_quantity")


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
    await _mutate(hass, conn, msg, "item_check_out")


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
    await _mutate(hass, conn, msg, "item_check_in")


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
    notify_mutation(hass, action="updated", item=serialized)
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

    One command rather than the client working out the next date and writing it
    back: the rule lives in `Repository.bump_reminder`, so two clients bumping
    the same reminder land on the same answer, and neither of them can re-anchor
    a series by accident.
    """

    await _mutate(hass, conn, msg, "reminder_bump")


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
    await _mutate(hass, conn, msg, "item_add_tags")


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
    await _mutate(hass, conn, msg, "item_remove_tags")


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
    await _mutate(hass, conn, msg, "item_update_custom_fields")


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
    await _mutate(hass, conn, msg, "item_set_low_stock_threshold")


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
    notify_mutation(hass, action="updated", item=serialized)
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
    notify_mutation(hass, action="updated", item=serialized)
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
    # No counts event: a title and an order move nothing any count reads.
    notify_mutation(hass, action="updated", item=serialized, counts=False)
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
    # No counts event: a title and an order move nothing any count reads.
    notify_mutation(hass, action="updated", item=serialized, counts=False)
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
    await _mutate(hass, conn, msg, "item_move")


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
            if kind not in ops.BULK_KINDS:
                # The op table also carries the writes only a command or a
                # service can make; a row may name the documented subset.
                raise ValidationError("unknown operation kind")
            written = ops.run(hass, kind, payload)
        except Exception as exc:
            # Whatever it was, it fails its own row and no other.
            results[op_id] = _bulk_op_error(op_id, kind, payload, exc)
        else:
            results[op_id] = {"success": True, "result": written.entity}
            successful_ops.append((op_id, written.entity, written.action))

    # Only a batch that changed something writes or announces anything. An
    # all-failed batch deliberately logs no summary of its own: each op already
    # logged its op_id and reason above, which is what an operator acts on, and a
    # line repeating "none of them worked" only doubles the log on the worst path.
    if successful_ops:
        # Persist immediately so storage errors surface through @ws_guard, and
        # before anything else so neither the summary nor an event describes a
        # batch that never reached disk. The whole batch shares this one write.
        await _persist_repo(hass)

        # `deleted` is the action `_op_item_delete` alone returns, so it names
        # exactly the rows whose files nothing references any more. A row that
        # failed is not in `successful_ops` and keeps every file it had.
        await media_mod.async_delete_item_files(
            hass, [body for _op_id, body, action in successful_ops if action == "deleted"]
        )

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

        # One counts event for the batch rather than one per row: each row's
        # own event still names it, and the counts describe the inventory as a
        # whole.
        for _op_id, serialized, action in successful_ops:
            notify_mutation(hass, action=action, item=serialized, counts=False)

        notify_counts(hass)

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


def _require_known_area(hass: HomeAssistant, area_id: Any) -> None:
    """Refuse an `area_id` Home Assistant has no area for.

    Areas are HA's: the integration reads the registry and never creates one, so
    a location anchored to an id no registry knows would report an
    `effective_area_id` that filters to nothing. The command schemas type
    `area_id` as `object`, so whatever the frame carried reaches the lookup, and
    the lookup is what refuses it.
    """

    if area_id is None:
        return
    if ar.async_get(hass).async_get_area(cast("str", area_id)) is None:
        raise ValidationError("unknown area_id")


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
    _require_known_area(hass, msg.get("area_id"))
    await _mutate(hass, conn, msg, "location_create")


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
    _require_known_area(hass, msg.get("area_id"))
    await _mutate(hass, conn, msg, "location_update")


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/location/delete", vol.Required("location_id"): object}
)
@websocket_api.async_response
@ws_guard("location_delete", ("location_id",))
async def ws_location_delete(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    await _mutate(hass, conn, msg, "location_delete")


@websocket_api.websocket_command({"type": "haventory/location/list"})
@websocket_api.async_response
@ws_guard("location_list", ())
async def ws_location_list(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    data = [serialize_location(loc) for loc in _repo(hass).iter_locations()]
    conn.send_message(websocket_api.result_message(msg.get("id", 0), data))


@websocket_api.websocket_command(
    {vol.Required("type"): "haventory/location/tree", vol.Optional("filter"): object}
)
@websocket_api.async_response
@ws_guard("location_tree", ())
async def ws_location_tree(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    repo = _repo(hass)

    # With a filter, every node also reports how much of it the filter keeps, so
    # a sidebar can read "4 / 37" instead of a total that never moves. Counted
    # once here and rolled up, rather than one query per location.
    item_filter = msg.get("filter")
    validate_item_filter(item_filter)
    matching_direct = (
        repo.count_matching_by_location(item_filter) if item_filter is not None else None
    )

    def build_node(loc_id: str) -> dict[str, Any]:
        loc = repo.get_location(loc_id)
        counts = repo.get_location_item_counts(loc_id)
        children = [build_node(cid) for cid in sorted(repo.children_of(loc_id))]
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

    tree = [build_node(root) for root in sorted(repo.children_of(None))]
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
    repo = _repo(hass)
    was_below = repo.get_location(msg["location_id"]).parent_id
    loc = repo.update_location(msg["location_id"], new_parent_id=new_parent)
    serialized = serialize_location(loc)
    await _persist_repo(hass)
    notify_location_mutation(
        hass, action="moved", location=serialized, repaint=loc.parent_id != was_below
    )
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
    notify_status_mutation(hass, action="created", status=serialized)
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
    notify_status_mutation(hass, action="updated", status=serialized)
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
    notify_status_mutation(hass, action="reordered", statuses=serialized)
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
    notify_status_mutation(hass, action="deleted", status=serialized)
    if reassigned:
        # Two topics on purpose: one card is showing the vocabulary, another is
        # showing the items that just moved underneath it — that second topic is
        # the `items` event `notify_bulk_mutation` broadcasts.
        #
        # Each rewritten item took a new version and a new updated_at, so each
        # is an ordinary item edit as far as the bus is concerned. Announcing the
        # command and not the edits would leave an automation watching
        # `haventory_item_changed` blind while a whole set moved underneath it.
        notify_bulk_mutation(
            hass,
            action="updated",
            items=[serialize_item(hass, repo.get_item(item_id)) for item_id in reassigned],
        )
    conn.send_message(
        websocket_api.result_message(
            msg.get("id", 0), {"status": serialized, "reassigned": len(reassigned)}
        )
    )


@websocket_api.websocket_command({"type": "haventory/areas/list"})
@websocket_api.async_response
@ws_guard("areas_list", ())
async def ws_areas_list(
    hass: HomeAssistant, conn: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    reg = ar.async_get(hass)
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
    notify_dataset_replaced(hass)
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


# Every command this integration serves. Home Assistant keys its command
# registry by command type, so registering the list again — which a reload does
# — replaces each handler rather than adding a second one.
HANDLERS: tuple[Any, ...] = (
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
)


def setup(hass: HomeAssistant) -> None:
    """Register every HAventory WebSocket command."""

    for handler in HANDLERS:
        websocket_api.async_register_command(hass, handler)
