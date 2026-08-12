"""Offline tests for the in-memory Repository (items focus).

Scenarios cover CRUD, optimistic concurrency, filtering/sorting/pagination,
and derived counts (checked_out and low_stock).
"""

from __future__ import annotations

import base64
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from custom_components.haventory.exceptions import ConflictError, NotFoundError, ValidationError
from custom_components.haventory.models import ItemCreate, ItemFilter, ItemUpdate, Sort
from custom_components.haventory.repository import CURSOR_MAX_LENGTH, Repository

TOTAL_ITEMS = 3
BOOKS_TOTAL = 3
INITIAL_LOW_STOCK_COUNT = 1
LOW_STOCK_AFTER_ADJUST = 2
LOADED_ITEM_COUNT = 2


@pytest.mark.asyncio
async def test_item_crud_and_concurrency() -> None:
    """Create, get, update, and delete with version checks."""

    repo = Repository()

    # Create
    item = repo.create_item(ItemCreate(name="Hammer"))
    assert item.name == "Hammer"
    assert repo.get_counts()["items_total"] == 1

    # Get
    fetched = repo.get_item(item.id)
    assert str(fetched.id) == str(item.id)

    # Update with mismatched version → ConflictError
    with pytest.raises(ConflictError):
        repo.update_item(item.id, {"name": "Hammer v2"}, expected_version=item.version + 1)  # type: ignore[arg-type]

    # Successful update increments version
    updated = repo.update_item(item.id, {"name": "Hammer v2"}, expected_version=item.version)  # type: ignore[arg-type]
    assert updated.version == item.version + 1
    assert updated.name == "Hammer v2"

    # Delete with wrong version → ConflictError
    with pytest.raises(ConflictError):
        repo.delete_item(item.id, expected_version=999)

    # Delete succeeds with current version
    repo.delete_item(item.id, expected_version=updated.version)
    with pytest.raises(NotFoundError):
        repo.get_item(item.id)
    assert repo.get_counts()["items_total"] == 0


@pytest.mark.asyncio
async def test_filter_sort_and_cursor_pagination() -> None:
    """Filter, sort, and paginate deterministically with a stable cursor."""

    repo = Repository()

    # Create a small catalog of items with names exercising case/accent rules
    names = ["Äfter", "alpha", "Bravo", "Zulu", "Oscar"]
    for nm in names:
        repo.create_item(ItemCreate(name=nm))

    # Sort by name asc (case-insensitive, accent-folded)
    sort = Sort(field="name", order="asc")  # type: ignore[typeddict-item]

    page1 = repo.list_items(sort=sort, limit=2)
    assert [x.name for x in page1["items"]] == ["Äfter", "alpha"]
    assert isinstance(page1["next_cursor"], str)

    page2 = repo.list_items(sort=sort, limit=2, cursor=page1["next_cursor"])  # type: ignore[arg-type]
    assert [x.name for x in page2["items"]] == ["Bravo", "Oscar"]
    assert isinstance(page2["next_cursor"], str)

    page3 = repo.list_items(sort=sort, limit=2, cursor=page2["next_cursor"])  # type: ignore[arg-type]
    assert [x.name for x in page3["items"]] == ["Zulu"]
    assert page3["next_cursor"] is None

    # Apply a q filter (name/description/tags/location path case-insensitive)
    out = repo.list_items(flt=ItemFilter(q="lph"))
    assert [x.name for x in out["items"]] == ["alpha"]


@pytest.mark.asyncio
async def test_due_date_sort_cursor_pagination_with_nulls() -> None:
    """Cursor pagination stays consistent for due_date sort, undated items last."""

    repo = Repository()
    repo.create_item(ItemCreate(name="Mid", checked_out=True, due_date="2024-02-01"))
    repo.create_item(ItemCreate(name="Early", checked_out=True, due_date="2024-01-01"))
    repo.create_item(ItemCreate(name="Late", checked_out=True, due_date="2024-03-01"))
    repo.create_item(ItemCreate(name="UndatedA"))
    repo.create_item(ItemCreate(name="UndatedB"))

    sort = Sort(field="due_date", order="asc")  # type: ignore[typeddict-item]

    page1 = repo.list_items(sort=sort, limit=2)
    assert [x.name for x in page1["items"]] == ["Early", "Mid"]
    assert isinstance(page1["next_cursor"], str)

    page2 = repo.list_items(sort=sort, limit=2, cursor=page1["next_cursor"])
    assert page2["items"][0].name == "Late"
    # The second slot starts the undated tail (id-asc order within the tail)
    assert page2["items"][1].due_date is None
    assert isinstance(page2["next_cursor"], str)

    page3 = repo.list_items(sort=sort, limit=2, cursor=page2["next_cursor"])
    assert len(page3["items"]) == 1
    assert page3["items"][0].due_date is None
    assert page3["next_cursor"] is None

    # Descending: dated items newest-first, undated still last
    out_desc = repo.list_items(sort=Sort(field="due_date", order="desc"))  # type: ignore[typeddict-item]
    names = [x.name for x in out_desc["items"]]
    assert names[:3] == ["Late", "Mid", "Early"]
    assert {names[3], names[4]} == {"UndatedA", "UndatedB"}


@pytest.mark.asyncio
async def test_orphaned_only_filter_through_list_items() -> None:
    """orphaned_only composes with the index-first candidate path (q index)."""

    repo = Repository()
    loc = repo.create_location(name="Garage")
    repo.create_item(ItemCreate(name="Placed Saw", location_id=str(loc.id)))
    repo.create_item(ItemCreate(name="Orphan Saw"))
    repo.create_item(ItemCreate(name="Orphan Tape"))

    out = repo.list_items(flt=ItemFilter(orphaned_only=True))
    assert sorted(x.name for x in out["items"]) == ["Orphan Saw", "Orphan Tape"]

    # q uses the text index for candidates; orphaned_only post-filters them
    out_q = repo.list_items(flt=ItemFilter(orphaned_only=True, q="saw"))
    assert [x.name for x in out_q["items"]] == ["Orphan Saw"]


@pytest.mark.asyncio
async def test_overdue_count_and_filter_track_check_in() -> None:
    """`overdue_count` counts past-due items and follows the check-out state."""

    repo = Repository()
    late = repo.create_item(ItemCreate(name="Late Drill", checked_out=True, due_date="2000-01-01"))
    repo.create_item(ItemCreate(name="Soon Drill", checked_out=True, due_date="2999-12-31"))
    repo.create_item(ItemCreate(name="Out Drill", checked_out=True))
    repo.create_item(ItemCreate(name="Home Drill"))

    assert repo.get_counts()["overdue_count"] == 1
    out = repo.list_items(flt=ItemFilter(overdue_only=True))
    assert [x.name for x in out["items"]] == ["Late Drill"]

    # Checking in clears the due date, so the overdue population empties with it.
    repo.check_in(late.id)
    assert repo.get_counts()["overdue_count"] == 0
    assert repo.list_items(flt=ItemFilter(overdue_only=True))["items"] == []


def _utc_day_offset(days: int) -> str:
    """A UTC calendar date `days` from today, as YYYY-MM-DD."""

    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


@pytest.mark.asyncio
async def test_inspection_overdue_count_walks_the_whole_inventory() -> None:
    """`inspection_overdue_count` spans every item, not just the checked-out ones."""

    repo = Repository()
    repo.create_item(ItemCreate(name="Ladder", inspection_date=_utc_day_offset(-1)))
    repo.create_item(
        ItemCreate(
            name="Extinguisher",
            checked_out=True,
            due_date=_utc_day_offset(7),
            inspection_date=_utc_day_offset(-30),
        )
    )
    repo.create_item(ItemCreate(name="Harness", inspection_date=_utc_day_offset(0)))
    repo.create_item(ItemCreate(name="Rope", inspection_date=_utc_day_offset(365)))
    repo.create_item(ItemCreate(name="Bucket"))

    counts = repo.get_counts()
    # Two past dates, one on a shelved item and one on a borrowed one. The
    # inspection due today is not late yet.
    INSPECTION_OVERDUE = 2
    assert counts["inspection_overdue_count"] == INSPECTION_OVERDUE
    # Nothing is past its *due* date: the two counts answer different questions.
    assert counts["overdue_count"] == 0

    out = repo.list_items(flt=ItemFilter(inspection_overdue_only=True))
    assert sorted(x.name for x in out["items"]) == ["Extinguisher", "Ladder"]
    assert out["total"] == INSPECTION_OVERDUE


@pytest.mark.asyncio
async def test_inspection_overdue_count_follows_the_stored_date() -> None:
    """Rescheduling or clearing the date moves the item out of the population."""

    repo = Repository()
    ladder = repo.create_item(ItemCreate(name="Ladder", inspection_date=_utc_day_offset(-1)))
    assert repo.get_counts()["inspection_overdue_count"] == 1

    inspected = repo.update_item(
        ladder.id, ItemUpdate(inspection_date=_utc_day_offset(365)), expected_version=ladder.version
    )
    assert repo.get_counts()["inspection_overdue_count"] == 0

    repo.update_item(
        inspected.id, ItemUpdate(inspection_date=None), expected_version=inspected.version
    )
    assert repo.get_counts()["inspection_overdue_count"] == 0
    assert repo.list_items(flt=ItemFilter(inspection_overdue_only=True))["items"] == []


@pytest.mark.asyncio
async def test_prefilter_by_area_and_and_logic_with_location() -> None:
    """Pre-filter by area id and support AND with location_id."""

    repo = Repository()
    # Create locations: L1(area=A), L2(area=B)
    area_a = uuid.uuid4()
    area_b = uuid.uuid4()
    l1 = repo.create_location(name="L1", area_id=area_a)
    l2 = repo.create_location(name="L2", area_id=area_b)

    # Items in each location
    i1 = repo.create_item(ItemCreate(name="X", location_id=str(l1.id)))
    i2 = repo.create_item(ItemCreate(name="Y", location_id=str(l2.id)))

    # Filter by area A returns only i1
    out = repo.list_items(flt=ItemFilter(area_id=str(area_a)))
    assert [x.id for x in out["items"]] == [i1.id]

    # Filter by area B AND location_id=L2 returns only i2
    out2 = repo.list_items(
        flt=ItemFilter(area_id=str(area_b), location_id=str(l2.id)),
        sort=Sort(field="name", order="asc"),  # type: ignore[typeddict-item]
    )
    assert [x.id for x in out2["items"]] == [i2.id]


@pytest.mark.asyncio
async def test_prefilter_by_area_with_non_uuid_ids_and_update_rebuckets() -> None:
    """Repository accepts string area ids and re-buckets items on area change."""

    repo = Repository()
    # Non-UUID area ids
    l1 = repo.create_location(name="L1", area_id="kitchen")
    l2 = repo.create_location(name="L2", area_id="garage")

    i1 = repo.create_item(ItemCreate(name="X", location_id=str(l1.id)))
    i2 = repo.create_item(ItemCreate(name="Y", location_id=str(l2.id)))

    # Filter by 'kitchen' returns only i1
    out = repo.list_items(flt=ItemFilter(area_id="kitchen"))
    assert [x.id for x in out["items"]] == [i1.id]

    # Change L2 area to 'kitchen' and ensure item re-bucketed
    repo.update_location(l2.id, area_id="kitchen")
    out2 = repo.list_items(flt=ItemFilter(area_id="kitchen"))
    assert {x.id for x in out2["items"]} == {i1.id, i2.id}

    # 'garage' bucket now empty
    out3 = repo.list_items(flt=ItemFilter(area_id="garage"))
    assert [x.id for x in out3["items"]] == []


@pytest.mark.asyncio
async def test_low_stock_and_checked_out_counts_update() -> None:
    """Derived counts reflect item state and update on writes."""

    repo = Repository()

    # Create items; glue starts as low-stock due to threshold 0
    repo.create_item(ItemCreate(name="Glue", quantity=0, low_stock_threshold=0))
    i2 = repo.create_item(ItemCreate(name="Screws", quantity=5, low_stock_threshold=2))
    i3 = repo.create_item(ItemCreate(name="Hammer"))

    cnt = repo.get_counts()
    assert cnt["items_total"] == TOTAL_ITEMS
    assert cnt["low_stock_count"] == INITIAL_LOW_STOCK_COUNT
    assert cnt["checked_out_count"] == 0

    # Adjust quantity to enter low-stock for i2
    repo.set_quantity(i2.id, 2)
    cnt2 = repo.get_counts()
    assert cnt2["low_stock_count"] == LOW_STOCK_AFTER_ADJUST

    # Check-out and check-in
    repo.check_out(i3.id, due_date="2024-01-02")
    assert repo.get_counts()["checked_out_count"] == 1
    repo.check_in(i3.id)
    assert repo.get_counts()["checked_out_count"] == 0


@pytest.mark.asyncio
async def test_generation_counter_on_item_operations() -> None:
    """Generation counter increments on every item state modification."""
    repo = Repository()
    initial_gen = repo.generation

    # Create item increments generation
    item = repo.create_item(ItemCreate(name="Test Item", quantity=10))
    assert repo.generation == initial_gen + 1

    # Update item increments generation
    repo.update_item(item.id, ItemUpdate(quantity=20))
    gen_after_update = repo.generation
    assert gen_after_update > initial_gen + 1

    # Adjust quantity increments generation
    repo.adjust_quantity(item.id, delta=5)
    gen_after_adjust = repo.generation
    assert gen_after_adjust > gen_after_update

    # Set quantity increments generation
    repo.set_quantity(item.id, quantity=30)
    gen_after_set = repo.generation
    assert gen_after_set > gen_after_adjust

    # Check out increments generation
    repo.check_out(item.id, due_date="2025-12-31")
    gen_after_checkout = repo.generation
    assert gen_after_checkout > gen_after_set

    # Check in increments generation
    repo.check_in(item.id)
    gen_after_checkin = repo.generation
    assert gen_after_checkin > gen_after_checkout

    # Delete item increments generation
    repo.delete_item(item.id)
    assert repo.generation > gen_after_checkin


@pytest.mark.asyncio
async def test_generation_counter_on_location_operations() -> None:
    """Generation counter increments on every location state modification."""
    repo = Repository()
    initial_gen = repo.generation

    # Create location increments generation
    loc1 = repo.create_location(name="Workshop")
    assert repo.generation == initial_gen + 1

    # Create child location increments generation
    loc2 = repo.create_location(name="Shelf A", parent_id=loc1.id)
    assert repo.generation == initial_gen + 2

    # Update location name increments generation (no reindexing, just one increment)
    repo.update_location(loc2.id, name="Shelf A Updated")
    gen_after_update = repo.generation
    assert gen_after_update > initial_gen + 2

    # Move location increments generation
    repo.update_location(loc2.id, new_parent_id=None)
    gen_after_move = repo.generation
    assert gen_after_move > gen_after_update

    # Delete location increments generation
    repo.delete_location(loc2.id)
    gen_after_delete1 = repo.generation
    assert gen_after_delete1 > gen_after_move

    repo.delete_location(loc1.id)
    assert repo.generation > gen_after_delete1


@pytest.mark.asyncio
async def test_generation_property_accessor() -> None:
    """Generation property provides read-only access to counter."""
    repo = Repository()

    # Initial generation
    gen1 = repo.generation
    assert isinstance(gen1, int)
    assert gen1 >= 0

    # After modification
    repo.create_item(ItemCreate(name="Item"))
    gen2 = repo.generation
    assert gen2 == gen1 + 1

    # Property is read-only (no setter)
    with pytest.raises(AttributeError):
        repo.generation = 999  # type: ignore[misc]


@pytest.mark.asyncio
async def test_generation_export_and_load_roundtrip() -> None:
    """Generation counter persists across export/load cycles."""
    repo = Repository()

    # Create some data
    item1 = repo.create_item(ItemCreate(name="Item 1"))
    item2 = repo.create_item(ItemCreate(name="Item 2"))
    loc = repo.create_location(name="Location")

    generation_before = repo.generation
    assert generation_before > 0

    # Export state
    state = repo.export_state()
    assert "_generation" in state
    assert state["_generation"] == generation_before

    # Create new repo and load state
    new_repo = Repository.from_state(state)

    # Generation should be restored and incremented during load
    # (load calls _index_item/_add_location for each entity, incrementing generation)
    assert new_repo.generation > generation_before

    # Verify data integrity
    assert len(new_repo.list_items()["items"]) == LOADED_ITEM_COUNT
    assert new_repo.get_item(item1.id).name == "Item 1"
    assert new_repo.get_item(item2.id).name == "Item 2"
    assert new_repo.get_location(loc.id).name == "Location"


@pytest.mark.asyncio
async def test_generation_load_state_without_generation() -> None:
    """Loading state without _generation field initializes to 0."""
    repo = Repository()

    # Create state without _generation field (legacy data)
    state = {
        "items": {},
        "locations": {},
    }

    repo.load_state(state)

    # Should initialize to 0, then increment for load
    assert repo.generation == 1


@pytest.mark.asyncio
async def test_inspection_date_persists_across_create_update_get() -> None:
    """inspection_date field persists correctly through CRUD operations."""
    repo = Repository()

    # Create item with inspection_date
    item = repo.create_item(ItemCreate(name="Fire Extinguisher", inspection_date="2024-06-15"))
    assert item.inspection_date == "2024-06-15"

    # Get item and verify inspection_date
    fetched = repo.get_item(item.id)
    assert fetched.inspection_date == "2024-06-15"

    # Update inspection_date
    updated = repo.update_item(item.id, ItemUpdate(inspection_date="2024-12-31"))
    assert updated.inspection_date == "2024-12-31"

    # Get again to verify persistence
    fetched_again = repo.get_item(item.id)
    assert fetched_again.inspection_date == "2024-12-31"

    # Clear inspection_date
    cleared = repo.update_item(item.id, ItemUpdate(inspection_date=None))
    assert cleared.inspection_date is None

    # Export and reload state to verify serialization
    state = repo.export_state()
    new_repo = Repository.from_state(state)
    reloaded = new_repo.get_item(item.id)
    assert reloaded.inspection_date is None


@pytest.mark.asyncio
async def test_list_items_total_counts_all_matches() -> None:
    """`total` reflects all filtered matches, independent of pagination."""

    repo = Repository()
    seeded = 5
    tools = 2
    for i in range(seeded):
        repo.create_item(ItemCreate(name=f"Widget {i}", category="tools" if i < tools else "misc"))

    # Unpaginated: total equals the number of items returned
    out = repo.list_items()
    assert out["total"] == seeded
    assert len(out["items"]) == seeded

    # Paginated: every page reports the full total, not the page size
    page_limit = 2
    page1 = repo.list_items(limit=page_limit)
    assert page1["total"] == seeded
    assert len(page1["items"]) == page_limit
    page2 = repo.list_items(limit=page_limit, cursor=page1["next_cursor"])
    assert page2["total"] == seeded

    # Filtered: total counts only matches
    filtered = repo.list_items(flt=ItemFilter(category="tools"), limit=1)
    assert filtered["total"] == tools
    assert len(filtered["items"]) == 1

    # No matches: empty page, zero total
    none = repo.list_items(flt=ItemFilter(q="zzz-not-there"))
    assert none["total"] == 0
    assert none["items"] == []


# -----------------------------
# Malformed cursors
# -----------------------------


@pytest.mark.parametrize(
    "bad_cursor",
    [
        "garbage",
        base64.urlsafe_b64encode(b"not json at all").decode("ascii"),
        base64.urlsafe_b64encode(b'["a list", "not an object"]').decode("ascii"),
        base64.urlsafe_b64encode(b'{"sort": {"field": "name", "order": "asc"}}').decode("ascii"),
        "A" * (CURSOR_MAX_LENGTH + 1),
    ],
)
def test_a_malformed_cursor_raises_rather_than_returning_page_one(bad_cursor: str) -> None:
    """The footgun this closes: an unreadable cursor answered with a full page.

    A caller paging through the inventory would loop over page one forever and
    never be told the cursor stopped being understood.
    """

    repo = Repository()
    for i in range(5):
        repo.create_item(ItemCreate(name=f"Item {i}"))

    with pytest.raises(ValidationError):
        repo.list_items(limit=2, cursor=bad_cursor)


def test_a_cursor_minted_under_another_sort_raises() -> None:
    repo = Repository()
    for i in range(5):
        repo.create_item(ItemCreate(name=f"Item {i}"))

    page1 = repo.list_items(sort=Sort(field="name", order="asc"), limit=2)
    assert isinstance(page1["next_cursor"], str)

    with pytest.raises(ValidationError):
        repo.list_items(
            sort=Sort(field="quantity", order="asc"), limit=2, cursor=page1["next_cursor"]
        )


def test_a_valid_cursor_still_pages_to_the_end() -> None:
    """The regression that matters: hardening did not break the round trip."""

    repo = Repository()
    for i in range(5):
        repo.create_item(ItemCreate(name=f"Item {i}"))

    sort = Sort(field="name", order="asc")
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        page = repo.list_items(sort=sort, limit=2, cursor=cursor)
        seen.extend(it.name for it in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert seen == [f"Item {i}" for i in range(5)]
    assert cursor is None


def test_distinct_values_priced_against_a_filter_folds_case_variants() -> None:
    """One entry per casefolded category, and its matching_count is that group's."""

    repo = Repository()
    repo.create_item(ItemCreate(name="A", category="Books", quantity=0, low_stock_threshold=1))
    repo.create_item(ItemCreate(name="B", category="books", quantity=5))
    repo.create_item(ItemCreate(name="C", category="Books", quantity=5))

    result = repo.get_distinct_field_values(ItemFilter(low_stock_only=True))
    categories = result["categories"]
    assert isinstance(categories, list)

    assert len(categories) == 1
    entry = categories[0]
    # The representative label is still the most frequent original casing.
    assert entry["value"] == "Books"
    assert entry["count"] == BOOKS_TOTAL
    assert entry["matching_count"] == 1


def test_distinct_values_counts_an_excluded_item_towards_count_only() -> None:
    """An item whose value matches but which the filter drops moves only `count`."""

    repo = Repository()
    repo.create_item(ItemCreate(name="Kept", category="Tools", tags=["red"], checked_out=True))
    repo.create_item(ItemCreate(name="Dropped", category="Tools", tags=["red"]))

    result = repo.get_distinct_field_values(ItemFilter(checked_out=True))
    categories = result["categories"]
    tags = result["tags"]
    assert isinstance(categories, list)
    assert isinstance(tags, list)

    assert categories == [{"value": "Tools", "count": 2, "matching_count": 1}]
    assert tags == [{"value": "red", "count": 2, "matching_count": 1}]

    # Without a filter the key is absent rather than equal to `count`, so a
    # client can tell "unpriced" from "everything matches".
    unfiltered = repo.get_distinct_field_values()
    assert unfiltered["categories"] == [{"value": "Tools", "count": 2}]
