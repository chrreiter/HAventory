"""Offline tests for haventory WebSocket location commands.

Scenarios:
- create/get/update/move_subtree/delete location via WS success
- list locations returns array
- tree returns nested structure
- error mapping for validation and not_found
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
    # Prefer exact type match on the handler schema
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
async def test_location_crud_and_tree() -> None:
    """Create a small tree, list, get, move via WS, and delete."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Create root and child
    res_root = await _send(hass, 1, "haventory/location/create", name="Root")
    root_id = res_root["result"]["id"]
    res_child = await _send(hass, 2, "haventory/location/create", name="Shelf", parent_id=root_id)
    child_id = res_child["result"]["id"]

    # Get
    res = await _send(hass, 3, "haventory/location/get", location_id=root_id)
    assert res["success"] is True and res["result"]["id"] == root_id

    # List
    res = await _send(hass, 4, "haventory/location/list")
    expected_locations_count = 2  # root + child
    assert res["success"] is True and len(res["result"]) == expected_locations_count

    # Tree
    res = await _send(hass, 5, "haventory/location/tree")
    assert res["success"] is True
    tree = res["result"]
    assert isinstance(tree, list) and len(tree) == 1
    assert tree[0]["id"] == root_id and tree[0]["children"][0]["id"] == child_id

    # Move subtree: move Shelf to root
    res = await _send(
        hass, 6, "haventory/location/move_subtree", location_id=child_id, new_parent_id=None
    )
    assert res["success"] is True

    # Delete child then root
    res = await _send(hass, 7, "haventory/location/delete", location_id=child_id)
    assert res["success"] is True
    res = await _send(hass, 8, "haventory/location/delete", location_id=root_id)
    assert res["success"] is True


@pytest.mark.asyncio
async def test_location_error_mapping() -> None:
    """Invalid operations yield validation/not_found errors."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)


@pytest.mark.asyncio
async def test_ws_location_mutations_persist_to_store(monkeypatch) -> None:
    """Location create/update/delete should persist via DomainStore.save."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    root = await _send(hass, 1, "haventory/location/create", name="Root")
    rid = root["result"]["id"]
    await _send(hass, 2, "haventory/location/update", location_id=rid, name="Root2")
    await _send(hass, 3, "haventory/location/delete", location_id=rid)
    MIN_PERSISTS_TOTAL = 3
    assert calls["count"] >= MIN_PERSISTS_TOTAL

    # Not found
    res = await _send(
        hass, 1, "haventory/location/get", location_id="00000000-0000-4000-8000-000000000000"
    )
    assert res["success"] is False and res["error"]["code"] == "not_found"

    # Validation: create with empty name
    res = await _send(hass, 2, "haventory/location/create", name="")
    assert res["success"] is False and res["error"]["code"] == "validation_error"
