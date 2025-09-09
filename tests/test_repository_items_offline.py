"""Offline tests for the in-memory Repository (items focus).

Scenarios cover CRUD, optimistic concurrency, filtering/sorting/pagination,
and derived counts (checked_out and low_stock).
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import ConflictError, NotFoundError
from custom_components.haventory.models import ItemCreate, ItemFilter, Sort
from custom_components.haventory.repository import Repository

TOTAL_ITEMS = 3
INITIAL_LOW_STOCK_COUNT = 1
LOW_STOCK_AFTER_ADJUST = 2


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
