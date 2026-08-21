"""Offline tests for the boundary log-severity policy.

One policy governs every error the API boundary logs:

- ERROR only where an operator has to act — ``storage_error`` and
  ``unknown_error``.
- WARNING for contract-defined, client-recoverable rejections —
  ``validation_error``, ``not_found``, ``conflict``, ``rate_limited``, and the
  ``storage_error`` a teardown leaves behind, which is a state somebody chose
  rather than a failure.
- ``exc_info`` only where a traceback says something the message does not.

The conflict and not-found cases are what the release run checks:
``release_testing_plan.md`` exit criterion 4 forbids any traceback from
``custom_components.haventory`` in the HA log, and the run provokes both.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest
import voluptuous as vol
from custom_components.haventory import services as services_mod
from custom_components.haventory.exceptions import NotLoadedError, StorageError
from custom_components.haventory.rate_limit import RateLimitConfig, RateLimiter
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, repo_of, runtime_of
from ws_helpers import RecordingConn, ws_send

WS_LOGGER = "custom_components.haventory.ws"
SERVICES_LOGGER = "custom_components.haventory.services"
RATE_LIMIT_LOGGER = "custom_components.haventory.rate_limit"


def _make_hass(limiter: RateLimiter | None = None) -> HomeAssistant:
    hass = HomeAssistant()
    install_runtime(hass, rate_limiter=limiter)
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

    res = await ws_send(hass, 1, "haventory/item/set_quantity", item_id="any", quantity=-1)
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    record = _only(caplog)
    assert record.op == "item_set_quantity"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_not_found_logs_warning_without_traceback(caplog) -> None:
    hass = _make_hass()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(
        hass, 2, "haventory/item/get", item_id="00000000-0000-4000-8000-000000000000"
    )
    assert res["success"] is False and res["error"]["code"] == "not_found"

    record = _only(caplog)
    assert record.op == "item_get"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_conflict_logs_warning_without_traceback(caplog) -> None:
    """A stale ``expected_version`` is an HTTP-409 equivalent, not a crash."""

    hass = _make_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(
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
    # One connection object across both sends: the limiter keys a bucket per
    # connection identity, so a second object would get a fresh budget.
    conn = RecordingConn()
    caplog.set_level(logging.DEBUG)

    assert (await ws_send(hass, 1, "haventory/ping", conn=conn))["success"] is True
    res = await ws_send(hass, 2, "haventory/ping", conn=conn)
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

    monkeypatch.setattr(runtime_of(hass).store, "async_save", _raise)
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(hass, 1, "haventory/item/create", name="X")
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

    monkeypatch.setattr(repo_of(hass), "create_item", _boom)
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(hass, 1, "haventory/item/create", name="X")
    assert res["success"] is False and res["error"]["code"] == "unknown_error"

    record = _only(caplog)
    assert record.op == "item_create"
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None


# -----------------------------
# The refusal a teardown leaves behind: same envelope, quieter log
# -----------------------------


def _make_unloaded_hass() -> HomeAssistant:
    """Commands registered with nothing behind them — what a teardown leaves."""

    hass = HomeAssistant()
    ws_setup(hass)
    return hass


@pytest.mark.asyncio
async def test_not_loaded_refusal_logs_warning_without_traceback(caplog) -> None:
    """An entry that is unloaded, disabled or removed is a state, not a fault.

    Nothing broke and no cause chain exists to print; the operator's move is to
    re-enable the entry, and the client's is to stop asking.
    """

    hass = _make_unloaded_hass()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(hass, 1, "haventory/item/create", name="X")
    assert res["success"] is False and res["error"]["code"] == "storage_error"

    record = _only(caplog)
    assert record.op == "item_create"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


@pytest.mark.asyncio
async def test_not_loaded_refusal_keeps_the_storage_error_envelope() -> None:
    """The wire contract does not move with the log level.

    ``NotLoadedError`` is a ``StorageError``, so clients that key on the code go
    on seeing exactly what they saw before.
    """

    hass = _make_unloaded_hass()
    conn = RecordingConn()

    res = await ws_send(hass, 1, "haventory/item/list", conn=conn)

    assert res["error"]["code"] == "storage_error"
    assert res["error"]["data"]["op"] == "item_list"
    assert res["error"]["message"]
    assert conn.messages[-1] == res


@pytest.mark.asyncio
async def test_a_retrying_client_leaves_no_tracebacks(caplog) -> None:
    """The flood case: a dashboard that keeps knocking must not fill the log.

    ``release_testing_plan.md`` exit criterion 4 audits the Home Assistant log
    for tracebacks from this integration, and a card left open across a removal
    retries for as long as the tab does.
    """

    hass = _make_unloaded_hass()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    retries = 12
    # Frame ids start at 1: Home Assistant refuses a non-positive id outright,
    # so a 0 would never reach the handler whose logging is under test.
    for i in range(1, retries + 1):
        assert (await ws_send(hass, i, "haventory/stats"))["error"]["code"] == "storage_error"

    records = _records(caplog)
    assert len(records) == retries
    assert {r.levelno for r in records} == {logging.WARNING}
    assert all(r.exc_info is None for r in records)


@pytest.mark.asyncio
async def test_a_real_storage_failure_still_logs_error_with_traceback(caplog, monkeypatch) -> None:
    """The quieter rule is scoped to the refusal, not to the code it maps to."""

    hass = _make_hass()

    async def _raise(*_args: Any, **_kwargs: Any) -> None:
        raise StorageError("failed to persist repository")

    monkeypatch.setattr(runtime_of(hass).store, "async_save", _raise)
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(hass, 1, "haventory/item/create", name="X")
    assert res["success"] is False and res["error"]["code"] == "storage_error"

    record = _only(caplog)
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None


@pytest.mark.asyncio
async def test_service_not_loaded_refusal_logs_warning_without_traceback(caplog) -> None:
    """The service boundary grades the same refusal the same way."""

    hass = _make_unloaded_hass()
    caplog.set_level(logging.DEBUG, logger=SERVICES_LOGGER)

    with pytest.raises(NotLoadedError):
        await services_mod.service_item_create(hass, {"name": "X"})

    record = _only(caplog, SERVICES_LOGGER)
    assert record.op == "item_create"
    assert record.levelno == logging.WARNING
    assert record.exc_info is None


# -----------------------------
# Bulk ops classify per failing op, not per batch
# -----------------------------


@pytest.mark.asyncio
async def test_bulk_conflict_logs_warning_without_traceback(caplog) -> None:
    hass = _make_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(
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
    created = await ws_send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("kaboom")

    monkeypatch.setattr(repo_of(hass), "update_item", _boom)
    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(
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


@pytest.mark.asyncio
async def test_all_failed_bulk_logs_only_its_per_op_lines(caplog) -> None:
    """A batch where nothing succeeded adds no summary of its own.

    The per-op lines already carry the ``op_id`` and reason an operator acts on;
    a batch-level "none of them worked" repeats that on the one path where the
    log is already at its longest.
    """

    hass = _make_hass()
    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    res = await ws_send(
        hass,
        1,
        "haventory/items/bulk",
        operations=[
            {"op_id": "a", "kind": "item_update", "payload": {"item_id": "missing-1"}},
            {"op_id": "b", "kind": "item_delete", "payload": {"item_id": "missing-2"}},
        ],
    )
    results = res["result"]["results"]
    assert {k: v["success"] for k, v in results.items()} == {"a": False, "b": False}

    records = _records(caplog)
    assert [r.op for r in records] == ["items_bulk_op_failed"] * 2
    assert {r.op_id for r in records} == {"a", "b"}


@pytest.mark.asyncio
async def test_partly_successful_bulk_still_logs_its_summary(caplog) -> None:
    """The summary survives where it still says something: a batch that changed state."""

    hass = _make_hass()
    created = await ws_send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)

    await ws_send(
        hass,
        2,
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "a",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": item_id, "delta": 1},
            },
            {"op_id": "b", "kind": "item_delete", "payload": {"item_id": "missing"}},
        ],
    )

    summaries = [r for r in _records(caplog) if r.op == "items_bulk"]
    assert len(summaries) == 1
    assert summaries[0].levelno == logging.INFO
    assert (summaries[0].successful, summaries[0].failed) == (1, 1)


# -----------------------------
# The service boundary follows the same policy
# -----------------------------


@pytest.mark.asyncio
async def test_service_conflict_logs_warning_without_traceback(caplog) -> None:
    hass = _make_hass()
    repo = repo_of(hass)
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
