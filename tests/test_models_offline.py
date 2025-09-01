"""Offline tests for HAventory models and helpers.

Scenarios cover creation defaults, invalid payloads, tag normalization, field
clearing via updates, and denormalized location path generation.
"""

from __future__ import annotations

import re

import pytest
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    EMPTY_LOCATION_PATH,
    Item,
    ItemCreate,
    ItemUpdate,
    Location,
    LocationPath,
    apply_item_update,
    build_location_path,
    build_location_path_from_map,
    create_item_from_create,
    new_uuid4_str,
)

UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I
)


def _make_location(id: str, name: str, parent_id: str | None) -> Location:
    return Location(id=id, parent_id=parent_id, name=name, path=EMPTY_LOCATION_PATH)


@pytest.mark.asyncio
async def test_create_with_defaults_and_optionals() -> None:
    # Create with minimal payload → defaults applied, UUID/ISO timestamps, version=1
    payload: ItemCreate = {"name": "Hammer", "tags": ["Tools", "  tools  ", "DIY"]}
    item = create_item_from_create(payload)

    assert isinstance(item, Item)
    assert item.name == "Hammer"
    assert item.quantity == 1
    assert item.checked_out is False
    assert item.due_date is None
    assert item.location_id is None
    assert item.tags == ["tools", "diy"]
    assert item.version == 1
    assert UUID4_RE.match(item.id)
    assert item.created_at.endswith("Z") and item.updated_at.endswith("Z")
    assert item.location_path == EMPTY_LOCATION_PATH


@pytest.mark.asyncio
async def test_invalid_due_date_requires_checked_out() -> None:
    # Invalid: due_date without checked_out → ValidationError
    with pytest.raises(ValidationError):
        create_item_from_create({"name": "Cordless Drill", "due_date": "2024-12-31"})


@pytest.mark.asyncio
async def test_tag_normalization_and_update_clears_fields() -> None:
    # Normalize tags on create and allow clearing via update
    item = create_item_from_create({"name": "Battery", "tags": ["Li-Ion", " li-ion ", "Spare"]})
    assert item.tags == ["li-ion", "spare"]

    updated = apply_item_update(item, ItemUpdate(tags=[]))
    assert updated.tags == []

    updated2 = apply_item_update(updated, ItemUpdate(description=None, category=None))
    assert updated2.description is None and updated2.category is None


@pytest.mark.asyncio
async def test_denormalized_location_path_generation() -> None:
    # Build a simple 3-level location chain and ensure display/sort paths
    root_id = new_uuid4_str()
    mid_id = new_uuid4_str()
    leaf_id = new_uuid4_str()
    root = _make_location(root_id, "Garage", None)
    mid = _make_location(mid_id, "Shelf A", root_id)
    leaf = _make_location(leaf_id, "Bin 3", mid_id)
    path = build_location_path([root, mid, leaf])

    assert isinstance(path, LocationPath)
    assert path.id_path == [root_id, mid_id, leaf_id]
    assert path.name_path == ["Garage", "Shelf A", "Bin 3"]
    assert path.display_path == "Garage / Shelf A / Bin 3"
    assert path.sort_key == "garage / shelf a / bin 3"

    # When creating with a valid location_id and map, item has location_path
    by_id: dict[str, Location] = {root_id: root, mid_id: mid, leaf_id: leaf}
    item = create_item_from_create(
        {"name": "Tape", "location_id": leaf_id, "checked_out": True, "due_date": "2024-01-02"},
        locations_by_id=by_id,
    )
    assert item.location_id == leaf_id
    assert item.location_path.display_path == "Garage / Shelf A / Bin 3"

    # And lookup via map works from leaf
    path2 = build_location_path_from_map(leaf_id, locations_by_id=by_id)
    assert path2.display_path == path.display_path


@pytest.mark.asyncio
async def test_invalid_location_reference() -> None:
    # Invalid: location_id unknown → ValidationError
    fake_id = new_uuid4_str()
    with pytest.raises(ValidationError):
        create_item_from_create(
            {"name": "Glue", "location_id": fake_id, "checked_out": True, "due_date": "2024-01-02"},
            locations_by_id={},
        )


@pytest.mark.asyncio
async def test_update_version_and_updated_at_changes() -> None:
    # Update increments version and refreshes updated_at
    item = create_item_from_create({"name": "Saw"})
    updated = apply_item_update(item, ItemUpdate(quantity=3))
    assert updated.version == item.version + 1
    assert updated.updated_at != item.updated_at
