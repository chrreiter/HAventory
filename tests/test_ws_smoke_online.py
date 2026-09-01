import os
import uuid
from typing import Any

import aiohttp
import pytest
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION

from online_helpers import expect_result, id_counter, open_ws, ws_url_from_base

pytestmark = pytest.mark.online

# Destructive online tests PURGE ALL HAventory data on the target instance.
# They are opt-in twice: RUN_ONLINE=1 *and* HAV_ONLINE_DESTRUCTIVE=1, and must
# only ever be pointed at a disposable HA. Everything not marked destructive is
# self-contained: it creates uniquely-named entities and cleans them up.
DESTRUCTIVE_ONLINE = os.environ.get("HAV_ONLINE_DESTRUCTIVE") == "1"
destructive = pytest.mark.skipif(
    not DESTRUCTIVE_ONLINE,
    reason=(
        "destructive online test (purges ALL HAventory data on the target HA); "
        "set HAV_ONLINE_DESTRUCTIVE=1 only against a disposable instance"
    ),
)


def _unique(name: str) -> str:
    """A per-run unique entity name so tests never collide with real data."""
    return f"{name} {uuid.uuid4().hex[:8]}"


MAGIC_MIN_ADDED_LOCATIONS: int = 2
EXPECTED_LOCATIONS_AFTER_CREATE: int = 2
EXPECTED_FINAL_LOCATIONS: int = 2


async def _create_location(
    ws: aiohttp.ClientWebSocketResponse, next_id, name: str, parent_id: str | None = None
) -> str:
    cid = next_id()
    payload: dict[str, Any] = {"id": cid, "type": "haventory/location/create", "name": name}
    if parent_id is not None:
        payload["parent_id"] = parent_id
    await ws.send_json(payload)
    res = await expect_result(ws, cid)
    assert res.get("success") is True, res
    return str(res["result"]["id"])


async def _delete_location_quiet(
    ws: aiohttp.ClientWebSocketResponse, next_id, location_id: str | None
) -> None:
    """Best-effort cleanup delete for test-created locations."""
    if not location_id:
        return
    did = next_id()
    await ws.send_json({"id": did, "type": "haventory/location/delete", "location_id": location_id})
    _ = await expect_result(ws, did)


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_areas_list_and_location_area_field_presence() -> None:
    """Verify areas/list shape and that location serialization includes area_id."""

    session, ws = await open_ws()
    next_id = id_counter()
    try:
        # areas/list returns {areas: []}
        aid = next_id()
        await ws.send_json({"id": aid, "type": "haventory/areas/list"})
        areas = await expect_result(ws, aid)
        if not areas.get("success"):
            pytest.skip("areas/list not available in this HA runtime")
        assert isinstance((areas.get("result") or {}).get("areas"), list)

        # Create a location without area_id and ensure serializer includes area_id: null
        cid = next_id()
        probe_name = _unique("AreaProbe")
        await ws.send_json({"id": cid, "type": "haventory/location/create", "name": probe_name})
        cre = await expect_result(ws, cid)
        loc = cre.get("result") or {}
        assert "area_id" in loc and loc.get("area_id") is None
        # Clean up the probe location so the test leaves no trace
        await _delete_location_quiet(ws, next_id, loc.get("id"))
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

    ws_url = ws_url_from_base(base)

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
            assert result.get("schema_version") == CURRENT_SCHEMA_VERSION


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
@destructive
async def test_ws_smoke_phase0_phase1_locations() -> None:  # noqa: PLR0915
    """End-to-end online smoke: Phase 0 and Phase 1 (locations CRUD and validation).

    Preconditions:
    - Intended to run against a clean dataset (fresh storage) so Phase 0 stats are zero.
    """
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        # Purge any existing items/locations to ensure a clean dataset
        await _purge_items(ws, next_id)
        await _purge_locations(ws, next_id)

        # Phase 0.1: ping
        await ws.send_json({"id": 101, "type": "haventory/ping", "echo": "hi"})
        msg = await expect_result(ws, 101)
        assert msg.get("success") is True  # scenario: WS echo should succeed
        assert msg.get("result", {}).get("echo") == "hi"  # expected: echo roundtrip

        # Phase 0.2: version and stats
        await ws.send_json({"id": 102, "type": "haventory/version"})
        ver = await expect_result(ws, 102)
        assert ver.get("success") is True  # scenario: version endpoint works
        vres = ver.get("result")
        assert isinstance(vres, dict) and vres.get("schema_version") == CURRENT_SCHEMA_VERSION

        await ws.send_json({"id": 103, "type": "haventory/stats"})
        stats = await expect_result(ws, 103)
        sres = stats.get("result", {})
        # Expect clean storage (script purges before running)
        assert sres.get("items_total") == 0  # scenario: no items initially
        assert sres.get("locations_total") == 0  # scenario: no locations initially

        # Phase 0.3: health
        await ws.send_json({"id": 104, "type": "haventory/health"})
        health = await expect_result(ws, 104)
        hres = health.get("result", {})
        assert hres.get("healthy") is True  # expected: healthy on empty dataset
        assert hres.get("issues") == []  # expected: no issues

        # Phase 1.1: create root and child
        await ws.send_json({"id": 201, "type": "haventory/location/create", "name": "Garage"})
        cre_g = await expect_result(ws, 201)
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
        cre_s = await expect_result(ws, 202)
        shelf_id = cre_s.get("result", {}).get("id")
        assert isinstance(shelf_id, str) and len(shelf_id) > 0

        await ws.send_json({"id": 203, "type": "haventory/location/list"})
        lst = await expect_result(ws, 203)
        lres = lst.get("result")
        assert (
            isinstance(lres, list) and len(lres) >= MAGIC_MIN_ADDED_LOCATIONS
        )  # minimum expected additions
        ids = {loc.get("id") for loc in lres if isinstance(loc, dict)}
        assert garage_id in ids and shelf_id in ids  # created ids present
        shelf_entry = next(loc for loc in lres if loc.get("id") == shelf_id)
        assert shelf_entry.get("parent_id") == garage_id  # parent relation

        await ws.send_json({"id": 204, "type": "haventory/location/tree"})
        tree = await expect_result(ws, 204)
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
        stats_after_create = await expect_result(ws, 205)
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
    """Rename a test-created location (self-contained, cleans up after itself)."""
    session, ws = await open_ws()
    next_id = id_counter()
    loc_id: str | None = None
    try:
        name = _unique("SmokeRename")
        loc_id = await _create_location(ws, next_id, name)
        rid = next_id()
        await ws.send_json(
            {
                "id": rid,
                "type": "haventory/location/update",
                "location_id": loc_id,
                "name": f"{name} Renamed",
            }
        )
        upd = await expect_result(ws, rid)
        assert upd.get("success") is True and upd["result"]["name"] == f"{name} Renamed"
    finally:
        await _delete_location_quiet(ws, next_id, loc_id)
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_move_subtree() -> None:
    """Move a test-created subtree under another test-created root (self-contained)."""
    session, ws = await open_ws()
    next_id = id_counter()
    garage_id: str | None = None
    basement_id: str | None = None
    try:
        garage_id = await _create_location(ws, next_id, _unique("SmokeMoveSrc"))
        basement_id = await _create_location(ws, next_id, _unique("SmokeMoveDst"))
        mid = next_id()
        await ws.send_json(
            {
                "id": mid,
                "type": "haventory/location/move_subtree",
                "location_id": garage_id,
                "new_parent_id": basement_id,
            }
        )
        mv = await expect_result(ws, mid)
        assert mv.get("success") is True
        # Verify via tree
        tid = next_id()
        await ws.send_json({"id": tid, "type": "haventory/location/tree"})
        tree2 = await expect_result(ws, tid)
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
        # children first: the moved source now sits under the destination
        await _delete_location_quiet(ws, next_id, garage_id)
        await _delete_location_quiet(ws, next_id, basement_id)
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_move_subtree_negative_self() -> None:
    """Negative: cannot move a location under itself (self-contained)."""
    session, ws = await open_ws()
    next_id = id_counter()
    garage_id: str | None = None
    try:
        garage_id = await _create_location(ws, next_id, _unique("SmokeSelfMove"))
        nid = next_id()
        await ws.send_json(
            {
                "id": nid,
                "type": "haventory/location/move_subtree",
                "location_id": garage_id,
                "new_parent_id": garage_id,
            }
        )
        neg = await expect_result(ws, nid)
        assert (
            neg.get("success") is False
            and (neg.get("error") or {}).get("code") == "validation_error"
        )
    finally:
        await _delete_location_quiet(ws, next_id, garage_id)
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_move_subtree_negative_descendant() -> None:
    """Negative: cannot move a location under a descendant (self-contained)."""
    session, ws = await open_ws()
    next_id = id_counter()
    garage_id: str | None = None
    shelf_id: str | None = None
    try:
        garage_id = await _create_location(ws, next_id, _unique("SmokeDescMove"))
        shelf_id = await _create_location(
            ws, next_id, _unique("SmokeDescShelf"), parent_id=garage_id
        )
        nid = next_id()
        await ws.send_json(
            {
                "id": nid,
                "type": "haventory/location/move_subtree",
                "location_id": garage_id,
                "new_parent_id": shelf_id,
            }
        )
        neg2 = await expect_result(ws, nid)
        assert (
            neg2.get("success") is False
            and (neg2.get("error") or {}).get("code") == "validation_error"
        )
    finally:
        # child first, then the root
        await _delete_location_quiet(ws, next_id, shelf_id)
        await _delete_location_quiet(ws, next_id, garage_id)
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_location_delete_leaf_and_get_not_found() -> None:
    """Delete a test-created leaf and verify get returns not_found (self-contained)."""
    session, ws = await open_ws()
    next_id = id_counter()
    root_id: str | None = None
    try:
        root_id = await _create_location(ws, next_id, _unique("SmokeDelRoot"))
        shelf_id = await _create_location(ws, next_id, _unique("SmokeDelLeaf"), parent_id=root_id)
        did = next_id()
        await ws.send_json(
            {"id": did, "type": "haventory/location/delete", "location_id": shelf_id}
        )
        del_ack = await expect_result(ws, did)
        assert del_ack.get("success") is True
        gid = next_id()
        await ws.send_json({"id": gid, "type": "haventory/location/get", "location_id": shelf_id})
        get_after = await expect_result(ws, gid)
        assert (
            get_after.get("success") is False
            and (get_after.get("error") or {}).get("code") == "not_found"
        )
    finally:
        await _delete_location_quiet(ws, next_id, root_id)
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
@destructive
async def test_ws_final_stats_after_all_location_ops() -> None:
    """Final stats: expect 2 locations remaining (Basement + Garage West)."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        # Make this test independent: purge all locations, then create exactly two roots
        await _purge_locations(ws, next_id)
        # Create 'Basement'
        bid = next_id()
        await ws.send_json({"id": bid, "type": "haventory/location/create", "name": "Basement"})
        _ = await expect_result(ws, bid)
        # Create 'Garage West'
        gid = next_id()
        await ws.send_json({"id": gid, "type": "haventory/location/create", "name": "Garage West"})
        _ = await expect_result(ws, gid)
        fid = next_id()
        await ws.send_json({"id": fid, "type": "haventory/stats"})
        stats_final = await expect_result(ws, fid)
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
    lst = await expect_result(ws, qid)
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
        _ = await expect_result(ws, did)


async def _purge_locations(ws: aiohttp.ClientWebSocketResponse, next_id) -> None:
    qid = next_id()
    await ws.send_json({"id": qid, "type": "haventory/location/list"})
    lst = await expect_result(ws, qid)
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
        _ = await expect_result(ws, did)


async def _ensure_phase2_base(ws: aiohttp.ClientWebSocketResponse, next_id) -> dict[str, str]:
    # Purge everything
    await _purge_items(ws, next_id)
    await _purge_locations(ws, next_id)

    # Create base locations: Garage, Workshop, Shelf A under Garage
    gid = next_id()
    await ws.send_json({"id": gid, "type": "haventory/location/create", "name": L_GARAGE})
    cre_g = await expect_result(ws, gid)
    garage_id = str((cre_g.get("result") or {}).get("id"))

    wid = next_id()
    await ws.send_json({"id": wid, "type": "haventory/location/create", "name": L_WORKSHOP})
    cre_w = await expect_result(ws, wid)
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
    cre_s = await expect_result(ws, sid)
    shelf_a_id = str((cre_s.get("result") or {}).get("id"))

    return {"garage": garage_id, "workshop": workshop_id, "shelfA": shelf_a_id}


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
@destructive
async def test_p2_item_create_defaults_and_rich() -> None:
    """Create default item and rich item with all optionals."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        ids = await _ensure_phase2_base(ws, next_id)

        # Default
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer"})
        cre = await expect_result(ws, cid)
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
        rich = await expect_result(ws, rid)
        ritem = rich.get("result") or {}
        TARGET_QTY_RICH = 3  # avoid magic numbers
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
@destructive
async def test_p2_item_get_update_delete_recreate() -> None:
    """Get, update (version++), delete (with expected), then re-create."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)

        # Create
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer"})
        cre = await expect_result(ws, cid)
        item_id = cre["result"]["id"]
        ver = int(cre["result"]["version"])

        # Get
        gid = next_id()
        await ws.send_json({"id": gid, "type": "haventory/item/get", "item_id": item_id})
        got = await expect_result(ws, gid)
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
        upd = await expect_result(ws, uid)
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
        del_ack = await expect_result(ws, did)
        assert del_ack.get("success") is True

        # Re-create for later tests
        rcid = next_id()
        await ws.send_json({"id": rcid, "type": "haventory/item/create", "name": "Hammer R"})
        re = await expect_result(ws, rcid)
        assert re.get("success") is True
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
@destructive
async def test_p2_item_move_between_locations() -> None:
    """Move item to Workshop; verify location_path and version bump."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        ids = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await expect_result(ws, cid)
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
        mv = await expect_result(ws, mid)
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
@destructive
async def test_p2_quantity_operations() -> None:
    """Invalid set_quantity (-1) then adjust +2 and set=5."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await expect_result(ws, cid)
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
        neg = await expect_result(ws, sid)
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
        adj = await expect_result(ws, aid)
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
        setq = await expect_result(ws, sid2)
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
@destructive
async def test_p2_checkout_checkin_and_due_dates() -> None:
    """Check-out with due_date, check-in, then negative due_date without checked_out."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await expect_result(ws, cid)
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
        co = await expect_result(ws, coid)
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
        ci = await expect_result(ws, ciid)
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
        neg = await expect_result(ws, nid)
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
@destructive
async def test_p2_tags_and_custom_fields() -> None:
    """Add/remove tags; set/unset custom fields; verify normalization and result."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await expect_result(ws, cid)
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
        tadd = await expect_result(ws, tid)
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
        trem = await expect_result(ws, rid)
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
        cset = await expect_result(ws, sid)
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
        cunset = await expect_result(ws, uid)
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
@destructive
async def test_p2_low_stock_threshold_and_stats() -> None:
    """Set threshold and cross it to verify low_stock_count in stats."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item quantity 5
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await expect_result(ws, cid)
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
        _ = await expect_result(ws, tid)

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
        _ = await expect_result(ws, qid)

        sid2 = next_id()
        await ws.send_json({"id": sid2, "type": "haventory/stats"})
        s2 = await expect_result(ws, sid2)
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
        _ = await expect_result(ws, qid2)

        sid3 = next_id()
        await ws.send_json({"id": sid3, "type": "haventory/stats"})
        s3 = await expect_result(ws, sid3)
        assert (s3.get("result") or {}).get("low_stock_count") == 0
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
@destructive
async def test_p2_list_filters_sorts_pagination() -> None:  # noqa: PLR0915
    """Exercise list filters, sorts, and cursor pagination."""
    session, ws = await open_ws()
    next_id = id_counter()
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
        _ = await expect_result(ws, rid)

        did = next_id()
        await ws.send_json({"id": did, "type": "haventory/item/create", "name": "Hammer"})
        _ = await expect_result(ws, did)

        # q
        q1 = next_id()
        await ws.send_json({"id": q1, "type": "haventory/item/list", "filter": {"q": "hammer"}})
        r1 = await expect_result(ws, q1)
        assert len((r1.get("result") or {}).get("items") or []) >= 1

        # tags_any
        q2 = next_id()
        await ws.send_json(
            {"id": q2, "type": "haventory/item/list", "filter": {"tags_any": ["garage"]}}
        )
        r2 = await expect_result(ws, q2)
        assert len((r2.get("result") or {}).get("items") or []) >= 1

        # tags_all
        q3 = next_id()
        await ws.send_json(
            {"id": q3, "type": "haventory/item/list", "filter": {"tags_all": ["garage"]}}
        )
        r3 = await expect_result(ws, q3)
        assert len((r3.get("result") or {}).get("items") or []) >= 1

        # category (none expected)
        q4 = next_id()
        await ws.send_json(
            {"id": q4, "type": "haventory/item/list", "filter": {"category": "TOOLS"}}
        )
        r4 = await expect_result(ws, q4)
        assert ((r4.get("result") or {}).get("items") or []) == []

        # checked_out
        q5 = next_id()
        await ws.send_json(
            {"id": q5, "type": "haventory/item/list", "filter": {"checked_out": False}}
        )
        r5 = await expect_result(ws, q5)
        assert len((r5.get("result") or {}).get("items") or []) >= 1

        # location_id + include_subtree under Garage (expect none as items reside in Workshop)
        q7 = next_id()
        await ws.send_json(
            {
                "id": q7,
                "type": "haventory/item/list",
                "filter": {"location_id": ids["garage"], "include_subtree": True},
            }
        )
        r7 = await expect_result(ws, q7)
        assert ((r7.get("result") or {}).get("items") or []) == []

        # sort by name asc
        q8 = next_id()
        await ws.send_json(
            {"id": q8, "type": "haventory/item/list", "sort": {"field": "name", "order": "asc"}}
        )
        r8 = await expect_result(ws, q8)
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
        r9 = await expect_result(ws, q9)
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
        pg1 = await expect_result(ws, q10)
        assert pg1.get("success") is True
    finally:
        await ws.close()
        await session.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
@destructive
async def test_p2_optimistic_concurrency_conflict() -> None:
    """Demonstrate conflict on stale expected_version with error envelope."""
    session, ws = await open_ws()
    next_id = id_counter()
    try:
        _ = await _ensure_phase2_base(ws, next_id)
        # Create item
        cid = next_id()
        await ws.send_json({"id": cid, "type": "haventory/item/create", "name": "Hammer R"})
        cre = await expect_result(ws, cid)
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
        good = await expect_result(ws, uid)
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
        stale = await expect_result(ws, sid)
        assert (
            stale.get("success") is False and (stale.get("error") or {}).get("code") == "conflict"
        )
    finally:
        await ws.close()
        await session.close()
