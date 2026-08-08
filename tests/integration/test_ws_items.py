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


async def test_ws_rename_keeps_item_versions_valid(hass: HomeAssistant, hass_ws_client) -> None:
    """A location rename must not spend the client's optimistic-concurrency token.

    The rename rewrites the item's derived ``location_path``; a client holding
    the pre-rename ``version`` for an unrelated field must still be able to
    update. Exercised against real HA because a stub could get the concurrency
    check wrong without anything failing.
    """

    await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/location/create", "name": "Garage"})
    created_loc = await client.receive_json()
    assert created_loc["success"] is True, created_loc
    location_id = created_loc["result"]["id"]

    await client.send_json(
        {
            "id": 2,
            "type": "haventory/item/create",
            "name": "Hammer",
            "quantity": 1,
            "location_id": location_id,
        }
    )
    created = await client.receive_json()
    assert created["success"] is True, created
    item_id = created["result"]["id"]
    held_version = created["result"]["version"]

    await client.send_json(
        {
            "id": 3,
            "type": "haventory/location/update",
            "location_id": location_id,
            "name": "Workshop",
        }
    )
    renamed = await client.receive_json()
    assert renamed["success"] is True, renamed

    await client.send_json({"id": 4, "type": "haventory/item/get", "item_id": item_id})
    fetched = await client.receive_json()
    assert fetched["success"] is True, fetched
    assert fetched["result"]["location_path"]["display_path"] == "Workshop"
    assert fetched["result"]["version"] == held_version

    await client.send_json(
        {
            "id": 5,
            "type": "haventory/item/update",
            "item_id": item_id,
            "expected_version": held_version,
            "name": "Sledgehammer",
        }
    )
    updated = await client.receive_json()
    assert updated["success"] is True, updated
    assert updated["result"]["name"] == "Sledgehammer"
    assert updated["result"]["version"] == held_version + 1


async def test_ws_item_get_unknown_returns_error(hass: HomeAssistant, hass_ws_client) -> None:
    """Fetching a missing item surfaces a structured error, not a crash."""

    await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/get", "item_id": "does-not-exist"})
    resp = await client.receive_json()
    assert resp["success"] is False, resp
    assert "error" in resp
