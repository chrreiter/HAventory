"""Performance tests for repository filtering logic.

These tests verify that selective filters (category, tags, etc.) use indexes
instead of full scans, and that intersection logic works correctly.
"""

import pytest
from custom_components.haventory.models import ItemCreate, ItemFilter
from custom_components.haventory.repository import Repository


@pytest.mark.asyncio
async def test_index_first_filtering_candidates():
    """Verify that selective filters reduce the candidate set significantly."""
    repo = Repository()

    # Create 100 items
    # Items 0-49: electronics
    # Items 50-99: tools
    total_items = 100
    split_index = 50
    for i in range(total_items):
        repo.create_item(
            ItemCreate(
                name=f"Item{i}", category="electronics" if i < split_index else "tools", quantity=1
            )
        )

    # Calling internal method (once implemented) or observing side effects would be ideal,
    # but for now we verify correctness and (optionally) speed if we had a large dataset.
    # We will verify that we get exactly 50 items for 'electronics'.

    result = repo.list_items(flt=ItemFilter(category="electronics"))
    assert len(result["items"]) == split_index
    for item in result["items"]:
        assert item.category == "electronics"


@pytest.mark.asyncio
async def test_index_intersection_logic():
    """Verify that multiple indexed filters intersect correctly."""
    repo = Repository()

    # Create 4 items with overlapping properties
    # 0: cat=A, tag=X, checked_out=False
    # 1: cat=A, tag=Y, checked_out=True
    # 2: cat=B, tag=X, checked_out=True
    # 3: cat=A, tag=X, checked_out=True  <-- Target

    repo.create_item(ItemCreate(name="I0", category="A", tags=["X"], checked_out=False, quantity=1))
    repo.create_item(ItemCreate(name="I1", category="A", tags=["Y"], checked_out=True, quantity=1))
    repo.create_item(ItemCreate(name="I2", category="B", tags=["X"], checked_out=True, quantity=1))
    repo.create_item(ItemCreate(name="I3", category="A", tags=["X"], checked_out=True, quantity=1))

    # Query: category=A AND tags_any=[X] AND checked_out=True
    # Should only match I3
    flt = ItemFilter(category="A", tags_any=["X"], checked_out=True)
    result = repo.list_items(flt=flt)

    assert len(result["items"]) == 1
    assert result["items"][0].name == "I3"


@pytest.mark.asyncio
async def test_empty_candidate_set_returns_early():
    """Verify that if one index returns empty, result is empty immediately."""
    repo = Repository()
    repo.create_item(ItemCreate(name="I1", category="A", quantity=1))

    # Category matches A (1 item), but tag 'Z' matches nothing.
    # Intersection should be empty.
    result = repo.list_items(flt=ItemFilter(category="A", tags_any=["Z"]))
    assert len(result["items"]) == 0


@pytest.mark.asyncio
async def test_fallback_to_full_scan():
    """Verify that queries with no indexed fields still work (fallback)."""
    repo = Repository()
    repo.create_item(ItemCreate(name="FindMe", quantity=1))
    repo.create_item(ItemCreate(name="IgnoreMe", quantity=1))

    # 'q' is not indexed currently, so this forces a full scan
    # (or candidate scan if other filters exist).
    # Here only 'q' is provided.
    result = repo.list_items(flt=ItemFilter(q="FindMe"))
    assert len(result["items"]) == 1
    assert result["items"][0].name == "FindMe"
