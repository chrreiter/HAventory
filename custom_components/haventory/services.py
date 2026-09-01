"""Service registration and handlers for HAventory.

Exposes Home Assistant services under the ``haventory`` domain to perform
CRUD operations on items and locations. Each service is its voluptuous schema
plus the name of the operation in ``ops.py`` it runs, so a service and the
WebSocket command doing the same thing reach the repository through one
function and announce one event.

What the services keep of their own is their ingress and their answer: the
schemas here are concretely typed, so Home Assistant refuses a wrong type in
the Actions form before a handler runs, and every service answers the
``{"item": …}`` / ``{"location": …}`` envelope a ``response_variable`` reads.

Errors from the domain layer (validation, not found, conflicts, storage) are
logged with contextual fields and re-raised unchanged so Home Assistant
surfaces them to the caller.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any, NoReturn

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse

from . import ops
from .const import DOMAIN
from .exceptions import (
    ConflictError,
    NotFoundError,
    StorageError,
    ValidationError,
    error_code,
    log_exc_info,
    log_severity,
)
from .logs import context_logger
from .storage import async_persist_repo as _storage_async_persist_repo

LOGGER = context_logger(__name__)


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
        # Permissive on purpose, exactly as the WebSocket commands are: the
        # shape rules live in `validate_reminder_rules`, which names what is
        # wrong with a value far better than a schema mismatch can.
        vol.Optional("reminder_date"): vol.Any(str, None),
        vol.Optional("reminder_interval"): vol.Any(dict, None),
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
        vol.Optional("reminder_date"): vol.Any(str, None),
        vol.Optional("reminder_interval"): vol.Any(dict, None),
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

SCHEMA_REMINDER_BUMP = vol.Schema(
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
    """
    await _storage_async_persist_repo(hass)


#: What each service's refusal names in its log line, the way `ws_guard`'s
#: `context_fields` name a command's. `item_name` and `location_name` read the
#: call's `name`: `name` is a reserved `LogRecord` key, which the record would
#: be dropped over.
_CONTEXT_FIELDS: dict[str, tuple[str, ...]] = {
    "item_create": ("item_name",),
    "item_update": ("item_id",),
    "item_delete": ("item_id",),
    "item_move": ("item_id", "new_location_id"),
    "item_adjust_quantity": ("item_id", "delta"),
    "item_set_quantity": ("item_id", "quantity"),
    "item_check_out": ("item_id", "due_date"),
    "item_check_in": ("item_id",),
    "reminder_bump": ("item_id",),
    "location_create": ("location_name",),
    "location_update": ("location_id",),
    "location_delete": ("location_id",),
}

_DATA_KEY = {"item_name": "name", "location_name": "name"}


def _context(name: str, data: dict[str, Any]) -> dict[str, Any]:
    """The refused call's own fields, read off what the caller sent.

    Off the call rather than off the validated payload: a call refused *by* the
    schema has no validated payload, and that is the refusal an operator most
    needs the fields of.
    """

    return {field: data.get(_DATA_KEY.get(field, field)) for field in _CONTEXT_FIELDS[name]}


def _op_payload(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """The operation's payload for a validated service call.

    One service names a field differently from the operation it runs:
    `item_move` takes `new_location_id`, where every other surface writing that
    field calls it `location_id`. The service name is what a household's
    automations are written against, so it is translated here rather than moved.
    """

    if name != "item_move":
        return payload
    moved = {key: value for key, value in payload.items() if key != "new_location_id"}
    # Always set, so a call that omits it moves the item to the top level.
    moved["location_id"] = payload.get("new_location_id")
    return moved


async def _run_service(hass: HomeAssistant, name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Run one service call: validate, write, persist, announce, answer.

    The order is the one every write path takes, and the reason is the same:
    the response and the event both follow the durable write, so a caller with a
    `response_variable` and a subscriber on the wire are told about a change
    only once it is on disk.
    """

    try:
        payload = _SCHEMAS[name](data)
        written = ops.run(hass, name, _op_payload(name, payload))
        await async_persist_repo(hass)
        await ops.announce(hass, written)
        # `item` / `location` — the entity the call touched, whole, because the
        # next call in the automation needs its `version` for `expected_version`.
        return {written.noun: written.entity}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        _raise_service_error(name, _context(name, data), exc)


async def service_item_create(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_create", data)


async def service_item_update(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_update", data)


async def service_item_delete(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_delete", data)


async def service_item_move(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_move", data)


async def service_item_adjust_quantity(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_adjust_quantity", data)


async def service_item_set_quantity(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_set_quantity", data)


async def service_item_check_out(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_check_out", data)


async def service_item_check_in(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "item_check_in", data)


async def service_reminder_bump(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    """Mark a recurring reminder done and move the series on one step.

    The one reminder verb that is not an ordinary field write: setting and
    clearing a reminder are `item_update` with `reminder_date` and
    `reminder_interval`, but "I have just done this" is a question about where
    the series goes next, and the answer has to be the same one the card gets.
    """

    return await _run_service(hass, "reminder_bump", data)


async def service_location_create(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "location_create", data)


async def service_location_update(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "location_update", data)


async def service_location_delete(hass: HomeAssistant, data: dict) -> dict[str, Any]:
    return await _run_service(hass, "location_delete", data)


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
    ("reminder_bump", service_reminder_bump, SCHEMA_REMINDER_BUMP),
    ("location_create", service_location_create, SCHEMA_LOCATION_CREATE),
    ("location_update", service_location_update, SCHEMA_LOCATION_UPDATE),
    ("location_delete", service_location_delete, SCHEMA_LOCATION_DELETE),
)

#: The same catalog, the way `_run_service` reads it. One table, so a service
#: that registers is a service that validates.
_SCHEMAS: dict[str, vol.Schema] = {name: schema for name, _handler, schema in SERVICES}


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
    """Register haventory.* services on Home Assistant.

    Idempotent because Home Assistant's registry is keyed by domain and service
    name: a reload registers over the top rather than adding a second handler.
    """

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
