"""Offline tests for the error-mapping guarantees of the WS API.

Scenarios:
- every registered haventory/* command is wrapped by ws_guard
- unexpected (non-domain) exceptions map to unknown_error with a generic
  message; exception details never reach the client payload
- previously unguarded commands surface domain errors with taxonomy codes
  (stats/health/location list/tree with missing repository -> storage_error;
  subscribe with a bad topic -> validation_error)
- unsubscribe validates the subscription id -> validation_error
- bulk: a malformed per-op payload fails only its own op; unexpected per-op
  errors map to a per-op unknown_error without killing the batch
- broadcast failures never turn a successful mutation into an error
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from custom_components.haventory import ops as ops_module
from custom_components.haventory import subscriptions as subs_mod
from custom_components.haventory.ws import HANDLERS, UNEXPECTED_ERROR_MESSAGE
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, repo_of
from ws_helpers import RecordingConn, ws_send


def _make_hass(*, with_repo: bool = True) -> HomeAssistant:
    hass = HomeAssistant()
    if with_repo:
        install_runtime(hass)
    ws_setup(hass)
    return hass


def test_every_registered_command_is_guarded() -> None:
    """All haventory/* handlers must carry the ws_guard structural marker."""

    assert HANDLERS, "expected registered WS handlers"
    unguarded = [
        getattr(h, "__name__", repr(h))
        for h in HANDLERS
        if not getattr(h, "_haventory_ws_guard", False)
    ]
    assert unguarded == []


@pytest.mark.asyncio
async def test_unexpected_exception_maps_to_unknown_error_without_leaking(monkeypatch) -> None:
    """Non-domain exceptions -> unknown_error with a generic message only."""

    hass = _make_hass()

    def _boom(*_args: Any, **_kwargs: Any) -> dict:
        raise RuntimeError("SECRET-INTERNAL-DETAIL")

    # Patch the name in `ops`, not in `serialization`: the module that calls the
    # serializer binds it into its own namespace at import, so replacing it at
    # the source module would leave the call site pointing at the original.
    monkeypatch.setattr(ops_module, "serialize_item", _boom)
    conn = RecordingConn()
    res = await ws_send(hass, 5, "haventory/item/create", conn=conn, name="Widget")

    assert res["success"] is False
    assert res["error"]["code"] == "unknown_error"
    assert res["error"]["message"] == UNEXPECTED_ERROR_MESSAGE
    data = res["error"].get("data", {})
    assert data.get("op") == "item_create"
    # Neither the exception text nor a traceback may reach the wire.
    wire = json.dumps(res)
    assert "SECRET-INTERNAL-DETAIL" not in wire
    assert "Traceback" not in wire
    # The envelope was also sent on the connection.
    assert conn.messages and conn.messages[-1] == res


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "type_",
    [
        "haventory/stats",
        "haventory/health",
        "haventory/location/list",
        "haventory/location/tree",
    ],
)
async def test_repo_dependent_commands_map_missing_repo_to_storage_error(type_: str) -> None:
    """Missing repository surfaces as storage_error, not an escaped exception."""

    hass = _make_hass(with_repo=False)
    res = await ws_send(hass, 6, type_)

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"


@pytest.mark.asyncio
async def test_subscribe_bad_topic_maps_to_validation_error() -> None:
    hass = _make_hass()
    res = await ws_send(hass, 7, "haventory/subscribe", topic="nope")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert res["error"].get("data", {}).get("op") == "subscribe"


@pytest.mark.asyncio
async def test_unsubscribe_validates_subscription_id() -> None:
    hass = _make_hass()

    res = await ws_send(hass, 8, "haventory/unsubscribe", subscription="abc")
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    res = await ws_send(hass, 9, "haventory/unsubscribe", subscription={"x": 1})
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    # Numeric strings remain accepted.
    res = await ws_send(hass, 10, "haventory/unsubscribe", subscription="42")
    assert res["success"] is True


@pytest.mark.asyncio
async def test_bulk_malformed_custom_fields_payload_fails_only_that_op() -> None:
    """A payload that would raise TypeError fails per-op as validation_error."""

    hass = _make_hass()
    repo = repo_of(hass)
    item = repo.create_item({"name": "Widget", "quantity": 1})

    conn = RecordingConn()
    res = await ws_send(
        hass,
        11,
        "haventory/items/bulk",
        conn=conn,
        operations=[
            {
                "op_id": "bad-set",
                "kind": "item_update_custom_fields",
                "payload": {"item_id": str(item.id), "set": "not-an-object"},
            },
            {
                "op_id": "bad-unset",
                "kind": "item_update_custom_fields",
                "payload": {"item_id": str(item.id), "unset": 123},
            },
            {
                "op_id": "good",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": str(item.id), "delta": 2},
            },
        ],
    )

    assert res["success"] is True
    results = res["result"]["results"]
    assert results["bad-set"]["success"] is False
    assert results["bad-set"]["error"]["code"] == "validation_error"
    assert results["bad-unset"]["success"] is False
    assert results["bad-unset"]["error"]["code"] == "validation_error"
    assert results["good"]["success"] is True
    expected_quantity = 1 + 2  # initial quantity + applied delta
    assert repo.get_item(item.id).quantity == expected_quantity


@pytest.mark.asyncio
async def test_bulk_payload_field_validation_errors() -> None:
    """Missing/typed-wrong per-op payload fields fail their own op only."""

    hass = _make_hass()
    repo = repo_of(hass)
    item = repo.create_item({"name": "Widget", "quantity": 1})

    res = await ws_send(
        hass,
        13,
        "haventory/items/bulk",
        operations=[
            {"op_id": "no-id", "kind": "item_update", "payload": {"name": "X"}},
            {"op_id": "empty-id", "kind": "item_delete", "payload": {"item_id": ""}},
            {
                "op_id": "str-delta",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": str(item.id), "delta": "5"},
            },
            {
                "op_id": "bool-qty",
                "kind": "item_set_quantity",
                "payload": {"item_id": str(item.id), "quantity": True},
            },
            {
                "op_id": "good",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": str(item.id), "delta": 1},
            },
        ],
    )

    assert res["success"] is True
    results = res["result"]["results"]
    for op_id in ("no-id", "empty-id", "str-delta", "bool-qty"):
        assert results[op_id]["success"] is False, op_id
        assert results[op_id]["error"]["code"] == "validation_error", op_id
    assert results["good"]["success"] is True
    expected_quantity = 1 + 1  # initial quantity + the one valid delta
    assert repo.get_item(item.id).quantity == expected_quantity


@pytest.mark.asyncio
async def test_bulk_unexpected_per_op_error_is_contained(monkeypatch) -> None:
    """An unexpected exception in one op yields per-op unknown_error only."""

    hass = _make_hass()
    repo = repo_of(hass)
    item = repo.create_item({"name": "Widget", "quantity": 1})

    def _boom(_hass: HomeAssistant, _payload: dict) -> ops_module.Written:
        raise RuntimeError("SECRET-OP-DETAIL")

    monkeypatch.setitem(ops_module.OPS, "item_update", _boom)

    res = await ws_send(
        hass,
        12,
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "boom",
                "kind": "item_update",
                "payload": {"item_id": str(item.id), "name": "X"},
            },
            {
                "op_id": "good",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": str(item.id), "delta": 1},
            },
        ],
    )

    assert res["success"] is True
    results = res["result"]["results"]
    assert results["boom"]["success"] is False
    assert results["boom"]["error"]["code"] == "unknown_error"
    assert results["boom"]["error"]["message"] == UNEXPECTED_ERROR_MESSAGE
    assert "SECRET-OP-DETAIL" not in json.dumps(res)
    assert results["good"]["success"] is True


@pytest.mark.asyncio
async def test_broadcast_failure_does_not_fail_the_command(monkeypatch) -> None:
    """A raising event sender must not turn a successful mutation into an error."""

    hass = _make_hass()
    conn = RecordingConn()
    sub = await ws_send(hass, 100, "haventory/subscribe", conn=conn, topic="items")
    assert sub["success"] is True

    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("broadcast down")

    monkeypatch.setattr(subs_mod, "_send_event_message", _boom)

    res = await ws_send(hass, 101, "haventory/item/create", conn=conn, name="Widget")
    assert res["success"] is True
    repo = repo_of(hass)
    assert repo.get_counts()["items_total"] == 1
