"""Service registration and handlers for HAventory.

Exposes Home Assistant services under the ``haventory`` domain to perform
CRUD operations on items and locations. Input is validated with voluptuous
and operations are delegated to the in-memory ``Repository``.

Errors from the domain layer (validation, not found, conflicts, storage) are
logged with contextual fields and re-raised unchanged so Home Assistant
surfaces them to the caller.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Coroutine
from typing import Any, NoReturn

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse

from .const import DOMAIN
from .events import notify_derived_paths_changed, notify_mutation
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
from .repository import UNSET, Repository
from .serialization import serialize_item, serialize_location
from .storage import async_persist_repo as _storage_async_persist_repo

LOGGER = logging.getLogger(__name__)


# -----------------------------
# Validation schemas
# -----------------------------

_SCALAR = vol.Any(str, int, float, bool)

SCHEMA_ITEM_CREATE = vol.Schema(
    {
        vol.Required("name"): str,
        vol.Optional("description"): vol.Any(str, None),
        vol.Optional("quantity", default=1): int,
        vol.Optional("status"): str,
        vol.Optional("checked_out", default=False): bool,
        vol.Optional("due_date"): str,
        vol.Optional("inspection_date"): str,
        vol.Optional("location_id"): vol.Any(str, None),
        vol.Optional("tags", default=[]): [str],
        vol.Optional("category"): vol.Any(str, None),
        vol.Optional("low_stock_threshold"): vol.Any(int, None),
        vol.Optional("custom_fields", default={}): {str: _SCALAR},
    }
)

SCHEMA_ITEM_UPDATE = vol.Schema(
    {
        vol.Required("item_id"): str,
        vol.Optional("expected_version"): int,
        vol.Optional("name"): str,
        vol.Optional("description"): vol.Any(str, None),
        vol.Optional("quantity"): int,
        vol.Optional("status"): str,
        vol.Optional("checked_out"): bool,
        vol.Optional("due_date"): vol.Any(str, None),
        vol.Optional("inspection_date"): vol.Any(str, None),
        vol.Optional("location_id"): vol.Any(str, None),
        vol.Optional("tags"): vol.Any([str], None),
        vol.Optional("category"): vol.Any(str, None),
        vol.Optional("low_stock_threshold"): vol.Any(int, None),
        vol.Optional("custom_fields_set"): {str: _SCALAR},
        vol.Optional("custom_fields_unset"): [str],
    }
)

SCHEMA_ITEM_DELETE = vol.Schema(
    {vol.Required("item_id"): str, vol.Optional("expected_version"): int}
)

SCHEMA_ITEM_MOVE = vol.Schema(
    {
        vol.Required("item_id"): str,
        vol.Optional("new_location_id"): vol.Any(str, None),
        vol.Optional("expected_version"): int,
    }
)

SCHEMA_ITEM_ADJUST_QTY = vol.Schema(
    {
        vol.Required("item_id"): str,
        vol.Required("delta"): int,
        vol.Optional("expected_version"): int,
    }
)

SCHEMA_ITEM_SET_QTY = vol.Schema(
    {
        vol.Required("item_id"): str,
        vol.Required("quantity"): int,
        vol.Optional("expected_version"): int,
    }
)

SCHEMA_ITEM_CHECK_OUT = vol.Schema(
    {
        vol.Required("item_id"): str,
        vol.Required("due_date"): str,
        vol.Optional("expected_version"): int,
    }
)

SCHEMA_ITEM_CHECK_IN = vol.Schema(
    {vol.Required("item_id"): str, vol.Optional("expected_version"): int}
)

SCHEMA_LOCATION_CREATE = vol.Schema(
    {
        vol.Required("name"): str,
        vol.Optional("parent_id"): vol.Any(str, None),
        vol.Optional("area_id"): vol.Any(str, None),
    }
)

SCHEMA_LOCATION_UPDATE = vol.Schema(
    {
        vol.Required("location_id"): str,
        vol.Optional("name"): str,
        vol.Optional("new_parent_id"): vol.Any(str, None),
        vol.Optional("area_id"): vol.Any(str, None),
    }
)

SCHEMA_LOCATION_DELETE = vol.Schema({vol.Required("location_id"): str})


# -----------------------------
# Internal helpers
# -----------------------------


def _get_repo(hass: HomeAssistant) -> Repository:
    bucket = hass.data.get(DOMAIN) or {}
    repo = bucket.get("repository")
    if repo is None:
        raise NotLoadedError("repository not initialized; run integration setup")
    return repo  # type: ignore[return-value]


def _log_domain_error(op: str, context: dict[str, Any], exc: Exception) -> None:
    # A schema rejection is a validation_error by any other name; voluptuous
    # just raises it before the domain layer gets a chance to.
    code = "validation_error" if isinstance(exc, vol.Invalid) else error_code(exc)
    LOGGER.log(
        log_severity(code, exc),
        str(exc),
        extra={"domain": DOMAIN, "op": op, **context},
        exc_info=log_exc_info(code, exc),
    )


def _raise_service_error(op: str, context: dict[str, Any], exc: Exception) -> NoReturn:
    """Log and surface service errors so Home Assistant can report them.

    Annotated ``NoReturn`` so a handler's ``except`` branch is not a path that
    falls through to an implicit ``None`` response.
    """

    _log_domain_error(op, context, exc)
    raise exc


async def async_persist_repo(hass: HomeAssistant) -> None:
    """Persist immediately after a successful service mutation.

    Services are user-initiated and infrequent; prefer immediate durability.
    Exposed for tests to monkeypatch failure paths.
    """
    await _storage_async_persist_repo(hass)


# -----------------------------
# Service handlers (exported for tests)
# -----------------------------


async def service_item_create(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_create"
    try:
        payload = SCHEMA_ITEM_CREATE(data)
        repo = _get_repo(hass)
        item = repo.create_item(payload)  # type: ignore[arg-type]
        await async_persist_repo(hass)
        serialized = serialize_item(hass, item)
        notify_mutation(hass, action="created", item=serialized)
        return {"item": serialized}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"item_name": data.get("name")}, exc)


async def service_item_update(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_update"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_UPDATE(data)
        expected = payload.get("expected_version")
        update = {k: v for k, v in payload.items() if k not in {"item_id", "expected_version"}}
        repo = _get_repo(hass)
        item = repo.update_item(payload["item_id"], update, expected_version=expected)  # type: ignore[arg-type]
        await async_persist_repo(hass)
        serialized = serialize_item(hass, item)
        notify_mutation(hass, action="updated", item=serialized)
        return {"item": serialized}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"item_id": item_id}, exc)


async def service_item_delete(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_delete"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_DELETE(data)
        expected = payload.get("expected_version")
        repo = _get_repo(hass)
        # Read the body before removing it: the delete returns nothing, and after it
        # the item is unreachable. An unknown id raises NotFoundError here exactly as
        # the delete would, so the pre-read adds no error surface.
        removed = serialize_item(hass, repo.get_item(payload["item_id"]))
        repo.delete_item(payload["item_id"], expected_version=expected)
        await async_persist_repo(hass)
        notify_mutation(hass, action="deleted", item=removed)
        return {"item": removed}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"item_id": item_id}, exc)


async def service_item_move(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_move"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_MOVE(data)
        update = {"location_id": payload.get("new_location_id")}
        expected = payload.get("expected_version")
        repo = _get_repo(hass)
        item = repo.update_item(payload["item_id"], update, expected_version=expected)  # type: ignore[arg-type]
        await async_persist_repo(hass)
        serialized = serialize_item(hass, item)
        notify_mutation(hass, action="moved", item=serialized)
        return {"item": serialized}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(
            op, {"item_id": item_id, "new_location_id": data.get("new_location_id")}, exc
        )


async def service_item_adjust_quantity(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_adjust_quantity"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_ADJUST_QTY(data)
        repo = _get_repo(hass)
        item = repo.adjust_quantity(
            payload["item_id"], payload["delta"], expected_version=payload.get("expected_version")
        )
        await async_persist_repo(hass)
        serialized = serialize_item(hass, item)
        notify_mutation(hass, action="quantity_changed", item=serialized)
        return {"item": serialized}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"item_id": item_id, "delta": data.get("delta")}, exc)


async def service_item_set_quantity(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_set_quantity"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_SET_QTY(data)
        repo = _get_repo(hass)
        item = repo.set_quantity(
            payload["item_id"],
            payload["quantity"],
            expected_version=payload.get("expected_version"),
        )
        await async_persist_repo(hass)
        serialized = serialize_item(hass, item)
        notify_mutation(hass, action="quantity_changed", item=serialized)
        return {"item": serialized}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"item_id": item_id, "quantity": data.get("quantity")}, exc)


async def service_item_check_out(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_check_out"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_CHECK_OUT(data)
        repo = _get_repo(hass)
        item = repo.check_out(
            payload["item_id"],
            due_date=payload["due_date"],
            expected_version=payload.get("expected_version"),
        )
        await async_persist_repo(hass)
        serialized = serialize_item(hass, item)
        notify_mutation(hass, action="checked_out", item=serialized)
        return {"item": serialized}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"item_id": item_id, "due_date": data.get("due_date")}, exc)


async def service_item_check_in(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "item_check_in"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_CHECK_IN(data)
        repo = _get_repo(hass)
        item = repo.check_in(payload["item_id"], expected_version=payload.get("expected_version"))
        await async_persist_repo(hass)
        serialized = serialize_item(hass, item)
        notify_mutation(hass, action="checked_in", item=serialized)
        return {"item": serialized}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"item_id": item_id}, exc)


async def service_location_create(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "location_create"
    try:
        payload = SCHEMA_LOCATION_CREATE(data)
        repo = _get_repo(hass)
        loc = repo.create_location(
            name=payload["name"],
            parent_id=payload.get("parent_id"),
            area_id=payload.get("area_id"),
        )
        await async_persist_repo(hass)
        return {"location": serialize_location(loc)}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"location_name": data.get("name")}, exc)


async def service_location_update(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "location_update"
    location_id = data.get("location_id")
    try:
        payload = SCHEMA_LOCATION_UPDATE(data)
        new_parent = payload["new_parent_id"] if "new_parent_id" in payload else UNSET
        area_id = payload["area_id"] if "area_id" in payload else UNSET
        repo = _get_repo(hass)
        before = repo.get_location(payload["location_id"])
        was_named, was_below = before.name, before.parent_id
        loc = repo.update_location(
            payload["location_id"],
            name=payload.get("name"),
            new_parent_id=new_parent,
            area_id=area_id,
        )
        await async_persist_repo(hass)
        # A rename or a re-parent rewrites the path denormalized onto every item
        # underneath, and the calendar renders those paths. No bus event: the
        # items themselves did not change.
        if loc.name != was_named or loc.parent_id != was_below:
            notify_derived_paths_changed(hass)
        return {"location": serialize_location(loc)}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"location_id": location_id}, exc)


async def service_location_delete(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    op = "location_delete"
    location_id = data.get("location_id")
    try:
        payload = SCHEMA_LOCATION_DELETE(data)
        repo = _get_repo(hass)
        removed = serialize_location(repo.get_location(payload["location_id"]))
        repo.delete_location(payload["location_id"])
        await async_persist_repo(hass)
        return {"location": removed}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(op, {"location_id": location_id}, exc)


# -----------------------------
# Registration
# -----------------------------

ServiceHandler = Callable[[HomeAssistant, dict[str, Any]], Coroutine[Any, Any, dict[str, Any]]]

# Service name -> (handler, voluptuous schema). Home Assistant validates the call
# against the schema before invoking the handler; the handler re-validates because
# it is also called directly (tests, and any in-process caller).
SERVICES: tuple[tuple[str, ServiceHandler, vol.Schema], ...] = (
    ("item_create", service_item_create, SCHEMA_ITEM_CREATE),
    ("item_update", service_item_update, SCHEMA_ITEM_UPDATE),
    ("item_delete", service_item_delete, SCHEMA_ITEM_DELETE),
    ("item_move", service_item_move, SCHEMA_ITEM_MOVE),
    ("item_adjust_quantity", service_item_adjust_quantity, SCHEMA_ITEM_ADJUST_QTY),
    ("item_set_quantity", service_item_set_quantity, SCHEMA_ITEM_SET_QTY),
    ("item_check_out", service_item_check_out, SCHEMA_ITEM_CHECK_OUT),
    ("item_check_in", service_item_check_in, SCHEMA_ITEM_CHECK_IN),
    ("location_create", service_location_create, SCHEMA_LOCATION_CREATE),
    ("location_update", service_location_update, SCHEMA_LOCATION_UPDATE),
    ("location_delete", service_location_delete, SCHEMA_LOCATION_DELETE),
)


def _bind(
    hass: HomeAssistant, handler: ServiceHandler
) -> Callable[[ServiceCall], Coroutine[Any, Any, dict[str, Any]]]:
    """Adapt a ``(hass, data)`` handler to the ``ServiceCall`` signature HA invokes.

    The returned callable **must be a coroutine function**. Home Assistant classifies
    every service handler with ``HassJob``: anything that is neither a coroutine
    function nor a ``@callback`` is dispatched via ``async_add_executor_job``. A
    plain ``lambda call: handler(hass, ...)`` therefore runs on a worker thread,
    where it only *constructs* the coroutine — which HA then returns as the service
    response and never awaits, so the mutation silently never happens, and the
    caller's ``response_variable`` is handed the coroutine object.
    """

    async def _handle(call: ServiceCall) -> dict[str, Any]:
        return await handler(hass, dict(call.data))

    return _handle


def setup(hass: HomeAssistant) -> None:
    """Register haventory.* services on Home Assistant."""

    # Idempotent: avoid duplicate registration across reloads
    bucket = hass.data.setdefault(DOMAIN, {})
    if bucket.get("services_registered"):
        return

    # In offline tests our HomeAssistant stub may not expose a services registry.
    if not hasattr(hass, "services") or not hasattr(hass.services, "async_register"):
        bucket["services_registered"] = True
        return

    # OPTIONAL, not ONLY: every one of these is a mutation first and an answer
    # second, so a caller that omits `response_variable` must keep working.
    for name, handler, schema in SERVICES:
        hass.services.async_register(
            DOMAIN,
            name,
            _bind(hass, handler),
            schema,
            supports_response=SupportsResponse.OPTIONAL,
        )

    bucket["services_registered"] = True
