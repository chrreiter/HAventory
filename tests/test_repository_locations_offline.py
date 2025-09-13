"""Offline tests for the in-memory Repository (locations focus).

Verify location CRUD, move/rename invariants, subtree path propagation,
and denormalization of item.location_path upon moves/renames.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import NotFoundError, ValidationError
from custom_components.haventory.repository import Repository


@pytest.mark.asyncio
async def test_create_get_and_delete_location_constraints() -> None:
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


@pytest.mark.asyncio
async def test_move_and_rename_updates_paths_and_items() -> None:
    """Renaming/moving a location updates subtree paths and item location_path."""

    repo = Repository()
    a = repo.create_location(name="A")
    b = repo.create_location(name="B", parent_id=a.id)
    c = repo.create_location(name="C", parent_id=b.id)

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


@pytest.mark.asyncio
async def test_move_to_root_and_disallow_self_parent() -> None:
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


@pytest.mark.asyncio
async def test_update_location_is_atomic_when_path_rebuild_fails(monkeypatch) -> None:
    """Path rebuild failure does not leave partial parent/name/path changes."""

    repo = Repository()
    a = repo.create_location(name="A")
    b = repo.create_location(name="B", parent_id=a.id)

    old_b = repo.get_location(b.id)
    old_children = {k: set(v) for k, v in repo._children_ids_by_parent_id.items()}
    old_paths = {lid: loc.path.display_path for lid, loc in repo._locations_by_id.items()}

    def boom(*args, **kwargs) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(repo, "_rebuild_paths_for_subtree", boom)

    with pytest.raises(RuntimeError):
        repo.update_location(b.id, name="B2", new_parent_id=None)

    # No state should have changed
    assert repo.get_location(b.id).name == old_b.name
    assert repo.get_location(b.id).parent_id == old_b.parent_id
    assert {k: set(v) for k, v in repo._children_ids_by_parent_id.items()} == old_children
    assert {lid: loc.path.display_path for lid, loc in repo._locations_by_id.items()} == old_paths
