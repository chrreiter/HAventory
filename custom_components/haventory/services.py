"""The ``haventory.*`` services.

Each service is its voluptuous schema plus the name of the op in ``ops.py`` it
runs, so a service and the WebSocket command doing the same thing share one
write and one event. The schemas here are concretely typed, so Home Assistant
refuses a wrong type in the Actions form before a handler runs, and every
service answers the ``{"item": …}`` / ``{"location": …}`` a
``response_variable`` reads. A domain refusal is logged and re-raised unchanged.
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
    """The refused call's fields, with `name` read as `item_name` / `location_name`."""

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


# Insertion order is registration order. `reminder_bump` is its own service because
# setting and clearing a reminder are `item_update`; bumping asks where the series
# goes next, which must be the answer the card gets.
SERVICES: dict[str, vol.Schema] = {
    "item_create": SCHEMA_ITEM_CREATE,
    "item_update": SCHEMA_ITEM_UPDATE,
    "item_delete": SCHEMA_ITEM_DELETE,
    "item_move": SCHEMA_ITEM_MOVE,
    "item_adjust_quantity": SCHEMA_ITEM_ADJUST_QTY,
    "item_set_quantity": SCHEMA_ITEM_SET_QTY,
    "item_check_out": SCHEMA_ITEM_CHECK_OUT,
    "item_check_in": SCHEMA_ITEM_CHECK_IN,
    "reminder_bump": SCHEMA_REMINDER_BUMP,
    "location_create": SCHEMA_LOCATION_CREATE,
    "location_update": SCHEMA_LOCATION_UPDATE,
    "location_delete": SCHEMA_LOCATION_DELETE,
}


def _handler(
    hass: HomeAssistant, name: str
) -> Callable[[ServiceCall], Coroutine[Any, Any, dict[str, Any]]]:
    """The ``ServiceCall`` handler for service ``name``.

    The returned callable **must be a coroutine function**. ``HassJob`` sends
    anything that is neither a coroutine function nor a ``@callback`` to the
    executor, so a plain ``lambda call: ops.commit(...)`` would only build the
    coroutine on a worker thread: HA returns it unawaited as the response, and
    the mutation silently never happens.
    """

    async def _handle(call: ServiceCall) -> dict[str, Any]:
        data = dict(call.data)
        try:
            written = await ops.commit(hass, name, _op_payload(name, data))
            # The whole entity: the next call in an automation needs its `version`.
            return {written.noun: written.entity}
        except (ValidationError, NotFoundError, ConflictError, StorageError) as exc:
            code = error_code(exc)
            LOGGER.log(
                log_severity(code, exc),
                str(exc),
                extra={"op": name, **_context(name, data)},
                exc_info=log_exc_info(code, exc),
            )
            raise

    return _handle


def setup(hass: HomeAssistant) -> None:
    """Register the ``haventory.*`` services; ``async_setup`` calls it once per run."""

    # OPTIONAL, not ONLY: each is a mutation first, so a caller that omits
    # `response_variable` must keep working.
    for name, schema in SERVICES.items():
        hass.services.async_register(
            DOMAIN,
            name,
            _handler(hass, name),
            schema,
            supports_response=SupportsResponse.OPTIONAL,
        )
