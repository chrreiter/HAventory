"""Performance benchmarks for repository operations (Phase 2.4).

These tests measure execution time for common operations to ensure
performance remains acceptable as the codebase evolves.

Set ASSERT_BUDGETS=1 to fail tests that exceed time budgets.
"""

import os
import statistics
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


# -----------------------------
# WP4 percentile budgets (typical dataset: 2k items / 60 locations)
#
# item list (50-item page, filtered + sorted, warm indexes):
#   p50 <= 30 ms, p95 <= 75 ms
# location move_subtree (typical subtree):
#   p50 <= 80 ms, p95 <= 150 ms
#
# The stretch dataset (10k items / 200 locations) is exercised by the
# standalone sweep documented in docs/; keeping it out of the default suite
# keeps the offline run fast.
# -----------------------------

LIST_BUDGET_P50_MS = 30.0
LIST_BUDGET_P95_MS = 75.0
MOVE_BUDGET_P50_MS = 80.0
MOVE_BUDGET_P95_MS = 150.0


def _percentiles(samples: list[float]) -> tuple[float, float]:
    qs = statistics.quantiles(samples, n=20, method="inclusive")
    return statistics.median(samples), qs[18]


def _print_percentiles(test_name: str, p50: float, p95: float, b50: float, b95: float) -> None:
    ok = p50 <= b50 and p95 <= b95
    status = "OK" if ok else "MISS"
    print(
        f"\n[{status}] {test_name}: p50={p50:.2f}ms p95={p95:.2f}ms (budget {b50:.0f}/{b95:.0f}ms)"
    )
    if ASSERT_BUDGETS and not ok:
        pytest.fail(f"Exceeded percentile budget: p50={p50:.2f}ms p95={p95:.2f}ms")


def _build_typical_dataset() -> tuple[Repository, list]:
    repo = Repository()
    locs = []
    for r in range(12):  # 12 rooms x (1 room + 4 shelves) = 60 locations
        room = repo.create_location(name=f"Room {r}")
        locs.append(room)
        for s in range(4):
            locs.append(repo.create_location(name=f"Shelf {r}-{s}", parent_id=room.id))
    words = ["widget", "gadget", "tool", "cable", "screw", "paint", "filter", "sensor"]
    for i in range(2000):
        payload = ItemCreate(
            name=f"{words[i % len(words)].title()} {i}",
            description=f"desc {words[(i + 3) % len(words)]} {i}",
            quantity=i % 7,
            category=f"cat-{i % 10}",
            tags=[f"tag-{i % 20}", f"tag-{(i * 7) % 20}"],
            location_id=str(locs[i % len(locs)].id),
        )
        if i % 11 == 0:
            payload["low_stock_threshold"] = 5
        repo.create_item(payload)
    return repo, locs


@pytest.mark.asyncio
async def test_benchmark_wp4_item_list_percentiles() -> None:
    """50-item page, filtered + sorted, warm indexes vs the WP4 budgets."""
    repo, locs = _build_typical_dataset()
    scenarios: list[tuple[str, dict | None, dict]] = [
        ("category+name", {"category": "cat-3"}, {"field": "name", "order": "asc"}),
        ("q+updated", {"q": "widget"}, {"field": "updated_at", "order": "desc"}),
        (
            "subtree+name",
            {"location_id": str(locs[0].id), "include_subtree": True},
            {"field": "name", "order": "asc"},
        ),
        ("nofilter+updated", None, {"field": "updated_at", "order": "desc"}),
        ("lowstock-first", {"low_stock_first": True}, {"field": "name", "order": "asc"}),
    ]
    iterations = 30
    for label, flt, sort in scenarios:
        repo.list_items(flt=flt, sort=sort, limit=50)  # warm the indexes
        samples = []
        for _ in range(iterations):
            start = time.perf_counter()
            repo.list_items(flt=flt, sort=sort, limit=50)
            samples.append((time.perf_counter() - start) * 1000)
        p50, p95 = _percentiles(samples)
        _print_percentiles(f"item list ({label})", p50, p95, LIST_BUDGET_P50_MS, LIST_BUDGET_P95_MS)


@pytest.mark.asyncio
async def test_benchmark_wp4_move_subtree_percentiles() -> None:
    """Typical subtree move (60 locations / 2k items) vs the WP4 budgets."""
    repo, locs = _build_typical_dataset()
    root_a = repo.create_location(name="Move Root A")
    root_b = repo.create_location(name="Move Root B")
    # Re-home the first room (with its shelves and items) under root A
    first_room = locs[0]
    repo.update_location(first_room.id, new_parent_id=root_a.id)

    samples = []
    targets = [root_b.id, root_a.id]
    iterations = 10
    for i in range(iterations):
        start = time.perf_counter()
        repo.update_location(first_room.id, new_parent_id=targets[i % 2])
        samples.append((time.perf_counter() - start) * 1000)
    p50, p95 = _percentiles(samples)
    _print_percentiles("move_subtree (typical)", p50, p95, MOVE_BUDGET_P50_MS, MOVE_BUDGET_P95_MS)
