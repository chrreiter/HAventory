"""Performance and correctness tests for location hierarchy indexes."""

import pytest
from custom_components.haventory.models import ItemCreate, ItemFilter
from custom_components.haventory.repository import Repository


@pytest.mark.asyncio
async def test_location_subtree_index_correctness():
    """Verify that the subtree index returns correct items."""
    repo = Repository()

    # Tree:
    # A
    #  -> A1
    #      -> A1_1 (Item1)
    #  -> A2 (Item2)
    # B (Item3)

    a = repo.create_location(name="A")
    a1 = repo.create_location(name="A1", parent_id=a.id)
    a1_1 = repo.create_location(name="A1_1", parent_id=a1.id)
    a2 = repo.create_location(name="A2", parent_id=a.id)
    b = repo.create_location(name="B")

    repo.create_item(ItemCreate(name="Item1", location_id=str(a1_1.id)))
    repo.create_item(ItemCreate(name="Item2", location_id=str(a2.id)))
    repo.create_item(ItemCreate(name="Item3", location_id=str(b.id)))

    # Query Subtree A: Should find Item1 and Item2
    expected_items = 2
    res = repo.list_items(flt=ItemFilter(location_id=str(a.id), include_subtree=True))
    assert len(res["items"]) == expected_items
    names = {i.name for i in res["items"]}
    assert names == {"Item1", "Item2"}


@pytest.mark.asyncio
async def test_location_hierarchy_updates_on_location_move():
    """Verify index updates when a location moves."""
    repo = Repository()

    # Tree:
    # Root1
    # Root2 -> Child (Item)

    r1 = repo.create_location(name="Root1")
    r2 = repo.create_location(name="Root2")
    child = repo.create_location(name="Child", parent_id=r2.id)

    repo.create_item(ItemCreate(name="Item", location_id=str(child.id)))

    # Verify initially in Root2
    expected_one = 1
    expected_zero = 0

    res = repo.list_items(flt=ItemFilter(location_id=str(r2.id), include_subtree=True))
    assert len(res["items"]) == expected_one

    # Move Child to Root1
    repo.update_location(child.id, new_parent_id=r1.id)

    # Verify removed from Root2
    res = repo.list_items(flt=ItemFilter(location_id=str(r2.id), include_subtree=True))
    assert len(res["items"]) == expected_zero

    # Verify added to Root1
    res = repo.list_items(flt=ItemFilter(location_id=str(r1.id), include_subtree=True))
    assert len(res["items"]) == expected_one


@pytest.mark.asyncio
async def test_location_hierarchy_updates_on_item_move():
    """Verify index updates when an item moves."""
    repo = Repository()

    r1 = repo.create_location(name="Root1")
    r2 = repo.create_location(name="Root2")

    item = repo.create_item(ItemCreate(name="Item", location_id=str(r1.id)))

    # Initially in R1
    expected_one = 1
    expected_zero = 0

    res = repo.list_items(flt=ItemFilter(location_id=str(r1.id), include_subtree=True))
    assert len(res["items"]) == expected_one

    # Move item to R2
    repo.update_item(item.id, {"location_id": str(r2.id)})

    # Not in R1
    res = repo.list_items(flt=ItemFilter(location_id=str(r1.id), include_subtree=True))
    assert len(res["items"]) == expected_zero

    # In R2
    res = repo.list_items(flt=ItemFilter(location_id=str(r2.id), include_subtree=True))
    assert len(res["items"]) == expected_one


@pytest.mark.asyncio
async def test_location_hierarchy_updates_on_location_delete():
    """Verify index handles deletion sequences correctly."""
    repo = Repository()
    r1 = repo.create_location(name="R1")
    child = repo.create_location(name="Child", parent_id=r1.id)
    item = repo.create_item(ItemCreate(name="Item", location_id=str(child.id)))

    # 1. Verify item in R1 subtree
    expected_one = 1
    res = repo.list_items(flt=ItemFilter(location_id=str(r1.id), include_subtree=True))
    assert len(res["items"]) == expected_one

    # 2. Delete item (should update subtree index)
    repo.delete_item(item.id)

    # Verify gone from subtree
    expected_zero = 0
    res = repo.list_items(flt=ItemFilter(location_id=str(r1.id), include_subtree=True))
    assert len(res["items"]) == expected_zero

    # 3. Delete child location (now allowed as empty)
    # This triggers _rebuild_location_hierarchy_indexes
    repo.delete_location(child.id)

    # (No public API to easily verify _location_descendants is clear,
    # but we verified _rebuild doesn't crash)
