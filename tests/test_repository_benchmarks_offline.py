"""Performance benchmarks for repository operations (Phase 2.4).

These tests measure execution time for common operations to ensure
performance remains acceptable as the codebase evolves.

Set ASSERT_BUDGETS=1 to fail tests that exceed time budgets.
"""

import os
import time

import pytest
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.repository import Repository

# Time budgets in seconds (conservative estimates)
BUDGET_CREATE_1K_ITEMS = 1.0
BUDGET_FILTER_10K_ITEMS = 0.5
BUDGET_TEXT_SEARCH_10K = 0.5
BUDGET_SUBTREE_MOVE_1K = 2.0

ASSERT_BUDGETS = os.getenv("ASSERT_BUDGETS", "0") == "1"


def _print_result(test_name: str, elapsed: float, budget: float) -> None:
    """Print benchmark result and optionally assert against budget."""
    status = "✓" if elapsed <= budget else "✗"
    print(f"\n{status} {test_name}: {elapsed:.3f}s (budget: {budget:.3f}s)")
    if ASSERT_BUDGETS and elapsed > budget:
        pytest.fail(f"Exceeded time budget: {elapsed:.3f}s > {budget:.3f}s")


@pytest.mark.asyncio
async def test_benchmark_item_creation() -> None:
    """Measure time to create 1000 items."""
    repo = Repository()
    count = 1000

    start = time.perf_counter()
    for i in range(count):
        repo.create_item(ItemCreate(name=f"Item{i}", quantity=1))
    elapsed = time.perf_counter() - start

    _print_result(f"Create {count} items", elapsed, BUDGET_CREATE_1K_ITEMS)
    assert len(repo._items_by_id) == count


@pytest.mark.asyncio
async def test_benchmark_item_filtering_by_category() -> None:
    """Measure time to filter 10k items by category."""
    repo = Repository()
    count = 10000

    # Create items: 50% electronics, 50% tools
    for i in range(count):
        category = "electronics" if i % 2 == 0 else "tools"
        repo.create_item(ItemCreate(name=f"Item{i}", category=category, quantity=1))

    start = time.perf_counter()
    result = repo.list_items(flt={"category": "electronics"})
    elapsed = time.perf_counter() - start

    _print_result(f"Filter {count} items by category", elapsed, BUDGET_FILTER_10K_ITEMS)
    assert len(result["items"]) == count // 2


@pytest.mark.asyncio
async def test_benchmark_text_search() -> None:
    """Measure time to perform full-text search across 10k items."""
    repo = Repository()
    count = 10000

    # Create items with searchable text
    for i in range(count):
        name = f"Widget{i}" if i % 100 == 0 else f"Item{i}"
        repo.create_item(ItemCreate(name=name, quantity=1))

    start = time.perf_counter()
    result = repo.list_items(flt={"q": "Widget"})
    elapsed = time.perf_counter() - start

    _print_result(f"Text search across {count} items", elapsed, BUDGET_TEXT_SEARCH_10K)
    assert len(result["items"]) == count // 100


@pytest.mark.asyncio
async def test_benchmark_subtree_operations() -> None:
    """Measure time to move a location with 1000+ items."""
    repo = Repository()
    item_count = 1000

    # Create location hierarchy: root -> warehouse -> shelf
    root = repo.create_location(name="Root")
    warehouse = repo.create_location(name="Warehouse", parent_id=root.id)
    shelf = repo.create_location(name="Shelf", parent_id=warehouse.id)

    # Create items in shelf
    for i in range(item_count):
        repo.create_item(ItemCreate(name=f"Item{i}", location_id=shelf.id, quantity=1))

    # Create new parent
    new_parent = repo.create_location(name="NewParent")

    # Measure time to move warehouse (with all descendants) under new parent
    start = time.perf_counter()
    repo.update_location(warehouse.id, new_parent_id=new_parent.id)
    elapsed = time.perf_counter() - start

    _print_result(f"Move subtree with {item_count} items", elapsed, BUDGET_SUBTREE_MOVE_1K)

    # Verify all items were updated
    updated_warehouse = repo.get_location(warehouse.id)
    assert updated_warehouse.parent_id == new_parent.id


@pytest.mark.asyncio
async def test_benchmark_temporal_index_performance() -> None:
    """Verify temporal indexes maintain performance during item creation."""
    repo = Repository()
    count = 5000

    start = time.perf_counter()
    for i in range(count):
        repo.create_item(ItemCreate(name=f"Item{i}", quantity=1))
    elapsed = time.perf_counter() - start

    # Verify temporal indexes are populated and sorted
    assert len(repo._items_by_created_at) == count
    assert len(repo._items_by_updated_at) == count

    # Verify sorted order
    created_timestamps = [ts for ts, _ in repo._items_by_created_at]
    assert created_timestamps == sorted(created_timestamps)

    updated_timestamps = [ts for ts, _ in repo._items_by_updated_at]
    assert updated_timestamps == sorted(updated_timestamps)

    _print_result(
        f"Create {count} items with temporal indexing", elapsed, BUDGET_CREATE_1K_ITEMS * 5
    )
