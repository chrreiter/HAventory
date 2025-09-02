"""WebSocket command handlers for HAventory.

Implements CRUD and helper commands for items and locations.
Adheres to the envelope: input {id, type, ...payload}, output result_message/error_message.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .exceptions import ConflictError, NotFoundError, StorageError, ValidationError
from .models import ItemUpdate
from .repository import UNSET, Repository

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
        return websocket_api.result_message(msg.get("id", 0), _serialize_item(item))
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
        return websocket_api.result_message(msg.get("id", 0), _serialize_item(updated))
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
        _repo(hass).delete_item(msg.get("item_id"), expected_version=msg.get("expected_version"))
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
        return websocket_api.result_message(msg.get("id", 0), _serialize_item(item))
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
        return websocket_api.result_message(msg.get("id", 0), _serialize_item(item))
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
        return websocket_api.result_message(msg.get("id", 0), _serialize_item(item))
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
        return websocket_api.result_message(msg["id"], _serialize_item(item))
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
        return websocket_api.result_message(msg.get("id", 0), _serialize_location(loc))
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
        return websocket_api.result_message(msg["id"], _serialize_location(loc))
    except Exception as exc:
        ctx = {"op": "location_update", "location_id": msg.get("location_id")}
        return _error_message(hass, msg["id"], exc, context=ctx)


@websocket_api.websocket_command({"type": "haventory/location/delete"})
@websocket_api.async_response
async def ws_location_delete(hass: HomeAssistant, _conn, msg):
    try:
        if msg.get("type") != "haventory/location/delete":
            return None
        _repo(hass).delete_location(msg.get("location_id"))
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
        return websocket_api.result_message(msg.get("id", 0), _serialize_location(loc))
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
