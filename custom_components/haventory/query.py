"""Item queries: the filter and sort inputs, their validation, and the engines.

``filter_items`` ignores a key it does not know, so ``validate_item_filter`` at
the boundary is what stops a typo from answering the whole inventory.
``SORT_FIELDS`` is read off ``Sort``, and ``sort_value`` is shared by
``sort_items`` and the pagination cursors, so the two cannot order a page
differently.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Collection, Iterable, Sequence
from functools import partial
from typing import Any, Final, Literal, TypedDict, get_args, get_type_hints

from .exceptions import ValidationError
from .models import (
    ITEM_STATUSES,
    Item,
    ItemStatus,
    LocationPath,
    validate_item_status,
)
from .text import normalize_text_for_sort
from .timestamps import is_canonical_utc_timestamp, today_local_date
from .validation import normalize_string_list, parse_uuid4


class ItemFilter(TypedDict, total=False):
    """Filter options for querying items."""

    q: str
    tags_any: list[str]
    tags_all: list[str]
    category: str
    # Unioned with `category`: an item has one category, so a selection is OR.
    categories: list[str]
    status: ItemStatus
    checked_out: bool
    low_stock_only: bool
    # Orders low-stock items first rather than filtering.
    low_stock_first: bool
    orphaned_only: bool
    # `*overdue*` excludes today; `*_due_only` includes it. See `_DATE_FILTERS`.
    overdue_only: bool
    checked_out_due_only: bool
    inspection_overdue_only: bool
    inspection_due_only: bool
    reminder_due_only: bool
    location_id: str | None
    # Unioned with `location_id`; `include_subtree` governs the whole selection.
    location_ids: list[str]
    # `None` means no area filter, as omitting the key does.
    area_id: str | None
    include_subtree: bool
    updated_after: str
    created_after: str
    updated_before: str
    created_before: str


class Sort(TypedDict):
    """Sort definition for item queries."""

    field: Literal[
        "updated_at",
        "created_at",
        "name",
        "quantity",
        "due_date",
        "inspection_date",
        "reminder_date",
        # The denormalized location path.
        "location",
    ]
    order: Literal["asc", "desc"]


ITEM_FILTER_KEYS: Final[frozenset[str]] = frozenset(ItemFilter.__annotations__)


def selected_categories(flt: ItemFilter) -> list[str]:
    """The casefolded categories a filter selects, scalar and list unioned."""

    selection: list[str] = []
    scalar = (flt.get("category") or "").strip().casefold() if "category" in flt else ""
    if scalar:
        selection.append(scalar)
    for value in normalize_string_list(
        flt.get("categories"), field_name="categories", casefold=True
    ):
        if value not in selection:
            selection.append(value)
    return selection


def selected_tags(flt: ItemFilter, key: Literal["tags_any", "tags_all"]) -> list[str]:
    """The casefolded tags one of a filter's two tag keys names."""

    return normalize_string_list(flt.get(key), field_name=key, casefold=True)


def selected_location_ids(flt: ItemFilter) -> list[str]:
    """The location ids a filter selects, scalar and list unioned."""

    selection: list[str] = []
    scalar = flt.get("location_id") if "location_id" in flt else None
    if scalar is not None:
        selection.append(str(scalar).strip())
    for value in normalize_string_list(flt.get("location_ids"), field_name="location_ids"):
        if value not in selection:
            selection.append(value)
    return selection


_SORT_HINTS: Final[dict[str, Any]] = get_type_hints(Sort)
SORT_FIELDS: Final[frozenset[str]] = frozenset(get_args(_SORT_HINTS["field"]))
SORT_ORDERS: Final[frozenset[str]] = frozenset(get_args(_SORT_HINTS["order"]))
SORT_KEYS: Final[frozenset[str]] = frozenset(_SORT_HINTS)


def validate_area_filter(value: object) -> str | None:
    """Return the area an ``area_id`` filter selects, or ``None`` for no filter.

    A blank string is refused rather than trimmed away: only the area index
    applies an area, so a value naming no bucket would answer the whole
    inventory.
    """

    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValidationError("area_id must be a non-empty string or null")
    return value.strip()


def validate_item_filter(flt: object) -> None:
    """Reject a filter object carrying unknown keys or an unusable ``area_id``.

    :func:`filter_items` ignores an unknown key, so a typo would otherwise
    answer the whole inventory as a filtered result.
    """

    if flt is None:
        return
    if not isinstance(flt, dict):
        raise ValidationError("filter must be an object")
    unknown = sorted(str(key) for key in flt if key not in ITEM_FILTER_KEYS)
    if unknown:
        raise ValidationError(f"unknown filter key(s): {', '.join(unknown)}")
    if "area_id" in flt:
        validate_area_filter(flt["area_id"])


def validate_sort(sort: object) -> None:
    """Reject a sort object carrying unknown keys, fields or orders."""

    if sort is None:
        return
    if not isinstance(sort, dict):
        raise ValidationError("sort must be an object")
    unknown = sorted(str(key) for key in sort if key not in SORT_KEYS)
    if unknown:
        raise ValidationError(f"unknown sort key(s): {', '.join(unknown)}")
    if sort.get("field") not in SORT_FIELDS:
        raise ValidationError(f"sort.field must be one of: {', '.join(sorted(SORT_FIELDS))}")
    if sort.get("order") not in SORT_ORDERS:
        raise ValidationError("sort.order must be 'asc' or 'desc'")


def _item_matches_q(item: Item, query_words: Sequence[str]) -> bool:
    """Every query word appears somewhere in the item's searchable text."""

    text = normalize_text_for_sort(
        " ".join(
            [
                item.name or "",
                item.description or "",
                item.category or "",
                item.location_path.display_path or "",
                " ".join(item.tags),
            ]
        )
    )
    return all(word in text for word in query_words)


def item_is_low_stock(item: Item) -> bool:
    thr = item.low_stock_threshold
    return thr is not None and item.quantity <= thr


def _date_passed(item: Item, field: str, today: str, *, inclusive: bool) -> bool:
    """Whether the item's ``field`` date has come round by ``today``.

    An item with no date on that field never counts. An empty ``today`` reads
    the clock, and only for an item that has a date.
    """

    value: str | None = getattr(item, field)
    if not value:
        return False
    day = today or today_local_date()
    return value <= day if inclusive else value < day


def item_is_overdue(item: Item, *, today: str = "") -> bool:
    return _date_passed(item, "due_date", today, inclusive=False)


def item_is_due(item: Item, *, today: str = "") -> bool:
    return _date_passed(item, "due_date", today, inclusive=True)


def item_inspection_is_overdue(item: Item, *, today: str = "") -> bool:
    return _date_passed(item, "inspection_date", today, inclusive=False)


def item_inspection_is_due(item: Item, *, today: str = "") -> bool:
    return _date_passed(item, "inspection_date", today, inclusive=True)


def item_reminder_is_due(item: Item, *, today: str = "") -> bool:
    return _date_passed(item, "reminder_date", today, inclusive=True)


def _parse_location_selection(location_ids: Sequence[str]) -> list[uuid.UUID]:
    """The selected location ids as UUIDs, dropping any that will not parse."""

    parsed: list[uuid.UUID] = []
    for raw in location_ids:
        try:
            parsed.append(parse_uuid4(raw, field_name="filter.location_id"))
        except ValidationError:
            continue
    return parsed


def _item_matches_locations(
    item: Item, needles: Sequence[uuid.UUID], include_subtree: bool
) -> bool:
    """True when the item sits in, or with ``include_subtree`` under, a selected location."""

    if not item.location_id:
        return False
    return any(
        item.location_id == needle or (include_subtree and needle in item.location_path.id_path)
        for needle in needles
    )


#: Spelled out so a table entry is checked against the ``ItemFilter`` keys.
DateFilterKey = Literal[
    "overdue_only",
    "checked_out_due_only",
    "inspection_overdue_only",
    "inspection_due_only",
    "reminder_due_only",
]
TimestampBoundKey = Literal["updated_after", "created_after", "updated_before", "created_before"]

#: Each date filter, the field it reads, and whether today itself counts.
_DATE_FILTERS: Final[tuple[tuple[DateFilterKey, str, bool], ...]] = (
    ("overdue_only", "due_date", False),
    ("checked_out_due_only", "due_date", True),
    ("inspection_overdue_only", "inspection_date", False),
    ("inspection_due_only", "inspection_date", True),
    ("reminder_due_only", "reminder_date", True),
)

#: Each timestamp bound, the field it reads, and whether an item must fall after it.
_TIMESTAMP_BOUNDS: Final[tuple[tuple[TimestampBoundKey, str, bool], ...]] = (
    ("updated_after", "updated_at", True),
    ("created_after", "created_at", True),
    ("updated_before", "updated_at", False),
    ("created_before", "created_at", False),
)


def _beyond_bound(item: Item, *, field: str, bound: str, after: bool) -> bool:
    value: str = getattr(item, field)
    return value > bound if after else value < bound


def _filter_predicates(  # noqa: PLR0912 - one branch per filter key
    flt: ItemFilter, *, known_statuses: Collection[str]
) -> list[Callable[[Item], bool]]:
    """The tests a filter asks for, one per key it carries.

    Built once per query, so each key is parsed once and a malformed value
    raises before any item is walked. ``q`` goes last as the costliest test.
    """

    predicates: list[Callable[[Item], bool]] = []

    q = (flt.get("q") or "").strip()
    tags_any = selected_tags(flt, "tags_any")
    if tags_any:
        predicates.append(lambda item: any(tag in item.tags for tag in tags_any))
    tags_all = selected_tags(flt, "tags_all")
    if tags_all:
        predicates.append(lambda item: all(tag in item.tags for tag in tags_all))
    categories = set(selected_categories(flt))
    if categories:
        predicates.append(lambda item: (item.category or "").strip().casefold() in categories)
    if "status" in flt:
        status = validate_item_status(flt["status"], known_statuses=known_statuses)
        predicates.append(lambda item: item.status == status)
    checked_out = flt.get("checked_out")
    if checked_out is not None:
        wanted = bool(checked_out)
        predicates.append(lambda item: item.checked_out == wanted)
    if flt.get("low_stock_only"):
        predicates.append(item_is_low_stock)
    if flt.get("orphaned_only"):
        predicates.append(lambda item: item.location_id is None)

    dated = [(attr, inclusive) for key, attr, inclusive in _DATE_FILTERS if flt.get(key)]
    if dated:
        today = today_local_date()
        predicates.extend(
            partial(_date_passed, field=attr, today=today, inclusive=inclusive)
            for attr, inclusive in dated
        )

    location_ids = selected_location_ids(flt)
    if location_ids:
        needles = _parse_location_selection(location_ids)
        include_subtree = bool(flt.get("include_subtree"))
        predicates.append(lambda item: _item_matches_locations(item, needles, include_subtree))

    # An empty bound is compared rather than parsed: `updated_before: ""` keeps nothing.
    for key, attr, after in _TIMESTAMP_BOUNDS:
        bound = flt.get(key)
        if bound is None:
            continue
        if bound and not is_canonical_utc_timestamp(bound):
            raise ValidationError(f"{key} must be an ISO-8601 UTC timestamp with 'Z'")
        predicates.append(partial(_beyond_bound, field=attr, bound=bound, after=after))

    query_words = normalize_text_for_sort(q).split()
    if query_words:
        predicates.append(partial(_item_matches_q, query_words=query_words))
    return predicates


def filter_items(
    items: Iterable[Item],
    flt: ItemFilter | None = None,
    *,
    known_statuses: Collection[str] = ITEM_STATUSES,
) -> list[Item]:
    """Keep the items every key of ``flt`` accepts; see :class:`ItemFilter`."""

    if not flt:
        return list(items)
    predicates = _filter_predicates(flt, known_statuses=known_statuses)
    return [item for item in items if all(passes(item) for passes in predicates)]


#: What an unlocated item sorts under ascending. A location sort key is built
#: from names, and an accented or non-Latin name can fold above any printable
#: sentinel; the highest code point cannot be outranked.
UNLOCATED_SORT_KEY: Final[str] = "\U0010ffff"


def location_sort_key(path: LocationPath, order: str) -> str:
    """Sort key for a location path; unlocated items sort last in both orders."""

    if not path.sort_key:
        return UNLOCATED_SORT_KEY if order == "asc" else ""
    return path.sort_key


def date_sort_key(value: str | None, order: str) -> str:
    """Sort key for a nullable date; undated items sort last in both orders."""

    if value is None:
        return "~" if order == "asc" else ""
    return value


DEFAULT_SORT: Final[Sort] = Sort(field="updated_at", order="desc")


def sort_value(item: Item, sort: Sort) -> str | int:
    """The key an item sorts under, shared by ``sort_items`` and the cursors."""

    field, order = sort.get("field"), sort.get("order")
    if field == "name":
        return normalize_text_for_sort(item.name)
    if field == "quantity":
        return int(item.quantity)
    if field in ("due_date", "inspection_date", "reminder_date"):
        return date_sort_key(getattr(item, field), order)
    if field == "location":
        return location_sort_key(item.location_path, order)
    return item.created_at if field == "created_at" else item.updated_at


def sort_items(items: Iterable[Item], sort: Sort | None = None) -> list[Item]:
    """Sort by ``sort`` (default updated_at desc), ties broken by id ascending.

    Does not validate: :func:`validate_sort` refuses an unknown field at the
    boundary, and one reaching here sorts as updated_at.
    """

    result = sorted(items, key=lambda x: str(x.id))
    if sort is None:
        sort = DEFAULT_SORT
    result.sort(key=lambda x: sort_value(x, sort), reverse=sort.get("order") == "desc")
    return result
