"""Offline tests for the fast-path item reindexing on subtree moves.

The subtree move/rename path rewrites each item's denormalized
``location_path`` in place instead of running a full unindex/index cycle.
These tests pin the invariants that must survive:

- text search agrees with the denormalized path after moves/renames
- rewriting the derived ``location_path`` leaves ``version`` and ``updated_at``
  alone, so optimistic-concurrency tokens held by clients stay valid
- effective-area buckets follow the subtree to its new ancestry
- an edit that changes neither the name nor the parent link rebuilds nothing,
  and each edit that does leaves the derived state a full rebuild would leave
"""

from __future__ import annotations

import pytest
from custom_components.haventory.models import (
    ItemCreate,
    ItemFilter,
    ItemUpdate,
    build_location_path_from_map,
)
from custom_components.haventory.repository import Repository

from repository_invariants import internal_indexes


def _build_tree() -> tuple[Repository, dict[str, object]]:
    repo = Repository()
    garage = repo.create_location(name="Garage")
    attic = repo.create_location(name="Attic")
    shelf = repo.create_location(name="Shelf Alpha", parent_id=garage.id)
    box = repo.create_location(name="Box One", parent_id=shelf.id)
    items = [
        repo.create_item(ItemCreate(name="Hammer", quantity=1, location_id=str(box.id))),
        # 'garage' also appears in the item's own name — the token must
        # survive the path losing it.
        repo.create_item(ItemCreate(name="Garage opener", quantity=1, location_id=str(shelf.id))),
    ]
    return repo, {"garage": garage, "attic": attic, "shelf": shelf, "box": box, "items": items}


@pytest.mark.asyncio
async def test_search_follows_subtree_move() -> None:
    repo, t = _build_tree()

    # Before: both items are under Garage and searchable via the path word.
    res = repo.list_items(flt=ItemFilter(q="garage"))
    assert {i.name for i in res["items"]} == {"Hammer", "Garage opener"}

    repo.update_location(t["shelf"].id, new_parent_id=t["attic"].id)

    # After: path-based matches moved to 'attic'.
    res = repo.list_items(flt=ItemFilter(q="attic"))
    assert {i.name for i in res["items"]} == {"Hammer", "Garage opener"}
    # 'garage' still matches the item whose NAME carries it, nothing else.
    res = repo.list_items(flt=ItemFilter(q="garage"))
    assert {i.name for i in res["items"]} == {"Garage opener"}
    # Name/description search is untouched.
    res = repo.list_items(flt=ItemFilter(q="hammer"))
    assert {i.name for i in res["items"]} == {"Hammer"}


@pytest.mark.asyncio
async def test_search_follows_location_rename() -> None:
    repo, t = _build_tree()
    repo.update_location(t["shelf"].id, name="Rack Beta")

    res = repo.list_items(flt=ItemFilter(q="rack"))
    assert {i.name for i in res["items"]} == {"Hammer", "Garage opener"}
    res = repo.list_items(flt=ItemFilter(q="alpha"))
    assert res["items"] == []


@pytest.mark.asyncio
async def test_rename_rewrites_paths_without_touching_versions() -> None:
    repo, t = _build_tree()
    before = {str(i.id): (i.version, i.updated_at) for i in t["items"]}

    repo.update_location(t["shelf"].id, name="Rack Beta")

    for item_id, (old_version, old_updated) in before.items():
        item = repo.get_item(item_id)
        assert "Rack Beta" in item.location_path.display_path
        assert "Shelf Alpha" not in item.location_path.display_path
        assert item.version == old_version
        assert item.updated_at == old_updated


@pytest.mark.asyncio
async def test_move_rewrites_paths_without_touching_versions() -> None:
    repo, t = _build_tree()
    before = {str(i.id): (i.version, i.updated_at) for i in t["items"]}

    repo.update_location(t["shelf"].id, new_parent_id=t["attic"].id)

    for item_id, (old_version, old_updated) in before.items():
        item = repo.get_item(item_id)
        assert item.location_path.display_path.startswith("Attic")
        assert item.version == old_version
        assert item.updated_at == old_updated


@pytest.mark.asyncio
async def test_stale_token_survives_a_rename() -> None:
    """The scenario item 23 is about: a rename must not spend a client's token."""
    repo, t = _build_tree()
    item = t["items"][0]
    held_version = repo.get_item(item.id).version

    repo.update_location(t["shelf"].id, name="Rack Beta")

    updated = repo.update_item(
        item.id, ItemUpdate(name="Sledgehammer"), expected_version=held_version
    )
    assert updated.name == "Sledgehammer"
    assert updated.version == held_version + 1
    # The real mutation still bumps from where the rename left it — the path
    # rewrite did not desynchronize the counter.
    assert repo.get_item(item.id).version == held_version + 1


@pytest.mark.asyncio
async def test_area_change_leaves_items_untouched() -> None:
    """``effective_area_id`` is resolved at serialization, never stored."""
    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf", parent_id=garage.id)
    item = repo.create_item(ItemCreate(name="Hammer", quantity=1, location_id=str(shelf.id)))

    repo.update_location(shelf.id, area_id="area-garage")

    after = repo.get_item(item.id)
    assert after.version == item.version
    assert after.updated_at == item.updated_at
    assert after.location_path == item.location_path
    res = repo.list_items(flt=ItemFilter(area_id="area-garage"))
    assert [i.name for i in res["items"]] == ["Hammer"]


@pytest.mark.asyncio
async def test_effective_area_rebuckets_on_subtree_move() -> None:
    repo = Repository()
    garage = repo.create_location(name="Garage", area_id="area-garage")
    attic = repo.create_location(name="Attic", area_id="area-attic")
    shelf = repo.create_location(name="Shelf", parent_id=garage.id)
    item = repo.create_item(ItemCreate(name="Hammer", quantity=1, location_id=str(shelf.id)))

    res = repo.list_items(flt=ItemFilter(area_id="area-garage"))
    assert [i.name for i in res["items"]] == ["Hammer"]

    repo.update_location(shelf.id, new_parent_id=attic.id)

    res = repo.list_items(flt=ItemFilter(area_id="area-garage"))
    assert res["items"] == []
    res = repo.list_items(flt=ItemFilter(area_id="area-attic"))
    assert [i.name for i in res["items"]] == ["Hammer"]
    assert repo.get_item(item.id).version == item.version


@pytest.mark.asyncio
async def test_an_area_only_edit_rebuilds_no_path_and_no_subtree_index() -> None:
    """A path is built from the name and the parent link; the index from the link.

    An edit that moves neither leaves both as they stand, which is what saves a
    deep tree a full walk per area reassignment. Identity is the assertion a
    rebuild would fail: it replaces every location in the subtree and every
    bucket of the subtree index with an equal object.
    """

    repo, t = _build_tree()
    box_before = repo.get_location(t["box"].id)
    attic_before = repo.get_location(t["attic"].id)
    paths_before = {str(loc.id): loc.path for loc in repo.iter_locations()}
    subtrees_before = dict(internal_indexes(repo)["items_in_subtree"])

    repo.update_location(t["shelf"].id, area_id="area-garage")

    assert repo.get_location(t["box"].id) is box_before
    assert repo.get_location(t["attic"].id) is attic_before
    subtrees_after = internal_indexes(repo)["items_in_subtree"]
    assert subtrees_after.keys() == subtrees_before.keys()
    assert all(subtrees_after[key] is bucket for key, bucket in subtrees_before.items())
    assert {str(loc.id): loc.path for loc in repo.iter_locations()} == paths_before

    # The area still lands where an area belongs — on the root of the tree.
    assert repo.get_location(t["garage"].id).area_id == "area-garage"
    res = repo.list_items(flt=ItemFilter(area_id="area-garage"))
    assert {i.name for i in res["items"]} == {"Hammer", "Garage opener"}


@pytest.mark.parametrize("kind", ["rename", "move", "area"])
@pytest.mark.asyncio
async def test_every_edit_leaves_the_derived_state_a_full_rebuild_would_leave(kind: str) -> None:
    """Each of the three change kinds answers what building from scratch answers.

    The oracle for a location's path is the chain it sits in, and the oracle for
    the subtree index is a repository loaded from the same content: a load
    rebuilds that index unconditionally.
    """

    repo, t = _build_tree()
    edits = {
        "rename": {"name": "Rack Beta"},
        "move": {"new_parent_id": t["attic"].id},
        "area": {"area_id": "area-garage"},
    }

    repo.update_location(t["shelf"].id, **edits[kind])

    locations_by_id = internal_indexes(repo)["locations_by_id"]
    for loc_id, loc in locations_by_id.items():
        assert loc.path == build_location_path_from_map(loc_id, locations_by_id=locations_by_id)
    for item in (repo.get_item(i.id) for i in t["items"]):
        assert item.location_path == locations_by_id[str(item.location_id)].path

    reloaded = Repository.from_state(repo.export_state())
    assert (
        internal_indexes(repo)["items_in_subtree"] == internal_indexes(reloaded)["items_in_subtree"]
    )
