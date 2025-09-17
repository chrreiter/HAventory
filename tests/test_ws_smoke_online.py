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
    try:
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
        # Ensure leaf 'Shelf A' is deleted if present to avoid order dependence
        shelf_id = await _find_location_id_by_name(ws, "Shelf A", next_id)
        if shelf_id:
            did = next_id()
            await ws.send_json(
                {"id": did, "type": "haventory/location/delete", "location_id": shelf_id}
            )
            _ = await _expect_result(ws, did)
        fid = next_id()
        await ws.send_json({"id": fid, "type": "haventory/stats"})
        stats_final = await _expect_result(ws, fid)
        s_final = stats_final.get("result", {})
        assert s_final.get("locations_total") == EXPECTED_FINAL_LOCATIONS  # Basement + Garage West
    finally:
        await ws.close()
        await session.close()
