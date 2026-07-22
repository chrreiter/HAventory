"""Integration: WebSocket item CRUD end-to-end through the real websocket_api.

Drives ``haventory/item/*`` commands over a real Home Assistant WebSocket
connection (``hass_ws_client``), exercising command registration, schema
validation, dispatch, and the result envelope against the actual HA API.
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def _setup(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_ws_item_create_get_list(hass: HomeAssistant, hass_ws_client) -> None:
    """Create an item, then fetch it by id and see it in the list."""

    await _setup(hass)
    client = await hass_ws_client(hass)

    create_id, get_id, list_id = 1, 2, 3
    quantity = 3

    # create
    await client.send_json(
        {
            "id": create_id,
            "type": "haventory/item/create",
            "name": "Screwdriver",
            "quantity": quantity,
        }
    )
    created = await client.receive_json()
    assert created["id"] == create_id
    assert created["success"] is True, created
    item = created["result"]
    item_id = item["id"]
    assert item["name"] == "Screwdriver"
    assert item["quantity"] == quantity
    assert item["version"] == 1

    # get by id
    await client.send_json({"id": get_id, "type": "haventory/item/get", "item_id": item_id})
    fetched = await client.receive_json()
    assert fetched["id"] == get_id
    assert fetched["success"] is True, fetched
    assert fetched["result"]["id"] == item_id
    assert fetched["result"]["name"] == "Screwdriver"

    # list
    await client.send_json({"id": list_id, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["id"] == list_id
    assert listed["success"] is True, listed
    names = [it["name"] for it in listed["result"]["items"]]
    assert "Screwdriver" in names


async def test_ws_item_get_unknown_returns_error(hass: HomeAssistant, hass_ws_client) -> None:
    """Fetching a missing item surfaces a structured error, not a crash."""

    await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/get", "item_id": "does-not-exist"})
    resp = await client.receive_json()
    assert resp["success"] is False, resp
    assert "error" in resp
