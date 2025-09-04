"""Service registration and handlers for HAventory.

Exposes Home Assistant services under the ``haventory`` domain to perform
CRUD operations on items and locations. Input is validated with voluptuous
and operations are delegated to the in-memory ``Repository``.

Errors from the domain layer (validation, not found, conflicts) are logged
with contextual fields and do not raise stack traces.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .exceptions import ConflictError, NotFoundError, ValidationError
from .repository import UNSET, Repository
from .storage import async_persist_repo

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
        vol.Optional("checked_out", default=False): bool,
        vol.Optional("due_date"): str,
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
        vol.Optional("checked_out"): bool,
        vol.Optional("due_date"): vol.Any(str, None),
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
    {vol.Required("name"): str, vol.Optional("parent_id"): vol.Any(str, None)}
)

SCHEMA_LOCATION_UPDATE = vol.Schema(
    {
        vol.Required("location_id"): str,
        vol.Optional("name"): str,
        vol.Optional("new_parent_id"): vol.Any(str, None),
    }
)

SCHEMA_LOCATION_DELETE = vol.Schema({vol.Required("location_id"): str})


# -----------------------------
# Internal helpers
# -----------------------------


def _get_repo(hass: HomeAssistant) -> Repository:
    bucket = hass.data.setdefault(DOMAIN, {})
    repo = bucket.get("repository")
    if repo is None:
        repo = Repository()
        bucket["repository"] = repo
    return repo  # type: ignore[return-value]


def _log_domain_error(op: str, context: dict[str, Any], exc: Exception) -> None:
    level = logging.WARNING
    if isinstance(exc, ConflictError):
        level = logging.ERROR
    LOGGER.log(level, str(exc), extra={"domain": DOMAIN, "op": op, **context})


async def _persist_repo(hass: HomeAssistant) -> None:
    try:
        await async_persist_repo(hass)
    except Exception:  # pragma: no cover - defensive
        LOGGER.warning(
            "Failed to persist repository",
            exc_info=True,
            extra={"domain": DOMAIN, "op": "persist_repo"},
        )


# -----------------------------
# Service handlers (exported for tests)
# -----------------------------


async def service_item_create(hass: HomeAssistant, data: dict) -> None:
    op = "item_create"
    try:
        payload = SCHEMA_ITEM_CREATE(data)
        repo = _get_repo(hass)
        item = repo.create_item(payload)  # type: ignore[arg-type]
        LOGGER.debug(
            "Service item_create created item",
            extra={"domain": DOMAIN, "op": op, "item_id": item.id},
        )
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"name": data.get("name")}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_item_update(hass: HomeAssistant, data: dict) -> None:
    op = "item_update"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_UPDATE(data)
        expected = payload.get("expected_version")
        update = {k: v for k, v in payload.items() if k not in {"item_id", "expected_version"}}
        repo = _get_repo(hass)
        repo.update_item(payload["item_id"], update, expected_version=expected)  # type: ignore[arg-type]
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"item_id": item_id}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_item_delete(hass: HomeAssistant, data: dict) -> None:
    op = "item_delete"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_DELETE(data)
        expected = payload.get("expected_version")
        repo = _get_repo(hass)
        repo.delete_item(payload["item_id"], expected_version=expected)
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"item_id": item_id}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_item_move(hass: HomeAssistant, data: dict) -> None:
    op = "item_move"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_MOVE(data)
        update = {"location_id": payload.get("new_location_id")}
        expected = payload.get("expected_version")
        repo = _get_repo(hass)
        repo.update_item(payload["item_id"], update, expected_version=expected)  # type: ignore[arg-type]
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(
            op, {"item_id": item_id, "new_location_id": data.get("new_location_id")}, exc
        )
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_item_adjust_quantity(hass: HomeAssistant, data: dict) -> None:
    op = "item_adjust_quantity"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_ADJUST_QTY(data)
        repo = _get_repo(hass)
        repo.adjust_quantity(
            payload["item_id"], payload["delta"], expected_version=payload.get("expected_version")
        )
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"item_id": item_id, "delta": data.get("delta")}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_item_set_quantity(hass: HomeAssistant, data: dict) -> None:
    op = "item_set_quantity"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_SET_QTY(data)
        repo = _get_repo(hass)
        repo.set_quantity(
            payload["item_id"],
            payload["quantity"],
            expected_version=payload.get("expected_version"),
        )
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"item_id": item_id, "quantity": data.get("quantity")}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_item_check_out(hass: HomeAssistant, data: dict) -> None:
    op = "item_check_out"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_CHECK_OUT(data)
        repo = _get_repo(hass)
        repo.check_out(
            payload["item_id"],
            due_date=payload["due_date"],
            expected_version=payload.get("expected_version"),
        )
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"item_id": item_id, "due_date": data.get("due_date")}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_item_check_in(hass: HomeAssistant, data: dict) -> None:
    op = "item_check_in"
    item_id = data.get("item_id")
    try:
        payload = SCHEMA_ITEM_CHECK_IN(data)
        repo = _get_repo(hass)
        repo.check_in(payload["item_id"], expected_version=payload.get("expected_version"))
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"item_id": item_id}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_location_create(hass: HomeAssistant, data: dict) -> None:
    op = "location_create"
    try:
        payload = SCHEMA_LOCATION_CREATE(data)
        repo = _get_repo(hass)
        loc = repo.create_location(name=payload["name"], parent_id=payload.get("parent_id"))
        LOGGER.debug(
            "Service location_create created location",
            extra={"domain": DOMAIN, "op": op, "location_id": loc.id},
        )
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"name": data.get("name")}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_location_update(hass: HomeAssistant, data: dict) -> None:
    op = "location_update"
    location_id = data.get("location_id")
    try:
        payload = SCHEMA_LOCATION_UPDATE(data)
        new_parent = payload["new_parent_id"] if "new_parent_id" in payload else UNSET
        repo = _get_repo(hass)
        repo.update_location(
            payload["location_id"], name=payload.get("name"), new_parent_id=new_parent
        )
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"location_id": location_id}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


async def service_location_delete(hass: HomeAssistant, data: dict) -> None:
    op = "location_delete"
    location_id = data.get("location_id")
    try:
        payload = SCHEMA_LOCATION_DELETE(data)
        repo = _get_repo(hass)
        repo.delete_location(payload["location_id"])
        await _persist_repo(hass)
    except (ValidationError, NotFoundError, ConflictError) as exc:
        _log_domain_error(op, {"location_id": location_id}, exc)
    except Exception:  # pragma: no cover - defensive
        LOGGER.error("Unhandled service error", exc_info=True, extra={"domain": DOMAIN, "op": op})


# -----------------------------
# Registration
# -----------------------------


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

    # Home Assistant will validate inputs according to these schemas before
    # invoking the handler. Handlers are exported above for testability.
    hass.services.async_register(
        DOMAIN,
        "item_create",
        lambda call: service_item_create(hass, dict(call.data)),
        SCHEMA_ITEM_CREATE,
    )
    hass.services.async_register(
        DOMAIN,
        "item_update",
        lambda call: service_item_update(hass, dict(call.data)),
        SCHEMA_ITEM_UPDATE,
    )
    hass.services.async_register(
        DOMAIN,
        "item_delete",
        lambda call: service_item_delete(hass, dict(call.data)),
        SCHEMA_ITEM_DELETE,
    )
    hass.services.async_register(
        DOMAIN, "item_move", lambda call: service_item_move(hass, dict(call.data)), SCHEMA_ITEM_MOVE
    )
    hass.services.async_register(
        DOMAIN,
        "item_adjust_quantity",
        lambda call: service_item_adjust_quantity(hass, dict(call.data)),
        SCHEMA_ITEM_ADJUST_QTY,
    )
    hass.services.async_register(
        DOMAIN,
        "item_set_quantity",
        lambda call: service_item_set_quantity(hass, dict(call.data)),
        SCHEMA_ITEM_SET_QTY,
    )
    hass.services.async_register(
        DOMAIN,
        "item_check_out",
        lambda call: service_item_check_out(hass, dict(call.data)),
        SCHEMA_ITEM_CHECK_OUT,
    )
    hass.services.async_register(
        DOMAIN,
        "item_check_in",
        lambda call: service_item_check_in(hass, dict(call.data)),
        SCHEMA_ITEM_CHECK_IN,
    )

    hass.services.async_register(
        DOMAIN,
        "location_create",
        lambda call: service_location_create(hass, dict(call.data)),
        SCHEMA_LOCATION_CREATE,
    )
    hass.services.async_register(
        DOMAIN,
        "location_update",
        lambda call: service_location_update(hass, dict(call.data)),
        SCHEMA_LOCATION_UPDATE,
    )
    hass.services.async_register(
        DOMAIN,
        "location_delete",
        lambda call: service_location_delete(hass, dict(call.data)),
        SCHEMA_LOCATION_DELETE,
    )

    bucket["services_registered"] = True
