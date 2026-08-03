"""Typed models and validation helpers for HAventory.

This module defines the persisted shapes for Item and Location, along with
lightweight input schemas for create/update/filter/sort operations. It also
provides validation and normalization helpers to enforce invariants and produce
denormalized location paths.

The intent is to keep these models framework-agnostic and free of I/O. Higher
layers (WebSocket/API, storage) are expected to compose these helpers.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Final, Literal, NotRequired, TypedDict

from .exceptions import ValidationError

# Scalar values allowed inside custom_fields.
ScalarValue = str | int | float | bool

# Stored per-item condition. Every item carries exactly one; "ok" is the
# default, so a payload written before the field existed reads as "ok".
ItemStatus = Literal["ok", "missing", "needs_repair"]
ITEM_STATUSES: Final[tuple[ItemStatus, ...]] = ("ok", "missing", "needs_repair")
DEFAULT_ITEM_STATUS: Final[ItemStatus] = "ok"


@dataclass(frozen=True)
class LocationPath:
    """Denormalized path data for a location or item.

    Attributes:
        id_path: Ordered list of UUID v4 strings from root to leaf.
        name_path: Ordered list of names from root to leaf.
        display_path: Human-readable path (e.g., "Garage / Shelf A / Bin 3").
        sort_key: Case-insensitive key suitable for lexicographic sorting.
    """

    id_path: list[uuid.UUID]
    name_path: list[str]
    display_path: str
    sort_key: str


EMPTY_LOCATION_PATH = LocationPath(id_path=[], name_path=[], display_path="", sort_key="")


NAME_MAX_LENGTH = 120
LOCATION_GUARD_MAX_STEPS = 10_000


@dataclass
class Location:
    """Persisted shape for a location node."""

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    area_id: str | None = None
    path: LocationPath = field(default_factory=lambda: EMPTY_LOCATION_PATH)


@dataclass
class Item:
    """Persisted shape for an inventory item."""

    id: uuid.UUID
    name: str
    description: str | None = None
    quantity: int = 1
    status: ItemStatus = DEFAULT_ITEM_STATUS
    checked_out: bool = False
    due_date: str | None = None  # YYYY-MM-DD
    # When the item is next due for inspection — a forward-looking date, so a
    # value before today means the inspection is outstanding.
    inspection_date: str | None = None  # YYYY-MM-DD
    location_id: uuid.UUID | None = None
    tags: list[str] = field(default_factory=list)
    category: str | None = None
    low_stock_threshold: int | None = None
    custom_fields: dict[str, ScalarValue] = field(default_factory=dict)
    # `iso_utc_now` is defined later in this module, so the lambda is required to
    # defer name resolution to instance-creation time (PLW0108 false positive).
    created_at: str = field(default_factory=lambda: iso_utc_now())  # noqa: PLW0108
    updated_at: str = field(default_factory=lambda: iso_utc_now())  # noqa: PLW0108
    version: int = 1
    location_path: LocationPath = field(default_factory=lambda: EMPTY_LOCATION_PATH)


class ItemCreate(TypedDict, total=False):
    """Creation input for Item. Only 'name' is required."""

    name: str
    description: str | None
    quantity: int
    status: ItemStatus
    checked_out: bool
    due_date: str | None
    inspection_date: str | None
    location_id: str | None
    tags: list[str]
    category: str | None
    low_stock_threshold: int | None
    custom_fields: dict[str, ScalarValue]


class ItemUpdate(TypedDict, total=False):
    """Update input for Item. All fields are optional; None clears nullable fields."""

    name: str
    description: str | None
    quantity: int
    status: ItemStatus
    checked_out: bool
    due_date: str | None
    inspection_date: str | None
    location_id: str | None
    tags: list[str] | None
    category: str | None
    low_stock_threshold: int | None
    custom_fields_set: NotRequired[dict[str, ScalarValue]]
    custom_fields_unset: NotRequired[list[str]]


class ItemFilter(TypedDict, total=False):
    """Filter options for querying items."""

    q: str
    tags_any: list[str]
    tags_all: list[str]
    category: str
    status: ItemStatus
    checked_out: bool
    low_stock_only: bool
    # When true, do not filter; instead, prefer low-stock items first in ordering
    low_stock_first: bool
    # When true, only items without a location (location_id is None)
    orphaned_only: bool
    # When true, only items whose due_date has passed (see filter_items)
    overdue_only: bool
    # When true, only items whose inspection_date has passed (see filter_items)
    inspection_overdue_only: bool
    location_id: str | None
    area_id: str
    include_subtree: bool
    updated_after: str
    created_after: str
    updated_before: str
    created_before: str


class Sort(TypedDict):
    """Sort definition for item queries."""

    field: Literal["updated_at", "created_at", "name", "quantity", "due_date", "inspection_date"]
    order: Literal["asc", "desc"]


# -----------------------------
# Utility helpers
# -----------------------------


def parse_uuid4(value: str | uuid.UUID, *, field_name: str = "id") -> uuid.UUID:
    """Parse a UUID value and ensure it is version 4.

    Accepts an existing uuid.UUID and returns it unchanged.
    Raises ValidationError when parsing fails or version is not 4.
    """

    UUID_VERSION_V4: Final[int] = 4
    if isinstance(value, uuid.UUID):
        if value.version != UUID_VERSION_V4:
            raise ValidationError(f"{field_name} must be a UUID v4")
        return value
    if not isinstance(value, str):
        raise ValidationError(f"{field_name} must be a UUID v4 string")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:  # pragma: no cover - specific parsing failure
        raise ValidationError(f"{field_name} must be a UUID v4 string") from exc
    if parsed.version != UUID_VERSION_V4:
        raise ValidationError(f"{field_name} must be a UUID v4")
    return parsed


def iso_utc_now() -> str:
    """Return ISO-8601 UTC timestamp string with 'Z'."""

    now = datetime.now(tz=UTC)
    # No microseconds to keep it compact and stable
    return now.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_uuid4() -> uuid.UUID:
    """Generate a UUID v4 object."""

    return uuid.uuid4()


def new_uuid4_str() -> str:
    """Generate a hyphenated UUID v4 string."""

    return str(new_uuid4())


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_date_yyyy_mm_dd(value: str) -> str:
    """Validate and normalize a YYYY-MM-DD date string.

    Returns the normalized value or raises ValidationError.
    """

    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ValidationError("due_date must be in 'YYYY-MM-DD' format")
    try:
        # This ensures the date components are valid (e.g., no Feb 30)
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValidationError("due_date must be a valid calendar date (YYYY-MM-DD)") from exc
    return value


def normalize_text_for_sort(text: str) -> str:
    """Return a case-insensitive, accent-folded string for lexicographic sorting."""

    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_text = nfkd.encode("ascii", "ignore").decode("ascii")
    collapsed = " ".join(ascii_text.split())
    return collapsed.casefold()


def normalize_search_text(text: str) -> str:
    """Normalize text for search matching (lowercase, strip accents).

    Uses NFKD normalization to separate accents from characters, then keeps only ASCII.
    Shared by the repository search indexes and the post-filter in ``_item_matches_q``
    so both layers agree on what "case-insensitive, accent-insensitive" means.
    """

    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_text = nfkd.encode("ascii", "ignore").decode("ascii")
    return ascii_text.casefold().strip()


def normalize_tags(tags: list[str] | None) -> list[str]:
    """Lowercase, trim, and de-duplicate a list of tags, preserving order."""

    if not tags:
        return []
    seen: set[str] = set()
    result: list[str] = []
    for raw in tags:
        if raw is None:
            continue
        tag = str(raw).strip().casefold()
        if not tag:
            continue
        if tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


def validate_location_name(name: str) -> str:
    """Validate a location name and return a trimmed value.

    Enforces non-empty string and maximum length consistent with item names.
    """

    if not isinstance(name, str):
        raise ValidationError("name is required and must be a non-empty string")
    trimmed = name.strip()
    if len(trimmed) == 0:
        raise ValidationError("name is required and must be a non-empty string")
    if len(trimmed) > NAME_MAX_LENGTH:
        raise ValidationError("name must be at most 120 characters")
    return trimmed


def validate_custom_fields(values: dict[str, ScalarValue]) -> None:
    """Validate custom field keys and values are scalars of allowed types."""

    if not isinstance(values, dict):
        raise ValidationError("custom_fields must be a mapping of string keys to scalars")
    for key, value in values.items():
        if not isinstance(key, str) or not key:
            raise ValidationError("custom_fields keys must be non-empty strings")
        if not isinstance(value, str | int | float | bool):
            raise ValidationError(
                "custom_fields values must be scalar (string, number, or boolean)"
            )


def validate_due_date_rules(*, checked_out: bool, due_date: str | None) -> str | None:
    """Validate due_date invariants against checked_out state.

    - due_date is only valid when checked_out is True
    - If provided, due_date must be YYYY-MM-DD

    Returns normalized due_date or None.
    """

    if due_date is None:
        return None
    if not checked_out:
        raise ValidationError("due_date is only valid when checked_out is true")
    return normalize_date_yyyy_mm_dd(due_date)


def validate_item_status(value: object) -> ItemStatus:
    """Validate an item status and return it.

    Status is non-nullable: an item always has one, so ``None`` is rejected the
    same as any other unknown value ("ok" is the way to clear a flagged state).
    """

    if isinstance(value, str) and value in ITEM_STATUSES:
        return value
    raise ValidationError(f"status must be one of: {', '.join(ITEM_STATUSES)}")


def coerce_item_status(value: object) -> ItemStatus:
    """Return ``value`` when it is a known status, otherwise the default.

    The tolerant twin of :func:`validate_item_status`, for loading persisted
    payloads: a store written before the field existed (or hand-edited into an
    unknown value) reads as "ok" rather than failing the whole item.
    """

    if isinstance(value, str) and value in ITEM_STATUSES:
        return value
    return DEFAULT_ITEM_STATUS


def validate_inspection_date(inspection_date: str | None) -> str | None:
    """Validate inspection_date format (YYYY-MM-DD) if provided.

    The date is when the item is next due for inspection; a past date is
    accepted and means the inspection is overdue.
    """

    if inspection_date is None:
        return None
    return normalize_date_yyyy_mm_dd(inspection_date)


def build_location_path(location_chain: list[Location]) -> LocationPath:
    """Build a denormalized LocationPath from a chain ordered root->leaf."""

    if not location_chain:
        return EMPTY_LOCATION_PATH
    id_path = [loc.id for loc in location_chain]
    name_path = [loc.name for loc in location_chain]
    display = " / ".join(name_path)
    sort_key = normalize_text_for_sort(display)
    return LocationPath(
        id_path=id_path, name_path=name_path, display_path=display, sort_key=sort_key
    )


def build_location_path_from_map(
    leaf_location_id: uuid.UUID, *, locations_by_id: dict[str, Location]
) -> LocationPath:
    """Follow parent links to build LocationPath given a leaf location ID.

    Raises ValidationError if the leaf ID is unknown.
    """

    # locations_by_id is keyed by string UUIDs
    leaf_key = str(leaf_location_id)
    if leaf_key not in locations_by_id:
        raise ValidationError("location_id must reference an existing location")

    chain: list[Location] = []
    cursor_id: uuid.UUID | None = leaf_location_id
    guard = 0
    while cursor_id:
        guard += 1
        if guard > LOCATION_GUARD_MAX_STEPS:  # pragma: no cover - degenerate cycles
            raise ValidationError("location graph too deep or cyclic")
        location = locations_by_id.get(str(cursor_id))
        if location is None:
            # Broken link in chain
            raise ValidationError("location_id must reference an existing location chain")
        chain.append(location)
        cursor_id = location.parent_id
    # We collected leaf->root; reverse to root->leaf
    chain.reverse()
    return build_location_path(chain)


# -----------------------------
# Creation and update helpers
# -----------------------------


def _is_int_not_bool(value: object) -> bool:
    """True for a real integer. ``bool`` is a subclass of ``int`` — exclude it."""
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_optional_text(value: object, field_name: str) -> None:
    """Ensure an optional free-text field is a string or None.

    Non-text values (list/dict/number) would otherwise reach the search-index
    build and crash mid-way, leaving a partially-indexed item.
    """
    if value is not None and not isinstance(value, str):
        raise ValidationError(f"{field_name} must be a string or null")


def _validate_item_core_fields(name: str, quantity: int, low_stock_threshold: int | None) -> None:
    if not isinstance(name, str) or len(name.strip()) == 0:
        raise ValidationError("name is required and must be a non-empty string")
    if len(name) > NAME_MAX_LENGTH:
        raise ValidationError("name must be at most 120 characters")
    if not _is_int_not_bool(quantity) or quantity < 0:
        raise ValidationError("quantity must be an integer >= 0")
    if low_stock_threshold is not None and (
        not _is_int_not_bool(low_stock_threshold) or low_stock_threshold < 0
    ):
        raise ValidationError("low_stock_threshold must be an integer >= 0 or null")


def create_item_from_create(
    payload: ItemCreate,
    *,
    locations_by_id: dict[str, Location] | None = None,
) -> Item:
    """Create a validated Item from an ItemCreate payload.

    Args:
        payload: Input fields from the client.
        locations_by_id: Optional map of locations used to validate location_id and
            construct a denormalized location_path when provided.

    Returns:
        A fully-populated Item instance with defaults applied.
    """

    name = payload.get("name")
    if name is None:
        raise ValidationError("name is required")
    # Trim whitespace before validation and persistence
    name = name.strip()
    description = payload.get("description")
    raw_quantity = payload.get("quantity", 1)
    if isinstance(raw_quantity, bool):
        raise ValidationError("quantity must be an integer >= 0")
    quantity = int(raw_quantity)
    status = validate_item_status(payload.get("status", DEFAULT_ITEM_STATUS))
    checked_out = bool(payload.get("checked_out", False))
    due_date = payload.get("due_date")
    inspection_date = payload.get("inspection_date")
    location_id_raw = payload.get("location_id")
    tags = normalize_tags(payload.get("tags"))
    category = payload.get("category")
    low_stock_threshold = payload.get("low_stock_threshold")
    custom_fields = payload.get("custom_fields", {})

    _validate_optional_text(description, "description")
    _validate_optional_text(category, "category")
    _validate_item_core_fields(name, quantity, low_stock_threshold)
    validate_custom_fields(custom_fields)
    normalized_due_date = validate_due_date_rules(checked_out=checked_out, due_date=due_date)
    normalized_inspection_date = validate_inspection_date(inspection_date)

    location_id: uuid.UUID | None = None
    if location_id_raw is not None:
        location_id = parse_uuid4(location_id_raw, field_name="location_id")
        if locations_by_id is None or str(location_id) not in locations_by_id:
            raise ValidationError("location_id must reference an existing location")

    created_ts = iso_utc_now()
    location_path = (
        build_location_path_from_map(location_id, locations_by_id=locations_by_id)
        if location_id is not None and locations_by_id
        else EMPTY_LOCATION_PATH
    )

    item = Item(
        id=new_uuid4(),
        name=name,
        description=description,
        quantity=quantity,
        status=status,
        checked_out=checked_out,
        due_date=normalized_due_date,
        inspection_date=normalized_inspection_date,
        location_id=location_id,
        tags=tags,
        category=category,
        low_stock_threshold=low_stock_threshold,
        custom_fields=custom_fields,
        created_at=created_ts,
        updated_at=created_ts,
        version=1,
        location_path=location_path,
    )

    return item


def _update_name_and_description(new_item: Item, update: ItemUpdate) -> None:
    if "name" in update and update["name"] is not None:
        # Trim before validation and persistence
        if not isinstance(update["name"], str) or len(update["name"].strip()) == 0:
            raise ValidationError("name must be a non-empty string")
        trimmed = update["name"].strip()
        if len(trimmed) > NAME_MAX_LENGTH:
            raise ValidationError("name must be at most 120 characters")
        new_item.name = trimmed
    if "description" in update:
        _validate_optional_text(update["description"], "description")
        new_item.description = update["description"]


def _update_quantity(new_item: Item, update: ItemUpdate) -> None:
    if "quantity" in update:
        q = update["quantity"]
        if not _is_int_not_bool(q) or q < 0:
            raise ValidationError("quantity must be an integer >= 0")
        new_item.quantity = q


def _update_status(new_item: Item, update: ItemUpdate) -> None:
    if "status" in update:
        new_item.status = validate_item_status(update["status"])


def _update_checkout_and_due_date(new_item: Item, update: ItemUpdate) -> None:
    checked_out = new_item.checked_out
    due_date_val = new_item.due_date
    if "checked_out" in update:
        checked_out = bool(update["checked_out"])
    if "due_date" in update:
        due_date_val = update["due_date"]
    new_item.checked_out = checked_out
    new_item.due_date = validate_due_date_rules(checked_out=checked_out, due_date=due_date_val)


def _update_inspection_date(new_item: Item, update: ItemUpdate) -> None:
    if "inspection_date" in update:
        new_item.inspection_date = validate_inspection_date(update["inspection_date"])


def _update_location_and_path(
    new_item: Item, update: ItemUpdate, locations_by_id: dict[str, Location] | None
) -> None:
    if "location_id" in update:
        loc_raw = update["location_id"]
        loc_id: uuid.UUID | None = None
        if loc_raw is not None:
            parsed = parse_uuid4(loc_raw, field_name="location_id")
            if locations_by_id is None or str(parsed) not in locations_by_id:
                raise ValidationError("location_id must reference an existing location")
            loc_id = parsed
        new_item.location_id = loc_id

    # Recompute location_path if we have a mapping and a location_id
    if new_item.location_id is not None and locations_by_id:
        new_item.location_path = build_location_path_from_map(
            new_item.location_id, locations_by_id=locations_by_id
        )
    elif new_item.location_id is None:
        new_item.location_path = EMPTY_LOCATION_PATH


def _update_tags_category_threshold(new_item: Item, update: ItemUpdate) -> None:
    if "tags" in update:
        new_item.tags = normalize_tags(update.get("tags") or [])
    if "category" in update:
        _validate_optional_text(update["category"], "category")
        new_item.category = update["category"]
    if "low_stock_threshold" in update:
        thr = update["low_stock_threshold"]
        if thr is not None and (not _is_int_not_bool(thr) or thr < 0):
            raise ValidationError("low_stock_threshold must be an integer >= 0 or null")
        new_item.low_stock_threshold = thr


def _update_custom_fields(new_item: Item, update: ItemUpdate) -> None:
    to_set = update.get("custom_fields_set", {})
    to_unset = update.get("custom_fields_unset", [])
    if to_set:
        validate_custom_fields(to_set)
        new_item.custom_fields = {**new_item.custom_fields, **to_set}
    if to_unset:
        new_item.custom_fields = {
            k: v for k, v in new_item.custom_fields.items() if k not in set(to_unset)
        }


def apply_item_update(
    item: Item,
    update: ItemUpdate,
    *,
    locations_by_id: dict[str, Location] | None = None,
) -> Item:
    """Apply an update payload to an Item and return a new updated instance."""

    new_item = replace(item)  # shallow copy

    _update_name_and_description(new_item, update)
    _update_quantity(new_item, update)
    _update_status(new_item, update)
    _update_checkout_and_due_date(new_item, update)
    _update_inspection_date(new_item, update)
    _update_location_and_path(new_item, update, locations_by_id)
    _update_tags_category_threshold(new_item, update)
    _update_custom_fields(new_item, update)

    # Ensure updated_at is strictly monotonic to avoid equality within same second
    new_item.updated_at = monotonic_timestamp_after(item.updated_at)
    new_item.version = item.version + 1
    return new_item


# -----------------------------
# Filtering and sorting helpers
# -----------------------------


#: Length of the canonical "YYYY-MM-DDTHH:MM:SSZ" timestamp format. Canonical
#: timestamps are fixed-width, so lexicographic comparison IS chronological
#: comparison — sorting and range filters rely on this.
_CANONICAL_TS_LENGTH = 20


def monotonic_timestamp_after(previous_ts: str, *, now_ts: str | None = None) -> str:
    """Return a UTC ISO-8601 'Z' timestamp strictly after previous_ts.

    If the current time is not greater than the previous timestamp (due to
    second resolution), bump by one second to maintain monotonicity. Batch
    callers may pass a precomputed ``now_ts`` (from :func:`iso_utc_now`) to
    avoid re-reading the clock per item.
    """

    if now_ts is None:
        now_ts = iso_utc_now()
    # Fast path: canonical fixed-width timestamps compare lexicographically,
    # so the common case (time moved on) needs no parsing at all.
    if _looks_canonical_utc(previous_ts) and now_ts > previous_ts:
        return now_ts

    now_dt = datetime.now(tz=UTC).replace(microsecond=0)
    try:
        prev_dt = _parse_iso8601_utc(previous_ts, field_name="previous_ts")
    except ValidationError:
        # If previous_ts is malformed, fall back to current time
        prev_dt = now_dt - timedelta(seconds=1)
    if now_dt <= prev_dt:
        now_dt = prev_dt + timedelta(seconds=1)
    return now_dt.isoformat().replace("+00:00", "Z")


def _looks_canonical_utc(ts: str) -> bool:
    """Cheap positional shape check for the canonical YYYY-MM-DDTHH:MM:SSZ form."""
    return (
        len(ts) == _CANONICAL_TS_LENGTH
        and ts[4] == "-"
        and ts[7] == "-"
        and ts[10] == "T"
        and ts[13] == ":"
        and ts[16] == ":"
        and ts[19] == "Z"
    )


def is_canonical_utc_timestamp(ts: object) -> bool:
    """Return True when ``ts`` is exactly the canonical YYYY-MM-DDTHH:MM:SSZ form.

    The positional separator checks matter: ``datetime.fromisoformat`` alone
    would also accept e.g. a space date/time separator, ISO week dates, or
    basic-format times, which would then compare lexicographically wrong
    against canonical timestamps.
    """

    if not isinstance(ts, str) or not _looks_canonical_utc(ts):
        return False
    try:
        datetime.fromisoformat(ts)
    except ValueError:
        return False
    return True


def _parse_iso8601_utc(ts: str, *, field_name: str) -> datetime:
    """Parse a UTC ISO-8601 with trailing 'Z' into datetime.

    Only the canonical fixed-width YYYY-MM-DDTHH:MM:SSZ form is accepted.
    Raises ValidationError on bad format.
    """

    if not is_canonical_utc_timestamp(ts):
        raise ValidationError(f"{field_name} must be an ISO-8601 UTC timestamp with 'Z'")
    return datetime.fromisoformat(ts)


def _item_matches_q(item: Item, q: str) -> bool:
    """Match query string against item fields using multi-word AND logic."""
    if not q:
        return True

    # Normalize query (casefold + NFKD accent-stripping): split into words
    query_words = normalize_search_text(q).split()
    if not query_words:
        return True

    # Every query word must appear somewhere in the item's combined
    # searchable text (name, description, category, path, tags).
    searchable_text = normalize_search_text(
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

    for word in query_words:
        if word not in searchable_text:
            return False

    return True


def item_is_low_stock(item: Item) -> bool:
    """Return True when the item's quantity is at or below its threshold."""
    thr = item.low_stock_threshold
    if thr is None:
        return False
    return item.quantity <= thr


def today_utc_date() -> str:
    """Today's date as YYYY-MM-DD in UTC — the reference point for "overdue"."""
    return datetime.now(UTC).date().isoformat()


def item_is_overdue(item: Item, *, today: str = "") -> bool:
    """Return True when the item's due date has passed.

    A due date only exists while an item is checked out (see
    ``validate_due_date_rules``), so this needs no separate checked-out test.
    Both sides are YYYY-MM-DD, which compares correctly as text. ``today``
    defaults to the current UTC date; callers filtering many items pass it in
    once rather than re-reading the clock per item.
    """

    if not item.due_date:
        return False
    return item.due_date < (today or today_utc_date())


def item_inspection_is_overdue(item: Item, *, today: str = "") -> bool:
    """Return True when the item is past the date it was next due for inspection.

    Independent of the check-out state: an inspection is a fact about the item,
    not about a borrowing, so this walks any item that carries a date. Same
    text comparison and same ``today`` convention as ``item_is_overdue``.
    """

    if not item.inspection_date:
        return False
    return item.inspection_date < (today or today_utc_date())


def _item_matches_location(item: Item, location_id: str | None, include_subtree: bool) -> bool:
    if location_id is None:
        return True
    if not item.location_id:
        return False
    try:
        needle = parse_uuid4(location_id, field_name="filter.location_id")
    except ValidationError:
        return False
    if include_subtree:
        if item.location_id == needle:
            return True
        return bool(item.location_path.id_path and (needle in item.location_path.id_path))
    return item.location_id == needle


def filter_items(items: Iterable[Item], flt: ItemFilter | None = None) -> list[Item]:
    """Filter items according to ItemFilter semantics.

    - q: case-insensitive match in name, description, tags, location display_path
    - tags_any: at least one matches
    - tags_all: all must be present
    - category: case-insensitive equals
    - status: exact match against one of the known statuses
    - checked_out: exact match
    - low_stock_only: quantity <= threshold (0 valid, None disables)
    - orphaned_only: only items without a location (location_id is None)
    - overdue_only: due_date set and strictly before today (UTC)
    - inspection_overdue_only: inspection_date set and strictly before today (UTC)
    - location_id: equals; include_subtree optionally includes descendants (by prefix of id_path)
    - updated_after/created_after: ISO-8601 UTC with 'Z', strictly greater-than
    - updated_before/created_before: ISO-8601 UTC with 'Z', strictly less-than
    """

    if not flt:
        return list(items)

    q = (flt.get("q") or "").strip()
    tags_any = normalize_tags(flt.get("tags_any")) if "tags_any" in flt else []
    tags_all = normalize_tags(flt.get("tags_all")) if "tags_all" in flt else []
    category = (flt.get("category") or "").strip().casefold() if "category" in flt else ""
    status = validate_item_status(flt["status"]) if "status" in flt else None
    checked_out = flt.get("checked_out") if "checked_out" in flt else None
    low_stock_only = bool(flt.get("low_stock_only")) if "low_stock_only" in flt else False
    orphaned_only = bool(flt.get("orphaned_only")) if "orphaned_only" in flt else False
    overdue_only = bool(flt.get("overdue_only")) if "overdue_only" in flt else False
    inspection_overdue_only = (
        bool(flt.get("inspection_overdue_only")) if "inspection_overdue_only" in flt else False
    )
    location_id = flt.get("location_id") if "location_id" in flt else None
    include_subtree = bool(flt.get("include_subtree")) if "include_subtree" in flt else False
    updated_after = flt.get("updated_after") if "updated_after" in flt else None
    created_after = flt.get("created_after") if "created_after" in flt else None
    updated_before = flt.get("updated_before") if "updated_before" in flt else None
    created_before = flt.get("created_before") if "created_before" in flt else None

    # Validate filter bounds (raises ValidationError for malformed input).
    for bound, name in (
        (updated_after, "updated_after"),
        (created_after, "created_after"),
        (updated_before, "updated_before"),
        (created_before, "created_before"),
    ):
        if bound:
            _parse_iso8601_utc(bound, field_name=name)
    today = today_utc_date() if (overdue_only or inspection_overdue_only) else ""

    predicates_active = (
        bool(q)
        or bool(tags_any)
        or bool(tags_all)
        or bool(category)
        or status is not None
        or checked_out is not None
        or low_stock_only
        or orphaned_only
        or overdue_only
        or inspection_overdue_only
        or location_id is not None
        or updated_after is not None
        or created_after is not None
        or updated_before is not None
        or created_before is not None
    )
    if not predicates_active:
        # e.g. flt only carries presentation hints such as low_stock_first
        return list(items)

    filtered: list[Item] = []
    for it in items:
        matches_q = (not q) or _item_matches_q(it, q)
        matches_any = (not tags_any) or any(tag in it.tags for tag in tags_any)
        matches_all = (not tags_all) or all(tag in it.tags for tag in tags_all)
        matches_category = (not category) or ((it.category or "").strip().casefold() == category)
        matches_status = (status is None) or (it.status == status)
        matches_checked = (checked_out is None) or (it.checked_out == bool(checked_out))
        matches_low_stock = (not low_stock_only) or item_is_low_stock(it)
        matches_orphaned = (not orphaned_only) or (it.location_id is None)
        matches_overdue = (not overdue_only) or item_is_overdue(it, today=today)
        matches_inspection = (not inspection_overdue_only) or item_inspection_is_overdue(
            it, today=today
        )
        matches_location = _item_matches_location(it, location_id, include_subtree)
        # Canonical fixed-width 'Z' timestamps compare lexicographically, so no
        # per-item parsing is needed (the filter bound was validated above).
        matches_updated = ((updated_after is None) or (it.updated_at > updated_after)) and (
            (updated_before is None) or (it.updated_at < updated_before)
        )
        matches_created = ((created_after is None) or (it.created_at > created_after)) and (
            (created_before is None) or (it.created_at < created_before)
        )
        ok = (
            matches_q
            and matches_any
            and matches_all
            and matches_category
            and matches_status
            and matches_checked
            and matches_low_stock
            and matches_orphaned
            and matches_overdue
            and matches_inspection
            and matches_location
            and matches_updated
            and matches_created
        )
        if ok:
            filtered.append(it)

    return filtered


def date_sort_key(value: str | None, order: str) -> str:
    """Return a scalar sort key for a nullable YYYY-MM-DD field.

    Items without a date sort last in BOTH orders: in ascending order null maps
    to "~" (after any digit), in descending order to "" (smallest value, which
    a reversed sort places last). The same key is used by the repository's
    cursor pagination so page boundaries stay consistent with this ordering.
    """

    if value is None:
        return "~" if order == "asc" else ""
    return value


def sort_items(items: Iterable[Item], sort: Sort | None = None) -> list[Item]:
    """Sort items by the requested field and order.

    Defaults to updated_at desc with id asc tie-break.
    name sorting is case-insensitive using normalize_text_for_sort.
    due_date / inspection_date place undated items last in both orders.
    """

    result = list(items)
    if not result:
        return result

    if sort is None:
        # Default: updated_at desc, id asc tie-break. Canonical fixed-width
        # 'Z' timestamps sort lexicographically — no parsing needed.
        result.sort(key=lambda x: str(x.id))
        result.sort(key=lambda x: x.updated_at, reverse=True)
        return result

    field = sort.get("field")
    order = sort.get("order")
    allowed_fields = {"updated_at", "created_at", "name", "quantity", "due_date", "inspection_date"}
    if field not in allowed_fields:
        raise ValidationError(
            "sort.field must be one of: updated_at, created_at, name, quantity, "
            "due_date, inspection_date"
        )
    if order not in {"asc", "desc"}:
        raise ValidationError("sort.order must be 'asc' or 'desc'")

    reverse = order == "desc"
    # Stable sort: primary key, then id asc tie-break
    result.sort(key=lambda x: str(x.id))

    if field == "name":
        result.sort(key=lambda x: normalize_text_for_sort(x.name), reverse=reverse)
    elif field == "quantity":
        result.sort(key=lambda x: int(x.quantity), reverse=reverse)
    elif field == "due_date":
        result.sort(key=lambda x: date_sort_key(x.due_date, order), reverse=reverse)
    elif field == "inspection_date":
        result.sort(key=lambda x: date_sort_key(x.inspection_date, order), reverse=reverse)
    elif field == "created_at":
        result.sort(key=lambda x: x.created_at, reverse=reverse)
    else:  # updated_at
        result.sort(key=lambda x: x.updated_at, reverse=reverse)

    return result
