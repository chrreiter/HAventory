"""Offline tests for the WP4 fast-path item reindexing on subtree moves.

The subtree move/rename path updates items via path-token deltas instead of a
full unindex/index cycle. These tests pin the invariants that must survive:

- text search agrees with the denormalized path after moves/renames
- the text indexes stay byte-identical to a from-scratch rebuild
- item versions bump and updated_at stays strictly monotonic
- effective-area buckets follow the subtree to its new ancestry
"""

from __future__ import annotations

import pytest
from custom_components.haventory.models import ItemCreate, ItemFilter
from custom_components.haventory.repository import Repository


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
async def test_text_indexes_match_fresh_rebuild_after_moves() -> None:
    """Delta-maintained text indexes must equal a from-scratch rebuild."""
    repo, t = _build_tree()

    repo.update_location(t["shelf"].id, new_parent_id=t["attic"].id)
    repo.update_location(t["shelf"].id, name="Rack Beta")
    repo.update_location(t["shelf"].id, new_parent_id=t["garage"].id)

    rebuilt = Repository.from_state(repo.export_state())
    assert repo._word_to_item_ids == rebuilt._word_to_item_ids
    assert repo._trigram_to_item_ids == rebuilt._trigram_to_item_ids
    assert repo._name_prefix_to_item_ids == rebuilt._name_prefix_to_item_ids


@pytest.mark.asyncio
async def test_move_bumps_versions_and_updated_at() -> None:
    repo, t = _build_tree()
    before = {str(i.id): (i.version, i.updated_at) for i in t["items"]}

    repo.update_location(t["shelf"].id, new_parent_id=t["attic"].id)

    for item_id, (old_version, old_updated) in before.items():
        item = repo.get_item(item_id)
        assert item.version == old_version + 1
        assert item.updated_at > old_updated
        assert item.location_path.display_path.startswith("Attic")


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
    assert repo.get_item(item.id).version == item.version + 1
