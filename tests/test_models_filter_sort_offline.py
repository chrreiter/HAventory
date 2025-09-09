"""Comprehensive offline tests covering filter and sort behavior."""

from __future__ import annotations

import uuid

import pytest
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    EMPTY_LOCATION_PATH,
    ItemFilter,
    Location,
    Sort,
    build_location_path,
    create_item_from_create,
    filter_items,
    new_uuid4_str,
    sort_items,
)


def _make_location(id: str, name: str, parent_id: str | None) -> Location:
    return Location(
        id=uuid.UUID(id),
        parent_id=(uuid.UUID(parent_id) if parent_id is not None else None),
        name=name,
        path=EMPTY_LOCATION_PATH,
    )


def _build_locations() -> tuple[dict[str, Location], Location, Location, Location]:
    root_id = new_uuid4_str()
    mid_id = new_uuid4_str()
    leaf_id = new_uuid4_str()
    root = _make_location(root_id, "Garage", None)
    mid = _make_location(mid_id, "Shelf A", root_id)
    leaf = _make_location(leaf_id, "Bin 3", mid_id)
    by_id = {root_id: root, mid_id: mid, leaf_id: leaf}
    # Provide path data (not required for filtering but helpful for q/location tests)
    root.path = build_location_path([root])
    mid.path = build_location_path([root, mid])
    leaf.path = build_location_path([root, mid, leaf])
    return by_id, root, mid, leaf


@pytest.mark.asyncio
async def test_filter_q_matches_name_description_tags_and_location() -> None:
    by_id, root, mid, leaf = _build_locations()
    a = create_item_from_create({"name": "Electric Saw", "description": "Power cutting TOOL"})
    b = create_item_from_create({"name": "Glue", "description": "Strong adhesive"})
    c = create_item_from_create({"name": "Band", "tags": ["First Aid"]})
    d = create_item_from_create(
        {"name": "Tape", "location_id": leaf.id, "checked_out": True, "due_date": "2024-01-02"},
        locations_by_id=by_id,
    )

    # Name/description/tags/location display_path should all be matched case-insensitively
    out = filter_items([a, b, c, d], ItemFilter(q="adhesive"))
    assert [x.name for x in out] == ["Glue"]

    out2 = filter_items([a, b, c, d], ItemFilter(q="tool"))
    assert [x.name for x in out2] == ["Electric Saw"]

    out3 = filter_items([a, b, c, d], ItemFilter(q="aid"))
    assert [x.name for x in out3] == ["Band"]

    out4 = filter_items([a, b, c, d], ItemFilter(q="GARAGE"))
    assert [x.name for x in out4] == ["Tape"]


@pytest.mark.asyncio
async def test_filter_tags_any_and_all() -> None:
    i1 = create_item_from_create({"name": "Box", "tags": ["red", "blue"]})
    i2 = create_item_from_create({"name": "Tape", "tags": ["blue"]})
    i3 = create_item_from_create({"name": "Bag", "tags": ["yellow"]})

    out_any = filter_items([i1, i2, i3], ItemFilter(tags_any=["blue", "white"]))
    assert [x.name for x in out_any] == ["Box", "Tape"]

    out_all = filter_items([i1, i2, i3], ItemFilter(tags_all=["red", "blue"]))
    assert [x.name for x in out_all] == ["Box"]

    out_both = filter_items([i1, i2, i3], ItemFilter(tags_any=["blue"], tags_all=["red", "blue"]))
    assert [x.name for x in out_both] == ["Box"]


@pytest.mark.asyncio
async def test_filter_category_and_checked_out() -> None:
    a = create_item_from_create({"name": "Hammer", "category": "Tools"})
    b = create_item_from_create(
        {"name": "Glue", "category": "Consumables", "checked_out": True, "due_date": "2024-01-02"}
    )

    out_cat = filter_items([a, b], ItemFilter(category="tools"))
    assert [x.name for x in out_cat] == ["Hammer"]

    out_checked = filter_items([a, b], ItemFilter(checked_out=True))
    assert [x.name for x in out_checked] == ["Glue"]


@pytest.mark.asyncio
async def test_filter_low_stock_only_threshold_rules() -> None:
    # None disables; 0 is valid (quantity <= 0); integer N indicates quantity <= N
    a = create_item_from_create({"name": "Screws", "quantity": 5, "low_stock_threshold": None})
    b = create_item_from_create({"name": "Glue", "quantity": 0, "low_stock_threshold": 0})
    c = create_item_from_create({"name": "Batteries", "quantity": 2, "low_stock_threshold": 2})
    d = create_item_from_create({"name": "Nails", "quantity": 3, "low_stock_threshold": 2})

    out = filter_items([a, b, c, d], ItemFilter(low_stock_only=True))
    assert [x.name for x in out] == ["Glue", "Batteries"]


@pytest.mark.asyncio
async def test_filter_location_id_with_and_without_subtree() -> None:
    by_id, root, mid, leaf = _build_locations()
    at_root = create_item_from_create(
        {"name": "Box", "location_id": root.id, "checked_out": True, "due_date": "2024-01-02"},
        locations_by_id=by_id,
    )
    at_mid = create_item_from_create(
        {"name": "Tape", "location_id": mid.id, "checked_out": True, "due_date": "2024-01-02"},
        locations_by_id=by_id,
    )
    at_leaf = create_item_from_create(
        {"name": "Glue", "location_id": leaf.id, "checked_out": True, "due_date": "2024-01-02"},
        locations_by_id=by_id,
    )

    without_subtree = filter_items(
        [at_root, at_mid, at_leaf], ItemFilter(location_id=str(root.id), include_subtree=False)
    )
    assert [x.name for x in without_subtree] == ["Box"]

    with_subtree = filter_items(
        [at_root, at_mid, at_leaf], ItemFilter(location_id=str(root.id), include_subtree=True)
    )
    assert [x.name for x in with_subtree] == ["Box", "Tape", "Glue"]

    # Unknown location id → empty result (no error)
    empty = filter_items(
        [at_root, at_mid, at_leaf], ItemFilter(location_id=new_uuid4_str(), include_subtree=True)
    )
    assert empty == []


@pytest.mark.asyncio
async def test_filter_updated_after_and_created_after() -> None:
    a = create_item_from_create({"name": "A"})
    b = create_item_from_create({"name": "B"})
    c = create_item_from_create({"name": "C"})

    a.created_at = "2024-01-01T00:00:00Z"
    a.updated_at = "2024-01-01T10:00:00Z"
    b.created_at = "2024-01-02T00:00:00Z"
    b.updated_at = "2024-01-02T10:00:00Z"
    c.created_at = "2024-01-03T00:00:00Z"
    c.updated_at = "2024-01-03T10:00:00Z"

    out_upd = filter_items([a, b, c], ItemFilter(updated_after="2024-01-02T00:00:00Z"))
    assert [x.name for x in out_upd] == ["B", "C"]

    out_created = filter_items([a, b, c], ItemFilter(created_after="2024-01-01T12:00:00Z"))
    assert [x.name for x in out_created] == ["B", "C"]

    with pytest.raises(ValidationError):
        filter_items([a, b, c], ItemFilter(updated_after="2024/01/01"))


@pytest.mark.asyncio
async def test_sort_default_and_fields_with_tiebreak() -> None:
    a = create_item_from_create({"name": "Alpha"})
    b = create_item_from_create({"name": "Bravo"})
    c = create_item_from_create({"name": "Charlie"})

    a.updated_at = "2024-01-02T10:00:00Z"
    b.updated_at = "2024-01-03T10:00:00Z"
    c.updated_at = "2024-01-03T10:00:00Z"  # equal to b → tie broken by id asc

    # Default: updated_at desc, id asc tie-break
    out_default = sort_items([a, b, c])
    # b and c share updated_at; ensure id asc among them
    expected = [b, c] if b.id < c.id else [c, b]
    assert [x.id for x in out_default][:2] == [x.id for x in expected]

    # By name asc (case-insensitive)
    n1 = create_item_from_create({"name": "Äfter"})
    n2 = create_item_from_create({"name": "alpha"})
    n3 = create_item_from_create({"name": "Bravo"})
    out_name_asc = sort_items([n3, n1, n2], Sort(field="name", order="asc"))
    assert [x.name for x in out_name_asc] == ["Äfter", "alpha", "Bravo"]

    out_name_desc = sort_items([n3, n1, n2], Sort(field="name", order="desc"))
    assert [x.name for x in out_name_desc] == ["Bravo", "alpha", "Äfter"]


@pytest.mark.asyncio
async def test_sort_by_quantity_and_timestamps() -> None:
    q1 = create_item_from_create({"name": "A", "quantity": 5})
    q2 = create_item_from_create({"name": "B", "quantity": 1})
    q3 = create_item_from_create({"name": "C", "quantity": 3})
    out_q_asc = sort_items([q1, q2, q3], Sort(field="quantity", order="asc"))
    assert [x.quantity for x in out_q_asc] == [1, 3, 5]
    out_q_desc = sort_items([q1, q2, q3], Sort(field="quantity", order="desc"))
    assert [x.quantity for x in out_q_desc] == [5, 3, 1]

    t1 = create_item_from_create({"name": "T1"})
    t2 = create_item_from_create({"name": "T2"})
    t3 = create_item_from_create({"name": "T3"})
    t1.created_at = "2024-01-01T00:00:00Z"
    t2.created_at = "2024-01-02T00:00:00Z"
    t3.created_at = "2024-01-03T00:00:00Z"
    out_c_asc = sort_items([t3, t1, t2], Sort(field="created_at", order="asc"))
    assert [x.name for x in out_c_asc] == ["T1", "T2", "T3"]
    out_c_desc = sort_items([t1, t2, t3], Sort(field="created_at", order="desc"))
    assert [x.name for x in out_c_desc] == ["T3", "T2", "T1"]


@pytest.mark.asyncio
async def test_sort_invalid_inputs_raise() -> None:
    items = [create_item_from_create({"name": "A"})]
    with pytest.raises(ValidationError):
        sort_items(items, Sort(field="bogus", order="asc"))  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        sort_items(items, Sort(field="name", order="ascending"))  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_filter_then_sort_pipeline() -> None:
    a = create_item_from_create({"name": "B", "tags": ["x"]})
    b = create_item_from_create({"name": "A", "tags": ["y"]})
    c = create_item_from_create({"name": "C", "tags": ["x"]})
    filt = ItemFilter(tags_any=["x"])
    out = sort_items(filter_items([a, b, c], filt), Sort(field="name", order="asc"))
    assert [x.name for x in out] == ["B", "C"]
