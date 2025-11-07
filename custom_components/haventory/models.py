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
    area_id: uuid.UUID | None = None
    path: LocationPath = field(default_factory=lambda: EMPTY_LOCATION_PATH)


@dataclass
class Item:
    """Persisted shape for an inventory item."""

    id: uuid.UUID
    name: str
    description: str | None = None
    quantity: int = 1
    checked_out: bool = False
    due_date: str | None = None  # YYYY-MM-DD
    location_id: uuid.UUID | None = None
    tags: list[str] = field(default_factory=list)
    category: str | None = None
    low_stock_threshold: int | None = None
    custom_fields: dict[str, ScalarValue] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: iso_utc_now())
    updated_at: str = field(default_factory=lambda: iso_utc_now())
    version: int = 1
    location_path: LocationPath = field(default_factory=lambda: EMPTY_LOCATION_PATH)


class ItemCreate(TypedDict, total=False):
    """Creation input for Item. Only 'name' is required."""

    name: str
    description: str | None
    quantity: int
    checked_out: bool
    due_date: str | None
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
    checked_out: bool
    due_date: str | None
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
    checked_out: bool
    low_stock_only: bool
    # When true, do not filter; instead, prefer low-stock items first in ordering
    low_stock_first: bool
    location_id: str | None
    area_id: str
    include_subtree: bool
    updated_after: str
    created_after: str


class Sort(TypedDict):
    """Sort definition for item queries."""

    field: Literal["updated_at", "created_at", "name", "quantity"]
    order: Literal["asc", "desc"]


@dataclass
class LocationNode:
    """Tree node for locations when building hierarchies."""

    location: Location
    children: list[LocationNode] = field(default_factory=list)


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


def _validate_item_core_fields(name: str, quantity: int, low_stock_threshold: int | None) -> None:
    if not isinstance(name, str) or len(name.strip()) == 0:
        raise ValidationError("name is required and must be a non-empty string")
    if len(name) > NAME_MAX_LENGTH:
        raise ValidationError("name must be at most 120 characters")
    if not isinstance(quantity, int) or quantity < 0:
        raise ValidationError("quantity must be an integer >= 0")
    if low_stock_threshold is not None and (
        not isinstance(low_stock_threshold, int) or low_stock_threshold < 0
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

    name = payload.get("name")  # type: ignore[assignment]
    if name is None:
        raise ValidationError("name is required")
    # Trim whitespace before validation and persistence
    name = name.strip()
    description = payload.get("description")
    quantity = int(payload.get("quantity", 1))  # type: ignore[arg-type]
    checked_out = bool(payload.get("checked_out", False))
    due_date = payload.get("due_date")
    location_id_raw = payload.get("location_id")
    tags = normalize_tags(payload.get("tags"))
    category = payload.get("category")
    low_stock_threshold = payload.get("low_stock_threshold")
    custom_fields = payload.get("custom_fields", {})

    _validate_item_core_fields(name, quantity, low_stock_threshold)
    validate_custom_fields(custom_fields)
    normalized_due_date = validate_due_date_rules(checked_out=checked_out, due_date=due_date)

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
        checked_out=checked_out,
        due_date=normalized_due_date,
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
        new_item.description = update["description"]


def _update_quantity(new_item: Item, update: ItemUpdate) -> None:
    if "quantity" in update:
        q = update["quantity"]
        if not isinstance(q, int) or q < 0:
            raise ValidationError("quantity must be an integer >= 0")
        new_item.quantity = q


def _update_checkout_and_due_date(new_item: Item, update: ItemUpdate) -> None:
    checked_out = new_item.checked_out
    due_date_val = new_item.due_date
    if "checked_out" in update:
        checked_out = bool(update["checked_out"])  # type: ignore[truthy-bool]
    if "due_date" in update:
        due_date_val = update["due_date"]
    new_item.checked_out = checked_out
    new_item.due_date = validate_due_date_rules(checked_out=checked_out, due_date=due_date_val)


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
        new_item.category = update["category"]
    if "low_stock_threshold" in update:
        thr = update["low_stock_threshold"]
        if thr is not None and (not isinstance(thr, int) or thr < 0):
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
    _update_checkout_and_due_date(new_item, update)
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


def monotonic_timestamp_after(previous_ts: str) -> str:
    """Return a UTC ISO-8601 'Z' timestamp strictly after previous_ts.

    If iso_utc_now() is not greater than the previous timestamp (due to second
    resolution), bump by one second to maintain monotonicity.
    """

    now_dt = datetime.now(tz=UTC).replace(microsecond=0)
    try:
        prev_dt = _parse_iso8601_utc(previous_ts, field_name="previous_ts")
    except ValidationError:
        # If previous_ts is malformed, fall back to current time
        prev_dt = now_dt - timedelta(seconds=1)
    if now_dt <= prev_dt:
        now_dt = prev_dt + timedelta(seconds=1)
    return now_dt.isoformat().replace("+00:00", "Z")


def _parse_iso8601_utc(ts: str, *, field_name: str) -> datetime:
    """Parse a UTC ISO-8601 with trailing 'Z' into datetime.

    Raises ValidationError on bad format.
    """

    try:
        if not isinstance(ts, str) or not ts.endswith("Z"):
            raise ValueError
        # Support YYYY-MM-DDTHH:MM:SSZ (no offset, no micros)
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as exc:
        raise ValidationError(f"{field_name} must be an ISO-8601 UTC timestamp with 'Z'") from exc


def _item_matches_q(item: Item, q: str) -> bool:
    if not q:
        return True
    needle = q.casefold()
    if needle in (item.name or "").casefold():
        return True
    if needle in (item.description or "").casefold():
        return True
    if any(needle in tag for tag in item.tags):
        return True
    if needle in (item.location_path.display_path or "").casefold():
        return True
    return False


def _low_stock(item: Item) -> bool:
    thr = item.low_stock_threshold
    if thr is None:
        return False
    return item.quantity <= thr


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
    - checked_out: exact match
    - low_stock_only: quantity <= threshold (0 valid, None disables)
    - location_id: equals; include_subtree optionally includes descendants (by prefix of id_path)
    - updated_after/created_after: ISO-8601 UTC with 'Z'
    """

    if not flt:
        return list(items)

    q = (flt.get("q") or "").strip()
    tags_any = normalize_tags(flt.get("tags_any")) if "tags_any" in flt else []
    tags_all = normalize_tags(flt.get("tags_all")) if "tags_all" in flt else []
    category = (flt.get("category") or "").strip().casefold() if "category" in flt else ""
    checked_out = flt.get("checked_out") if "checked_out" in flt else None
    low_stock_only = bool(flt.get("low_stock_only")) if "low_stock_only" in flt else False
    location_id = flt.get("location_id") if "location_id" in flt else None
    include_subtree = bool(flt.get("include_subtree")) if "include_subtree" in flt else False
    updated_after = flt.get("updated_after") if "updated_after" in flt else None
    created_after = flt.get("created_after") if "created_after" in flt else None

    updated_after_dt = (
        _parse_iso8601_utc(updated_after, field_name="updated_after") if updated_after else None
    )
    created_after_dt = (
        _parse_iso8601_utc(created_after, field_name="created_after") if created_after else None
    )

    filtered: list[Item] = []
    for it in items:
        matches_q = (not q) or _item_matches_q(it, q)
        matches_any = (not tags_any) or any(tag in it.tags for tag in tags_any)
        matches_all = (not tags_all) or all(tag in it.tags for tag in tags_all)
        matches_category = (not category) or ((it.category or "").strip().casefold() == category)
        matches_checked = (checked_out is None) or (it.checked_out == bool(checked_out))
        matches_low_stock = (not low_stock_only) or _low_stock(it)
        matches_location = _item_matches_location(it, location_id, include_subtree)
        matches_updated = (updated_after_dt is None) or (
            _parse_iso8601_utc(it.updated_at, field_name="item.updated_at") > updated_after_dt
        )
        matches_created = (created_after_dt is None) or (
            _parse_iso8601_utc(it.created_at, field_name="item.created_at") > created_after_dt
        )
        ok = (
            matches_q
            and matches_any
            and matches_all
            and matches_category
            and matches_checked
            and matches_low_stock
            and matches_location
            and matches_updated
            and matches_created
        )
        if ok:
            filtered.append(it)

    return filtered


def sort_items(items: Iterable[Item], sort: Sort | None = None) -> list[Item]:
    """Sort items by the requested field and order.

    Defaults to updated_at desc with id asc tie-break.
    name sorting is case-insensitive using normalize_text_for_sort.
    """

    result = list(items)
    if not result:
        return result

    if sort is None:
        # Default: updated_at desc, id asc tie-break
        result.sort(key=lambda x: str(x.id))
        result.sort(
            key=lambda x: _parse_iso8601_utc(x.updated_at, field_name="updated_at"), reverse=True
        )
        return result

    field = sort.get("field")
    order = sort.get("order")
    if field not in {"updated_at", "created_at", "name", "quantity"}:
        raise ValidationError("sort.field must be one of: updated_at, created_at, name, quantity")
    if order not in {"asc", "desc"}:
        raise ValidationError("sort.order must be 'asc' or 'desc'")

    reverse = order == "desc"
    # Stable sort: primary key, then id asc tie-break
    result.sort(key=lambda x: str(x.id))

    if field == "name":
        result.sort(key=lambda x: normalize_text_for_sort(x.name), reverse=reverse)
    elif field == "quantity":
        result.sort(key=lambda x: int(x.quantity), reverse=reverse)
    elif field == "created_at":
        result.sort(
            key=lambda x: _parse_iso8601_utc(x.created_at, field_name="created_at"), reverse=reverse
        )
    else:  # updated_at
        result.sort(
            key=lambda x: _parse_iso8601_utc(x.updated_at, field_name="updated_at"), reverse=reverse
        )

    return result
