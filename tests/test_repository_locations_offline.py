"""Offline tests for the in-memory Repository (locations focus).

Verify location CRUD, move/rename invariants, subtree path propagation,
and denormalization of item.location_path upon moves/renames.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import NotFoundError, ValidationError
from custom_components.haventory.models import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository


def test_create_get_and_delete_location_constraints() -> None:
    """Create/get locations; deletion blocked when children or items exist."""

    repo = Repository()
    root = repo.create_location(name="Garage")
    leaf = repo.create_location(name="Bin 1", parent_id=root.id)

    # Cannot delete parent while it has a child
    with pytest.raises(ValidationError):
        repo.delete_location(root.id)

    # Deleting leaf works
    repo.delete_location(leaf.id)
    with pytest.raises(NotFoundError):
        repo.get_location(leaf.id)


def test_move_and_rename_updates_paths_and_items() -> None:
    """Renaming/moving a location updates subtree paths and item location_path."""

    repo = Repository()
    a = repo.create_location(name="A", area_id=None)
    b = repo.create_location(name="B", parent_id=a.id, area_id=None)
    c = repo.create_location(name="C", parent_id=b.id, area_id=None)

    # Create an item at C so its path includes A/B/C
    item = repo.create_item(
        {"name": "Tape", "location_id": c.id, "checked_out": True, "due_date": "2024-01-02"}
    )  # type: ignore[arg-type]
    assert "A / B / C" in repo.get_item(item.id).location_path.display_path

    # Rename B -> B2 and ensure subtree paths and item path update
    repo.update_location(b.id, name="B2")
    assert repo.get_location(c.id).path.display_path == "A / B2 / C"
    assert "A / B2 / C" in repo.get_item(item.id).location_path.display_path

    # Move C under A (C becomes A/C)
    repo.update_location(c.id, new_parent_id=a.id)
    assert repo.get_location(c.id).path.display_path == "A / C"
    assert "A / C" in repo.get_item(item.id).location_path.display_path

    # Attempt to move A under C (descendant) → invalid
    with pytest.raises(ValidationError):
        repo.update_location(a.id, new_parent_id=c.id)


def test_move_to_root_and_disallow_self_parent() -> None:
    """Moving a node to root works and self-parent is disallowed."""

    repo = Repository()
    a = repo.create_location(name="A")
    b = repo.create_location(name="B", parent_id=a.id)

    # Self-parent invalid
    with pytest.raises(ValidationError):
        repo.update_location(a.id, new_parent_id=a.id)

    # Move B to root
    updated_b = repo.update_location(b.id, new_parent_id=None)
    assert updated_b.parent_id is None
    assert updated_b.path.display_path == "B"


def test_location_item_counts_and_no_location_count() -> None:
    """Per-location direct/subtree counts and the orphan count track item moves."""

    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf", parent_id=garage.id)

    repo.create_item(ItemCreate(name="Car", location_id=str(garage.id)))
    wrench = repo.create_item(ItemCreate(name="Wrench", location_id=str(shelf.id)))
    repo.create_item(ItemCreate(name="Orphan"))

    # Subtree count includes the location's own items plus descendants
    assert repo.get_location_item_counts(garage.id) == {"direct": 1, "subtree": 2}
    assert repo.get_location_item_counts(shelf.id) == {"direct": 1, "subtree": 1}
    assert repo.get_counts()["no_location_count"] == 1

    # Clearing an item's location updates both the tree counts and the orphan count
    repo.update_item(wrench.id, ItemUpdate(location_id=None))
    assert repo.get_location_item_counts(garage.id) == {"direct": 1, "subtree": 1}
    assert repo.get_location_item_counts(shelf.id) == {"direct": 0, "subtree": 0}
    expected_orphans = 2
    assert repo.get_counts()["no_location_count"] == expected_orphans

    # Unknown location id raises NotFoundError
    with pytest.raises(NotFoundError):
        repo.get_location_item_counts("00000000-0000-4000-8000-000000000000")


def test_moving_a_subtree_to_the_top_level_files_it_under_a_new_area() -> None:
    """One update does both halves of "move this subtree into an area".

    The parent change commits before the area propagates, so the area lands on
    the moved location — a root of its own by then — instead of rewriting the
    tree it is leaving. The area the old tree carries is untouched, and the
    items under the moved subtree follow by inheritance.
    """

    repo = Repository()
    garage = repo.create_location(name="Garage", area_id="area-garage")
    shelf = repo.create_location(name="Shelf", parent_id=garage.id)
    bin_1 = repo.create_location(name="Bin 1", parent_id=shelf.id)
    repo.create_item(ItemCreate(name="Car", location_id=str(garage.id)))
    drill = repo.create_item(ItemCreate(name="Drill", location_id=str(bin_1.id)))

    moved = repo.update_location(shelf.id, new_parent_id=None, area_id="area-cellar")

    assert moved.parent_id is None
    assert moved.area_id == "area-cellar"
    assert repo.get_location(garage.id).area_id == "area-garage"
    # Descendants inherit from the root rather than storing an area of their own.
    assert repo.get_location(bin_1.id).area_id is None

    in_cellar = repo.list_items(flt={"area_id": "area-cellar"})
    assert [i.id for i in in_cellar["items"]] == [drill.id]


def test_the_tree_is_readable_without_reaching_into_the_indexes() -> None:
    """`location/list` and `location/tree` are ordinary reads, not introspection.

    Both used to walk the location index and the private child map directly, so
    the two commands the card opens with depended on a helper written for tests.
    These two accessors are what they read instead.
    """

    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf", parent_id=garage.id)
    bin_1 = repo.create_location(name="Bin 1", parent_id=shelf.id)

    assert [loc.id for loc in repo.iter_locations()] == [garage.id, shelf.id, bin_1.id]
    assert repo.children_of(None) == frozenset({str(garage.id)})
    assert repo.children_of(garage.id) == frozenset({str(shelf.id)})
    assert repo.children_of(str(shelf.id)) == frozenset({str(bin_1.id)})
    assert repo.children_of(bin_1.id) == frozenset()

    # A childless answer is not the index: adding to it moves nothing.
    repo.delete_location(bin_1.id)
    assert repo.children_of(shelf.id) == frozenset()
    assert [loc.id for loc in repo.iter_locations()] == [garage.id, shelf.id]
