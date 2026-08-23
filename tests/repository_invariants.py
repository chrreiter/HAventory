"""Consistency checks over a loaded repository, run as the suite's oracle.

Every check compares the repository's indexes against the entities they index:
an item that says it is checked out has to be in the checked-out set, a location
bucket has to hold exactly the items pointing at it, and the counts served to
clients have to agree with the collections they summarise. Drift here is a bug
in the repository, not in the data, which is why the issue strings are symbol-
like names rather than sentences — they name the invariant that broke.

That is also why the checks live here and not in the integration. Nothing a
household can do produces a hit, so ``haventory/health`` answered with an empty
list on every install that ever ran it; what the checks are worth is the
guarantee they give a refactor of ``repository.py``. ``conftest.py`` runs them
after every test, against every repository the test built, so an index left
disagreeing with the entities it indexes fails the test that touched it.

Reaching into the private index attributes is the point here: they are the
subject. A test that needs one of them for its own assertions asks
``internal_indexes`` rather than growing a second reach-in.
"""

from __future__ import annotations

from typing import TypedDict

from custom_components.haventory.models import DEFAULT_ITEM_STATUS, Item, Location
from custom_components.haventory.repository import Repository


class InternalIndexes(TypedDict):
    """Live references to the repository's internal indexes."""

    items_by_id: dict[str, Item]
    locations_by_id: dict[str, Location]
    tags_to_item_ids: dict[str, set[str]]
    category_to_item_ids: dict[str, set[str]]
    status_to_item_ids: dict[str, set[str]]
    checked_out_item_ids: set[str]
    low_stock_item_ids: set[str]
    items_by_location_id: dict[str, set[str]]
    locations_by_area_id: dict[str, set[str]]
    items_by_area_id: dict[str, set[str]]


def internal_indexes(repo: Repository) -> InternalIndexes:
    """The live index objects, not copies: a check reads what the repository uses."""

    return {
        "items_by_id": repo._items_by_id,
        "locations_by_id": repo._locations_by_id,
        "tags_to_item_ids": repo._tags_to_item_ids,
        "category_to_item_ids": repo._category_to_item_ids,
        "status_to_item_ids": repo._status_to_item_ids,
        "checked_out_item_ids": repo._checked_out_item_ids,
        "low_stock_item_ids": repo._low_stock_item_ids,
        "items_by_location_id": repo._items_by_location_id,
        "locations_by_area_id": repo._locations_by_area_id,
        "items_by_area_id": repo._items_by_area_id,
    }


def _collect_item_status_issues(
    item_id: str, item: Item, status_to_item_ids: dict[str, set[str]]
) -> list[str]:
    """Check the item's membership in the status index against its status.

    Only non-default statuses are bucketed, so a default-status item found in
    any bucket is drift just as much as a flagged item missing from its own.
    """

    issues: list[str] = []
    status = str(getattr(item, "status", DEFAULT_ITEM_STATUS))
    if status != DEFAULT_ITEM_STATUS:
        if item_id not in status_to_item_ids.get(status, set()):
            issues.append("status_item_missing_from_index")
    elif any(item_id in ids for ids in status_to_item_ids.values()):
        issues.append("default_status_item_present_in_index")
    return issues


def _collect_item_issues(item_id: str, item: Item, idx: InternalIndexes) -> list[str]:
    issues: list[str] = []
    items_by_location_id = idx["items_by_location_id"]
    locations_by_id = idx["locations_by_id"]
    checked_out_item_ids = idx["checked_out_item_ids"]
    low_stock_item_ids = idx["low_stock_item_ids"]
    status_to_item_ids = idx["status_to_item_ids"]

    # Normalize types for comparison (UUID vs string)
    if str(getattr(item, "id", "")) != item_id:
        issues.append("item_id_key_mismatch")

    loc_id = getattr(item, "location_id", None)
    loc_key = str(loc_id) if loc_id is not None else None
    if loc_key is not None and loc_key not in locations_by_id:
        issues.append("item_references_missing_location")

    if loc_key is not None:
        bucket_ids = items_by_location_id.get(loc_key, set())
        if item_id not in bucket_ids:
            issues.append("item_missing_from_items_by_location_index")

    if bool(getattr(item, "checked_out", False)):
        if item_id not in checked_out_item_ids:
            issues.append("checked_out_item_missing_from_index")
    elif item_id in checked_out_item_ids:
        issues.append("non_checked_out_item_present_in_index")

    issues.extend(_collect_item_status_issues(item_id, item, status_to_item_ids))

    thr = getattr(item, "low_stock_threshold", None)
    is_low = False
    try:
        is_low = thr is not None and int(getattr(item, "quantity", 0)) <= int(thr)
    except TypeError, ValueError:  # pragma: no cover - defensive
        is_low = False
    if is_low:
        if item_id not in low_stock_item_ids:
            issues.append("low_stock_item_missing_from_index")
    elif item_id in low_stock_item_ids:
        issues.append("non_low_stock_item_present_in_index")
    return issues


def _check_items_consistency(idx: InternalIndexes) -> list[str]:
    issues: list[str] = []
    items_by_id = idx["items_by_id"]
    for item_id, item in items_by_id.items():
        issues.extend(_collect_item_issues(item_id, item, idx))
    return issues


def _check_index_references(idx: InternalIndexes) -> list[str]:
    issues: list[str] = []
    items_by_id = idx["items_by_id"]
    tags_to_item_ids = idx["tags_to_item_ids"]
    category_to_item_ids = idx["category_to_item_ids"]
    checked_out_item_ids = idx["checked_out_item_ids"]
    low_stock_item_ids = idx["low_stock_item_ids"]
    items_by_location_id = idx["items_by_location_id"]
    locations_by_id = idx["locations_by_id"]

    def _assert_known_ids(name: str, ids: set[str]) -> None:
        unknown = [x for x in ids if x not in items_by_id]
        if unknown:
            issues.append(f"{name}_references_unknown_item_ids")

    for _tag, ids in list(tags_to_item_ids.items()):
        _assert_known_ids("tags_index", set(ids))
    for _cat, ids in list(category_to_item_ids.items()):
        _assert_known_ids("category_index", set(ids))
    for _status, ids in list(idx["status_to_item_ids"].items()):
        _assert_known_ids("status_index", set(ids))

    _assert_known_ids("checked_out_index", set(checked_out_item_ids))
    _assert_known_ids("low_stock_index", set(low_stock_item_ids))

    for loc_id, ids in list(items_by_location_id.items()):
        if loc_id is not None and loc_id not in locations_by_id:
            issues.append("items_by_location_references_missing_location")
        _assert_known_ids("items_by_location_index", set(ids))
        for iid in list(ids):
            item = items_by_id.get(iid)
            if item is not None and (
                (
                    str(getattr(item, "location_id", None))
                    if getattr(item, "location_id", None) is not None
                    else None
                )
                != loc_id
            ):
                issues.append("items_by_location_bucket_mismatch")

    return issues


def _check_locations_consistency(*, locations_by_id: dict[str, Location]) -> list[str]:
    issues: list[str] = []
    for loc_id, loc in locations_by_id.items():
        # Normalize types for comparison (UUID vs string)
        if str(getattr(loc, "id", "")) != loc_id:
            issues.append("location_id_key_mismatch")
    return issues


def collect_index_issues(repo: Repository) -> list[str]:
    """Return the repository's consistency issues; an empty list is what healthy means.

    The counts are compared here rather than anywhere else because they are
    served straight to clients: a number that has drifted from the collection it
    summarises is the same class of bug as a bucket that has.
    """

    idx = internal_indexes(repo)
    issues: list[str] = []
    issues.extend(_check_items_consistency(idx))
    issues.extend(_check_index_references(idx))
    issues.extend(_check_locations_consistency(locations_by_id=idx["locations_by_id"]))

    counts = repo.get_counts()
    if counts.get("items_total") != len(idx["items_by_id"]):
        issues.append("items_total_count_mismatch")
    if counts.get("locations_total") != len(idx["locations_by_id"]):
        issues.append("locations_total_count_mismatch")
    if counts.get("checked_out_count") != len(idx["checked_out_item_ids"]):
        issues.append("checked_out_count_mismatch")
    if counts.get("low_stock_count") != len(idx["low_stock_item_ids"]):
        issues.append("low_stock_count_mismatch")
    return issues
