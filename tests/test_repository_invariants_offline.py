"""Offline tests for the index checks the rest of the suite is measured against.

An oracle nothing tests is an oracle that passes everything. These pin the
healthy answer, one index drift, and each of the four count comparisons, so a
check that stopped looking would be caught here rather than by the refactor it
was supposed to guard.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.models import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository

from repository_invariants import collect_index_issues, internal_indexes


def _seeded() -> tuple[Repository, str]:
    """A repository with a location, a plain item and a checked-out one."""

    repo = Repository()
    where = repo.create_location(name="Garage")
    repo.create_item(ItemCreate(name="Drill", location_id=str(where.id)))
    borrowed = repo.create_item(ItemCreate(name="Ladder", location_id=str(where.id)))
    repo.update_item(str(borrowed.id), ItemUpdate(checked_out=True))
    return repo, str(borrowed.id)


def test_a_consistent_repository_reports_nothing() -> None:
    """The healthy answer is an empty list — which is what the oracle demands."""

    repo, _ = _seeded()

    assert collect_index_issues(repo) == []


@pytest.mark.index_drift
def test_an_item_missing_from_the_checked_out_index_is_reported() -> None:
    """Drift between an item and the index that is supposed to list it.

    Nothing in the repository can produce this; the checks exist because a bug
    in it could, and a silent disagreement is the kind that survives a release.
    """

    repo, borrowed_id = _seeded()
    internal_indexes(repo)["checked_out_item_ids"].discard(borrowed_id)

    assert "checked_out_item_missing_from_index" in collect_index_issues(repo)


def test_every_count_is_compared_against_the_collection_it_summarises(monkeypatch) -> None:
    """All four count checks fire when the served numbers stop matching.

    The counts come off the same collections the checks measure, so a genuine
    disagreement is unreachable from outside — which is the point of asserting
    the comparison itself rather than hoping it is exercised elsewhere.
    """

    repo, _ = _seeded()
    monkeypatch.setattr(
        Repository,
        "get_counts",
        lambda _self: {
            "items_total": 99,
            "locations_total": 99,
            "checked_out_count": 99,
            "low_stock_count": 99,
        },
    )

    assert set(collect_index_issues(repo)) == {
        "items_total_count_mismatch",
        "locations_total_count_mismatch",
        "checked_out_count_mismatch",
        "low_stock_count_mismatch",
    }
