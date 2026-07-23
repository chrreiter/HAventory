"""Offline regression tests for WP4 persistence/pagination edge fixes.

- LocationPath.sort_key must survive an export_state/load_state round trip
  (it previously serialized without sort_key and reloaded as "").
- Cursor pagination must return an empty page when everything after the
  cursor was deleted between pages (it previously re-served page one).
"""

from __future__ import annotations

import pytest
from custom_components.haventory.models import ItemCreate, Sort
from custom_components.haventory.repository import Repository


@pytest.mark.asyncio
async def test_sort_key_survives_persistence_round_trip() -> None:
    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf Alpha", parent_id=garage.id)
    item = repo.create_item(ItemCreate(name="Hammer", quantity=1, location_id=str(shelf.id)))

    assert repo.get_location(shelf.id).path.sort_key
    assert repo.get_item(item.id).location_path.sort_key

    reloaded = Repository.from_state(repo.export_state())

    assert (
        reloaded.get_location(shelf.id).path.sort_key == repo.get_location(shelf.id).path.sort_key
    )
    assert (
        reloaded.get_item(item.id).location_path.sort_key
        == repo.get_item(item.id).location_path.sort_key
    )


@pytest.mark.asyncio
async def test_cursor_returns_empty_page_when_tail_deleted() -> None:
    repo = Repository()
    items = [repo.create_item(ItemCreate(name=f"Item {i:02d}", quantity=1)) for i in range(6)]

    sort = Sort(field="name", order="asc")
    page1 = repo.list_items(sort=sort, limit=3)
    assert [i.name for i in page1["items"]] == ["Item 00", "Item 01", "Item 02"]
    cursor = page1["next_cursor"]
    assert cursor is not None

    # Everything after the cursor disappears between the two page fetches.
    for item in items[3:]:
        repo.delete_item(item.id)

    page2 = repo.list_items(sort=sort, limit=3, cursor=cursor)
    assert page2["items"] == []
    assert page2["next_cursor"] is None
