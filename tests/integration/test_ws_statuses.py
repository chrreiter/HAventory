"""Integration: the status WebSocket commands and the item field they describe, on a real core.

`status/delete` is the one command that can orphan data, so its refusal, its
reassign escape hatch and the two topics a reassignment reaches are pinned over
a real socket. The item's own `status` follows through every command a card uses
to flag an item and find it again.
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory.const import DEFAULT_STATUS_COLOR, DEFAULT_STATUS_ICON

LENT_OUT = {"slug": "lent_out", "label": "Lent out"}

# One case per refusal, and the reason for it where the code does not say.
REFUSALS = [
    pytest.param(
        "status/create", {"slug": "missing", "label": "Gone"}, "validation_error", id="duplicate"
    ),
    # The card can only paint a token it has a rule for, or a literal it can read.
    pytest.param(
        "status/create", {**LENT_OUT, "color": "puce"}, "validation_error", id="unknown_colour"
    ),
    pytest.param("status/update", LENT_OUT, "not_found", id="update_unknown"),
    # A reorder names every status or none.
    pytest.param(
        "status/reorder", {"slugs": ["ok", "missing"]}, "validation_error", id="partial_reorder"
    ),
    pytest.param(
        "status/reorder",
        {"slugs": ["ok", "ok", "missing"]},
        "validation_error",
        id="reorder_names_one_twice",
    ),
    pytest.param("status/delete", {"slug": "ok"}, "validation_error", id="delete_default"),
    pytest.param(
        "item/create", {"name": "Drill", "status": "lost"}, "validation_error", id="item_unknown"
    ),
    pytest.param(
        "item/list", {"filter": {"status": "bogus"}}, "validation_error", id="filter_unknown"
    ),
    pytest.param("subscribe", {"topic": "nonsense"}, "validation_error", id="unknown_topic"),
]


async def test_list_returns_the_vocabulary_in_display_order(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/status/list")

    assert res["success"] is True
    assert [d["slug"] for d in res["result"]] == ["ok", "missing", "needs_repair"]
    assert res["result"][0]["color"] == "green"
    assert res["result"][0]["icon"] == "check"


async def test_create_defines_a_status_and_broadcasts(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("statuses")

    res = await ws.send("haventory/status/create", **LENT_OUT, color="blue")

    assert res["success"] is True
    assert res["result"]["slug"] == "lent_out"
    assert res["result"]["color"] == "blue"
    assert res["result"]["icon"] == DEFAULT_STATUS_ICON
    assert [e["action"] for e in ws.events("statuses")] == ["created"]


async def test_create_defaults_the_appearance_when_none_is_given(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/status/create", **LENT_OUT)

    assert res["result"]["color"] == DEFAULT_STATUS_COLOR


async def test_create_accepts_a_literal_colour(setup_entry, ws_connect) -> None:
    """A household colour outside the ten reaches the store as it was entered."""

    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/status/create", **LENT_OUT, color="#2F6F4F")

    assert res["success"] is True, res
    assert res["result"]["color"] == "#2f6f4f"


@pytest.mark.parametrize(("command", "payload", "code"), REFUSALS)
async def test_a_bad_request_is_refused_with_its_code(
    setup_entry, ws_connect, command: str, payload: dict[str, Any], code: str
) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send(f"haventory/{command}", **payload)

    assert res["success"] is False
    assert res["error"]["code"] == code


async def test_update_renames_without_touching_items(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    created = await ws.send("haventory/item/create", name="Saw", status="needs_repair")
    await ws.subscribe("statuses")
    await ws.subscribe("items")

    res = await ws.send("haventory/status/update", slug="needs_repair", label="Broken")

    assert res["success"] is True
    assert res["result"]["label"] == "Broken"
    assert [e["action"] for e in ws.events("statuses")] == ["updated"]
    assert ws.events("items") == []
    still = await ws.send("haventory/item/get", item_id=created["result"]["id"])
    assert still["result"]["version"] == created["result"]["version"]


async def test_reorder_rewrites_display_order(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("statuses")

    res = await ws.send("haventory/status/reorder", slugs=["needs_repair", "ok", "missing"])

    assert res["success"] is True
    assert [d["slug"] for d in res["result"]] == ["needs_repair", "ok", "missing"]
    assert [e["action"] for e in ws.events("statuses")] == ["reordered"]


async def test_delete_removes_an_unused_status(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("statuses")

    res = await ws.send("haventory/status/delete", slug="needs_repair")

    assert res["success"] is True
    assert res["result"]["reassigned"] == 0
    assert [e["action"] for e in ws.events("statuses")] == ["deleted"]
    listed = await ws.send("haventory/status/list")
    assert [d["slug"] for d in listed["result"]] == ["ok", "missing"]


async def test_delete_refuses_a_status_in_use_without_a_target(setup_entry, ws_connect) -> None:
    """An item whose status names nothing would be silently coerced on reload."""

    await setup_entry()
    ws = await ws_connect()
    await ws.send("haventory/item/create", name="Ladder", status="missing")

    res = await ws.send("haventory/status/delete", slug="missing")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    listed = await ws.send("haventory/status/list")
    assert "missing" in [d["slug"] for d in listed["result"]]


async def test_delete_with_a_target_moves_the_items_and_broadcasts_both(
    setup_entry, ws_connect
) -> None:
    await setup_entry()
    ws = await ws_connect()
    created = await ws.send("haventory/item/create", name="Ladder", status="missing")
    item_id = created["result"]["id"]
    await ws.subscribe("statuses")
    await ws.subscribe("items")

    res = await ws.send("haventory/status/delete", slug="missing", reassign_to="ok")

    assert res["success"] is True
    assert res["result"]["reassigned"] == 1
    # Both, and for different readers: one card is showing the vocabulary, the
    # other is showing the items that just changed underneath it.
    assert [e["action"] for e in ws.events("statuses")] == ["deleted"]
    (items_event,) = ws.events("items")
    assert items_event["action"] == "updated"
    # The reassignment is one bulk rewrite, so the items event names no item.
    # Clients key on that absence to mean "refetch, there is nothing to merge";
    # attaching a payload here would silently turn a refetch into a one-item
    # patch and strand every other moved row.
    assert set(items_event) == {"domain", "topic", "action", "ts"}
    moved = await ws.send("haventory/item/get", item_id=item_id)
    assert moved["result"]["status"] == "ok"
    assert moved["result"]["version"] == created["result"]["version"] + 1


async def test_delete_refuses_an_unknown_reassign_target(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    await ws.send("haventory/item/create", name="Ladder", status="missing")

    res = await ws.send("haventory/status/delete", slug="missing", reassign_to="nowhere")

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


async def test_item_create_and_update_status(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/item/create", name="Hammer", status="missing")
    assert res["success"] is True
    assert res["result"]["status"] == "missing"
    item_id = res["result"]["id"]

    res = await ws.send("haventory/item/update", item_id=item_id, status="needs_repair")
    assert res["success"] is True
    assert res["result"]["status"] == "needs_repair"

    res = await ws.send("haventory/item/get", item_id=item_id)
    assert res["result"]["status"] == "needs_repair"


async def test_item_create_defaults_status_and_update_refuses_none(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/item/create", name="Hammer")
    assert res["success"] is True
    assert res["result"]["status"] == "ok"

    res = await ws.send("haventory/item/update", item_id=res["result"]["id"], status=None)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


async def test_item_list_filters_by_status(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    await ws.send("haventory/item/create", name="Hammer", status="missing")
    await ws.send("haventory/item/create", name="Wrench")

    res = await ws.send("haventory/item/list", filter={"status": "missing"})

    assert res["success"] is True
    assert [i["name"] for i in res["result"]["items"]] == ["Hammer"]
    assert res["result"]["total"] == 1


async def test_bulk_item_update_sets_status(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    created = await ws.send("haventory/item/create", name="Hammer")

    res = await ws.send(
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "a",
                "kind": "item_update",
                "payload": {"item_id": created["result"]["id"], "status": "missing"},
            }
        ],
    )

    assert res["success"] is True
    outcome = res["result"]["results"]["a"]
    assert outcome["success"] is True
    assert outcome["result"]["status"] == "missing"


async def test_stats_and_health_reflect_status(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    await ws.send("haventory/item/create", name="Hammer", status="missing")
    await ws.send("haventory/item/create", name="Drill", status="needs_repair")

    res = await ws.send("haventory/stats")
    assert res["result"]["status_counts"]["missing"] == 1
    assert res["result"]["status_counts"]["needs_repair"] == 1

    res = await ws.send("haventory/health")
    assert res["result"]["healthy"] is True
    assert res["result"]["issues"] == []
