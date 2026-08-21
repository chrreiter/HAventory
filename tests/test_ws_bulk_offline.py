"""Offline tests for haventory/items/bulk WebSocket command.

Scenarios:
- mixed success and failure results are mapped by op_id
- single persist when at least one operation succeeds (spy DomainStore.async_save)
"""

from __future__ import annotations

import pytest
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, runtime_of
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_bulk_mixed_results_and_single_persist(monkeypatch) -> None:
    """Bulk should return per-op results and persist once if any success."""

    hass = HomeAssistant()
    install_runtime(hass)
    store = DomainStore(hass)
    runtime_of(hass).store = store
    ws_setup(hass)

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Seed an item
    created = await ws_send(hass, 1, "haventory/item/create", name="Hammer", quantity=1)
    item_id = created["result"]["id"]

    ops = [
        {
            "op_id": "ok1",
            "kind": "item_adjust_quantity",
            "payload": {"item_id": item_id, "delta": 2},
        },
        {
            "op_id": "bad1",
            "kind": "item_set_quantity",
            "payload": {"item_id": item_id, "quantity": -1},
        },
        {
            "op_id": "ok2",
            "kind": "item_update_custom_fields",
            "payload": {"item_id": item_id, "set": {"color": "red"}},
        },
        {"op_id": "bad2", "kind": "unknown", "payload": {}},
    ]

    res = await ws_send(hass, 2, "haventory/items/bulk", operations=ops)
    assert res["success"] is True
    results = res["result"]["results"]
    assert results["ok1"]["success"] is True and results["ok2"]["success"] is True
    assert results["bad1"]["success"] is False and results["bad2"]["success"] is False

    # Persist should have been called at least once (for the successes)
    assert calls["count"] >= 1


@pytest.mark.asyncio
async def test_bulk_empty_and_invalid_operations_and_duplicate_ids(monkeypatch) -> None:
    """Bulk: empty returns empty results; invalid type rejected; dup op_id rejects."""

    hass = HomeAssistant()
    install_runtime(hass)
    store = DomainStore(hass)
    runtime_of(hass).store = store
    ws_setup(hass)

    calls = {"count": 0}

    async def _spy_save(_payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Empty operations list
    res = await ws_send(hass, 1, "haventory/items/bulk", operations=[])
    assert res["success"] is True and res["result"]["results"] == {}
    assert calls["count"] == 0  # nothing to persist

    # Invalid operations type: the command declares `operations` as `object`, so
    # the frame reaches the handler and is answered through the guard.
    res = await ws_send(hass, 2, "haventory/items/bulk", operations="oops")
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # The shape of each entry is the handler's to check too.
    res = await ws_send(hass, 3, "haventory/items/bulk", operations=["oops"])
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # Duplicate op_id: the batch is refused whole, because results are keyed by
    # op_id and a repeat would leave the caller one verdict for two operations.
    created = await ws_send(hass, 4, "haventory/item/create", name="X", quantity=1)
    iid = created["result"]["id"]
    START_QTY = 1
    ops = [
        {
            "op_id": "dup",
            "kind": "item_set_quantity",
            "payload": {"item_id": iid, "quantity": 2},
        },
        {
            "op_id": "dup",
            "kind": "item_set_quantity",
            "payload": {"item_id": iid, "quantity": 3},
        },
    ]
    res = await ws_send(hass, 5, "haventory/items/bulk", operations=ops)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "dup" in res["error"]["message"]
    # Nothing ran: the quantity is still what item/create left it at.
    got = await ws_send(hass, 6, "haventory/item/get", item_id=iid)
    assert got["result"]["quantity"] == START_QTY

    # `1` and `"1"` are one id, not two — the result map normalizes with str().
    ops_mixed = [
        {"op_id": 1, "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 2}},
        {"op_id": "1", "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 3}},
    ]
    res = await ws_send(hass, 7, "haventory/items/bulk", operations=ops_mixed)
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # Distinct ids still return one result each.
    ops_ok = [
        {"op_id": "a", "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 2}},
        {"op_id": "b", "kind": "item_set_quantity", "payload": {"item_id": iid, "quantity": 3}},
    ]
    res = await ws_send(hass, 8, "haventory/items/bulk", operations=ops_ok)
    assert res["success"] is True
    assert set(res["result"]["results"]) == {"a", "b"}
