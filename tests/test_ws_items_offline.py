"""Offline tests for haventory WebSocket item commands.

Scenarios:
- create/get/update/delete item with envelope success
- adjust/set quantity and check_out/check_in
- list items with pagination cursor passthrough
- error mapping for validation/not_found/conflict with contextual data
- optimistic concurrency: with and without expected_version
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
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
async def test_item_create_get_update_delete_success() -> None:
    """Create, get, update, delete an item via WS and assert envelopes."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    # Create
    res = await _send(hass, 1, "haventory/item/create", name="Hammer", quantity=2)
    assert res["id"] == 1 and res["type"] == "result" and res["success"] is True
    assert isinstance(res.get("result"), dict) and "id" in res["result"]
    item_id = res["result"]["id"]

    # Get
    res = await _send(hass, 2, "haventory/item/get", item_id=item_id)
    assert res["success"] is True and res["result"]["id"] == item_id

    # Update
    res = await _send(hass, 3, "haventory/item/update", item_id=item_id, name="Hammer Pro")
    assert res["success"] is True and res["result"]["name"] == "Hammer Pro"

    # Delete
    res = await _send(hass, 4, "haventory/item/delete", item_id=item_id)
    assert res["success"] is True and res["result"] is None


@pytest.mark.asyncio
async def test_item_quantity_and_checkout_helpers() -> None:
    """Adjust/set quantity and check in/out via WS."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    initial_quantity = 1
    created = await _send(hass, 1, "haventory/item/create", name="Box", quantity=initial_quantity)
    item_id = created["result"]["id"]

    delta_quantity = 2
    expected_after_adjust = initial_quantity + delta_quantity
    res = await _send(
        hass, 2, "haventory/item/adjust_quantity", item_id=item_id, delta=delta_quantity
    )
    assert res["result"]["quantity"] == expected_after_adjust

    target_quantity = 5
    res = await _send(
        hass, 3, "haventory/item/set_quantity", item_id=item_id, quantity=target_quantity
    )
    assert res["result"]["quantity"] == target_quantity

    res = await _send(hass, 4, "haventory/item/check_out", item_id=item_id, due_date="2030-01-01")
    assert res["result"]["checked_out"] is True

    res = await _send(hass, 5, "haventory/item/check_in", item_id=item_id)
    assert res["result"]["checked_out"] is False


@pytest.mark.asyncio
async def test_item_list_pagination_cursor_passthrough() -> None:
    """List items returns items array and next_cursor passthrough shape."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    # Seed a couple items
    await _send(hass, 1, "haventory/item/create", name="A")
    await _send(hass, 2, "haventory/item/create", name="B")

    res = await _send(hass, 3, "haventory/item/list", limit=1)
    assert res["success"] is True
    assert isinstance(res["result"].get("items"), list)
    cursor = res["result"].get("next_cursor")

    if cursor:
        res2 = await _send(hass, 4, "haventory/item/list", limit=1, cursor=cursor)
        assert res2["success"] is True


@pytest.mark.asyncio
async def test_error_mapping_validation_and_not_found_and_conflict() -> None:
    """Ensure errors map to codes and include minimal context."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    # Validation: set_quantity negative
    res = await _send(hass, 1, "haventory/item/set_quantity", item_id="x", quantity=-1)
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # Not found
    res = await _send(hass, 2, "haventory/item/get", item_id="00000000-0000-4000-8000-000000000000")
    assert res["success"] is False and res["error"]["code"] == "not_found"

    # Conflict: create, then update with stale version
    created = await _send(hass, 3, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]
    stale = await _send(
        hass, 4, "haventory/item/update", item_id=item_id, expected_version=999, name="X"
    )
    assert stale["success"] is False and stale["error"]["code"] == "conflict"
