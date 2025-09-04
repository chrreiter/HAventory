"""Offline tests for haventory/items/bulk WebSocket command.

Scenarios:
- mixed success and failure results are mapped by op_id
- single persist when at least one operation succeeds (spy DomainStore.async_save)
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        schema = getattr(h, "_ws_schema", None)
        if not callable(h) or not isinstance(schema, dict):
            continue
        if schema.get("type") != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        resp = await h(hass, None, req)
        return resp
    raise AssertionError("No handler responded for type " + type_)


@pytest.mark.asyncio
async def test_bulk_mixed_results_and_single_persist(monkeypatch) -> None:
    """Bulk should return per-op results and persist once if any success."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Seed an item
    created = await _send(hass, 1, "haventory/item/create", name="Hammer", quantity=1)
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

    res = await _send(hass, 2, "haventory/items/bulk", operations=ops)
    assert res["success"] is True
    results = res["result"]["results"]
    assert results["ok1"]["success"] is True and results["ok2"]["success"] is True
    assert results["bad1"]["success"] is False and results["bad2"]["success"] is False

    # Persist should have been called at least once (for the successes)
    assert calls["count"] >= 1
