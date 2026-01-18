"""Offline tests for HAventory models and helpers.

Scenarios cover creation defaults, invalid payloads, tag normalization, field
clearing via updates, and denormalized location path generation.
"""

from __future__ import annotations

import re
import uuid

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
    iso_utc_now,
    monotonic_timestamp_after,
    new_uuid4_str,
)

UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I
)


def _make_location(id: str, name: str, parent_id: str | None) -> Location:
    return Location(
        id=uuid.UUID(id),
        parent_id=(uuid.UUID(parent_id) if parent_id is not None else None),
        name=name,
        path=EMPTY_LOCATION_PATH,
    )


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
    assert UUID4_RE.match(str(item.id))
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
    assert [str(x) for x in path.id_path] == [root_id, mid_id, leaf_id]
    assert path.name_path == ["Garage", "Shelf A", "Bin 3"]
    assert path.display_path == "Garage / Shelf A / Bin 3"
    assert path.sort_key == "garage / shelf a / bin 3"

    # When creating with a valid location_id and map, item has location_path
    by_id: dict[str, Location] = {root_id: root, mid_id: mid, leaf_id: leaf}
    item = create_item_from_create(
        {"name": "Tape", "location_id": leaf_id, "checked_out": True, "due_date": "2024-01-02"},
        locations_by_id=by_id,
    )
    assert str(item.location_id) == leaf_id
    assert item.location_path.display_path == "Garage / Shelf A / Bin 3"

    # And lookup via map works from leaf
    path2 = build_location_path_from_map(uuid.UUID(leaf_id), locations_by_id=by_id)
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


@pytest.mark.asyncio
async def test_monotonic_timestamp_after_strictly_increases() -> None:
    # monotonic_timestamp_after returns a value strictly greater than prev and ends with 'Z'
    prev = iso_utc_now()
    nxt = monotonic_timestamp_after(prev)
    assert nxt.endswith("Z")
    assert nxt > prev


@pytest.mark.asyncio
async def test_create_trims_name_and_accepts_trailing_spaces() -> None:
    # Create accepts name with spaces and stores trimmed value
    item = create_item_from_create({"name": "  Widget  "})
    assert item.name == "Widget"


@pytest.mark.asyncio
async def test_update_trims_name_and_accepts_trailing_spaces() -> None:
    # Update accepts name with spaces and stores trimmed value
    item = create_item_from_create({"name": "Start"})
    updated = apply_item_update(item, ItemUpdate(name="  Wrench  "))
    assert updated.name == "Wrench"


@pytest.mark.asyncio
async def test_rejects_name_empty_after_trim_on_create_and_update() -> None:
    # Reject names that become empty after trimming on create and update
    with pytest.raises(ValidationError):
        create_item_from_create({"name": "   "})

    item = create_item_from_create({"name": "Valid"})
    with pytest.raises(ValidationError):
        apply_item_update(item, ItemUpdate(name="    "))


@pytest.mark.asyncio
async def test_inspection_date_accepted_without_checked_out() -> None:
    # inspection_date can be set without checked_out=True (unlike due_date)
    item = create_item_from_create({"name": "Battery", "inspection_date": "2024-12-31"})
    assert item.inspection_date == "2024-12-31"
    assert item.checked_out is False

    # Update inspection_date on non-checked-out item
    updated = apply_item_update(item, ItemUpdate(inspection_date="2025-01-15"))
    assert updated.inspection_date == "2025-01-15"
    assert updated.checked_out is False


@pytest.mark.asyncio
async def test_invalid_inspection_date_format_raises_validation_error() -> None:
    # Invalid inspection_date format → ValidationError
    with pytest.raises(ValidationError):
        create_item_from_create({"name": "Equipment", "inspection_date": "12/31/2024"})

    with pytest.raises(ValidationError):
        create_item_from_create({"name": "Equipment", "inspection_date": "2024-13-01"})

    item = create_item_from_create({"name": "Equipment"})
    with pytest.raises(ValidationError):
        apply_item_update(item, ItemUpdate(inspection_date="invalid-date"))
