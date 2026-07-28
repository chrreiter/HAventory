"""Offline tests for the boundary log-severity policy.

One policy governs every error the API boundary logs:

- ERROR only where an operator has to act — ``storage_error`` and
  ``unknown_error``.
- WARNING for contract-defined, client-recoverable rejections —
  ``validation_error``, ``not_found``, ``conflict``, ``rate_limited``.
- ``exc_info`` only where a traceback says something the message does not,
  which is the same two operator-actionable codes.

The conflict and not-found cases are load-bearing: ``release_testing_plan.md``
exit criterion 4 forbids any traceback from ``custom_components.haventory`` in
the HA log, and the release run deliberately provokes both.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest
import voluptuous as vol
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.rate_limit import RateLimitConfig, RateLimiter
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

WS_LOGGER = "custom_components.haventory.ws"
SERVICES_LOGGER = "custom_components.haventory.services"
RATE_LIMIT_LOGGER = "custom_components.haventory.rate_limit"


async def _send(hass: HomeAssistant, _id: int, type_: str, conn: object = None, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        schema = getattr(h, "_ws_schema", None)
        if not callable(h) or not isinstance(schema, dict):
            continue
        if schema.get("type") != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        return await h(hass, conn, req)
    raise AssertionError("No handler responded for type " + type_)


class _ConnStub:
    """A stable connection identity, so the limiter keys one bucket for it."""

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    def send_message(self, msg: dict[str, Any]) -> None:
        self.messages.append(msg)


def _make_hass(limiter: RateLimiter | None = None) -> HomeAssistant:
    hass = HomeAssistant()
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["repository"] = Repository()
    bucket["store"] = DomainStore(hass)
    if limiter is not None:
        bucket["rate_limiter"] = limiter
    ws_setup(hass)
    return hass


def _records(caplog, logger: str = WS_LOGGER) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == logger]


def _only(caplog, logger: str = WS_LOGGER) -> logging.LogRecord:
    records = _records(caplog, logger)
    assert len(records) == 1, f"expected exactly one {logger} record, got {records}"
    return records[0]


# -----------------------------
# Client-recoverable rejections: WARNING, no traceback
# -----------------------------


@pytest.mark.asyncio
async def test_validation_error_logs_warning_without_traceback(caplog) -> None:
    hass = _make_hass()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await _send(hass, 1, "haventory/item/set_quantity", item_id="any", quantity=-1)
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    record = _only(caplog)
    assert record.op == "item_set_quantity"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_not_found_logs_warning_without_traceback(caplog) -> None:
    hass = _make_hass()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await _send(hass, 2, "haventory/item/get", item_id="00000000-0000-4000-8000-000000000000")
    assert res["success"] is False and res["error"]["code"] == "not_found"

    record = _only(caplog)
    assert record.op == "item_get"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_conflict_logs_warning_without_traceback(caplog) -> None:
    """A stale ``expected_version`` is an HTTP-409 equivalent, not a crash."""

    hass = _make_hass()
    created = await _send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await _send(
        hass, 3, "haventory/item/update", item_id=item_id, expected_version=999, name="X"
    )
    assert res["success"] is False and res["error"]["code"] == "conflict"

    record = _only(caplog)
    assert record.op == "item_update"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_rate_limited_logs_warning_without_traceback(caplog) -> None:
    limiter = RateLimiter(
        RateLimitConfig(
            enabled=True,
            commands_per_second=1.0,
            commands_burst=1.0,
            global_commands_per_second=1.0,
            global_commands_burst=1000.0,
            events_per_second=1.0,
            events_burst=1000.0,
            global_events_per_second=1.0,
            global_events_burst=1000.0,
        )
    )
    hass = _make_hass(limiter)
    conn = _ConnStub()
    caplog.set_level(logging.DEBUG)

    assert (await _send(hass, 1, "haventory/ping", conn=conn))["success"] is True
    res = await _send(hass, 2, "haventory/ping", conn=conn)
    assert res["success"] is False and res["error"]["code"] == "rate_limited"

    # The rejection never reaches the WS error boundary; the limiter owns the
    # (throttled) log line.
    assert _records(caplog) == []
    record = _only(caplog, RATE_LIMIT_LOGGER)
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


# -----------------------------
# Operator-actionable failures: ERROR, with traceback
# -----------------------------


@pytest.mark.asyncio
async def test_storage_error_logs_error_with_traceback(caplog, monkeypatch) -> None:
    """The cause chain is the only record of what actually failed to write."""

    hass = _make_hass()

    async def _raise(*_args: Any, **_kwargs: Any) -> None:
        raise StorageError("failed to persist repository")

    monkeypatch.setattr(hass.data[DOMAIN]["store"], "async_save", _raise)
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await _send(hass, 1, "haventory/item/create", name="X")
    assert res["success"] is False and res["error"]["code"] == "storage_error"

    record = _only(caplog)
    assert record.op == "item_create"
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None


@pytest.mark.asyncio
async def test_unknown_error_logs_error_with_traceback(caplog, monkeypatch) -> None:
    """A non-domain exception has no vetted message, so the traceback is all there is."""

    hass = _make_hass()

    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("kaboom")

    monkeypatch.setattr(hass.data[DOMAIN]["repository"], "create_item", _boom)
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await _send(hass, 1, "haventory/item/create", name="X")
    assert res["success"] is False and res["error"]["code"] == "unknown_error"

    record = _only(caplog)
    assert record.op == "item_create"
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None


# -----------------------------
# Bulk ops classify per failing op, not per batch
# -----------------------------


@pytest.mark.asyncio
async def test_bulk_conflict_logs_warning_without_traceback(caplog) -> None:
    hass = _make_hass()
    created = await _send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await _send(
        hass,
        2,
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "a",
                "kind": "item_update",
                "payload": {"item_id": item_id, "expected_version": 999, "name": "X"},
            }
        ],
    )
    assert res["result"]["results"]["a"]["error"]["code"] == "conflict"

    failures = [r for r in _records(caplog) if r.op == "items_bulk_op_failed"]
    assert len(failures) == 1
    assert failures[0].levelno == logging.WARNING
    assert failures[0].exc_info is None


@pytest.mark.asyncio
async def test_bulk_unexpected_error_logs_error_with_traceback(caplog, monkeypatch) -> None:
    hass = _make_hass()
    created = await _send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("kaboom")

    monkeypatch.setattr(hass.data[DOMAIN]["repository"], "update_item", _boom)
    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await _send(
        hass,
        2,
        "haventory/items/bulk",
        operations=[
            {"op_id": "a", "kind": "item_update", "payload": {"item_id": item_id, "name": "X"}}
        ],
    )
    assert res["result"]["results"]["a"]["error"]["code"] == "unknown_error"

    failures = [r for r in _records(caplog) if r.op == "items_bulk_op_failed"]
    assert len(failures) == 1
    assert failures[0].levelno == logging.ERROR
    assert failures[0].exc_info is not None


# -----------------------------
# The service boundary follows the same policy
# -----------------------------


@pytest.mark.asyncio
async def test_service_conflict_logs_warning_without_traceback(caplog) -> None:
    hass = _make_hass()
    repo = hass.data[DOMAIN]["repository"]
    await services_mod.service_item_create(hass, {"name": "Widget"})
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=SERVICES_LOGGER)

    with pytest.raises(Exception, match="version"):
        await services_mod.service_item_update(
            hass, {"item_id": item_id, "expected_version": 999, "name": "X"}
        )

    record = _only(caplog, SERVICES_LOGGER)
    assert record.op == "item_update"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_service_schema_error_logs_warning_without_traceback(caplog) -> None:
    """``vol.Invalid`` is a validation rejection like any other."""

    hass = _make_hass()
    caplog.set_level(logging.DEBUG, logger=SERVICES_LOGGER)

    with pytest.raises(vol.Invalid):
        await services_mod.service_item_update(hass, {})

    record = _only(caplog, SERVICES_LOGGER)
    assert record.op == "item_update"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_service_storage_error_logs_error_with_traceback(caplog, monkeypatch) -> None:
    hass = _make_hass()

    async def _raise(*_args: Any, **_kwargs: Any) -> None:
        raise StorageError("failed to persist repository")

    monkeypatch.setattr(services_mod, "async_persist_repo", _raise)
    caplog.set_level(logging.DEBUG, logger=SERVICES_LOGGER)

    with pytest.raises(StorageError):
        await services_mod.service_item_create(hass, {"name": "X"})

    record = _only(caplog, SERVICES_LOGGER)
    assert record.op == "item_create"
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None
