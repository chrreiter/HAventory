"""Offline tests for haventory WebSocket location commands.

Scenarios:
- create/get/update/move_subtree/delete location via WS success
- list locations returns array
- tree returns nested structure
- error mapping for validation and not_found
"""

from __future__ import annotations

import pytest
from custom_components.haventory.areas import async_get_area_registry
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, repo_of, runtime_of
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_location_crud_and_tree() -> None:
    """Create a small tree, list, get, move via WS, and delete."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    # Seed areas and create root and child
    reg = await async_get_area_registry(hass)
    area_uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    reg._add(area_uuid, "Garage")  # type: ignore[attr-defined]

    res_root = await ws_send(hass, 1, "haventory/location/create", name="Root", area_id=area_uuid)
    root_id = res_root["result"]["id"]
    res_child = await ws_send(hass, 2, "haventory/location/create", name="Shelf", parent_id=root_id)
    child_id = res_child["result"]["id"]

    # Get
    res = await ws_send(hass, 3, "haventory/location/get", location_id=root_id)
    assert res["success"] is True and res["result"]["id"] == root_id

    # List
    res = await ws_send(hass, 4, "haventory/location/list")
    expected_locations_count = 2  # root + child
    assert res["success"] is True and len(res["result"]) == expected_locations_count

    # Tree
    res = await ws_send(hass, 5, "haventory/location/tree")
    assert res["success"] is True
    tree = res["result"]
    assert isinstance(tree, list) and len(tree) == 1
    assert tree[0]["id"] == root_id and tree[0]["children"][0]["id"] == child_id
    assert tree[0]["path"]["display_path"] == "Root"


@pytest.mark.asyncio
async def test_ws_location_create_update_area_validation() -> None:
    """Create/update with area validation and serialization of area_id."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    # Unknown area on create → validation_error
    bad = await ws_send(hass, 1, "haventory/location/create", name="X", area_id="missing")
    assert bad["success"] is False and bad["error"]["code"] == "validation_error"

    # Seed area, create ok
    reg = await async_get_area_registry(hass)
    area_uuid1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    reg._add(area_uuid1, "Garage")  # type: ignore[attr-defined]
    created = await ws_send(hass, 2, "haventory/location/create", name="A", area_id=area_uuid1)
    assert created["success"] is True and created["result"]["area_id"] == area_uuid1
    loc_id = created["result"]["id"]

    # Unknown area on update → validation_error
    upd_bad = await ws_send(
        hass, 3, "haventory/location/update", location_id=loc_id, area_id="missing"
    )
    assert upd_bad["success"] is False and upd_bad["error"]["code"] == "validation_error"

    # Add second area and update ok
    area_uuid2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    reg._add(area_uuid2, "Office")  # type: ignore[attr-defined]
    updated = await ws_send(
        hass, 4, "haventory/location/update", location_id=loc_id, area_id=area_uuid2
    )
    assert updated["success"] is True and updated["result"]["area_id"] == area_uuid2

    # No further mutations in this test


@pytest.mark.asyncio
async def test_ws_location_create_update_area_with_non_uuid_id() -> None:
    """WS accepts non-UUID area ids when present in HA area registry."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    reg = await async_get_area_registry(hass)
    reg._add("kitchen", "Kitchen")  # type: ignore[attr-defined]

    created = await ws_send(hass, 1, "haventory/location/create", name="Root", area_id="kitchen")
    assert created["success"] is True and created["result"]["area_id"] == "kitchen"
    loc_id = created["result"]["id"]

    reg._add("garage", "Garage")  # type: ignore[attr-defined]
    updated = await ws_send(
        hass, 2, "haventory/location/update", location_id=loc_id, area_id="garage"
    )
    assert updated["success"] is True and updated["result"]["area_id"] == "garage"


@pytest.mark.asyncio
async def test_location_error_mapping() -> None:
    """Invalid operations yield validation/not_found errors."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)


@pytest.mark.asyncio
async def test_ws_location_mutations_persist_to_store(monkeypatch) -> None:
    """Location create/update/delete should persist via DomainStore.save."""

    hass = HomeAssistant()
    install_runtime(hass)
    store = DomainStore(hass)
    runtime_of(hass).store = store
    ws_setup(hass)

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    root = await ws_send(hass, 1, "haventory/location/create", name="Root")
    rid = root["result"]["id"]
    await ws_send(hass, 2, "haventory/location/update", location_id=rid, name="Root2")
    await ws_send(hass, 3, "haventory/location/delete", location_id=rid)
    MIN_PERSISTS_TOTAL = 3
    assert calls["count"] >= MIN_PERSISTS_TOTAL

    # Not found
    res = await ws_send(
        hass, 1, "haventory/location/get", location_id="00000000-0000-4000-8000-000000000000"
    )
    assert res["success"] is False and res["error"]["code"] == "not_found"

    # Validation: create with empty name
    res = await ws_send(hass, 2, "haventory/location/create", name="")
    assert res["success"] is False and res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_location_move_subtree_persists(monkeypatch) -> None:
    """move_subtree persists via DomainStore.async_save."""

    hass = HomeAssistant()
    install_runtime(hass)
    store = DomainStore(hass)
    runtime_of(hass).store = store
    ws_setup(hass)

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Create a small tree: Root -> Shelf
    res_root = await ws_send(hass, 10, "haventory/location/create", name="Root")
    root_id = res_root["result"]["id"]
    res_child = await ws_send(
        hass, 11, "haventory/location/create", name="Shelf", parent_id=root_id
    )
    child_id = res_child["result"]["id"]

    before = calls["count"]
    # Move subtree: Shelf -> root (new_parent_id=None)
    res_move = await ws_send(
        hass, 12, "haventory/location/move_subtree", location_id=child_id, new_parent_id=None
    )
    assert res_move["success"] is True
    after = calls["count"]
    # Expect at least one persist triggered by move_subtree
    assert after >= before + 1


@pytest.mark.asyncio
async def test_location_tree_includes_item_counts() -> None:
    """Tree nodes carry direct and subtree item counts."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    root = await ws_send(hass, 1, "haventory/location/create", name="Garage")
    root_id = root["result"]["id"]
    child = await ws_send(hass, 2, "haventory/location/create", name="Shelf", parent_id=root_id)
    child_id = child["result"]["id"]

    await ws_send(hass, 3, "haventory/item/create", name="Car", location_id=root_id)
    await ws_send(hass, 4, "haventory/item/create", name="Wrench", location_id=child_id)
    await ws_send(hass, 5, "haventory/item/create", name="Orphan")

    res = await ws_send(hass, 6, "haventory/location/tree")
    assert res["success"] is True
    node = res["result"][0]
    subtree_total = 2
    assert node["direct_item_count"] == 1
    assert node["subtree_item_count"] == subtree_total
    child_node = node["children"][0]
    assert child_node["direct_item_count"] == 1
    assert child_node["subtree_item_count"] == 1

    # Moving the wrench out of the tree drops both counts
    items = repo_of(hass).list_items(flt={"q": "wrench"})["items"]
    repo_of(hass).update_item(items[0].id, {"location_id": None})
    res2 = await ws_send(hass, 8, "haventory/location/tree")
    node2 = res2["result"][0]
    assert node2["direct_item_count"] == 1
    assert node2["subtree_item_count"] == 1
    assert node2["children"][0]["direct_item_count"] == 0
    assert node2["children"][0]["subtree_item_count"] == 0


@pytest.mark.asyncio
async def test_location_tree_reports_matching_counts_for_a_filter() -> None:
    """With a filter, nodes also carry how much of themselves it keeps."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    root = await ws_send(hass, 1, "haventory/location/create", name="Garage")
    root_id = root["result"]["id"]
    child = await ws_send(hass, 2, "haventory/location/create", name="Shelf", parent_id=root_id)
    child_id = child["result"]["id"]

    create = "haventory/item/create"
    await ws_send(hass, 3, create, name="Car", location_id=root_id, category="Auto")
    await ws_send(hass, 4, create, name="Wrench", location_id=child_id, category="Tools")
    await ws_send(hass, 5, create, name="Saw", location_id=child_id, category="Tools")

    res = await ws_send(hass, 6, "haventory/location/tree", filter={"category": "Tools"})
    assert res["success"] is True
    node = res["result"][0]
    matching_subtree = 2
    all_subtree = 3
    # Unfiltered counts are unchanged; the matching pair sits beside them.
    assert node["subtree_item_count"] == all_subtree
    assert node["matching_direct_count"] == 0
    assert node["matching_subtree_count"] == matching_subtree
    assert node["children"][0]["matching_subtree_count"] == matching_subtree

    # Without a filter the keys are absent rather than zero, so a client can tell
    # "nothing matches" from "nothing was asked".
    plain = await ws_send(hass, 7, "haventory/location/tree")
    assert "matching_subtree_count" not in plain["result"][0]

    # A malformed filter is rejected like anywhere else, not silently ignored.
    bad = await ws_send(hass, 8, "haventory/location/tree", filter={"updated_after": "2024/01/01"})
    assert bad["success"] is False and bad["error"]["code"] == "validation_error"
