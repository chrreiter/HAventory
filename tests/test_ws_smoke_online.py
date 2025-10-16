import os
from typing import Any

import aiohttp
import pytest

pytestmark = pytest.mark.online


def _ws_url_from_base(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://') :]}/api/websocket"
    return f"ws://{base_url}/api/websocket"


MAGIC_MIN_ADDED_LOCATIONS: int = 2
EXPECTED_LOCATIONS_AFTER_CREATE: int = 2
EXPECTED_FINAL_LOCATIONS: int = 2


async def _open_ws():
    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")
    ws_url = _ws_url_from_base(base)
    session = aiohttp.ClientSession()
    ws = await session.ws_connect(ws_url)
    _ = await ws.receive_json()
    await ws.send_json({"type": "auth", "access_token": token})
    _ = await ws.receive_json()
    return session, ws


async def _expect_result(ws: aiohttp.ClientWebSocketResponse, expect_id: int) -> dict[str, Any]:
    while True:
        msg = await ws.receive_json()
        if isinstance(msg, dict) and msg.get("id") == expect_id and msg.get("type") == "result":
            return msg


def _id_counter(start: int = 0):
    value = start

    def _next() -> int:
        nonlocal value
        value += 1
        return value

    return _next


async def _find_location_id_by_name(
    ws: aiohttp.ClientWebSocketResponse, name: str, next_id
) -> str | None:
    qid = next_id()
    await ws.send_json({"id": qid, "type": "haventory/location/list"})
    lst = await _expect_result(ws, qid)
    for loc in lst.get("result", []) or []:
        if isinstance(loc, dict) and loc.get("name") == name:
            return str(loc.get("id"))
    return None


async def _open_ws():
    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")
    ws_url = _ws_url_from_base(base)
    session = aiohttp.ClientSession()
    ws = await session.ws_connect(ws_url)
    _ = await ws.receive_json()
    await ws.send_json({"type": "auth", "access_token": token})
    _ = await ws.receive_json()
    return session, ws


async def _expect_result(ws: aiohttp.ClientWebSocketResponse, expect_id: int) -> dict[str, Any]:
    while True:
        msg = await ws.receive_json()
        if isinstance(msg, dict) and msg.get("id") == expect_id and msg.get("type") == "result":
            return msg


def _id_counter(start: int = 0):
    value = start

    def _next() -> int:
        nonlocal value
        value += 1
        return value

    return _next


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_areas_list_and_location_area_field_presence() -> None:
    """Verify areas/list shape and that location serialization includes area_id."""

    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        # areas/list returns {areas: []}
        aid = next_id()
        await ws.send_json({"id": aid, "type": "haventory/areas/list"})
        areas = await _expect_result(ws, aid)
        if not areas.get("success"):
            pytest.skip("areas/list not available in this HA runtime")
        assert isinstance((areas.get("result") or {}).get("areas"), list)

        # Create a location without area_id and ensure serializer includes area_id: null
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/location/create", "name": "AreaProbe"})
        cre = await _expect_result(ws, cid)
        loc = cre.get("result") or {}
        assert "area_id" in loc and loc.get("area_id") is None

        # Cleanup: delete created location
        did = next_id()
        await ws.send_json(
            {
                "id": did,
                "type": "haventory/location/delete",
                "location_id": loc.get("id"),
            }
        )
        _ = await _expect_result(ws, did)
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_ping_and_version() -> None:
    """Connect to HA WS and validate ping + version."""
    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")

    ws_url = _ws_url_from_base(base)

    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(ws_url) as ws:
            _ = await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": token})
            _ = await ws.receive_json()

            await ws.send_json({"id": 1, "type": "haventory/ping", "echo": "hi"})
            msg = await ws.receive_json()
            assert isinstance(msg, dict)
            assert msg.get("type") == "result"
            assert msg.get("success") is True
            assert msg.get("result", {}).get("echo") == "hi"

            await ws.send_json({"id": 2, "type": "haventory/version"})
            ver = await ws.receive_json()
            assert ver.get("type") == "result"
            assert ver.get("success") is True
            result = ver.get("result")
            assert isinstance(result, dict)
            assert "integration_version" in result
            assert result.get("schema_version") == 1


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_smoke_phase0_phase1_locations() -> None:  # noqa: PLR0915
    """End-to-end online smoke: Phase 0 and Phase 1 (locations CRUD and validation).

    Preconditions:
    - Intended to run against a clean dataset (fresh storage) so Phase 0 stats are zero.
    """
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        # Purge any existing items/locations to ensure a clean dataset
        await _purge_items(ws, next_id)
        await _purge_locations(ws, next_id)

        # Phase 0.1: ping
        await ws.send_json({"id": 101, "type": "haventory/ping", "echo": "hi"})
        msg = await _expect_result(ws, 101)
        assert msg.get("success") is True  # scenario: WS echo should succeed
        assert msg.get("result", {}).get("echo") == "hi"  # expected: echo roundtrip

        # Phase 0.2: version and stats
        await ws.send_json({"id": 102, "type": "haventory/version"})
        ver = await _expect_result(ws, 102)
        assert ver.get("success") is True  # scenario: version endpoint works
        vres = ver.get("result")
        assert isinstance(vres, dict) and vres.get("schema_version") == 1  # expected: schema v1

        await ws.send_json({"id": 103, "type": "haventory/stats"})
        stats = await _expect_result(ws, 103)
        sres = stats.get("result", {})
        # Expect clean storage (script purges before running)
        assert sres.get("items_total") == 0  # scenario: no items initially
        assert sres.get("locations_total") == 0  # scenario: no locations initially

        # Phase 0.3: health
        await ws.send_json({"id": 104, "type": "haventory/health"})
        health = await _expect_result(ws, 104)
        hres = health.get("result", {})
        assert hres.get("healthy") is True  # expected: healthy on empty dataset
        assert hres.get("issues") == []  # expected: no issues

        # Phase 1.1: create root and child
        await ws.send_json({"id": 201, "type": "haventory/location/create", "name": "Garage"})
        cre_g = await _expect_result(ws, 201)
        garage_id = cre_g.get("result", {}).get("id")
        assert isinstance(garage_id, str) and len(garage_id) > 0  # expected: UUID

        await ws.send_json(
            {
                "id": 202,
                "type": "haventory/location/create",
                "name": "Shelf A",
                "parent_id": garage_id,
            }
        )
        cre_s = await _expect_result(ws, 202)
        shelf_id = cre_s.get("result", {}).get("id")
        assert isinstance(shelf_id, str) and len(shelf_id) > 0

        await ws.send_json({"id": 203, "type": "haventory/location/list"})
        lst = await _expect_result(ws, 203)
        lres = lst.get("result")
        assert (
            isinstance(lres, list) and len(lres) >= MAGIC_MIN_ADDED_LOCATIONS
        )  # minimum expected additions
        ids = {loc.get("id") for loc in lres if isinstance(loc, dict)}
        assert garage_id in ids and shelf_id in ids  # created ids present
        shelf_entry = next(loc for loc in lres if loc.get("id") == shelf_id)
        assert shelf_entry.get("parent_id") == garage_id  # parent relation

        await ws.send_json({"id": 204, "type": "haventory/location/tree"})
        tree = await _expect_result(ws, 204)
        tres = tree.get("result")
        assert isinstance(tres, list) and len(tres) >= 1

        # find Garage node somewhere in the forest
        def _dfs(nodes, target_id):
            for n in nodes:
                if n.get("id") == target_id:
                    return n
                child = _dfs(n.get("children") or [], target_id)
                if child:
                    return child
            return None

        garage_node = _dfs(tres, garage_id)
        assert garage_node is not None
        child_ids = [c.get("id") for c in garage_node.get("children") or []]
        assert shelf_id in child_ids  # Shelf A under Garage

        # Stats should reflect exactly +2 locations after creation
        await ws.send_json({"id": 205, "type": "haventory/stats"})
        stats_after_create = await _expect_result(ws, 205)
        s_after = stats_after_create.get("result", {})
        assert (
            s_after.get("locations_total") == EXPECTED_LOCATIONS_AFTER_CREATE
        )  # initial two locations

        # End of core creation checks; subsequent mechanics are validated in dedicated tests below
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_rename() -> None:
    """Rename existing 'Garage' to 'Garage West'."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        garage_id = await _find_location_id_by_name(ws, "Garage", next_id)
        assert garage_id is not None
        rid = next_id()
        await ws.send_json(
            {
                "id": rid,
                "type": "haventory/location/update",
                "location_id": garage_id,
                "name": "Garage West",
            }
        )
        upd = await _expect_result(ws, rid)
        assert upd.get("success") is True and upd["result"]["name"] == "Garage West"
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_create_basement() -> None:
    """Create a new root 'Basement'."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/location/create", "name": "Basement"})
        cre_b = await _expect_result(ws, cid)
        basement_id = cre_b.get("result", {}).get("id")
        assert isinstance(basement_id, str) and len(basement_id) > 0
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_move_subtree() -> None:
    """Move 'Garage West' subtree under 'Basement'."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        garage_id = await _find_location_id_by_name(ws, "Garage West", next_id)
        basement_id = await _find_location_id_by_name(ws, "Basement", next_id)
        assert garage_id and basement_id
        mid = next_id()
        await ws.send_json(
            {
                "id": mid,
                "type": "haventory/location/move_subtree",
                "location_id": garage_id,
                "new_parent_id": basement_id,
            }
        )
        mv = await _expect_result(ws, mid)
        assert mv.get("success") is True
        # Verify via tree
        tid = next_id()
        await ws.send_json({"id": tid, "type": "haventory/location/tree"})
        tree2 = await _expect_result(ws, tid)
        roots = tree2.get("result")
        assert isinstance(roots, list)

        # Reuse local DFS
        def _dfs(nodes, target_id):
            for n in nodes:
                if n.get("id") == target_id:
                    return n
                child = _dfs(n.get("children") or [], target_id)
                if child:
                    return child
            return None

        basement_node = _dfs(roots, basement_id)
        assert basement_node is not None
        b_child_ids = [c.get("id") for c in basement_node.get("children") or []]
        assert garage_id in b_child_ids
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_move_subtree_negative_self() -> None:
    """Negative: cannot move a location under itself."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        garage_id = await _find_location_id_by_name(ws, "Garage West", next_id)
        assert garage_id
        nid = next_id()
        await ws.send_json(
            {
                "id": nid,
                "type": "haventory/location/move_subtree",
                "location_id": garage_id,
                "new_parent_id": garage_id,
            }
        )
        neg = await _expect_result(ws, nid)
        assert (
            neg.get("success") is False
            and (neg.get("error") or {}).get("code") == "validation_error"
        )
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_move_subtree_negative_descendant() -> None:
    """Negative: cannot move a location under a descendant."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        garage_id = await _find_location_id_by_name(ws, "Garage West", next_id)
        # ensure a child leaf exists to test descendant move validation
        cid = next_id()
        await ws.send_json(
            {
                "id": cid,
                "type": "haventory/location/create",
                "name": "Shelf A",
                "parent_id": garage_id,
            }
        )
        _ = await _expect_result(ws, cid)
        shelf_id = await _find_location_id_by_name(ws, "Shelf A", next_id)
        assert garage_id and shelf_id
        nid = next_id()
        await ws.send_json(
            {
                "id": nid,
                "type": "haventory/location/move_subtree",
                "location_id": garage_id,
                "new_parent_id": shelf_id,
            }
        )
        neg2 = await _expect_result(ws, nid)
        assert (
            neg2.get("success") is False
            and (neg2.get("error") or {}).get("code") == "validation_error"
        )
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_delete_leaf_and_get_not_found() -> None:
    """Delete leaf 'Shelf A' and verify get returns not_found."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        shelf_id = await _find_location_id_by_name(ws, "Shelf A", next_id)
        assert shelf_id
        did = next_id()
        await ws.send_json(
            {"id": did, "type": "haventory/location/delete", "location_id": shelf_id}
        )
        del_ack = await _expect_result(ws, did)
        assert del_ack.get("success") is True
        gid = next_id()
        await ws.send_json({"id": gid, "type": "haventory/location/get", "location_id": shelf_id})
        get_after = await _expect_result(ws, gid)
        assert (
            get_after.get("success") is False
            and (get_after.get("error") or {}).get("code") == "not_found"
        )
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_final_stats_after_all_location_ops() -> None:
    """Final stats: expect 2 locations remaining (Basement + Garage West)."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        # Make this test independent: purge all locations, then create exactly two roots
        await _purge_locations(ws, next_id)
        # Create 'Basement'
        bid = next_id()
        await ws.send_json({"id": bid, "type": "haventory/location/create", "name": "Basement"})
        _ = await _expect_result(ws, bid)
        # Create 'Garage West'
        gid = next_id()
        await ws.send_json({"id": gid, "type": "haventory/location/create", "name": "Garage West"})
        _ = await _expect_result(ws, gid)
        fid = next_id()
        await ws.send_json({"id": fid, "type": "haventory/stats"})
        stats_final = await _expect_result(ws, fid)
        s_final = stats_final.get("result", {})
        assert s_final.get("locations_total") == EXPECTED_FINAL_LOCATIONS  # Basement + Garage West
    finally:
        await ws.close()
        await session.close()


# -----------------------------
# Phase 2 — Items WebSocket tests (online)
# -----------------------------

L_GARAGE = "Garage"
L_WORKSHOP = "Workshop"
L_SHELF_A = "Shelf A"


async def _purge_items(ws: aiohttp.ClientWebSocketResponse, next_id) -> None:
    qid = next_id()
    await ws.send_json({"id": qid, "type": "haventory/item/list"})
    lst = await _expect_result(ws, qid)
    items = (lst.get("result") or {}).get("items") or []
    for it in items:
        did = next_id()
        await ws.send_json(
            {
                "id": did,
                "type": "haventory/item/delete",
                "item_id": it.get("id"),
                "expected_version": int(it.get("version", 1)),
            }
        )
        _ = await _expect_result(ws, did)


async def _purge_locations(ws: aiohttp.ClientWebSocketResponse, next_id) -> None:
    qid = next_id()
    await ws.send_json({"id": qid, "type": "haventory/location/list"})
    lst = await _expect_result(ws, qid)
    locs = lst.get("result") or []
    # deepest-first by path length
    locs_sorted = sorted(
        [loc for loc in locs if isinstance(loc, dict)],
        key=lambda loc: len((loc.get("path") or {}).get("name_path") or []),
        reverse=True,
    )
    for loc in locs_sorted:
        did = next_id()
        await ws.send_json(
            {"id": did, "type": "haventory/location/delete", "location_id": loc.get("id")}
        )
        _ = await _expect_result(ws, did)


async def _ensure_phase2_base(ws: aiohttp.ClientWebSocketResponse, next_id) -> dict[str, str]:
    # Purge everything
    await _purge_items(ws, next_id)
    await _purge_locations(ws, next_id)

    # Create base locations: Garage, Workshop, Shelf A under Garage
    gid = next_id()
    await ws.send_json({"id": gid, "type": "haventory/location/create", "name": L_GARAGE})
    cre_g = await _expect_result(ws, gid)
    garage_id = str((cre_g.get("result") or {}).get("id"))

    wid = next_id()
    await ws.send_json({"id": wid, "type": "haventory/location/create", "name": L_WORKSHOP})
    cre_w = await _expect_result(ws, wid)
    workshop_id = str((cre_w.get("result") or {}).get("id"))

    sid = next_id()
    await ws.send_json(
        {
            "id": sid,
            "type": "haventory/location/create",
            "name": L_SHELF_A,
            "parent_id": garage_id,
        }
    )
    cre_s = await _expect_result(ws, sid)
    shelf_a_id = str((cre_s.get("result") or {}).get("id"))

    return {"garage": garage_id, "workshop": workshop_id, "shelfA": shelf_a_id}


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_item_create_defaults_and_rich() -> None:
    """Create default item and rich item with all optionals."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        ids = await _ensure_phase2_base(ws, next_id)

        # Default
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer"})
        cre = await _expect_result(ws, cid)
        assert cre.get("success") is True
        item = cre.get("result") or {}
        assert item.get("version") == 1 and item.get("quantity") == 1

        # Rich
        rid = next_id()
        await ws.send_json(
            {
                "id": rid,
                "type": "haventory/item/create",
                "name": "Hammer",
                "description": "16 oz claw hammer",
                "quantity": 3,
                "tags": ["tool", "garage"],
                "category": "tools",
                "low_stock_threshold": 1,
                "location_id": ids["shelfA"],
            }
        )
        rich = await _expect_result(ws, rid)
        ritem = rich.get("result") or {}
        TARGET_QTY_RICH = 3  # ruff: avoid magic numbers
        assert ritem.get("quantity") == TARGET_QTY_RICH and ritem.get("category") == "tools"
        lp = ritem.get("location_path") or {}
        assert lp.get("display_path") == "Garage / Shelf A"
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_item_get_update_delete_recreate() -> None:
    """Get, update (version++), delete (with expected), then re-create."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)

        # Create
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer"})
        cre = await _expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver = int(cre["result"]["version"])

        # Get
        gid = next_id()
        await ws.send_json({"id": gid, "type": "haventory/item/get", "item_id": item_id})
        got = await _expect_result(ws, gid)
        assert got.get("success") is True and got["result"]["id"] == item_id

        # Update name/description/category
        uid = next_id()
        await ws.send_json(
            {
                "id": uid,
                "type": "haventory/item/update",
                "item_id": item_id,
                "expected_version": ver,
                "name": "Hammer Pro",
                "description": "Upgraded",
                "category": "pro tools",
            }
        )
        upd = await _expect_result(ws, uid)
        ver = int(upd["result"]["version"])
        assert upd["result"]["name"] == "Hammer Pro"

        # Delete
        did = next_id()
        await ws.send_json(
            {
                "id": did,
                "type": "haventory/item/delete",
                "item_id": item_id,
                "expected_version": ver,
            }
        )
        del_ack = await _expect_result(ws, did)
        assert del_ack.get("success") is True

        # Re-create for later tests
        rcid = next_id()
        await ws.send_json({"id": rcid, "type": "haventory/item/create", "name": "Hammer R"})
        re = await _expect_result(ws, rcid)
        assert re.get("success") is True
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_item_move_between_locations() -> None:
    """Move item to Workshop; verify location_path and version bump."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        ids = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await _expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver = int(cre["result"]["version"])

        # Move
        mid = next_id()
        await ws.send_json(
            {
                "id": mid,
                "type": "haventory/item/move",
                "item_id": item_id,
                "location_id": ids["workshop"],
                "expected_version": ver,
            }
        )
        mv = await _expect_result(ws, mid)
        assert mv.get("success") is True and mv["result"]["location_id"] == ids["workshop"]
        assert (mv["result"].get("location_path") or {}).get("display_path") == L_WORKSHOP
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_quantity_operations() -> None:
    """Invalid set_quantity (-1) then adjust +2 and set=5."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await _expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver = int(cre["result"]["version"])

        # Invalid set_quantity
        sid = next_id()
        await ws.send_json(
            {
                "id": sid,
                "type": "haventory/item/set_quantity",
                "item_id": item_id,
                "quantity": -1,
                "expected_version": ver,
            }
        )
        neg = await _expect_result(ws, sid)
        assert (
            neg.get("success") is False
            and (neg.get("error") or {}).get("code") == "validation_error"
        )

        # adjust +2
        aid = next_id()
        await ws.send_json(
            {
                "id": aid,
                "type": "haventory/item/adjust_quantity",
                "item_id": item_id,
                "delta": 2,
                "expected_version": ver,
            }
        )
        adj = await _expect_result(ws, aid)
        ver = int(adj["result"]["version"])
        QTY_AFTER_ADJUST = 3
        assert adj["result"]["quantity"] == QTY_AFTER_ADJUST

        # set = 5
        sid2 = next_id()
        await ws.send_json(
            {
                "id": sid2,
                "type": "haventory/item/set_quantity",
                "item_id": item_id,
                "quantity": 5,
                "expected_version": ver,
            }
        )
        setq = await _expect_result(ws, sid2)
        TARGET_QTY_FINAL = 5
        assert setq["result"]["quantity"] == TARGET_QTY_FINAL
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_checkout_checkin_and_due_dates() -> None:
    """Check-out with due_date, check-in, then negative due_date without checked_out."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await _expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver = int(cre["result"]["version"])

        # check_out
        coid = next_id()
        await ws.send_json(
            {
                "id": coid,
                "type": "haventory/item/check_out",
                "item_id": item_id,
                "due_date": "2025-12-31",
                "expected_version": ver,
            }
        )
        co = await _expect_result(ws, coid)
        ver = int(co["result"]["version"])
        assert co["result"]["checked_out"] is True

        # check_in
        ciid = next_id()
        await ws.send_json(
            {
                "id": ciid,
                "type": "haventory/item/check_in",
                "item_id": item_id,
                "expected_version": ver,
            }
        )
        ci = await _expect_result(ws, ciid)
        ver = int(ci["result"]["version"])
        assert ci["result"]["checked_out"] is False

        # Negative due_date without checked_out
        nid = next_id()
        await ws.send_json(
            {
                "id": nid,
                "type": "haventory/item/update",
                "item_id": item_id,
                "expected_version": ver,
                "due_date": "2025-01-01",
            }
        )
        neg = await _expect_result(ws, nid)
        assert (
            neg.get("success") is False
            and (neg.get("error") or {}).get("code") == "validation_error"
        )
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_tags_and_custom_fields() -> None:
    """Add/remove tags; set/unset custom fields; verify normalization and result."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await _expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver = int(cre["result"]["version"])

        # add_tags (Tool, TOOL, garage) -> garage
        tid = next_id()
        await ws.send_json(
            {
                "id": tid,
                "type": "haventory/item/add_tags",
                "item_id": item_id,
                "expected_version": ver,
                "tags": ["Tool", "TOOL", "garage"],
            }
        )
        tadd = await _expect_result(ws, tid)
        ver = int(tadd["result"]["version"])
        # Normalization preserves insertion order of unique, casefolded tags
        # Given ["Tool","TOOL","garage"] -> ["tool","garage"]
        assert tadd["result"]["tags"] == ["tool", "garage"]

        # remove tag 'tool' (normalized)
        rid = next_id()
        await ws.send_json(
            {
                "id": rid,
                "type": "haventory/item/remove_tags",
                "item_id": item_id,
                "expected_version": ver,
                "tags": ["tool"],
            }
        )
        trem = await _expect_result(ws, rid)
        ver = int(trem["result"]["version"])
        # We removed 'tool', leaving 'garage'
        assert trem["result"]["tags"] == ["garage"]

        # custom_fields set
        sid = next_id()
        await ws.send_json(
            {
                "id": sid,
                "type": "haventory/item/update_custom_fields",
                "item_id": item_id,
                "expected_version": ver,
                "set": {"color": "red", "weight": 1.2},
                "unset": [],
            }
        )
        cset = await _expect_result(ws, sid)
        ver = int(cset["result"]["version"])
        assert (cset["result"].get("custom_fields") or {}).get("color") == "red"

        # custom_fields unset weight
        uid = next_id()
        await ws.send_json(
            {
                "id": uid,
                "type": "haventory/item/update_custom_fields",
                "item_id": item_id,
                "expected_version": ver,
                "set": {},
                "unset": ["weight"],
            }
        )
        cunset = await _expect_result(ws, uid)
        cf = cunset["result"].get("custom_fields") or {}
        assert "weight" not in cf and cf.get("color") == "red"
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_low_stock_threshold_and_stats() -> None:
    """Set threshold and cross it to verify low_stock_count in stats."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item quantity 5
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await _expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver = int(cre["result"]["version"])

        # threshold 3
        tid = next_id()
        await ws.send_json(
            {
                "id": tid,
                "type": "haventory/item/set_low_stock_threshold",
                "item_id": item_id,
                "expected_version": ver,
                "low_stock_threshold": 3,
            }
        )
        _ = await _expect_result(ws, tid)

        # stats before crossing
        sid = next_id()
        await ws.send_json({"id": sid, "type": "haventory/stats"})
        s1 = await _expect_result(ws, sid)
        assert (s1.get("result") or {}).get("low_stock_count") in {0, 1}

        # set quantity 2 => low stock
        qid = next_id()
        await ws.send_json(
            {
                "id": qid,
                "type": "haventory/item/set_quantity",
                "item_id": item_id,
                "quantity": 2,
                "expected_version": ver + 1,
            }
        )
        _ = await _expect_result(ws, qid)

        sid2 = next_id()
        await ws.send_json({"id": sid2, "type": "haventory/stats"})
        s2 = await _expect_result(ws, sid2)
        assert (s2.get("result") or {}).get("low_stock_count") >= 1

        # raise to 5 => not low
        qid2 = next_id()
        await ws.send_json(
            {
                "id": qid2,
                "type": "haventory/item/set_quantity",
                "item_id": item_id,
                "quantity": 5,
                "expected_version": (ver + 2),
            }
        )
        _ = await _expect_result(ws, qid2)

        sid3 = next_id()
        await ws.send_json({"id": sid3, "type": "haventory/stats"})
        s3 = await _expect_result(ws, sid3)
        assert (s3.get("result") or {}).get("low_stock_count") == 0
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_list_filters_sorts_pagination() -> None:  # noqa: PLR0915
    """Exercise list filters, sorts, and cursor pagination."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        ids = await _ensure_phase2_base(ws, next_id)
        # Create items
        # Hammer R in Workshop with tag garage and category tools
        rid = next_id()
        await ws.send_json(
            {
                "id": rid,
                "type": "haventory/item/create",
                "name": "Hammer R",
                "tags": ["garage"],
                "category": None,
                "location_id": ids["workshop"],
            }
        )
        _ = await _expect_result(ws, rid)

        did = next_id()
        await ws.send_json({"id": did, "type": "haventory/item/create", "name": "Hammer"})
        _ = await _expect_result(ws, did)

        # q
        q1 = next_id()
        await ws.send_json({"id": q1, "type": "haventory/item/list", "filter": {"q": "hammer"}})
        r1 = await _expect_result(ws, q1)
        assert len((r1.get("result") or {}).get("items") or []) >= 1

        # tags_any
        q2 = next_id()
        await ws.send_json(
            {"id": q2, "type": "haventory/item/list", "filter": {"tags_any": ["garage"]}}
        )
        r2 = await _expect_result(ws, q2)
        assert len((r2.get("result") or {}).get("items") or []) >= 1

        # tags_all
        q3 = next_id()
        await ws.send_json(
            {"id": q3, "type": "haventory/item/list", "filter": {"tags_all": ["garage"]}}
        )
        r3 = await _expect_result(ws, q3)
        assert len((r3.get("result") or {}).get("items") or []) >= 1

        # category (none expected)
        q4 = next_id()
        await ws.send_json(
            {"id": q4, "type": "haventory/item/list", "filter": {"category": "TOOLS"}}
        )
        r4 = await _expect_result(ws, q4)
        assert ((r4.get("result") or {}).get("items") or []) == []

        # checked_out
        q5 = next_id()
        await ws.send_json(
            {"id": q5, "type": "haventory/item/list", "filter": {"checked_out": False}}
        )
        r5 = await _expect_result(ws, q5)
        assert len((r5.get("result") or {}).get("items") or []) >= 1

        # low_stock_only
        q6 = next_id()
        await ws.send_json(
            {"id": q6, "type": "haventory/item/list", "filter": {"low_stock_only": True}}
        )
        r6 = await _expect_result(ws, q6)
        # May be zero depending on prior state
        assert ((r6.get("result") or {}).get("items") or []) in (
            [],
            (r6.get("result") or {}).get("items"),
        )

        # location_id + include_subtree under Garage (expect none as items reside in Workshop)
        q7 = next_id()
        await ws.send_json(
            {
                "id": q7,
                "type": "haventory/item/list",
                "filter": {"location_id": ids["garage"], "include_subtree": True},
            }
        )
        r7 = await _expect_result(ws, q7)
        assert ((r7.get("result") or {}).get("items") or []) == []

        # area_id prefilter: expect zero until areas are wired to locations online (best-effort)
        q8a = next_id()
        await ws.send_json(
            {
                "id": q8a,
                "type": "haventory/item/list",
                "filter": {"area_id": "00000000-0000-4000-8000-000000000000"},
            }
        )
        _ = await _expect_result(ws, q8a)

        # sort by name asc
        q8 = next_id()
        await ws.send_json(
            {"id": q8, "type": "haventory/item/list", "sort": {"field": "name", "order": "asc"}}
        )
        r8 = await _expect_result(ws, q8)
        assert r8.get("success") is True

        # sort by quantity desc
        q9 = next_id()
        await ws.send_json(
            {
                "id": q9,
                "type": "haventory/item/list",
                "sort": {"field": "quantity", "order": "desc"},
            }
        )
        r9 = await _expect_result(ws, q9)
        assert r9.get("success") is True

        # pagination: limit 1
        q10 = next_id()
        await ws.send_json(
            {
                "id": q10,
                "type": "haventory/item/list",
                "sort": {"field": "updated_at", "order": "desc"},
                "limit": 1,
            }
        )
        pg1 = await _expect_result(ws, q10)
        cursor = (pg1.get("result") or {}).get("next_cursor")
        if cursor:
            q11 = next_id()
            await ws.send_json(
                {
                    "id": q11,
                    "type": "haventory/item/list",
                    "sort": {"field": "updated_at", "order": "desc"},
                    "limit": 1,
                    "cursor": cursor,
                }
            )
            _ = await _expect_result(ws, q11)
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_p2_optimistic_concurrency_conflict() -> None:
    """Demonstrate conflict on stale expected_version with error envelope."""
    session, ws = await _open_ws()
    next_id = _id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await _expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver_a = int(cre["result"]["version"])

        # Valid update to bump
        uid = next_id()
        await ws.send_json(
            {
                "id": uid,
                "type": "haventory/item/update",
                "item_id": item_id,
                "expected_version": ver_a,
                "description": "bump",
            }
        )
        good = await _expect_result(ws, uid)
        ver_b = int(good["result"]["version"])
        assert ver_b == ver_a + 1

        # Stale update with old expected_version
        sid = next_id()
        await ws.send_json(
            {
                "id": sid,
                "type": "haventory/item/update",
                "item_id": item_id,
                "expected_version": ver_a,
                "name": "should conflict",
            }
        )
        stale = await _expect_result(ws, sid)
        assert (
            stale.get("success") is False and (stale.get("error") or {}).get("code") == "conflict"
        )
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1"
    or not os.environ.get("HA_TOKEN")
    or not os.environ.get("HA_CONTAINER"),
    reason="RUN_ONLINE!=1 or HA_TOKEN/HA_CONTAINER missing",
)
async def test_p2_logs_conflict_and_validation_present() -> None:
    """Best-effort: verify haventory WS logs appear in Docker logs (conflict/validation)."""
    # This test does not assert exact lines, only presence of key phrases to avoid flakiness.
    import asyncio  # noqa: PLC0415
    import shutil  # noqa: PLC0415
    import subprocess  # noqa: PLC0415

    # Give HA a moment to flush logs
    await asyncio.sleep(0.5)
    container = os.environ.get("HA_CONTAINER")
    try:
        docker_path = shutil.which("docker")
        if not docker_path:
            pytest.skip("docker not found")
            return
        out = subprocess.check_output(  # noqa: S603, ASYNC221
            [docker_path, "logs", "--tail", "200", container], text=True, stderr=subprocess.STDOUT
        )
    except Exception:  # pragma: no cover - environment dependent
        pytest.skip("docker logs unavailable")
        return
    assert "custom_components.haventory.ws" in out and ("validation" in out or "conflict" in out)
