"""Offline tests for the in-memory Repository (items focus).

Scenarios cover CRUD, optimistic concurrency, filtering/sorting/pagination,
and derived counts (checked_out and low_stock).
"""

from __future__ import annotations

import uuid

import pytest
from custom_components.haventory.exceptions import ConflictError, NotFoundError
from custom_components.haventory.models import ItemCreate, ItemFilter, ItemUpdate, Sort
from custom_components.haventory.repository import Repository

TOTAL_ITEMS = 3
INITIAL_LOW_STOCK_COUNT = 1
LOW_STOCK_AFTER_ADJUST = 2
LOADED_ITEM_COUNT = 2


@pytest.mark.asyncio
async def test_item_crud_and_concurrency() -> None:
    """Create, get, update, and delete with version checks."""

    repo = Repository()

    # Create
    item = repo.create_item(ItemCreate(name="Hammer"))
    assert item.name == "Hammer"
    assert repo.get_counts()["items_total"] == 1

    # Get
    fetched = repo.get_item(item.id)
    assert str(fetched.id) == str(item.id)

    # Update with mismatched version → ConflictError
    with pytest.raises(ConflictError):
        repo.update_item(item.id, {"name": "Hammer v2"}, expected_version=item.version + 1)  # type: ignore[arg-type]

    # Successful update increments version
    updated = repo.update_item(item.id, {"name": "Hammer v2"}, expected_version=item.version)  # type: ignore[arg-type]
    assert updated.version == item.version + 1
    assert updated.name == "Hammer v2"

    # Delete with wrong version → ConflictError
    with pytest.raises(ConflictError):
        repo.delete_item(item.id, expected_version=999)

    # Delete succeeds with current version
    repo.delete_item(item.id, expected_version=updated.version)
    with pytest.raises(NotFoundError):
        repo.get_item(item.id)
    assert repo.get_counts()["items_total"] == 0


@pytest.mark.asyncio
async def test_filter_sort_and_cursor_pagination() -> None:
    """Filter, sort, and paginate deterministically with a stable cursor."""

    repo = Repository()

    # Create a small catalog of items with names exercising case/accent rules
    names = ["Äfter", "alpha", "Bravo", "Zulu", "Oscar"]
    for nm in names:
        repo.create_item(ItemCreate(name=nm))

    # Sort by name asc (case-insensitive, accent-folded)
    sort = Sort(field="name", order="asc")  # type: ignore[typeddict-item]

    page1 = repo.list_items(sort=sort, limit=2)
    assert [x.name for x in page1["items"]] == ["Äfter", "alpha"]
    assert isinstance(page1["next_cursor"], str)

    page2 = repo.list_items(sort=sort, limit=2, cursor=page1["next_cursor"])  # type: ignore[arg-type]
    assert [x.name for x in page2["items"]] == ["Bravo", "Oscar"]
    assert isinstance(page2["next_cursor"], str)

    page3 = repo.list_items(sort=sort, limit=2, cursor=page2["next_cursor"])  # type: ignore[arg-type]
    assert [x.name for x in page3["items"]] == ["Zulu"]
    assert page3["next_cursor"] is None

    # Apply a q filter (name/description/tags/location path case-insensitive)
    out = repo.list_items(flt=ItemFilter(q="lph"))
    assert [x.name for x in out["items"]] == ["alpha"]


@pytest.mark.asyncio
async def test_prefilter_by_area_and_and_logic_with_location() -> None:
    """Pre-filter by area id and support AND with location_id."""

    repo = Repository()
    # Create locations: L1(area=A), L2(area=B)
    area_a = uuid.uuid4()
    area_b = uuid.uuid4()
    l1 = repo.create_location(name="L1", area_id=area_a)
    l2 = repo.create_location(name="L2", area_id=area_b)

    # Items in each location
    i1 = repo.create_item(ItemCreate(name="X", location_id=str(l1.id)))
    i2 = repo.create_item(ItemCreate(name="Y", location_id=str(l2.id)))

    # Filter by area A returns only i1
    out = repo.list_items(flt=ItemFilter(area_id=str(area_a)))
    assert [x.id for x in out["items"]] == [i1.id]

    # Filter by area B AND location_id=L2 returns only i2
    out2 = repo.list_items(
        flt=ItemFilter(area_id=str(area_b), location_id=str(l2.id)),
        sort=Sort(field="name", order="asc"),  # type: ignore[typeddict-item]
    )
    assert [x.id for x in out2["items"]] == [i2.id]


@pytest.mark.asyncio
async def test_prefilter_by_area_with_non_uuid_ids_and_update_rebuckets() -> None:
    """Repository accepts string area ids and re-buckets items on area change."""

    repo = Repository()
    # Non-UUID area ids
    l1 = repo.create_location(name="L1", area_id="kitchen")
    l2 = repo.create_location(name="L2", area_id="garage")

    i1 = repo.create_item(ItemCreate(name="X", location_id=str(l1.id)))
    i2 = repo.create_item(ItemCreate(name="Y", location_id=str(l2.id)))

    # Filter by 'kitchen' returns only i1
    out = repo.list_items(flt=ItemFilter(area_id="kitchen"))
    assert [x.id for x in out["items"]] == [i1.id]

    # Change L2 area to 'kitchen' and ensure item re-bucketed
    repo.update_location(l2.id, area_id="kitchen")
    out2 = repo.list_items(flt=ItemFilter(area_id="kitchen"))
    assert {x.id for x in out2["items"]} == {i1.id, i2.id}

    # 'garage' bucket now empty
    out3 = repo.list_items(flt=ItemFilter(area_id="garage"))
    assert [x.id for x in out3["items"]] == []


@pytest.mark.asyncio
async def test_low_stock_and_checked_out_counts_update() -> None:
    """Derived counts reflect item state and update on writes."""

    repo = Repository()

    # Create items; glue starts as low-stock due to threshold 0
    repo.create_item(ItemCreate(name="Glue", quantity=0, low_stock_threshold=0))
    i2 = repo.create_item(ItemCreate(name="Screws", quantity=5, low_stock_threshold=2))
    i3 = repo.create_item(ItemCreate(name="Hammer"))

    cnt = repo.get_counts()
    assert cnt["items_total"] == TOTAL_ITEMS
    assert cnt["low_stock_count"] == INITIAL_LOW_STOCK_COUNT
    assert cnt["checked_out_count"] == 0

    # Adjust quantity to enter low-stock for i2
    repo.set_quantity(i2.id, 2)
    cnt2 = repo.get_counts()
    assert cnt2["low_stock_count"] == LOW_STOCK_AFTER_ADJUST

    # Check-out and check-in
    repo.check_out(i3.id, due_date="2024-01-02")
    assert repo.get_counts()["checked_out_count"] == 1
    repo.check_in(i3.id)
    assert repo.get_counts()["checked_out_count"] == 0


@pytest.mark.asyncio
async def test_generation_counter_on_item_operations() -> None:
    """Generation counter increments on every item state modification."""
    repo = Repository()
    initial_gen = repo.generation

    # Create item increments generation
    item = repo.create_item(ItemCreate(name="Test Item", quantity=10))
    assert repo.generation == initial_gen + 1

    # Update item increments generation
    repo.update_item(item.id, ItemUpdate(quantity=20))
    gen_after_update = repo.generation
    assert gen_after_update > initial_gen + 1

    # Adjust quantity increments generation
    repo.adjust_quantity(item.id, delta=5)
    gen_after_adjust = repo.generation
    assert gen_after_adjust > gen_after_update

    # Set quantity increments generation
    repo.set_quantity(item.id, quantity=30)
    gen_after_set = repo.generation
    assert gen_after_set > gen_after_adjust

    # Check out increments generation
    repo.check_out(item.id, due_date="2025-12-31")
    gen_after_checkout = repo.generation
    assert gen_after_checkout > gen_after_set

    # Check in increments generation
    repo.check_in(item.id)
    gen_after_checkin = repo.generation
    assert gen_after_checkin > gen_after_checkout

    # Delete item increments generation
    repo.delete_item(item.id)
    assert repo.generation > gen_after_checkin


@pytest.mark.asyncio
async def test_generation_counter_on_location_operations() -> None:
    """Generation counter increments on every location state modification."""
    repo = Repository()
    initial_gen = repo.generation

    # Create location increments generation
    loc1 = repo.create_location(name="Workshop")
    assert repo.generation == initial_gen + 1

    # Create child location increments generation
    loc2 = repo.create_location(name="Shelf A", parent_id=loc1.id)
    assert repo.generation == initial_gen + 2

    # Update location name increments generation (no reindexing, just one increment)
    repo.update_location(loc2.id, name="Shelf A Updated")
    gen_after_update = repo.generation
    assert gen_after_update > initial_gen + 2

    # Move location increments generation
    repo.update_location(loc2.id, new_parent_id=None)
    gen_after_move = repo.generation
    assert gen_after_move > gen_after_update

    # Delete location increments generation
    repo.delete_location(loc2.id)
    gen_after_delete1 = repo.generation
    assert gen_after_delete1 > gen_after_move

    repo.delete_location(loc1.id)
    assert repo.generation > gen_after_delete1


@pytest.mark.asyncio
async def test_generation_property_accessor() -> None:
    """Generation property provides read-only access to counter."""
    repo = Repository()

    # Initial generation
    gen1 = repo.generation
    assert isinstance(gen1, int)
    assert gen1 >= 0

    # After modification
    repo.create_item(ItemCreate(name="Item"))
    gen2 = repo.generation
    assert gen2 == gen1 + 1

    # Property is read-only (no setter)
    with pytest.raises(AttributeError):
        repo.generation = 999  # type: ignore[misc]


@pytest.mark.asyncio
async def test_generation_export_and_load_roundtrip() -> None:
    """Generation counter persists across export/load cycles."""
    repo = Repository()

    # Create some data
    item1 = repo.create_item(ItemCreate(name="Item 1"))
    item2 = repo.create_item(ItemCreate(name="Item 2"))
    loc = repo.create_location(name="Location")

    generation_before = repo.generation
    assert generation_before > 0

    # Export state
    state = repo.export_state()
    assert "_generation" in state
    assert state["_generation"] == generation_before

    # Create new repo and load state
    new_repo = Repository.from_state(state)

    # Generation should be restored and incremented during load
    # (load calls _index_item/_add_location for each entity, incrementing generation)
    assert new_repo.generation > generation_before

    # Verify data integrity
    assert len(new_repo.list_items()["items"]) == LOADED_ITEM_COUNT
    assert new_repo.get_item(item1.id).name == "Item 1"
    assert new_repo.get_item(item2.id).name == "Item 2"
    assert new_repo.get_location(loc.id).name == "Location"


@pytest.mark.asyncio
async def test_generation_load_state_without_generation() -> None:
    """Loading state without _generation field initializes to 0."""
    repo = Repository()

    # Create state without _generation field (legacy data)
    state = {
        "items": {},
        "locations": {},
    }

    repo.load_state(state)

    # Should initialize to 0, then increment for load
    assert repo.generation == 1
