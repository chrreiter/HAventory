"""Comprehensive offline tests covering filter and sort behavior."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from custom_components.haventory import models
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    EMPTY_LOCATION_PATH,
    SORT_FIELDS,
    Item,
    ItemFilter,
    Location,
    Sort,
    build_location_path,
    create_item_from_create,
    filter_items,
    sort_items,
    validate_item_filter,
    validate_sort,
)


def _make_location(id: str, name: str, parent_id: str | None) -> Location:
    return Location(
        id=uuid.UUID(id),
        parent_id=(uuid.UUID(parent_id) if parent_id is not None else None),
        name=name,
        path=EMPTY_LOCATION_PATH,
    )


def _build_locations() -> tuple[dict[str, Location], Location, Location, Location]:
    root_id = str(uuid.uuid4())
    mid_id = str(uuid.uuid4())
    leaf_id = str(uuid.uuid4())
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
    by_id, _root, _mid, leaf = _build_locations()
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
async def test_filter_q_is_accent_insensitive() -> None:
    """q matching folds accents (NFKD) in both the query and the item text.

    Regression: the post-filter used casefold() only, so the unaccented query
    "cafe" missed an item named "Probe Café" even though the index found it.
    """
    a = create_item_from_create({"name": "Probe Café"})
    b = create_item_from_create({"name": "Plain Mug"})

    # Unaccented query vs accented content (the previously broken direction)
    out = filter_items([a, b], ItemFilter(q="cafe"))
    assert [x.name for x in out] == ["Probe Café"]

    out2 = filter_items([a, b], ItemFilter(q="CAFE"))
    assert [x.name for x in out2] == ["Probe Café"]

    # Accented query vs accented content still works
    out3 = filter_items([a, b], ItemFilter(q="café"))
    assert [x.name for x in out3] == ["Probe Café"]

    # Accented query vs unaccented content (the reverse direction)
    c = create_item_from_create({"name": "Cafe Filter"})
    out4 = filter_items([b, c], ItemFilter(q="café"))
    assert [x.name for x in out4] == ["Cafe Filter"]


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
async def test_low_stock_first_orders_without_filtering() -> None:
    a = create_item_from_create({"name": "A", "quantity": 5, "low_stock_threshold": 2})
    b = create_item_from_create({"name": "B", "quantity": 1, "low_stock_threshold": 2})
    c = create_item_from_create({"name": "C", "quantity": 3, "low_stock_threshold": None})
    d = create_item_from_create({"name": "D", "quantity": 0, "low_stock_threshold": 0})
    # Set timestamps so default secondary sorting is deterministic (updated_at desc)
    a.updated_at = "2024-01-01T00:00:00Z"
    b.updated_at = "2024-01-02T00:00:00Z"
    c.updated_at = "2024-01-03T00:00:00Z"
    d.updated_at = "2024-01-04T00:00:00Z"

    # Base order by updated_at desc (no preference applied yet)
    items = sort_items(
        filter_items([a, b, c, d], ItemFilter()),
        Sort(field="updated_at", order="desc"),
    )
    assert [x.name for x in items] == ["D", "C", "B", "A"]

    # Emulate repository stable grouping: bring low-stock items to front,
    # preserving the chosen primary sort within each group.
    def _is_low_stock_local(it) -> bool:
        thr = it.low_stock_threshold
        return thr is not None and it.quantity <= thr

    items = sort_items([a, b, c, d], Sort(field="updated_at", order="desc"))
    items.sort(key=lambda it: not _is_low_stock_local(it))
    assert [x.name for x in items] == ["D", "B", "C", "A"]


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
        [at_root, at_mid, at_leaf], ItemFilter(location_id=str(uuid.uuid4()), include_subtree=True)
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
async def test_filter_updated_before_and_created_before() -> None:
    """The `before` bounds mirror the `after` ones and combine into a range."""

    a = create_item_from_create({"name": "A"})
    b = create_item_from_create({"name": "B"})
    c = create_item_from_create({"name": "C"})

    a.created_at = "2024-01-01T00:00:00Z"
    a.updated_at = "2024-01-01T10:00:00Z"
    b.created_at = "2024-01-02T00:00:00Z"
    b.updated_at = "2024-01-02T10:00:00Z"
    c.created_at = "2024-01-03T00:00:00Z"
    c.updated_at = "2024-01-03T10:00:00Z"

    out_upd = filter_items([a, b, c], ItemFilter(updated_before="2024-01-02T00:00:00Z"))
    assert [x.name for x in out_upd] == ["A"]

    out_created = filter_items([a, b, c], ItemFilter(created_before="2024-01-03T00:00:00Z"))
    assert [x.name for x in out_created] == ["A", "B"]

    # Both ends together select the middle, and the bounds stay exclusive.
    windowed = filter_items(
        [a, b, c],
        ItemFilter(updated_after="2024-01-01T10:00:00Z", updated_before="2024-01-03T10:00:00Z"),
    )
    assert [x.name for x in windowed] == ["B"]

    # An inverted window matches nothing rather than erroring.
    assert (
        filter_items(
            [a, b, c],
            ItemFilter(updated_after="2024-01-03T00:00:00Z", updated_before="2024-01-02T00:00:00Z"),
        )
        == []
    )

    with pytest.raises(ValidationError):
        filter_items([a, b, c], ItemFilter(created_before="2024/01/01"))


@pytest.mark.asyncio
async def test_filter_overdue_only() -> None:
    """`overdue_only` keeps items whose due date is already in the past."""

    late = create_item_from_create({"name": "Late", "checked_out": True, "due_date": "2000-01-01"})
    soon = create_item_from_create({"name": "Soon", "checked_out": True, "due_date": "2999-12-31"})
    undated = create_item_from_create({"name": "Out", "checked_out": True})
    home = create_item_from_create({"name": "Home"})
    every = [late, soon, undated, home]

    assert [x.name for x in filter_items(every, ItemFilter(overdue_only=True))] == ["Late"]

    # Off (or absent) it is not a predicate at all, so nothing is excluded.
    assert filter_items(every, ItemFilter(overdue_only=False)) == every


def _utc_day_offset(days: int) -> str:
    """A UTC calendar date `days` from today, as YYYY-MM-DD."""

    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


@pytest.mark.asyncio
async def test_filter_inspection_overdue_only_is_strictly_before_today() -> None:
    """`inspection_overdue_only` keeps items whose next inspection is already past."""

    yesterday = create_item_from_create(
        {"name": "Yesterday", "inspection_date": _utc_day_offset(-1)}
    )
    today = create_item_from_create({"name": "Today", "inspection_date": _utc_day_offset(0)})
    tomorrow = create_item_from_create({"name": "Tomorrow", "inspection_date": _utc_day_offset(1)})
    undated = create_item_from_create({"name": "Undated"})
    every = [yesterday, today, tomorrow, undated]

    # An inspection due today has not been missed yet — the comparison is strict.
    kept = filter_items(every, ItemFilter(inspection_overdue_only=True))
    assert [x.name for x in kept] == ["Yesterday"]

    # Off (or absent) it is not a predicate at all, so nothing is excluded.
    assert filter_items(every, ItemFilter(inspection_overdue_only=False)) == every


@pytest.mark.asyncio
async def test_filter_inspection_overdue_is_independent_of_checkout() -> None:
    """An inspection is a fact about the item, so the two date filters are separate."""

    shelved = create_item_from_create({"name": "Shelved", "inspection_date": _utc_day_offset(-1)})
    borrowed = create_item_from_create(
        {
            "name": "Borrowed",
            "checked_out": True,
            "due_date": _utc_day_offset(-1),
            "inspection_date": _utc_day_offset(30),
        }
    )
    every = [shelved, borrowed]

    inspection = filter_items(every, ItemFilter(inspection_overdue_only=True))
    assert [x.name for x in inspection] == ["Shelved"]
    assert [x.name for x in filter_items(every, ItemFilter(overdue_only=True))] == ["Borrowed"]

    # Both predicates at once is an AND, and nothing here is late on both counts.
    assert filter_items(every, ItemFilter(overdue_only=True, inspection_overdue_only=True)) == []


@pytest.mark.asyncio
async def test_filter_checked_out_due_only_counts_today() -> None:
    """`checked_out_due_only` is `overdue_only` plus the items due back today."""

    late = create_item_from_create(
        {"name": "Late", "checked_out": True, "due_date": _utc_day_offset(-1)}
    )
    today = create_item_from_create(
        {"name": "Today", "checked_out": True, "due_date": _utc_day_offset(0)}
    )
    tomorrow = create_item_from_create(
        {"name": "Tomorrow", "checked_out": True, "due_date": _utc_day_offset(1)}
    )
    undated = create_item_from_create({"name": "Out", "checked_out": True})
    home = create_item_from_create({"name": "Home"})
    every = [late, today, tomorrow, undated, home]

    kept = filter_items(every, ItemFilter(checked_out_due_only=True))
    assert [x.name for x in kept] == ["Late", "Today"]
    # The strict twin drops the one due today, which is the whole difference.
    assert [x.name for x in filter_items(every, ItemFilter(overdue_only=True))] == ["Late"]

    # Off (or absent) it is not a predicate at all, so nothing is excluded.
    assert filter_items(every, ItemFilter(checked_out_due_only=False)) == every


@pytest.mark.asyncio
async def test_filter_inspection_due_only_counts_today() -> None:
    """`inspection_due_only` is `inspection_overdue_only` plus today's inspections."""

    yesterday = create_item_from_create(
        {"name": "Yesterday", "inspection_date": _utc_day_offset(-1)}
    )
    today = create_item_from_create({"name": "Today", "inspection_date": _utc_day_offset(0)})
    tomorrow = create_item_from_create({"name": "Tomorrow", "inspection_date": _utc_day_offset(1)})
    undated = create_item_from_create({"name": "Undated"})
    every = [yesterday, today, tomorrow, undated]

    kept = filter_items(every, ItemFilter(inspection_due_only=True))
    assert [x.name for x in kept] == ["Yesterday", "Today"]
    strict = filter_items(every, ItemFilter(inspection_overdue_only=True))
    assert [x.name for x in strict] == ["Yesterday"]

    # Off (or absent) it is not a predicate at all, so nothing is excluded.
    assert filter_items(every, ItemFilter(inspection_due_only=False)) == every


@pytest.mark.asyncio
async def test_the_two_due_filters_ask_about_different_dates() -> None:
    """A due date is about a borrowing; an inspection date is about the item."""

    borrowed = create_item_from_create(
        {"name": "Borrowed", "checked_out": True, "due_date": _utc_day_offset(0)}
    )
    shelved = create_item_from_create({"name": "Shelved", "inspection_date": _utc_day_offset(0)})
    every = [borrowed, shelved]

    assert [x.name for x in filter_items(every, ItemFilter(checked_out_due_only=True))] == [
        "Borrowed"
    ]
    assert [x.name for x in filter_items(every, ItemFilter(inspection_due_only=True))] == [
        "Shelved"
    ]

    # Both predicates at once is an AND, and neither item answers both.
    both = ItemFilter(checked_out_due_only=True, inspection_due_only=True)
    assert filter_items(every, both) == []


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
async def test_filter_orphaned_only_matches_items_without_location() -> None:
    """orphaned_only=True keeps only items with location_id == None."""

    by_id, root, _mid, _leaf = _build_locations()
    placed = create_item_from_create(
        {"name": "Placed", "location_id": root.id}, locations_by_id=by_id
    )
    orphan_a = create_item_from_create({"name": "Orphan Saw"})
    orphan_b = create_item_from_create({"name": "Orphan Glue"})

    out = filter_items([placed, orphan_a, orphan_b], ItemFilter(orphaned_only=True))
    assert sorted(x.name for x in out) == ["Orphan Glue", "Orphan Saw"]

    # Combines with q (AND semantics)
    out_q = filter_items([placed, orphan_a, orphan_b], ItemFilter(orphaned_only=True, q="saw"))
    assert [x.name for x in out_q] == ["Orphan Saw"]

    # False / absent → no effect
    out_off = filter_items([placed, orphan_a, orphan_b], ItemFilter(orphaned_only=False))
    assert sorted(x.name for x in out_off) == ["Orphan Glue", "Orphan Saw", "Placed"]


@pytest.mark.asyncio
async def test_sort_by_due_date_nulls_last_both_orders() -> None:
    """due_date sorting orders dated items and places undated items last."""

    d1 = create_item_from_create({"name": "Early", "checked_out": True, "due_date": "2024-01-05"})
    d2 = create_item_from_create({"name": "Late", "checked_out": True, "due_date": "2024-03-01"})
    d3 = create_item_from_create({"name": "Undated"})  # due_date is None

    out_asc = sort_items([d3, d2, d1], Sort(field="due_date", order="asc"))
    assert [x.name for x in out_asc] == ["Early", "Late", "Undated"]

    out_desc = sort_items([d1, d3, d2], Sort(field="due_date", order="desc"))
    assert [x.name for x in out_desc] == ["Late", "Early", "Undated"]


@pytest.mark.asyncio
async def test_sort_by_inspection_date_nulls_last_both_orders() -> None:
    """inspection_date sorting mirrors due_date semantics (nulls last)."""

    i1 = create_item_from_create({"name": "Soon", "inspection_date": "2024-02-01"})
    i2 = create_item_from_create({"name": "Later", "inspection_date": "2024-06-15"})
    i3 = create_item_from_create({"name": "Never"})  # inspection_date is None

    out_asc = sort_items([i2, i3, i1], Sort(field="inspection_date", order="asc"))
    assert [x.name for x in out_asc] == ["Soon", "Later", "Never"]

    out_desc = sort_items([i1, i2, i3], Sort(field="inspection_date", order="desc"))
    assert [x.name for x in out_desc] == ["Later", "Soon", "Never"]

    # Ties on the date fall back to id asc (stable, deterministic paging)
    t1 = create_item_from_create({"name": "TieA", "inspection_date": "2024-02-01"})
    t2 = create_item_from_create({"name": "TieB", "inspection_date": "2024-02-01"})
    out_tie = sort_items([t2, t1], Sort(field="inspection_date", order="asc"))
    expected = [t1, t2] if str(t1.id) < str(t2.id) else [t2, t1]
    assert [x.id for x in out_tie] == [x.id for x in expected]


@pytest.mark.asyncio
async def test_filter_then_sort_pipeline() -> None:
    a = create_item_from_create({"name": "B", "tags": ["x"]})
    b = create_item_from_create({"name": "A", "tags": ["y"]})
    c = create_item_from_create({"name": "C", "tags": ["x"]})
    filt = ItemFilter(tags_any=["x"])
    out = sort_items(filter_items([a, b, c], filt), Sort(field="name", order="asc"))
    assert [x.name for x in out] == ["B", "C"]


# -----------------------------
# Unknown filter and sort keys
# -----------------------------


def test_validate_item_filter_accepts_every_declared_key() -> None:
    """Keyed off the TypedDict, so a new filter key needs no second list.

    Asserted explicitly because that coupling is what lets a later filter key be
    added without touching the validator — incidental agreement would not.
    """

    every_key: dict[str, object] = dict.fromkeys(ItemFilter.__annotations__, None)
    validate_item_filter(every_key)


@pytest.mark.parametrize("typo", ["search", "query", "location", "tags"])
def test_validate_item_filter_names_the_unknown_key(typo: str) -> None:
    with pytest.raises(ValidationError, match=typo):
        validate_item_filter({typo: "hammer"})


def test_validate_item_filter_reports_every_unknown_key() -> None:
    with pytest.raises(ValidationError) as excinfo:
        validate_item_filter({"search": "x", "sort_by": "name", "q": "ok"})
    message = str(excinfo.value)
    assert "search" in message
    assert "sort_by" in message
    assert "q" not in message


@pytest.mark.parametrize("bad", ["not-an-object", 5, ["q"]])
def test_validate_item_filter_rejects_a_non_object(bad: object) -> None:
    with pytest.raises(ValidationError, match=r"filter must be an object"):
        validate_item_filter(bad)


def test_validate_item_filter_passes_none_through() -> None:
    validate_item_filter(None)


def test_validate_sort_accepts_the_vocabulary_and_rejects_the_rest() -> None:
    for field_name in SORT_FIELDS:
        validate_sort({"field": field_name, "order": "asc"})
        validate_sort({"field": field_name, "order": "desc"})

    with pytest.raises(ValidationError, match=r"sort\.field"):
        validate_sort({"field": "colour", "order": "asc"})
    with pytest.raises(ValidationError, match=r"sort\.order"):
        validate_sort({"field": "name", "order": "sideways"})
    with pytest.raises(ValidationError, match="by"):
        validate_sort({"by": "name", "order": "asc"})
    with pytest.raises(ValidationError, match=r"sort must be an object"):
        validate_sort("name")


# -----------------------------
# Multi-select categories and locations
# -----------------------------


@pytest.mark.asyncio
async def test_filter_categories_unions_the_selection() -> None:
    a = create_item_from_create({"name": "Hammer", "category": "Tools"})
    b = create_item_from_create({"name": "Novel", "category": "Books"})
    c = create_item_from_create({"name": "Soap", "category": "Cleaning"})

    out = filter_items([a, b, c], ItemFilter(categories=["Tools", "Books"]))
    assert sorted(x.name for x in out) == ["Hammer", "Novel"]

    # Case-insensitive and de-duplicating, like the scalar it sits beside.
    out_case = filter_items([a, b, c], ItemFilter(categories=["tOOLs", "TOOLS"]))
    assert [x.name for x in out_case] == ["Hammer"]


@pytest.mark.asyncio
async def test_filter_categories_unions_with_the_scalar_rather_than_intersecting() -> None:
    """An item has one category, so requiring both keys would match nothing."""

    a = create_item_from_create({"name": "Hammer", "category": "Tools"})
    b = create_item_from_create({"name": "Novel", "category": "Books"})

    out = filter_items([a, b], ItemFilter(category="Tools", categories=["Books"]))
    assert sorted(x.name for x in out) == ["Hammer", "Novel"]


@pytest.mark.asyncio
async def test_an_empty_category_selection_does_not_narrow() -> None:
    """The rule `tags_any` already follows: an empty list is not a filter."""

    a = create_item_from_create({"name": "Hammer", "category": "Tools"})
    b = create_item_from_create({"name": "Loose", "category": None})

    out = filter_items([a, b], ItemFilter(categories=[]))
    assert sorted(x.name for x in out) == ["Hammer", "Loose"]


@pytest.mark.asyncio
async def test_filter_location_ids_unions_the_selection() -> None:
    by_id, root, mid, leaf = _build_locations()
    in_root = create_item_from_create(
        {"name": "At root", "location_id": root.id}, locations_by_id=by_id
    )
    in_leaf = create_item_from_create(
        {"name": "At leaf", "location_id": leaf.id}, locations_by_id=by_id
    )
    nowhere = create_item_from_create({"name": "Nowhere"})
    items = [in_root, in_leaf, nowhere]

    direct = filter_items(items, ItemFilter(location_ids=[str(root.id), str(leaf.id)]))
    assert sorted(x.name for x in direct) == ["At leaf", "At root"]

    # An item with no location is not in any selected location.
    assert [x.name for x in filter_items(items, ItemFilter(location_ids=[str(mid.id)]))] == []


@pytest.mark.asyncio
async def test_include_subtree_is_one_flag_for_the_whole_location_selection() -> None:
    by_id, _root, mid, leaf = _build_locations()
    other = _make_location(str(uuid.uuid4()), "Cellar", None)
    by_id[str(other.id)] = other
    other.path = build_location_path([other])

    in_leaf = create_item_from_create(
        {"name": "At leaf", "location_id": leaf.id}, locations_by_id=by_id
    )
    in_other = create_item_from_create(
        {"name": "At cellar", "location_id": other.id}, locations_by_id=by_id
    )
    items = [in_leaf, in_other]

    # `mid` is an ancestor of `leaf`; `other` holds its item directly. One flag
    # applies to both entries — there is no per-entry form.
    with_subtree = filter_items(
        items, ItemFilter(location_ids=[str(mid.id), str(other.id)], include_subtree=True)
    )
    assert sorted(x.name for x in with_subtree) == ["At cellar", "At leaf"]

    without = filter_items(
        items, ItemFilter(location_ids=[str(mid.id), str(other.id)], include_subtree=False)
    )
    assert [x.name for x in without] == ["At cellar"]


@pytest.mark.asyncio
async def test_a_selection_of_only_unparseable_location_ids_matches_nothing() -> None:
    """The scalar has always answered "nothing" to a malformed id; so does a list."""

    by_id, root, _mid, _leaf = _build_locations()
    filed = create_item_from_create(
        {"name": "Filed", "location_id": root.id}, locations_by_id=by_id
    )

    assert filter_items([filed], ItemFilter(location_ids=["not-a-uuid"])) == []
    # One good id beside a bad one still selects on the good one.
    kept = filter_items([filed], ItemFilter(location_ids=["not-a-uuid", str(root.id)]))
    assert [x.name for x in kept] == ["Filed"]


def test_the_location_selection_is_parsed_once_per_query(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Not once per candidate item.

    The selection is constant for the whole query, so the cost of parsing it
    must not grow with the inventory. Pinned by counting, because the only
    other evidence is a benchmark nobody re-runs.
    """

    by_id, root, mid, _leaf = _build_locations()
    items = [
        create_item_from_create(
            {"name": f"Item {n}", "location_id": root.id}, locations_by_id=by_id
        )
        for n in range(50)
    ]

    calls = 0
    real = models.parse_uuid4

    def counting(value, *, field_name="id"):  # type: ignore[no-untyped-def]
        nonlocal calls
        if field_name == "filter.location_id":
            calls += 1
        return real(value, field_name=field_name)

    monkeypatch.setattr(models, "parse_uuid4", counting)

    kept = filter_items(items, ItemFilter(location_ids=[str(root.id), str(mid.id)]))
    assert len(kept) == len(items)
    assert calls == 2  # noqa: PLR2004 — one per selected id, whatever the item count


@pytest.mark.parametrize("key", ["categories", "location_ids", "tags_any", "tags_all"])
@pytest.mark.parametrize("bad", ["Tools", 5, {"a": 1}, [1], [None]])
def test_a_multi_select_key_that_is_not_a_list_of_strings_is_refused(key: str, bad: object) -> None:
    """A bare string is the one worth naming: iterating it filters by letters."""

    with pytest.raises(ValidationError, match=f"{key} must be a list of strings"):
        filter_items([], {key: bad})


def test_validate_item_filter_accepts_the_multi_select_keys() -> None:
    """Stated rather than incidental: the validator is keyed off the TypedDict,
    so `categories` and `location_ids` were accepted the moment they were
    declared there — no second list to extend."""

    assert {"categories", "location_ids"} <= set(ItemFilter.__annotations__)
    validate_item_filter({"categories": ["Tools"], "location_ids": [str(uuid.uuid4())]})


# -----------------------------
# Ordering by location path
# -----------------------------


def _located(name: str, chain: list[Location]) -> Item:
    """An item whose denormalized path is built from a root->leaf chain."""

    by_id = {str(loc.id): loc for loc in chain}
    return create_item_from_create(
        {"name": name, "location_id": chain[-1].id}, locations_by_id=by_id
    )


@pytest.mark.asyncio
async def test_sort_by_location_orders_on_the_denormalized_path() -> None:
    by_id, root, mid, leaf = _build_locations()
    cellar = _make_location(str(uuid.uuid4()), "Cellar", None)
    cellar.path = build_location_path([cellar])
    by_id[str(cellar.id)] = cellar

    in_leaf = _located("Deep", [root, mid, leaf])  # Garage / Shelf A / Bin 3
    in_root = _located("Shallow", [root])  # Garage
    in_cellar = _located("Elsewhere", [cellar])  # Cellar
    items = [in_leaf, in_root, in_cellar]

    asc = sort_items(items, Sort(field="location", order="asc"))
    assert [x.name for x in asc] == ["Elsewhere", "Shallow", "Deep"]

    desc = sort_items(items, Sort(field="location", order="desc"))
    assert [x.name for x in desc] == ["Deep", "Shallow", "Elsewhere"]


@pytest.mark.asyncio
async def test_sort_by_location_puts_unlocated_items_last_in_both_orders() -> None:
    """The rule `date_sort_key` already applies to undated items.

    A stored path key is "" for an item filed nowhere, which a plain ascending
    sort would float to the top.
    """

    by_id, root, _mid, _leaf = _build_locations()
    assert by_id
    filed = _located("Filed", [root])
    loose_a = create_item_from_create({"name": "Loose A"})
    loose_b = create_item_from_create({"name": "Loose B"})
    items = [loose_a, filed, loose_b]

    asc = sort_items(items, Sort(field="location", order="asc"))
    assert asc[0].name == "Filed"
    assert {x.name for x in asc[1:]} == {"Loose A", "Loose B"}

    desc = sort_items(items, Sort(field="location", order="desc"))
    assert desc[0].name == "Filed"
    assert {x.name for x in desc[1:]} == {"Loose A", "Loose B"}


@pytest.mark.asyncio
async def test_unlocated_items_stay_last_behind_a_non_latin_location_name() -> None:
    """A printable sentinel would not have outranked this path.

    The key is built from location *names*, and an accented or non-Latin one
    folds to a character well above the "~" the date rule uses.
    """

    accented = _make_location(str(uuid.uuid4()), "Éclairage", None)
    accented.path = build_location_path([accented])
    filed = _located("Filed", [accented])
    loose = create_item_from_create({"name": "Loose"})

    asc = sort_items([loose, filed], Sort(field="location", order="asc"))
    assert [x.name for x in asc] == ["Filed", "Loose"]


def test_location_joins_the_sort_vocabulary() -> None:
    assert "location" in SORT_FIELDS
    validate_sort({"field": "location", "order": "asc"})
    validate_sort({"field": "location", "order": "desc"})
