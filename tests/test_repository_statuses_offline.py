"""Offline tests for the repository's status layer.

The status vocabulary is the one collection whose entries items *reference*, so
deleting one is the only vocabulary edit that can orphan data. These tests pin
the refusal and the reassign escape hatch, and the reindexing that has to follow
a reassignment for the status filter to keep agreeing with the stored value.
Beside that sits the item field itself: the counts and the status index the
status filter reads, which is the repository half of what a card shows.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import NotFoundError, ValidationError
from custom_components.haventory.models import ItemFilter, ItemUpdate
from custom_components.haventory.repository import Repository

from repository_invariants import internal_indexes


def test_a_created_status_joins_the_live_vocabulary() -> None:
    repo = Repository()

    created = repo.create_status({"slug": "lent_out", "label": "Lent out", "color": "blue"})

    assert created.slug == "lent_out"
    assert "lent_out" in repo.status_slugs()
    assert repo.create_item({"name": "Ladder", "status": "lent_out"}).status == "lent_out"


def test_a_created_status_lands_last_when_it_names_no_order() -> None:
    repo = Repository()

    created = repo.create_status({"slug": "lent_out", "label": "Lent out"})

    assert [d.slug for d in repo.list_statuses()][-1] == "lent_out"
    assert created.order == len(repo.list_statuses()) - 1


def test_a_duplicate_slug_is_refused() -> None:
    repo = Repository()

    with pytest.raises(ValidationError, match="already"):
        repo.create_status({"slug": "missing", "label": "Gone"})


def test_a_rename_touches_no_item() -> None:
    """The slug is the identity, so a label edit is not an item edit."""

    repo = Repository()
    item = repo.create_item({"name": "Saw", "status": "needs_repair"})
    before = repo.get_item(item.id)

    repo.update_status("needs_repair", {"label": "Broken"})

    after = repo.get_item(item.id)
    assert after.status == "needs_repair"
    assert (after.version, after.updated_at) == (before.version, before.updated_at)


def test_updating_an_unknown_status_is_not_found() -> None:
    repo = Repository()

    with pytest.raises(NotFoundError):
        repo.update_status("lent_out", {"label": "Lent out"})


def test_a_slug_cannot_be_edited() -> None:
    """Items store it, so changing it would strand every one of them."""

    repo = Repository()

    with pytest.raises(ValidationError, match="slug"):
        repo.update_status("missing", {"slug": "gone"})


def test_reordering_rewrites_display_order() -> None:
    repo = Repository()

    repo.reorder_statuses(["needs_repair", "ok", "missing"])

    assert [d.slug for d in repo.list_statuses()] == ["needs_repair", "ok", "missing"]


def test_reordering_must_name_every_slug_exactly_once() -> None:
    repo = Repository()

    with pytest.raises(ValidationError, match="every status"):
        repo.reorder_statuses(["ok", "missing"])

    with pytest.raises(ValidationError, match="every status"):
        repo.reorder_statuses(["ok", "missing", "missing"])


def test_the_default_status_can_never_be_deleted() -> None:
    """`ok` is what an unknown value coerces to and what "flagged" is defined
    against, so nothing may remove it."""

    repo = Repository()

    with pytest.raises(ValidationError, match="default"):
        repo.delete_status("ok")


def test_an_unused_status_deletes_outright() -> None:
    repo = Repository()

    removed, moved = repo.delete_status("needs_repair")

    assert removed.slug == "needs_repair"
    assert moved == []
    assert "needs_repair" not in repo.status_slugs()


def test_a_status_in_use_is_refused_without_a_target() -> None:
    repo = Repository()
    repo.create_item({"name": "Ladder", "status": "missing"})

    with pytest.raises(ValidationError, match="1 item"):
        repo.delete_status("missing")

    assert "missing" in repo.status_slugs()


def test_reassigning_moves_the_items_and_then_deletes() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Ladder", "status": "missing"})
    before = repo.get_item(item.id)

    removed, moved = repo.delete_status("missing", reassign_to="ok")

    # The ids, not a count: the caller announces each item that moved.
    assert (removed.slug, moved) == ("missing", [str(item.id)])
    assert "missing" not in repo.status_slugs()
    after = repo.get_item(item.id)
    assert after.status == "ok"
    assert after.version == before.version + 1


def test_a_reassigned_item_leaves_the_old_status_index() -> None:
    """The filter reads the index, so a stale bucket would keep serving an item
    under a status that no longer exists."""

    repo = Repository()
    repo.create_item({"name": "Ladder", "status": "missing"})

    repo.delete_status("missing", reassign_to="needs_repair")

    assert repo.get_counts()["status_counts"]["needs_repair"] == 1
    page = repo.list_items(flt=ItemFilter(status="needs_repair"))
    assert [i.name for i in page["items"]] == ["Ladder"]


def test_reassigning_to_an_unknown_or_identical_status_is_refused() -> None:
    repo = Repository()
    repo.create_item({"name": "Ladder", "status": "missing"})

    with pytest.raises(ValidationError):
        repo.delete_status("missing", reassign_to="nowhere")

    with pytest.raises(ValidationError):
        repo.delete_status("missing", reassign_to="missing")


def test_counts_and_index_follow_status_changes() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Hammer", "status": "missing"})
    repo.create_item({"name": "Drill", "status": "needs_repair"})
    repo.create_item({"name": "Wrench"})

    counts = repo.get_counts()
    assert counts["missing_count"] == 1
    assert counts["needs_repair_count"] == 1

    # The default status is deliberately not bucketed.
    idx = internal_indexes(repo)
    assert "ok" not in idx["status_to_item_ids"]
    assert idx["status_to_item_ids"]["missing"] == {str(item.id)}

    repo.update_item(item.id, ItemUpdate(status="ok"))
    counts = repo.get_counts()
    assert counts["missing_count"] == 0
    assert "missing" not in internal_indexes(repo)["status_to_item_ids"]


def test_list_items_filters_by_status_via_index() -> None:
    repo = Repository()
    repo.create_item({"name": "Wrench"})
    missing = repo.create_item({"name": "Hammer", "status": "missing", "category": "tools"})
    repo.create_item({"name": "Drill", "status": "needs_repair", "category": "tools"})

    page = repo.list_items(flt={"status": "missing"})
    assert [str(i.id) for i in page["items"]] == [str(missing.id)]
    assert page["total"] == 1

    # Intersects with other indexed filters.
    page = repo.list_items(flt={"status": "missing", "category": "tools"})
    assert [str(i.id) for i in page["items"]] == [str(missing.id)]
    page = repo.list_items(flt={"status": "missing", "category": "kitchen"})
    assert page["items"] == [] and page["total"] == 0

    # "ok" takes the scan path (not bucketed) and still filters correctly.
    page = repo.list_items(flt={"status": "ok"})
    assert [i.name for i in page["items"]] == ["Wrench"]


def test_deleting_an_item_clears_the_status_index() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Hammer", "status": "missing"})
    repo.delete_item(item.id)
    assert repo.get_counts()["missing_count"] == 0
    assert "missing" not in internal_indexes(repo)["status_to_item_ids"]
