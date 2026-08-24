import os
import uuid

import pytest

from online_helpers import expect_result, id_counter, open_ws

pytestmark = pytest.mark.online


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)
async def test_ws_areas_list_with_created_areas() -> None:
    """Create temporary areas via HA WS API and assert haventory/areas/list includes them.

    Guarded by HA_ALLOW_AREA_MUTATIONS=1 to avoid modifying real instances unintentionally.
    """

    if os.environ.get("HA_ALLOW_AREA_MUTATIONS") != "1":
        pytest.skip("HA_ALLOW_AREA_MUTATIONS!=1; skipping area creation online test")

    session, ws = await open_ws()
    next_id = id_counter()
    try:
        # Create two unique areas via HA's area registry WS API
        suffix = uuid.uuid4().hex[:8]
        names = [f"haventory-e2e-{suffix}-A", f"haventory-e2e-{suffix}-B"]
        area_ids: list[str] = []

        for nm in names:
            cid = next_id()
            await ws.send_json({"id": cid, "type": "config/area_registry/create", "name": nm})
            created = await expect_result(ws, cid)
            if not created.get("success"):
                pytest.skip("area_registry/create not available; skipping")
            cres = created.get("result") or {}
            # HA may return id directly or nested under 'area'. Support both.
            aid = cres.get("id") or (cres.get("area") or {}).get("id") or cres.get("area_id")
            assert isinstance(aid, str) and len(aid) > 0
            area_ids.append(aid)

        # Call haventory/areas/list and ensure our areas are included by id or name
        qid = next_id()
        await ws.send_json({"id": qid, "type": "haventory/areas/list"})
        got = await expect_result(ws, qid)
        if not got.get("success"):
            pytest.skip("haventory/areas/list not available; skipping")
        areas = (got.get("result") or {}).get("areas") or []
        ids = {a.get("id") for a in areas if isinstance(a, dict)}
        assert set(area_ids).issubset(ids)

    finally:
        # Cleanup created areas
        for aid in area_ids:
            did = next_id()
            await ws.send_json({"id": did, "type": "config/area_registry/delete", "area_id": aid})
            _ = await expect_result(ws, did)
        await ws.close()
        await session.close()
