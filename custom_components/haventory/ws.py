"""WebSocket command handlers for HAventory.

Most payload fields are typed `object` rather than concretely, so a wrong type
is answered by the model as `validation_error` naming the field. A concrete
schema type has Home Assistant refuse the frame as `invalid_format` before the
guard runs, and log the client's payload at ERROR while naming nothing.

A mutation announces itself through `events.py`, never `subscriptions.py`.
"""

from __future__ import annotations

import asyncio
import functools
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.components.file_upload import process_uploaded_file
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar

from . import import_export, ops
from . import media as media_mod
from .const import (
    ATTACHMENT_MANUAL_MIME_TYPES,
    ATTACHMENT_PICTURE_MIME_TYPES,
    INTEGRATION_VERSION,
    MAX_ATTACHMENT_BYTES,
    MAX_MANUALS_PER_ITEM,
    MAX_PICTURES_PER_ITEM,
)
from .exceptions import (
    ConflictError,
    NotFoundError,
    StorageError,
    ValidationError,
    error_code,
    log_exc_info,
    log_severity,
    translation_fields,
)
from .import_export import POLICIES, Policy
from .logs import context_logger
from .models import (
    ATTACHMENT_KINDS,
    AttachmentMeta,
    iso_utc_now,
    new_uuid4,
    normalize_string_list,
    serialize_status_definition,
    validate_area_filter,
    validate_attachment_meta,
    validate_item_filter,
    validate_sort,
)
from .repository import Repository
from .runtime import Subscription, loaded_runtime
from .serialization import serialize_item, serialize_location
from .subscriptions import register_subscription, unregister_subscription

if TYPE_CHECKING:
    from homeassistant.components.websocket_api import ActiveConnection as _Conn
    from homeassistant.components.websocket_api import (
        AsyncWebSocketCommandHandler,
        WebSocketCommandHandler,
    )

LOGGER = context_logger(__name__)

_Msg = dict[str, Any]
_DOMAIN_ERRORS = (ValidationError, NotFoundError, ConflictError, StorageError)

# Sent when a non-domain exception escapes a handler; the details stay in the log.
UNEXPECTED_ERROR_MESSAGE = "unexpected error; see Home Assistant logs"


def _repo(hass: HomeAssistant) -> Repository:
    return loaded_runtime(hass).repository


def _error_envelope(
    iden: int, error: dict[str, Any], context: dict[str, Any] | None
) -> dict[str, Any]:
    """The contract's error envelope, built by hand.

    ``websocket_api.error_message`` has no ``data`` parameter (its 4th
    positional is ``translation_key``), so it cannot carry the context.
    """
    if context:
        error = {**error, "data": context}
    return {"id": iden, "type": "result", "success": False, "error": error}


def _log_rejection(exc: Exception, context: dict[str, Any]) -> dict[str, Any]:
    """Log one refusal at the level its code earns; return the wire's error body.

    Shared by a whole command and one bulk row, so both log a refusal alike.
    """

    code = error_code(exc)
    LOGGER.log(
        log_severity(code, exc),
        str(exc),
        extra={**context},
        exc_info=log_exc_info(code, exc),
    )
    return {"code": code, "message": str(exc), **translation_fields(exc)}


def _context_from_msg(op: str, msg: _Msg, fields: tuple[str, ...]) -> dict[str, Any]:
    # `name` is a reserved LogRecord key, so it is logged under the entity's name.
    name_key = "item_name" if op.startswith("item_") else "location_name"
    return {"op": op, **{(name_key if f == "name" else f): msg[f] for f in fields if f in msg}}


def ws_guard(
    op: str, context_fields: tuple[str, ...] = ()
) -> Callable[[AsyncWebSocketCommandHandler], AsyncWebSocketCommandHandler]:
    """Map a handler's exceptions to the contract's error envelope.

    Every command refuses once no loaded entry owns the data: Home Assistant
    cannot unregister a WebSocket command, and the commands that read no
    inventory must go quiet with the rest. A non-domain exception answers
    `unknown_error` with a generic message and its traceback in the log.
    """

    def decorator(func: AsyncWebSocketCommandHandler) -> AsyncWebSocketCommandHandler:
        @functools.wraps(func)
        async def wrapper(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
            try:
                loaded_runtime(hass)
                await func(hass, conn, msg)
                return
            except _DOMAIN_ERRORS as exc:
                ctx = _context_from_msg(op, msg, context_fields)
                error = _log_rejection(exc, ctx)
            except Exception:
                ctx = _context_from_msg(op, msg, context_fields)
                LOGGER.exception("Unexpected error in WS handler", extra={**ctx})
                error = {"code": "unknown_error", "message": UNEXPECTED_ERROR_MESSAGE}
            conn.send_message(_error_envelope(msg["id"], error, ctx))

        return wrapper

    return decorator


def _command(
    command: str, fields: dict[Any, Any] | None = None, context: tuple[str, ...] = ()
) -> Callable[[AsyncWebSocketCommandHandler], WebSocketCommandHandler]:
    """Declare a command: its schema, HA's async wrapper and `ws_guard`.

    The guard's `op` is the command type after `haventory/`, with `/` as `_`.
    """

    op = command.removeprefix("haventory/").replace("/", "_")
    schema = {vol.Required("type"): command, **(fields or {})}

    def decorator(func: AsyncWebSocketCommandHandler) -> WebSocketCommandHandler:
        guarded = websocket_api.async_response(ws_guard(op, context)(func))
        return websocket_api.websocket_command(schema)(guarded)

    return decorator


def _validate_bulk_ops(operations: Any) -> list[dict[str, Any]]:
    # `operations` is typed `object` in the schema, so this is the only check.
    if not isinstance(operations, list):
        raise ValidationError("operations must be a list")
    validated: list[dict[str, Any]] = []
    seen_op_ids: set[str] = set()
    for op in operations:
        if not isinstance(op, dict):
            raise ValidationError("each operation must be an object")
        if "op_id" not in op:
            raise ValidationError("operation missing op_id")
        op_id = op.get("op_id")
        if not isinstance(op_id, str | int):
            raise ValidationError("op_id must be a string or integer")
        # Results are keyed by `str(op_id)`, so `1` and `"1"` are one id and a
        # repeat would leave two operations sharing one verdict.
        normalized_op_id = str(op_id)
        if normalized_op_id in seen_op_ids:
            raise ValidationError(f"duplicate op_id in operations: {normalized_op_id}")
        seen_op_ids.add(normalized_op_id)
        kind = op.get("kind")
        # An unknown kind fails its own row, not the batch.
        if not isinstance(kind, str):
            raise ValidationError("kind must be a string")
        payload = op.get("payload")
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            raise ValidationError("operation.payload must be an object")
        validated.append({"op_id": normalized_op_id, "kind": kind, "payload": payload})
    return validated


#: The payload fields a refused bulk row names in its context, for every kind.
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
    """The verdict one refused row reads under its `op_id`, logged as `ws_guard` would."""

    context = _context_from_msg("items_bulk_op_failed", payload, _BULK_OP_CONTEXT_FIELDS)
    context["op_id"] = op_id
    context["kind"] = kind
    if isinstance(exc, _DOMAIN_ERRORS):
        error = _log_rejection(exc, context)
    else:
        LOGGER.exception("Unexpected error in a bulk operation", extra={**context})
        error = {"code": "unknown_error", "message": UNEXPECTED_ERROR_MESSAGE}
    return {"success": False, "error": {**error, "context": context}}


def _answer(written: ops.Written) -> Any:
    """What a committed write answers with on this surface.

    A delete answers `null`, since its body is a pre-delete snapshot; a status
    delete answers the removed status and how many items it rewrote.
    """

    if written.action != "deleted":
        return written.entity
    if written.noun == "status":
        return {"status": written.entity, "reassigned": len(written.reassigned)}
    return None


async def _mutate(
    hass: HomeAssistant,
    conn: _Conn,
    msg: _Msg,
    name: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Commit one op, then answer.

    The payload is the command's fields unless the handler built its own. The
    reply is sent after `ops.commit` returns, so an answer means the write is on
    disk and announced.
    """

    if payload is None:
        payload = {k: v for k, v in msg.items() if k not in {"id", "type"}}
    written = await ops.commit(hass, name, payload)
    conn.send_message(websocket_api.result_message(msg["id"], _answer(written)))


@_command("haventory/ping", {vol.Optional("echo"): object})
async def ws_ping(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    result = {"echo": msg.get("echo"), "ts": datetime.now(UTC).isoformat()}
    conn.send_message(websocket_api.result_message(msg["id"], result))


def _schema_version(hass: HomeAssistant) -> int:
    return loaded_runtime(hass).store.schema_version


@_command("haventory/version")
async def ws_version(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    result = {"integration_version": INTEGRATION_VERSION, "schema_version": _schema_version(hass)}
    conn.send_message(websocket_api.result_message(msg["id"], result))


@_command("haventory/config")
async def ws_config(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Return what the card cannot know on its own, not the whole options set.

    The attachment caps let the picker refuse an oversized file before sending
    it; the backend enforces them regardless.
    """
    runtime = loaded_runtime(hass)
    result = {
        "card_title": runtime.card_title,
        # `null` leaves the choice to the dashboard's own `quick_filters:`; an
        # empty list is an explicit choice of no pills. The two never collapse.
        "quick_filters": runtime.quick_filters,
        "statuses": [serialize_status_definition(d) for d in _repo(hass).list_statuses()],
        "media": {
            "picture_mime_types": list(ATTACHMENT_PICTURE_MIME_TYPES),
            "max_pictures_per_item": MAX_PICTURES_PER_ITEM,
            "manual_mime_types": list(ATTACHMENT_MANUAL_MIME_TYPES),
            "max_manuals_per_item": MAX_MANUALS_PER_ITEM,
            "max_attachment_bytes": MAX_ATTACHMENT_BYTES,
        },
    }
    conn.send_message(websocket_api.result_message(msg["id"], result))


@_command("haventory/stats")
async def ws_stats(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    conn.send_message(websocket_api.result_message(msg["id"], _repo(hass).get_counts()))


@_command("haventory/distinct_values", {vol.Optional("filter"): object})
async def ws_distinct_values(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    # A filter adds a matching count per value; the list itself never shrinks,
    # because the same payload feeds autocomplete.
    item_filter = msg.get("filter")
    validate_item_filter(item_filter)
    result = _repo(hass).get_distinct_field_values(item_filter)
    conn.send_message(websocket_api.result_message(msg["id"], result))


@_command("haventory/health")
async def ws_health(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    # `healthy` and `issues` are constant (an index disagreeing with its data is
    # a bug the test suite catches), but clients read them.
    result = {"healthy": True, "issues": [], "counts": _repo(hass).get_counts()}
    conn.send_message(websocket_api.result_message(msg["id"], result))


@_command(
    "haventory/subscribe",
    {
        vol.Required("topic"): str,
        # `object` so an explicit null clears a filter instead of being refused
        # by HA core's schema. `location_ids` is unioned with `location_id`.
        vol.Optional("location_id"): object,
        vol.Optional("location_ids"): object,
        vol.Optional("area_id"): object,
        vol.Optional("include_subtree"): bool,
        vol.Optional("inspection_overdue_only"): bool,
    },
    ("topic",),
)
async def ws_subscribe(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    topic = msg.get("topic")
    if topic not in {"items", "locations", "stats", "statuses"}:
        raise ValidationError("topic must be one of: items, locations, stats, statuses")
    sub: Subscription = {"topic": topic}
    if "location_id" in msg:
        sub["location_id"] = msg.get("location_id")
    if "location_ids" in msg:
        sub["location_ids"] = normalize_string_list(
            msg.get("location_ids"), field_name="location_ids"
        )
    if "area_id" in msg:
        sub["area_id"] = validate_area_filter(msg.get("area_id"))
    if "include_subtree" in msg:
        sub["include_subtree"] = bool(msg.get("include_subtree"))
    if "inspection_overdue_only" in msg:
        sub["inspection_overdue_only"] = bool(msg.get("inspection_overdue_only"))
    register_subscription(hass, conn, msg["id"], sub)
    LOGGER.debug(
        "Subscribed",
        extra={
            "op": "subscribe",
            "subscription_id": msg["id"],
            "topic": topic,
        },
    )
    conn.send_message(websocket_api.result_message(msg["id"], None))


@_command("haventory/unsubscribe", {vol.Required("subscription"): object}, ("subscription",))
async def ws_unsubscribe(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
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
            "op": "unsubscribe",
            "subscription_id": sub_id,
            "removed": removed,
        },
    )
    conn.send_message(websocket_api.result_message(msg["id"], None))


@_command(
    "haventory/item/create",
    {
        vol.Required("name"): object,
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
        vol.Optional("custom_fields"): object,
    },
    ("name",),
)
async def ws_item_create(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_create")


@_command("haventory/item/get", {vol.Required("item_id"): object}, ("item_id",))
async def ws_item_get(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    item = _repo(hass).get_item(msg["item_id"])
    conn.send_message(websocket_api.result_message(msg["id"], serialize_item(hass, item)))


@_command(
    "haventory/item/update",
    {
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
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
        vol.Optional("custom_fields_set"): object,
        vol.Optional("custom_fields_unset"): object,
    },
    ("item_id", "expected_version"),
)
async def ws_item_update(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_update")


@_command(
    "haventory/item/delete",
    {vol.Required("item_id"): object, vol.Optional("expected_version"): int},
    ("item_id", "expected_version"),
)
async def ws_item_delete(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_delete")


@_command(
    "haventory/item/adjust_quantity",
    {
        vol.Required("item_id"): object,
        vol.Required("delta"): object,
        vol.Optional("expected_version"): int,
    },
    ("item_id", "delta", "expected_version"),
)
async def ws_item_adjust_quantity(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_adjust_quantity")


@_command(
    "haventory/item/set_quantity",
    {
        vol.Required("item_id"): object,
        vol.Required("quantity"): object,
        vol.Optional("expected_version"): int,
    },
    ("item_id", "quantity", "expected_version"),
)
async def ws_item_set_quantity(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_set_quantity")


@_command(
    "haventory/item/check_out",
    {
        vol.Required("item_id"): object,
        vol.Optional("due_date"): vol.Any(str, None),
        vol.Optional("expected_version"): int,
    },
    ("item_id", "due_date", "expected_version"),
)
async def ws_item_check_out(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_check_out")


@_command(
    "haventory/item/check_in",
    {vol.Required("item_id"): object, vol.Optional("expected_version"): int},
    ("item_id", "expected_version"),
)
async def ws_item_check_in(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_check_in")


@_command(
    "haventory/reminder/set",
    {
        vol.Required("item_id"): object,
        vol.Required("reminder_date"): str,
        vol.Optional("reminder_interval"): vol.Any(dict, None),
        vol.Optional("expected_version"): int,
    },
    ("item_id", "reminder_date", "expected_version"),
)
async def ws_reminder_set(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "reminder_set")


@_command(
    "haventory/reminder/clear",
    {vol.Required("item_id"): object, vol.Optional("expected_version"): int},
    ("item_id", "expected_version"),
)
async def ws_reminder_clear(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "reminder_clear")


@_command(
    "haventory/reminder/bump",
    {vol.Required("item_id"): object, vol.Optional("expected_version"): int},
    ("item_id", "expected_version"),
)
async def ws_reminder_bump(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    # The next date is computed server-side, so two clients bumping the same
    # reminder land on the same answer.
    await _mutate(hass, conn, msg, "reminder_bump")


@_command(
    "haventory/item/add_tags",
    {
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("tags"): object,
    },
    ("item_id", "expected_version"),
)
async def ws_item_add_tags(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_add_tags")


@_command(
    "haventory/item/remove_tags",
    {
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("tags"): object,
    },
    ("item_id", "expected_version"),
)
async def ws_item_remove_tags(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_remove_tags")


@_command(
    "haventory/item/update_custom_fields",
    {
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("set"): object,
        vol.Optional("unset"): object,
    },
    ("item_id", "expected_version"),
)
async def ws_item_update_custom_fields(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_update_custom_fields")


@_command(
    "haventory/item/set_low_stock_threshold",
    {
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("low_stock_threshold"): object,
    },
    ("item_id", "expected_version"),
)
async def ws_item_set_low_stock_threshold(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_set_low_stock_threshold")


@_command(
    "haventory/item/attachment/add",
    {
        vol.Required("item_id"): object,
        # The handle core's `/api/file_upload` hands back after the POST.
        vol.Required("file_id"): str,
        vol.Optional("kind"): str,
        # Display only: the stored name comes from the attachment id and type.
        vol.Optional("filename"): str,
        vol.Optional("expected_version"): int,
    },
    ("item_id", "kind", "expected_version"),
)
async def ws_item_attachment_add(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Consume an uploaded file and attach it to an item.

    The bytes ride core's ``file_upload``, not the WebSocket. Nothing the client
    claimed is trusted: the type is sniffed from the file's leading bytes and
    both caps are enforced here.
    """

    kind = msg.get("kind", "picture")
    if kind not in ATTACHMENT_KINDS:
        raise ValidationError(f"kind must be one of: {', '.join(ATTACHMENT_KINDS)}")

    repo = _repo(hass)
    item_id = msg["item_id"]
    expected = msg.get("expected_version")
    # Check the version before consuming the upload: the temp file is destroyed
    # either way, so failing afterwards would cost the user the upload too.
    current = repo.get_item(item_id)
    if expected is not None and current.version != expected:
        raise ConflictError(
            f"version conflict: expected {expected}, actual {current.version}",
            key="version_conflict",
            placeholders={"expected": expected, "actual": current.version},
        )

    attachment_id = new_uuid4()
    # Both halves of `file_upload`'s context manager run in the executor: its
    # teardown walks and deletes the temp directory, which would stall the loop.
    upload_handle = process_uploaded_file(hass, msg["file_id"])
    try:
        # Only this call maps `ValueError`: `file_upload` raises it for an
        # unknown or already consumed id.
        source = await hass.async_add_executor_job(upload_handle.__enter__)
    except ValueError as exc:
        raise NotFoundError(
            "uploaded file not found; upload it again", key="upload_not_found"
        ) from exc

    try:
        mime, size = await media_mod.async_consume_upload(
            hass,
            source=source,
            kind=kind,
            item_id=str(current.id),
            attachment_id=str(attachment_id),
        )
    finally:
        # Shielded so a cancelled command still removes its temp directory:
        # nothing else collects these files.
        await asyncio.shield(hass.async_add_executor_job(upload_handle.__exit__, None, None, None))

    meta = AttachmentMeta(
        id=attachment_id,
        kind=kind,
        filename=str(msg.get("filename") or f"{attachment_id}"),
        mime=mime,
        size=size,
        uploaded_at=iso_utc_now(),
    )
    payload = {"item_id": item_id, "meta": meta, "expected_version": expected}
    await _mutate(hass, conn, msg, "item_attachment_add", payload)


@_command(
    "haventory/item/attachment/remove",
    {
        vol.Required("item_id"): object,
        vol.Required("attachment_id"): object,
        vol.Optional("expected_version"): int,
    },
    ("item_id", "attachment_id", "expected_version"),
)
async def ws_item_attachment_remove(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Detach one file from an item and delete its bytes."""

    # The bytes go after the save: a failed save then leaves an orphan the sweep
    # collects, rather than metadata pointing at bytes that are gone.
    await _mutate(hass, conn, msg, "item_attachment_remove")


@_command(
    "haventory/item/attachment/update",
    {
        vol.Required("item_id"): object,
        vol.Required("attachment_id"): object,
        vol.Required("title"): str,
        vol.Optional("expected_version"): int,
    },
    ("item_id", "attachment_id", "expected_version"),
)
async def ws_item_attachment_update(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Retitle one attachment. The file on disk is untouched."""

    await _mutate(hass, conn, msg, "item_attachment_update")


@_command(
    "haventory/item/attachment/reorder",
    {
        vol.Required("item_id"): object,
        vol.Required("kind"): str,
        vol.Required("attachment_ids"): object,
        vol.Optional("expected_version"): int,
    },
    ("item_id", "kind", "expected_version"),
)
async def ws_item_attachment_reorder(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Renumber one kind's attachments; the first named becomes position 0.

    A picture at position 0 is the item's cover, so "make cover" is this command.
    """

    await _mutate(hass, conn, msg, "item_attachment_reorder")


@_command(
    "haventory/item/move",
    {
        vol.Required("item_id"): object,
        vol.Optional("expected_version"): int,
        vol.Optional("location_id"): object,
    },
    ("item_id", "location_id", "expected_version"),
)
async def ws_item_move(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "item_move")


@_command("haventory/items/bulk", {vol.Required("operations"): object})
async def ws_items_bulk(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    operations = _validate_bulk_ops(msg.get("operations"))
    # Seeded in request order, so the answer lists rows as they were sent.
    results: dict[str, dict[str, object]] = {op["op_id"]: {} for op in operations}

    def refused(index: int, exc: Exception) -> None:
        op = operations[index]
        results[op["op_id"]] = _bulk_op_error(op["op_id"], op["kind"], op["payload"], exc)

    rows = [(op["kind"], op["payload"]) for op in operations]
    written = await ops.commit_batch(hass, rows, refused=refused)
    for op, row in zip(operations, written, strict=True):
        if row is not None:
            results[op["op_id"]] = {"success": True, "result": row.entity}

    successful = sum(row is not None for row in written)
    # Each failed row has already logged its own reason.
    if successful:
        LOGGER.info(
            "Bulk operation completed",
            extra={
                "op": "items_bulk",
                "total_ops": len(operations),
                "successful": successful,
                "failed": len(operations) - successful,
            },
        )
    conn.send_message(websocket_api.result_message(msg["id"], {"results": results}))


@_command(
    "haventory/item/list",
    {
        vol.Optional("filter"): object,
        vol.Optional("sort"): object,
        vol.Optional("limit"): object,
        vol.Optional("cursor"): object,
    },
)
async def ws_item_list(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    flt = msg.get("filter")
    sort = msg.get("sort")
    limit = msg.get("limit")
    cursor = msg.get("cursor")
    validate_item_filter(flt)
    validate_sort(sort)
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int)):
        raise ValidationError("limit must be an integer")
    if cursor is not None and (not isinstance(cursor, str) or not cursor):
        # Omitting the key is how a caller asks for page one.
        raise ValidationError("cursor must be a non-empty string")
    page = _repo(hass).list_items(flt=flt, sort=sort, limit=limit, cursor=cursor)
    result = {
        "items": [serialize_item(hass, it) for it in page["items"]],
        "next_cursor": page.get("next_cursor"),
        "total": page["total"],
    }
    conn.send_message(websocket_api.result_message(msg["id"], result))


@_command(
    "haventory/location/create",
    {
        vol.Required("name"): object,
        vol.Optional("parent_id"): object,
        vol.Optional("area_id"): object,
    },
    ("name", "parent_id"),
)
async def ws_location_create(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "location_create")


@_command("haventory/location/get", {vol.Required("location_id"): object}, ("location_id",))
async def ws_location_get(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    loc = _repo(hass).get_location(msg["location_id"])
    conn.send_message(websocket_api.result_message(msg["id"], serialize_location(loc)))


@_command(
    "haventory/location/update",
    {
        vol.Required("location_id"): object,
        vol.Optional("new_parent_id"): object,
        vol.Optional("name"): object,
        vol.Optional("area_id"): object,
    },
    ("location_id", "new_parent_id", "name"),
)
async def ws_location_update(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "location_update")


@_command("haventory/location/delete", {vol.Required("location_id"): object}, ("location_id",))
async def ws_location_delete(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "location_delete")


@_command("haventory/location/list")
async def ws_location_list(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    data = [serialize_location(loc) for loc in _repo(hass).iter_locations()]
    conn.send_message(websocket_api.result_message(msg["id"], data))


@_command("haventory/location/tree", {vol.Optional("filter"): object})
async def ws_location_tree(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    repo = _repo(hass)

    # With a filter, every node also reports how much of it the filter keeps,
    # counted once here and rolled up rather than queried per location.
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
    conn.send_message(websocket_api.result_message(msg["id"], tree))


@_command(
    "haventory/location/move_subtree",
    {vol.Required("location_id"): object, vol.Optional("new_parent_id"): object},
    ("location_id", "new_parent_id"),
)
async def ws_location_move_subtree(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "location_move_subtree")


@_command("haventory/status/list")
async def ws_status_list(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    data = [serialize_status_definition(d) for d in _repo(hass).list_statuses()]
    conn.send_message(websocket_api.result_message(msg["id"], data))


@_command(
    "haventory/status/create",
    {
        vol.Required("slug"): str,
        vol.Required("label"): str,
        vol.Optional("color"): str,
        vol.Optional("icon"): str,
        vol.Optional("order"): int,
    },
    ("slug",),
)
async def ws_status_create(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    await _mutate(hass, conn, msg, "status_create")


@_command(
    "haventory/status/update",
    {
        vol.Required("slug"): str,
        vol.Optional("label"): str,
        vol.Optional("color"): str,
        vol.Optional("icon"): str,
        vol.Optional("order"): int,
    },
    ("slug",),
)
async def ws_status_update(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Edit a status's presentation; no item or item version moves."""
    await _mutate(hass, conn, msg, "status_update")


@_command("haventory/status/reorder", {vol.Required("slugs"): object})
async def ws_status_reorder(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Rewrite display order from a full permutation of the live slugs."""
    await _mutate(hass, conn, msg, "status_reorder")


@_command(
    "haventory/status/delete",
    {vol.Required("slug"): str, vol.Optional("reassign_to"): str},
    ("slug", "reassign_to"),
)
async def ws_status_delete(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    """Remove a status, optionally moving the items that carry it first.

    Refused while items still carry the slug and no target is given.
    """
    await _mutate(hass, conn, msg, "status_delete")


@_command("haventory/areas/list")
async def ws_areas_list(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    areas = [{"id": a.id, "name": a.name} for a in ar.async_get(hass).async_list_areas()]
    conn.send_message(websocket_api.result_message(msg["id"], {"areas": areas}))


@_command("haventory/export", {vol.Optional("filter"): object})
async def ws_export(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    item_filter = msg.get("filter")
    validate_item_filter(item_filter)
    document = import_export.build_export_document(
        _repo(hass), item_filter=item_filter, schema_version=_schema_version(hass)
    )
    conn.send_message(websocket_api.result_message(msg["id"], document))


async def _count_missing_attachments(hass: HomeAssistant, target: dict[str, Any]) -> dict[str, int]:
    """How many attachment references the planned dataset has no file for.

    An export carries metadata, not bytes, so preview reports the gap rather
    than refusing the document; the card renders a "file missing" state.
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


def _import_policy(msg: _Msg) -> Policy:
    policy = msg.get("policy", "merge")
    if policy not in POLICIES:
        raise ValidationError(f"policy must be one of: {', '.join(POLICIES)}")
    return cast("Policy", policy)


_IMPORT_FIELDS = {vol.Required("document"): dict, vol.Optional("policy"): str}


@_command("haventory/import/preview", _IMPORT_FIELDS)
async def ws_import_preview(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    policy = _import_policy(msg)
    report, target = import_export.plan_import(
        _repo(hass),
        msg.get("document"),
        policy=policy,
        current_schema_version=_schema_version(hass),
    )
    if target is not None:
        report["attachments"] = await _count_missing_attachments(hass, target)
    conn.send_message(websocket_api.result_message(msg["id"], report))


@_command("haventory/import/execute", _IMPORT_FIELDS)
async def ws_import_execute(hass: HomeAssistant, conn: _Conn, msg: _Msg) -> None:
    policy = _import_policy(msg)
    repo = _repo(hass)
    report, target = import_export.plan_import(
        repo, msg.get("document"), policy=policy, current_schema_version=_schema_version(hass)
    )
    if not report.get("valid") or target is None:
        errors = report.get("errors", [])
        LOGGER.warning(
            "Import rejected: invalid document",
            extra={"op": "import_execute", "error_count": len(errors)},
        )
        refusal = ValidationError("import document is invalid", key="import_document_invalid")
        error = {"code": "validation_error", "message": str(refusal), **translation_fields(refusal)}
        conn.send_message(
            _error_envelope(msg["id"], error, {"op": "import_execute", "errors": errors})
        )
        return

    # Not `_mutate`: the answer is the summary below, built after the commit.
    await ops.commit(hass, "import_execute", {"target": target})

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
            "op": "import_execute",
            "policy": policy,
            "items_total": summary["items"]["total"],
            "locations_total": summary["locations"]["total"],
        },
    )
    conn.send_message(websocket_api.result_message(msg["id"], summary))


# Home Assistant keys its command registry by type, so registering these again
# on a reload replaces each handler rather than adding a second.
HANDLERS: tuple[WebSocketCommandHandler, ...] = (
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
