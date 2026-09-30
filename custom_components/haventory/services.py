"""The ``haventory.*`` services.

Each service is its voluptuous schema plus the name of the op in ``ops.py`` it
runs, so a service and the WebSocket command doing the same thing share one
write and one event. The schemas here are concretely typed, so Home Assistant
refuses a wrong type in the Actions form before a handler runs, and every
service answers the ``{"item": …}`` / ``{"location": …}`` a
``response_variable`` reads. A refusal is logged and re-raised unchanged.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

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
from .storage import async_persist_repo

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
        # Permissive on purpose: `validate_reminder_rules` names what is wrong.
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


#: What each service's refusal names in its log line. `item_name` and
#: `location_name` read the call's `name`, a reserved `LogRecord` key.
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
    """The refused call's fields, read off the raw call so a schema refusal has them."""

    return {field: data.get(_DATA_KEY.get(field, field)) for field in _CONTEXT_FIELDS[name]}


def _op_payload(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Translate `item_move`'s `new_location_id` to the op's `location_id`.

    Automations are written against the service's field name, so it stays.
    """

    if name != "item_move":
        return payload
    moved = {key: value for key, value in payload.items() if key != "new_location_id"}
    # Always set, so a call that omits it moves the item to the top level.
    moved["location_id"] = payload.get("new_location_id")
    return moved


async def _run_service(hass: HomeAssistant, name: str, data: dict[str, Any]) -> dict[str, Any]:
    """Validate, write, persist, announce, answer: the order every write path takes."""

    try:
        payload = _SCHEMAS[name](data)
        written = ops.run(hass, name, _op_payload(name, payload))
        await async_persist_repo(hass)
        await ops.announce(hass, written)
        # The whole entity: the next call in an automation needs its `version`.
        return {written.noun: written.entity}
    except (vol.Invalid, ValidationError, NotFoundError, ConflictError, StorageError) as exc:
        # A schema refusal is a validation_error raised before the domain layer.
        code = "validation_error" if isinstance(exc, vol.Invalid) else error_code(exc)
        LOGGER.log(
            log_severity(code, exc),
            str(exc),
            extra={"domain": DOMAIN, "op": name, **_context(name, data)},
            exc_info=log_exc_info(code, exc),
        )
        raise


ServiceHandler = Callable[[HomeAssistant, dict[str, Any]], Coroutine[Any, Any, dict[str, Any]]]


def _service(name: str) -> ServiceHandler:
    async def handler(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
        return await _run_service(hass, name, data)

    handler.__name__ = f"service_{name}"
    return handler


service_item_create = _service("item_create")
service_item_update = _service("item_update")
service_item_delete = _service("item_delete")
service_item_move = _service("item_move")
service_item_adjust_quantity = _service("item_adjust_quantity")
service_item_set_quantity = _service("item_set_quantity")
service_item_check_out = _service("item_check_out")
service_item_check_in = _service("item_check_in")
# Setting and clearing a reminder are `item_update`; bumping asks where the
# series goes next, which must be the answer the card gets.
service_reminder_bump = _service("reminder_bump")
service_location_create = _service("location_create")
service_location_update = _service("location_update")
service_location_delete = _service("location_delete")

# Home Assistant validates a call against the schema before the handler runs;
# the handler validates again because it is also called directly.
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

_SCHEMAS: dict[str, vol.Schema] = {name: schema for name, _handler, schema in SERVICES}


def _bind(
    hass: HomeAssistant, handler: ServiceHandler
) -> Callable[[ServiceCall], Coroutine[Any, Any, dict[str, Any]]]:
    """Adapt a ``(hass, data)`` handler to the ``ServiceCall`` signature HA invokes.

    The returned callable **must be a coroutine function**. ``HassJob`` sends
    anything that is neither a coroutine function nor a ``@callback`` to the
    executor, so a plain ``lambda call: handler(hass, ...)`` would only build
    the coroutine on a worker thread: HA returns it unawaited as the response,
    and the mutation silently never happens.
    """

    async def _handle(call: ServiceCall) -> dict[str, Any]:
        return await handler(hass, dict(call.data))

    return _handle


def setup(hass: HomeAssistant) -> None:
    """Register the ``haventory.*`` services; a reload registers over the top."""

    # OPTIONAL, not ONLY: each is a mutation first, so a caller that omits
    # `response_variable` must keep working.
    for name, handler, schema in SERVICES:
        hass.services.async_register(
            DOMAIN,
            name,
            _bind(hass, handler),
            schema,
            supports_response=SupportsResponse.OPTIONAL,
        )
