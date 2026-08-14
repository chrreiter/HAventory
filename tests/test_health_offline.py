"""Offline tests for the repository consistency checks in `health.py`.

The checks used to be private helpers inside `ws.py`; two callers ask the same
question now, so they answer from one module. What they report has to be exactly
what it was — these tests pin the healthy case, one index drift, and each of the
four count comparisons.
"""

from __future__ import annotations

from custom_components.haventory.health import collect_health_issues
from custom_components.haventory.models import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository


def _seeded() -> tuple[Repository, str]:
    """A repository with a location, a plain item and a checked-out one."""

    repo = Repository()
    where = repo.create_location(name="Garage")
    repo.create_item(ItemCreate(name="Drill", location_id=str(where.id)))
    borrowed = repo.create_item(ItemCreate(name="Ladder", location_id=str(where.id)))
    repo.update_item(str(borrowed.id), ItemUpdate(checked_out=True))
    return repo, str(borrowed.id)


def test_a_consistent_repository_reports_nothing() -> None:
    """The healthy answer is an empty list, and the counts it was checked against."""

    repo, _ = _seeded()

    issues, counts = collect_health_issues(repo)

    assert issues == []
    indexes = repo._debug_get_internal_indexes()
    assert counts["items_total"] == len(indexes["items_by_id"])
    assert counts["locations_total"] == len(indexes["locations_by_id"])
    assert counts["checked_out_count"] == len(indexes["checked_out_item_ids"])


def test_an_item_missing_from_the_checked_out_index_is_reported() -> None:
    """Drift between an item and the index that is supposed to list it.

    Nothing in the repository can produce this; the checks exist because a bug
    in it could, and a silent disagreement is the kind that survives a release.
    """

    repo, borrowed_id = _seeded()
    repo._debug_get_internal_indexes()["checked_out_item_ids"].discard(borrowed_id)

    issues, _ = collect_health_issues(repo)

    assert "checked_out_item_missing_from_index" in issues


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

    issues, _ = collect_health_issues(repo)

    assert set(issues) == {
        "items_total_count_mismatch",
        "locations_total_count_mismatch",
        "checked_out_count_mismatch",
        "low_stock_count_mismatch",
    }
