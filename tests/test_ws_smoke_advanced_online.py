import pytest

from online_helpers import (
    destructive,
    expect_result,
    id_counter,
    open_ws,
    purge_items,
    purge_locations,
    requires_online,
)

pytestmark = [pytest.mark.online, requires_online]


BASELINE_ITEMS_COUNT = 3
BASELINE_LOCATIONS_COUNT = 3
AFTER_MIXED_ITEMS_COUNT = 2


@pytest.mark.asyncio
@destructive
async def test_a_bulk_batch_reports_each_row_and_leaves_the_others_alone() -> None:  # noqa: PLR0915
    """A mixed batch, then one where every row fails.

    The counts are absolute, so the instance is emptied first: a batch that
    quietly applied a row it reported as failed would otherwise hide behind
    whatever else the instance holds.
    """

    session, ws = await open_ws()
    next_id = id_counter()
    try:
        await purge_items(ws, next_id)
        await purge_locations(ws, next_id)

        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/location/create", "name": "Garage"})
        cre_g = await expect_result(ws, cid)
        garage_id = str((cre_g.get("result") or {}).get("id"))

        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/location/create", "name": "Pantry"})
        cre_p = await expect_result(ws, cid)
        pantry_id = str((cre_p.get("result") or {}).get("id"))

        cid = next_id()
        await ws.send_json(
            {
                "id": cid,
                "type": "haventory/location/create",
                "name": "Shelf A",
                "parent_id": pantry_id,
            }
        )
        cre_s = await expect_result(ws, cid)
        shelf_a_id = str((cre_s.get("result") or {}).get("id"))

        QTY_HAMMER = 2
        QTY_APPLES = 5
        QTY_JUNK = 1

        iid = next_id()
        await ws.send_json(
            {
                "id": iid,
                "type": "haventory/item/create",
                "name": "Hammer",
                "quantity": QTY_HAMMER,
                "location_id": garage_id,
            }
        )
        cre_h = await expect_result(ws, iid)
        hammer_id = str((cre_h.get("result") or {}).get("id"))

        iid = next_id()
        await ws.send_json(
            {
                "id": iid,
                "type": "haventory/item/create",
                "name": "Apples",
                "quantity": QTY_APPLES,
                "location_id": pantry_id,
            }
        )
        cre_a = await expect_result(ws, iid)
        apples_id = str((cre_a.get("result") or {}).get("id"))

        iid = next_id()
        await ws.send_json(
            {
                "id": iid,
                "type": "haventory/item/create",
                "name": "Junk Screwdriver",
                "quantity": QTY_JUNK,
                "location_id": garage_id,
            }
        )
        cre_j = await expect_result(ws, iid)
        junk_id = str((cre_j.get("result") or {}).get("id"))

        sid = next_id()
        await ws.send_json({"id": sid, "type": "haventory/stats"})
        stats0 = await expect_result(ws, sid)
        s0 = stats0.get("result", {})
        assert (
            s0.get("items_total") == BASELINE_ITEMS_COUNT
            and s0.get("locations_total") == BASELINE_LOCATIONS_COUNT
        )

        bid = next_id()
        await ws.send_json(
            {
                "id": bid,
                "type": "haventory/items/bulk",
                "operations": [
                    {
                        "op_id": "u1",
                        "kind": "item_update",
                        "payload": {"item_id": hammer_id, "name": "Hammer PRO"},
                    },
                    {
                        "op_id": "m1",
                        "kind": "item_move",
                        "payload": {"item_id": apples_id, "location_id": shelf_a_id},
                    },
                    {"op_id": "d1", "kind": "item_delete", "payload": {"item_id": junk_id}},
                    {
                        "op_id": "q1",
                        "kind": "item_adjust_quantity",
                        "payload": {"item_id": hammer_id, "delta": -1},
                    },
                    {
                        "op_id": "x1",
                        "kind": "totally_unknown",
                        "payload": {"note": "should fail with validation_error"},
                    },
                ],
            }
        )
        bulk = await expect_result(ws, bid)
        assert bulk.get("success") is True
        results = (bulk.get("result") or {}).get("results") or {}

        assert (results.get("u1") or {}).get("success") is True
        assert (results.get("m1") or {}).get("success") is True
        assert (results.get("d1") or {}).get("success") is True
        hammer_after_adjust = QTY_HAMMER - 1
        assert ((results.get("q1") or {}).get("result") or {}).get(
            "quantity"
        ) == hammer_after_adjust
        assert (results.get("x1") or {}).get("success") is False and (
            ((results.get("x1") or {}).get("error") or {}).get("code") == "validation_error"
        )

        sid2 = next_id()
        await ws.send_json({"id": sid2, "type": "haventory/stats"})
        stats1 = await expect_result(ws, sid2)
        s1 = stats1.get("result", {})
        assert (
            s1.get("items_total") == AFTER_MIXED_ITEMS_COUNT
            and s1.get("locations_total") == BASELINE_LOCATIONS_COUNT
        )

        bid2 = next_id()
        await ws.send_json(
            {
                "id": bid2,
                "type": "haventory/items/bulk",
                "operations": [
                    {"op_id": "b1", "kind": "totally_unknown", "payload": {}},
                    {
                        "op_id": "b2",
                        "kind": "item_adjust_quantity",
                        "payload": {"item_id": "nonexistent-id", "delta": 1},
                    },
                    {
                        "op_id": "b3",
                        "kind": "item_set_quantity",
                        "payload": {"item_id": "nonexistent-id", "quantity": 3},
                    },
                    {
                        "op_id": "b4",
                        "kind": "item_update",
                        "payload": {"item_id": "nonexistent-id", "name": "Nope"},
                    },
                ],
            }
        )
        bulk_bad = await expect_result(ws, bid2)
        assert bulk_bad.get("success") is True
        results_bad = (bulk_bad.get("result") or {}).get("results") or {}
        for key in ("b1", "b2", "b3", "b4"):
            assert (results_bad.get(key) or {}).get("success") is False

        sid3 = next_id()
        await ws.send_json({"id": sid3, "type": "haventory/stats"})
        stats2 = await expect_result(ws, sid3)
        s2 = stats2.get("result", {})
        assert s2.get("items_total") == s1.get("items_total") and s2.get(
            "locations_total"
        ) == s1.get("locations_total")
    finally:
        await ws.close()
        await session.close()
