"""Timing floor for a `q` list at a size no household reaches.

Opt-in with ``ASSERT_BUDGETS=1``: a wall-clock assertion on a shared CI runner
fails for reasons that have nothing to do with the code, so the gate never runs
it and a person measuring the search path asks for it by name.

    ASSERT_BUDGETS=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q -s \\
        tests/test_repository_search_benchmark_offline.py

The number this defends is the cost of answering ``q`` by scanning every item —
five fields per item through ``normalize_search_text`` — which is what
``list_items`` does once no index pre-filters ``q``.
"""

import os
import time

import pytest
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.repository import Repository

#: Items seeded before the query is timed. Well past the few thousand items the
#: README calls comfortable, so the measurement carries headroom over any
#: household this ships to.
BENCHMARK_ITEM_COUNT = 10_000

#: What one `q` list must stay under at that size, in seconds. A search runs
#: while a person waits on a card, so the ceiling is a human one, not a
#: machine one.
Q_LIST_BUDGET_SECONDS = 0.5

#: Timed passes; the fastest is reported, because a slower pass measures the
#: host's other work rather than this code.
TIMED_PASSES = 5

#: Every fifth item is a "Widget", so the query returns a fifth of the
#: inventory: an answer big enough that building it is part of what is timed.
_NAME_STEMS = ("Widget", "Bracket", "Cable", "Fastener", "Gasket")

pytestmark = pytest.mark.skipif(
    os.environ.get("ASSERT_BUDGETS") != "1",
    reason="wall-clock assertion; opt in with ASSERT_BUDGETS=1",
)


def _seeded_repository(count: int) -> Repository:
    """A repository holding ``count`` items spread over a small location tree.

    Every text field ``q`` reads is populated — name, description, category,
    tags and, through the location, the denormalized display path — so the scan
    pays for all five rather than for a name alone.
    """

    repo = Repository()
    warehouse = repo.create_location(name="Warehouse")
    shelves = [
        repo.create_location(name=f"Shelf {n}", parent_id=str(warehouse.id)) for n in range(20)
    ]
    for n in range(count):
        stem = _NAME_STEMS[n % len(_NAME_STEMS)]
        repo.create_item(
            ItemCreate(
                name=f"{stem} {n}",
                description=f"Spare {stem.lower()} kept for the {n % 7}th bench",
                category=f"Category {n % 11}",
                tags=[f"tag{n % 13}", "spare"],
                location_id=str(shelves[n % len(shelves)].id),
            )
        )
    return repo


def test_q_list_stays_under_budget() -> None:
    """One `q` list over 10,000 items answers inside the budget."""

    repo = _seeded_repository(BENCHMARK_ITEM_COUNT)
    expected_matches = BENCHMARK_ITEM_COUNT // len(_NAME_STEMS)

    timings: list[float] = []
    for _ in range(TIMED_PASSES):
        start = time.perf_counter()
        page = repo.list_items(flt={"q": "Widget"})
        timings.append(time.perf_counter() - start)
        assert page["total"] == expected_matches

    best = min(timings)
    print(
        f"\nq='Widget' over {BENCHMARK_ITEM_COUNT} items: "
        f"best {best:.3f}s of {TIMED_PASSES} passes "
        f"(budget {Q_LIST_BUDGET_SECONDS:.3f}s, {expected_matches} matches)"
    )
    assert best < Q_LIST_BUDGET_SECONDS, (
        f"q list took {best:.3f}s over {BENCHMARK_ITEM_COUNT} items, "
        f"budget is {Q_LIST_BUDGET_SECONDS:.3f}s"
    )
