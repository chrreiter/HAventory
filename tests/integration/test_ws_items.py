"""Integration: WebSocket item CRUD end-to-end through the real websocket_api.

Drives ``haventory/item/*`` commands over a real Home Assistant WebSocket
connection (``hass_ws_client``), exercising command registration, schema
validation, dispatch, and the result envelope against the actual HA API.
"""

from __future__ import annotations

from homeassistant.core import HomeAssistant


async def test_ws_item_create_get_list(hass: HomeAssistant, hass_ws_client, setup_entry) -> None:
    """Create an item, then fetch it by id and see it in the list."""

    await setup_entry()
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


async def test_ws_rename_keeps_item_versions_valid(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """A location rename must not spend the client's optimistic-concurrency token.

    The rename rewrites the item's derived ``location_path``; a client holding
    the pre-rename ``version`` for an unrelated field must still be able to
    update. Exercised against real HA because a stub could get the concurrency
    check wrong without anything failing.
    """

    await setup_entry()
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


async def test_ws_subscribe_accepts_area_id_and_refuses_unknown_keys(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Real HA applies the subscribe schema; the offline stub stores it unapplied.

    So the two halves of the schema change — ``area_id`` accepted, including as an
    explicit null, and anything else still refused — are only genuinely asserted
    against a real connection.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json(
        {"id": 1, "type": "haventory/subscribe", "topic": "items", "area_id": "kitchen"}
    )
    accepted = await client.receive_json()
    assert accepted["success"] is True, accepted

    await client.send_json(
        {"id": 2, "type": "haventory/subscribe", "topic": "items", "area_id": None}
    )
    cleared = await client.receive_json()
    assert cleared["success"] is True, cleared

    await client.send_json(
        {"id": 3, "type": "haventory/subscribe", "topic": "items", "area": "kitchen"}
    )
    refused = await client.receive_json()
    assert refused["success"] is False, refused


async def test_ws_item_get_unknown_returns_error(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Fetching a missing item surfaces a structured error, not a crash."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/get", "item_id": "does-not-exist"})
    resp = await client.receive_json()
    assert resp["success"] is False, resp
    assert "error" in resp


async def test_widened_frames_answer_validation_error(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """The fields typed ``object`` reach the handler and answer through the guard.

    Home Assistant refuses a schema mismatch before ``ws_guard`` runs, so a
    frame the schema rejects can only ever answer ``invalid_format``. This is
    the mode that applies the real voluptuous schemas, so it is the one that can
    tell the two answers apart.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    frames = [
        {"type": "haventory/item/create", "name": "Hammer", "quantity": 1.5},
        {"type": "haventory/item/create", "name": 42},
        {"type": "haventory/items/bulk", "operations": "oops"},
        # The collections a caller writes whole: the schema types them loosely,
        # so a bare string reaches the model and is refused there.
        {"type": "haventory/item/create", "name": "Hammer", "tags": "chisel"},
        {"type": "haventory/item/create", "name": "Hammer", "custom_fields": ["length"]},
        {"type": "haventory/status/reorder", "slugs": "ok"},
    ]
    for msg_id, frame in enumerate(frames, start=1):
        await client.send_json({"id": msg_id, **frame})
        resp = await client.receive_json()
        assert resp["success"] is False, resp
        assert resp["error"]["code"] == "validation_error", resp

    # Nothing was created along the way.
    await client.send_json({"id": len(frames) + 1, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["result"]["items"] == []


async def test_item_list_input_hardening_over_the_real_schema(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Unknown filter keys, unknown sort fields and bad cursors are refused."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Hammer"})
    assert (await client.receive_json())["success"] is True

    refused = [
        {"type": "haventory/item/list", "filter": {"query": "Hammer"}},
        {"type": "haventory/item/list", "sort": {"field": "colour", "order": "asc"}},
        {"type": "haventory/item/list", "limit": 1, "cursor": ""},
        {"type": "haventory/item/list", "limit": 1, "cursor": "garbage"},
    ]
    for msg_id, frame in enumerate(refused, start=2):
        await client.send_json({"id": msg_id, **frame})
        resp = await client.receive_json()
        assert resp["success"] is False, resp
        assert resp["error"]["code"] == "validation_error", resp

    # A known filter and a real cursor still page.
    await client.send_json(
        {
            "id": 100,
            "type": "haventory/item/list",
            "filter": {"q": "Hammer"},
            "sort": {"field": "name", "order": "asc"},
            "limit": 1,
        }
    )
    listed = await client.receive_json()
    assert listed["success"] is True, listed
    assert [i["name"] for i in listed["result"]["items"]] == ["Hammer"]


async def test_duplicate_op_ids_reject_the_batch(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Results are keyed by op_id, so a repeat has to fail the whole command."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Hammer"})
    created = await client.receive_json()
    item_id = created["result"]["id"]

    await client.send_json(
        {
            "id": 2,
            "type": "haventory/items/bulk",
            "operations": [
                {
                    "op_id": "dup",
                    "kind": "item_set_quantity",
                    "payload": {"item_id": item_id, "quantity": 2},
                },
                {
                    "op_id": "dup",
                    "kind": "item_set_quantity",
                    "payload": {"item_id": item_id, "quantity": 3},
                },
            ],
        }
    )
    resp = await client.receive_json()
    assert resp["success"] is False, resp
    assert resp["error"]["code"] == "validation_error", resp

    await client.send_json({"id": 3, "type": "haventory/item/get", "item_id": item_id})
    fetched = await client.receive_json()
    assert fetched["result"]["quantity"] == 1


async def test_card_write_commands_over_the_real_schemas(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Every write the card sends passes its real schema and takes effect.

    The refusals a user can hit answer ``validation_error`` and ``conflict``
    rather than ``invalid_format``, which is what a schema mismatch would give.
    """

    await setup_entry()
    client = await hass_ws_client(hass)
    last_id = 0
    set_to, adjusted_to = 4, 3

    async def call(frame: dict) -> dict:
        nonlocal last_id
        last_id += 1
        await client.send_json({"id": last_id, **frame})
        return await client.receive_json()

    async def ok(frame: dict) -> dict:
        resp = await call(frame)
        assert resp["success"] is True, resp
        return resp["result"]

    async def refused(frame: dict, code: str) -> None:
        resp = await call(frame)
        assert resp["success"] is False, resp
        assert resp["error"]["code"] == code, resp

    garage = (await ok({"type": "haventory/location/create", "name": "Garage"}))["id"]
    shelf = (await ok({"type": "haventory/location/create", "name": "Shelf", "parent_id": garage}))[
        "id"
    ]
    basement = (await ok({"type": "haventory/location/create", "name": "Basement"}))["id"]

    item = await ok({"type": "haventory/item/create", "name": "Hammer"})
    item_id = item["id"]

    async def write(command: str, **fields) -> dict:
        nonlocal item
        item = await ok(
            {
                "type": f"haventory/item/{command}",
                "item_id": item_id,
                "expected_version": item["version"],
                **fields,
            }
        )
        return item

    moved = await write("move", location_id=basement)
    assert moved["location_id"] == basement
    assert moved["location_path"]["display_path"] == "Basement"
    assert (await write("set_quantity", quantity=set_to))["quantity"] == set_to
    assert (await write("adjust_quantity", delta=-1))["quantity"] == adjusted_to
    assert (await write("add_tags", tags=["Tool", "TOOL", "garage"]))["tags"] == ["tool", "garage"]
    assert (await write("remove_tags", tags=["TOOL"]))["tags"] == ["garage"]
    assert (await write("update_custom_fields", set={"color": "red", "weight": 1.2}, unset=[]))[
        "custom_fields"
    ] == {"color": "red", "weight": 1.2}
    assert (await write("update_custom_fields", set={}, unset=["weight"]))["custom_fields"] == {
        "color": "red"
    }

    assert (await ok({"type": "haventory/stats"}))["low_stock_count"] == 0
    await write("set_low_stock_threshold", low_stock_threshold=5)
    assert (await ok({"type": "haventory/stats"}))["low_stock_count"] == 1

    await refused(
        {
            "type": "haventory/item/set_quantity",
            "item_id": item_id,
            "expected_version": item["version"],
            "quantity": -1,
        },
        "validation_error",
    )
    stale = {
        "type": "haventory/item/update",
        "item_id": item_id,
        "expected_version": item["version"] - 1,
        "name": "Mallet",
    }
    await refused(stale, "conflict")

    await ok(
        {
            "type": "haventory/location/move_subtree",
            "location_id": garage,
            "new_parent_id": basement,
        }
    )
    tree = await ok({"type": "haventory/location/tree"})
    basement_node = next(node for node in tree if node["id"] == basement)
    assert [child["id"] for child in basement_node["children"]] == [garage]
    for parent in (garage, shelf):
        await refused(
            {
                "type": "haventory/location/move_subtree",
                "location_id": garage,
                "new_parent_id": parent,
            },
            "validation_error",
        )

    await ok({"type": "haventory/location/delete", "location_id": shelf})
    await refused({"type": "haventory/location/get", "location_id": shelf}, "not_found")


async def test_bulk_batch_answers_each_row_on_its_own(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """A row the batch cannot apply fails alone; the rows around it still land."""

    await setup_entry()
    client = await hass_ws_client(hass)
    quantity = 7

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Hammer"})
    item_id = (await client.receive_json())["result"]["id"]

    await client.send_json(
        {
            "id": 2,
            "type": "haventory/items/bulk",
            "operations": [
                {
                    "op_id": "good",
                    "kind": "item_set_quantity",
                    "payload": {"item_id": item_id, "quantity": quantity},
                },
                {"op_id": "bad", "kind": "totally_unknown", "payload": {}},
            ],
        }
    )
    resp = await client.receive_json()
    assert resp["success"] is True, resp
    results = resp["result"]["results"]
    assert results["good"]["success"] is True
    assert results["good"]["result"]["quantity"] == quantity
    assert results["bad"]["success"] is False
    assert results["bad"]["error"]["code"] == "validation_error"

    await client.send_json({"id": 3, "type": "haventory/item/get", "item_id": item_id})
    assert (await client.receive_json())["result"]["quantity"] == quantity
