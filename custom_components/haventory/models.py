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
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Literal, NotRequired, TypedDict

from .const import (
    DEFAULT_STATUS_COLOR,
    DEFAULT_STATUS_ICON,
    STATUS_COLORS,
    STATUS_ICONS,
)
from .exceptions import ValidationError

# Scalar values allowed inside custom_fields.
ScalarValue = str | int | float | bool

# Stored per-item condition, identified by an immutable slug. Every item carries
# exactly one; "ok" is the default, so a payload written before the field
# existed reads as "ok". Not a Literal: the set of slugs is data, seeded with
# the three below and read from the store, so the functions that check a status
# take the live set as `known_statuses` rather than closing over this tuple.
ItemStatus = str
ITEM_STATUSES: Final[tuple[ItemStatus, ...]] = ("ok", "missing", "needs_repair")
DEFAULT_ITEM_STATUS: Final[ItemStatus] = "ok"

# A slug is what items store and what the media/index paths key on, so it is
# restricted to what reads back identically everywhere: lowercase ASCII, digits
# and underscores.
STATUS_SLUG_RE = re.compile(r"^[a-z0-9_]{1,64}$")

# A status colour a household typed rather than picked out of the ten tokens.
# `#rrggbb` only: it is what `<input type="color">` produces, what every browser
# normalizes to, and the one form the card can read three channels out of
# without a second parser.
STATUS_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# What an item can carry as an attachment. "picture" is the kind the card
# renders; "manual" exists on the backend so a document does not have to be
# migrated onto the shape later.
AttachmentKind = Literal["picture", "manual"]
ATTACHMENT_KINDS: Final[tuple[AttachmentKind, ...]] = ("picture", "manual")


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
# An attachment title is a caption, not a name, so it gets more room than a
# location or a status label — a manual is plausibly "Dishwasher manual (EN,
# model SMS4HVI31E)".
ATTACHMENT_TITLE_MAX_LENGTH = 200

# Input bounds for the free-text and collection fields, anchored on the 120-char
# name cap above. The store is one JSON document rewritten in full on every
# mutation, so an unbounded field is a cost every later write pays; these are set
# where a household's real entry still fits comfortably.
DESCRIPTION_MAX_LENGTH = 4_000
CATEGORY_MAX_LENGTH = 120
TAG_MAX_LENGTH = 64
TAGS_MAX_COUNT = 50
CUSTOM_FIELDS_MAX_KEYS = 50
CUSTOM_FIELD_KEY_MAX_LENGTH = 64
CUSTOM_FIELD_VALUE_MAX_LENGTH = 1_000


@dataclass
class Location:
    """Persisted shape for a location node."""

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    area_id: str | None = None
    path: LocationPath = field(default_factory=lambda: EMPTY_LOCATION_PATH)


@dataclass
class StatusDefinition:
    """One entry of the store's ``statuses`` collection.

    The ``slug`` is the immutable identity — it is what every item stores — and
    the ``label`` is the only part a rename touches, so renaming never rewrites
    an item. ``order`` is display order alone.
    """

    slug: str
    label: str
    order: int = 0
    # Appearance. The icon is always a token naming a glyph the card bundle
    # carries, never a path. The colour is a token too by default — the card
    # paints those against whatever Home Assistant theme is active — but it may
    # also be a literal `#rrggbb`, which is a household choosing one exact
    # colour and giving up the theme for that one chip.
    color: str = DEFAULT_STATUS_COLOR
    icon: str = DEFAULT_STATUS_ICON


@dataclass
class AttachmentMeta:
    """Metadata for one file attached to an item.

    Only metadata is persisted: the bytes live under the media root (see
    ``media.py``), because the store is one JSON document rewritten in full on
    every mutation.
    """

    id: uuid.UUID
    kind: AttachmentKind
    filename: str
    mime: str
    size: int
    uploaded_at: str
    # What the user chose to call this file. Empty means "show the filename" —
    # storing a copy of it instead would make the two drift apart with no way to
    # tell an untitled attachment from one deliberately titled after its file.
    title: str = ""
    # Position within the item's attachments of the same kind. The picture at 0
    # is the item's cover, so there is no separate flag and no "exactly one
    # cover" invariant for an import to repair.
    order: int = 0


# How often a reminder comes round. Calendar units rather than a plain number
# of days: "every 3 months" is what a household says, and expanding it as 90
# days would walk the date off the month it belongs to.
REMINDER_UNITS: Final[tuple[str, ...]] = ("days", "weeks", "months")
# A bound, not a policy: an interval is a small repeating period, and a count
# this large is a typo or a probe rather than a household's intent.
REMINDER_COUNT_MAX: Final[int] = 1000


@dataclass(frozen=True, slots=True)
class ReminderInterval:
    """How far apart a reminder's occurrences fall.

    Frozen: an interval is a value, and sharing one between items must not let
    an edit to one move the other.
    """

    unit: str
    count: int


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
    # A reminder is three fields, and two of them are dates on purpose.
    # `reminder_date` is the next occurrence nobody has marked done — what the
    # calendar shows first and what a bump advances. `reminder_anchor` is what
    # the series is measured from, and a bump leaves it alone: month steps are
    # counted from the anchor, so a series anchored on the 31st returns to the
    # 31st in every month that has one, however often it is bumped through a
    # short one. The two are equal until the first bump; neither exists without
    # the other. Nothing schedules from any of it — see `calendar_projection.py`.
    reminder_date: str | None = None  # YYYY-MM-DD
    reminder_anchor: str | None = None  # YYYY-MM-DD
    reminder_interval: ReminderInterval | None = None
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
    # Deliberately absent from ItemCreate / ItemUpdate: the two attachment
    # commands own this field, so an ordinary item edit can never rewrite it.
    attachments: list[AttachmentMeta] = field(default_factory=list)


class ItemCreate(TypedDict, total=False):
    """Creation input for Item. Only 'name' is required."""

    name: str
    description: str | None
    quantity: int
    status: ItemStatus
    checked_out: bool
    due_date: str | None
    inspection_date: str | None
    reminder_date: str | None
    reminder_interval: dict[str, Any] | None
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
    reminder_date: str | None
    reminder_interval: dict[str, Any] | None
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
    # Multi-select beside the scalar above. An item has exactly one category, so
    # a selection can only ever mean OR — see `selected_categories`.
    categories: list[str]
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
    # When true, only items whose reminder has come round — today included,
    # unlike the two above (see filter_items)
    reminder_due_only: bool
    location_id: str | None
    # Multi-select beside the scalar above, unioned the same way — see
    # `selected_location_ids`. `include_subtree` governs the whole selection.
    location_ids: list[str]
    area_id: str
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
        # The next occurrence a reminder is asking about, not `reminder_anchor`
        # — the anchor says where the series started, which is not a useful
        # order to read a list of chores in.
        "reminder_date",
        # The item's denormalized location path, which is the ordering the
        # Location column implies. Not an area sort: an area lives on the
        # location tree and its name in Home Assistant's registry, neither of
        # which this module can reach.
        "location",
    ]
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


def validate_custom_fields(
    values: dict[str, ScalarValue], *, previous: Mapping[str, ScalarValue] | None = None
) -> None:
    """Validate custom field keys and values are scalars of allowed types.

    ``previous`` is the map the item already carries, and the caps refuse
    *growth* past it, the way :func:`validate_tags` treats its ``previous``: a
    key the item already has is not refused for its length, a stored string
    value may stay over the cap as long as the edit does not lengthen it, and
    a patch carrying more keys than the cap passes when the item already
    carried that many. Without ``previous`` (a brand-new item) every cap is
    absolute.
    """

    if not isinstance(values, dict):
        raise ValidationError("custom_fields must be a mapping of string keys to scalars")
    prev = previous or {}
    if len(values) > CUSTOM_FIELDS_MAX_KEYS and len(values) > len(prev):
        raise ValidationError(f"custom_fields must have at most {CUSTOM_FIELDS_MAX_KEYS} keys")
    for key, value in values.items():
        if not isinstance(key, str) or not key:
            raise ValidationError("custom_fields keys must be non-empty strings")
        if len(key) > CUSTOM_FIELD_KEY_MAX_LENGTH and key not in prev:
            raise ValidationError(
                f"custom_fields keys must be at most {CUSTOM_FIELD_KEY_MAX_LENGTH} characters"
            )
        if not isinstance(value, str | int | float | bool):
            raise ValidationError(
                "custom_fields values must be scalar (string, number, or boolean)"
            )
        if isinstance(value, str) and len(value) > CUSTOM_FIELD_VALUE_MAX_LENGTH:
            prev_value = prev.get(key)
            if not isinstance(prev_value, str) or len(value) > len(prev_value):
                raise ValidationError(
                    f"custom_fields values must be at most "
                    f"{CUSTOM_FIELD_VALUE_MAX_LENGTH} characters"
                )


def validate_tags(tags: list[str] | None, *, previous: Collection[str] = ()) -> list[str]:
    """Normalize an *item's* tag list and enforce the item-side tag caps.

    Separate from :func:`normalize_tags`, which also normalizes *filter* values:
    a filter naming sixty tags is a query, not an item, and is not over any
    limit.

    ``previous`` is the item's current tag list, and the caps are enforced
    against what the edit *adds*. An item that predates the caps can therefore
    still be edited — including by the edit that removes the excess, which an
    absolute check would refuse along with everything else.
    """

    normalized = normalize_tags(tags)
    previous_tags = set(previous)
    for tag in normalized:
        if tag not in previous_tags and len(tag) > TAG_MAX_LENGTH:
            raise ValidationError(f"each tag must be at most {TAG_MAX_LENGTH} characters")
    if len(normalized) > TAGS_MAX_COUNT and len(normalized) > len(previous_tags):
        raise ValidationError(f"tags must have at most {TAGS_MAX_COUNT} entries")
    return normalized


#: Every key an :class:`ItemFilter` accepts. Derived from the TypedDict so a new
#: filter key is accepted the moment it is declared there, with no second list
#: to keep in step.
ITEM_FILTER_KEYS: Final[frozenset[str]] = frozenset(ItemFilter.__annotations__)


def normalize_filter_values(value: object, *, field_name: str, casefold: bool = False) -> list[str]:
    """Normalize a multi-select filter list: trim, drop blanks, de-duplicate.

    A bare string is the mistake worth naming rather than absorbing: iterating
    one yields characters, so ``categories: "Tools"`` would quietly filter by
    five single letters instead of by a category.
    """

    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(f"{field_name} must be a list of strings")
    seen: set[str] = set()
    result: list[str] = []
    for raw in value:
        if not isinstance(raw, str):
            raise ValidationError(f"{field_name} must be a list of strings")
        text = raw.strip().casefold() if casefold else raw.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def selected_categories(flt: ItemFilter) -> list[str]:
    """The casefolded categories a filter selects, scalar and list unioned.

    An item carries exactly one category, so the two keys can only mean OR:
    requiring both would match nothing whenever they name different values —
    the silent empty result this filter shape exists to avoid. An empty
    selection does not narrow at all, the way an empty ``tags_any`` does not.
    """

    selection: list[str] = []
    scalar = (flt.get("category") or "").strip().casefold() if "category" in flt else ""
    if scalar:
        selection.append(scalar)
    for value in normalize_filter_values(
        flt.get("categories"), field_name="categories", casefold=True
    ):
        if value not in selection:
            selection.append(value)
    return selection


def selected_location_ids(flt: ItemFilter) -> list[str]:
    """The location ids a filter selects, scalar and list unioned.

    Same rule as :func:`selected_categories` — an item sits in one location.
    ``include_subtree`` is one flag for the whole selection rather than one per
    entry: an item is kept when it is in, or under, *any* of them.
    """

    selection: list[str] = []
    scalar = flt.get("location_id") if "location_id" in flt else None
    if scalar is not None:
        selection.append(str(scalar).strip())
    for value in normalize_filter_values(flt.get("location_ids"), field_name="location_ids"):
        if value not in selection:
            selection.append(value)
    return selection


#: The fields :func:`sort_items` can order by, and the two orders it accepts.
SORT_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "updated_at",
        "created_at",
        "name",
        "quantity",
        "due_date",
        "inspection_date",
        "reminder_date",
        "location",
    }
)
SORT_ORDERS: Final[frozenset[str]] = frozenset({"asc", "desc"})
#: The keys a sort object carries. Anything else is a client typo.
SORT_KEYS: Final[frozenset[str]] = frozenset({"field", "order"})


def validate_item_filter(flt: object) -> None:
    """Reject a filter object carrying keys no filter understands.

    An unknown key is silently dropped by :func:`filter_items`, so a typo'd
    ``search`` or ``query`` in place of ``q`` returns the *whole* inventory
    labelled as a filtered result. Naming the offending key is the only way a
    caller finds that out.
    """

    if flt is None:
        return
    if not isinstance(flt, dict):
        raise ValidationError("filter must be an object")
    unknown = sorted(str(key) for key in flt if key not in ITEM_FILTER_KEYS)
    if unknown:
        raise ValidationError(f"unknown filter key(s): {', '.join(unknown)}")


def validate_sort(sort: object) -> None:
    """Reject a sort object carrying unknown keys, fields or orders.

    Same footgun as :func:`validate_item_filter`: an unknown key leaves the
    ordering at its default, which reads as "the sort did nothing".
    """

    if sort is None:
        return
    if not isinstance(sort, dict):
        raise ValidationError("sort must be an object")
    unknown = sorted(str(key) for key in sort if key not in SORT_KEYS)
    if unknown:
        raise ValidationError(f"unknown sort key(s): {', '.join(unknown)}")
    field_value = sort.get("field")
    if field_value not in SORT_FIELDS:
        raise ValidationError(f"sort.field must be one of: {', '.join(sorted(SORT_FIELDS))}")
    if sort.get("order") not in SORT_ORDERS:
        raise ValidationError("sort.order must be 'asc' or 'desc'")


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


def validate_item_status(
    value: object, *, known_statuses: Collection[str] = ITEM_STATUSES
) -> ItemStatus:
    """Validate an item status against the live set and return it.

    Status is non-nullable: an item always has one, so ``None`` is rejected the
    same as any other unknown value ("ok" is the way to clear a flagged state).

    ``known_statuses`` is an explicit parameter rather than module-level mutable
    state: the default keeps every caller that has no repository to ask meaning
    what it has always meant, and nothing global needs resetting between tests.
    """

    if isinstance(value, str) and value in known_statuses:
        return value
    raise ValidationError(f"status must be one of: {', '.join(sorted(known_statuses))}")


def coerce_item_status(
    value: object, *, known_statuses: Collection[str] = ITEM_STATUSES
) -> ItemStatus:
    """Return ``value`` when it is a known status, otherwise the default.

    The tolerant twin of :func:`validate_item_status`, for loading persisted
    payloads: a store written before the field existed (or hand-edited into an
    unknown value) reads as "ok" rather than failing the whole item. Callers
    loading a store MUST pass the definitions that store carries — with the
    built-ins alone, every custom status would be silently rewritten to "ok" on
    the first restart after the upgrade that introduced it.
    """

    if isinstance(value, str) and value in known_statuses:
        return value
    return DEFAULT_ITEM_STATUS


def validate_status_slug(value: object) -> str:
    """Validate a status slug: the immutable identity items store."""

    if not isinstance(value, str) or not STATUS_SLUG_RE.match(value):
        raise ValidationError(
            "status slug must be 1-64 characters of lowercase letters, digits or underscores"
        )
    return value


def validate_status_color(value: object) -> str:
    """Validate a status colour: one of the ten tone tokens, or a `#rrggbb` literal.

    A token is resolved by the card against the active Home Assistant theme; a
    literal is not, and cannot be — it is the household saying "this exact
    colour, whatever the theme". The card computes the ink for it from the
    fill's own luminance, so no colour is illegible and none has to be refused.

    Case is folded so one colour has one spelling in the store, which is what
    lets a chip's colour be compared rather than only rendered.
    """

    if isinstance(value, str):
        if value in STATUS_COLORS:
            return value
        if STATUS_HEX_COLOR_RE.match(value):
            return value.lower()
    raise ValidationError(
        f"status color must be a #rrggbb hex colour or one of: {', '.join(STATUS_COLORS)}"
    )


def validate_status_definition(value: object) -> StatusDefinition:
    """Build a :class:`StatusDefinition` from a stored/incoming mapping."""

    if not isinstance(value, dict):
        raise ValidationError("status definition must be an object")
    slug = validate_status_slug(value.get("slug"))
    label = value.get("label")
    if not isinstance(label, str) or not label.strip():
        raise ValidationError("status label is required and must be a non-empty string")
    if len(label.strip()) > NAME_MAX_LENGTH:
        raise ValidationError("status label must be at most 120 characters")
    order = value.get("order", 0)
    if not _is_int_not_bool(order):
        raise ValidationError("status order must be an integer")
    color = validate_status_color(value.get("color", DEFAULT_STATUS_COLOR))
    icon = value.get("icon", DEFAULT_STATUS_ICON)
    if icon not in STATUS_ICONS:
        raise ValidationError(f"status icon must be one of: {', '.join(STATUS_ICONS)}")
    return StatusDefinition(
        slug=slug,
        label=label.strip(),
        order=int(order),
        color=color,
        icon=str(icon),
    )


def serialize_status_definition(definition: StatusDefinition) -> dict[str, Any]:
    """Serialize a status definition to its stored/exported shape."""

    return {
        "slug": definition.slug,
        "label": definition.label,
        "order": int(definition.order),
        "color": definition.color,
        "icon": definition.icon,
    }


# The built-in three, and what each one looks like. `ok` is green because it is
# the resting state a healthy inventory sits in; the other two are amber because
# they are chores, not failures.
_SEED_STATUSES: Final[tuple[tuple[str, str, str, str], ...]] = (
    ("ok", "OK", "green", "check"),
    ("missing", "Missing", "amber", "alert"),
    ("needs_repair", "Needs repair", "amber", "wrench"),
)


def seed_status_definitions() -> dict[str, StatusDefinition]:
    """The built-in definitions, in display order — the permanent fallback.

    A store or an export document carrying no ``statuses`` section means exactly
    this set, so every pre-v6 document stays readable without a migration of its
    own.
    """

    return {
        slug: StatusDefinition(slug=slug, label=label, order=order, color=color, icon=icon)
        for order, (slug, label, color, icon) in enumerate(_SEED_STATUSES)
    }


def validate_attachment_meta(value: object) -> AttachmentMeta:
    """Build an :class:`AttachmentMeta` from a stored/incoming mapping.

    The id is a UUID v4 because it is also the file's name under the media root
    — a value that round-trips through a path is the only kind allowed there.
    """

    if not isinstance(value, dict):
        raise ValidationError("attachment must be an object")
    att_id = parse_uuid4(value.get("id"), field_name="attachment.id")  # type: ignore[arg-type]
    kind = value.get("kind")
    if kind not in ATTACHMENT_KINDS:
        raise ValidationError(f"attachment kind must be one of: {', '.join(ATTACHMENT_KINDS)}")
    filename = value.get("filename")
    if not isinstance(filename, str) or not filename.strip():
        raise ValidationError("attachment filename is required and must be a non-empty string")
    mime = value.get("mime")
    if not isinstance(mime, str) or not mime.strip():
        raise ValidationError("attachment mime is required and must be a non-empty string")
    size = value.get("size")
    if not _is_int_not_bool(size) or int(size) < 0:  # type: ignore[arg-type]
        raise ValidationError("attachment size must be an integer >= 0")
    uploaded_at = value.get("uploaded_at")
    if not is_canonical_utc_timestamp(uploaded_at):
        raise ValidationError(
            "attachment uploaded_at must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)"
        )
    title = value.get("title", "")
    if not isinstance(title, str):
        raise ValidationError("attachment title must be a string")
    if len(title.strip()) > ATTACHMENT_TITLE_MAX_LENGTH:
        raise ValidationError(
            f"attachment title must be at most {ATTACHMENT_TITLE_MAX_LENGTH} characters"
        )
    order = value.get("order", 0)
    if not _is_int_not_bool(order) or int(order) < 0:
        raise ValidationError("attachment order must be an integer >= 0")
    return AttachmentMeta(
        id=att_id,
        kind=kind,
        filename=filename.strip(),
        mime=mime.strip(),
        size=int(size),  # type: ignore[arg-type]
        uploaded_at=str(uploaded_at),
        title=title.strip(),
        order=int(order),
    )


def serialize_attachment_meta(meta: AttachmentMeta) -> dict[str, Any]:
    """Serialize attachment metadata to its stored/exported shape."""

    return {
        "id": str(meta.id),
        "kind": meta.kind,
        "filename": meta.filename,
        "mime": meta.mime,
        "size": int(meta.size),
        "uploaded_at": meta.uploaded_at,
        "title": meta.title,
        "order": int(meta.order),
    }


def load_attachments(value: object) -> list[AttachmentMeta]:
    """Read a stored ``attachments`` list, tolerating what predates the field.

    A missing or non-list value reads as none rather than failing the whole
    item; a malformed *entry* is the caller's problem, because dropping one
    silently would lose the only reference to a file on disk.
    """

    if not isinstance(value, list):
        return []
    return [validate_attachment_meta(entry) for entry in value]


def validate_inspection_date(inspection_date: str | None) -> str | None:
    """Validate inspection_date format (YYYY-MM-DD) if provided.

    The date is when the item is next due for inspection; a past date is
    accepted and means the inspection is overdue.
    """

    if inspection_date is None:
        return None
    return normalize_date_yyyy_mm_dd(inspection_date)


def validate_reminder_date(reminder_date: str | None) -> str | None:
    """Validate the reminder anchor's format if provided.

    A past anchor is accepted: it is the date the series counts from, and a
    recurring reminder set up years ago is still due on whichever occurrence
    comes next.
    """

    if reminder_date is None:
        return None
    return normalize_date_yyyy_mm_dd(reminder_date)


def validate_reminder_interval(value: object) -> ReminderInterval | None:
    """Validate `{unit, count}` into a `ReminderInterval`, or none.

    Rejects a zero or negative count outright: an interval of zero occurrences
    apart has no next occurrence, and expanding it would not terminate.
    """

    if value is None:
        return None
    if isinstance(value, ReminderInterval):
        interval = value
    elif isinstance(value, Mapping):
        # `count` is carried through unchecked so the guards below can name what
        # is wrong with it; coercing here would turn "every True days" into 1.
        interval = ReminderInterval(unit=str(value.get("unit", "")), count=value.get("count", 0))
    else:
        raise ValidationError("reminder_interval must be an object with 'unit' and 'count'")

    if interval.unit not in REMINDER_UNITS:
        raise ValidationError(f"reminder_interval.unit must be one of {', '.join(REMINDER_UNITS)}")
    if not _is_int_not_bool(interval.count) or interval.count < 1:
        raise ValidationError("reminder_interval.count must be an integer >= 1")
    if interval.count > REMINDER_COUNT_MAX:
        raise ValidationError(f"reminder_interval.count must be <= {REMINDER_COUNT_MAX}")
    return ReminderInterval(unit=interval.unit, count=int(interval.count))


def validate_reminder_rules(
    *, reminder_date: str | None, reminder_interval: object
) -> tuple[str | None, ReminderInterval | None]:
    """Validate the pair, and hold the one rule that binds them.

    An interval with no date has nothing to count from, so it is refused rather
    than silently stored — an item carrying a recurrence that can never produce
    an occurrence reads as a reminder that quietly does nothing.
    """

    normalized_date = validate_reminder_date(reminder_date)
    interval = validate_reminder_interval(reminder_interval)
    if interval is not None and normalized_date is None:
        raise ValidationError("reminder_interval requires a reminder_date to count from")
    return normalized_date, interval


def load_reminder_anchor(value: object, *, reminder_date: str | None) -> str | None:
    """Read a stored series anchor, falling back to the date it belongs to.

    Tolerant, the way `load_reminder_interval` is: every store written before v9
    carries no anchor, and a reminder that has never been bumped has one equal to
    its date anyway — so "absent" and "equal" have to reach the same answer.

    An anchor *after* its date describes no series this build can walk (the
    occurrences would all start beyond the date they are supposed to lead to), so
    it is read as the date rather than refused. Compared as text, which is what
    fixed-width ISO dates are for.
    """

    if reminder_date is None:
        return None
    if not isinstance(value, str) or not value or value > reminder_date:
        return reminder_date
    try:
        return normalize_date_yyyy_mm_dd(value)
    except ValidationError:
        return reminder_date


def serialize_reminder_interval(interval: ReminderInterval | None) -> dict[str, Any] | None:
    """The stored and wire shape of an interval."""

    if interval is None:
        return None
    return {"unit": interval.unit, "count": interval.count}


def load_reminder_interval(value: object) -> ReminderInterval | None:
    """Read a stored interval, treating anything unreadable as none.

    Tolerant on the load path where `validate_reminder_interval` is strict: a
    row whose interval cannot be read still has an item and an anchor worth
    keeping, and refusing the store over it would cost more than the recurrence.
    """

    try:
        return validate_reminder_interval(value)
    except ValidationError:
        return None


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


def _validate_optional_text(
    value: object, field_name: str, *, max_length: int | None = None, previous: str | None = None
) -> None:
    """Ensure an optional free-text field is a string or None, within its cap.

    Non-text values (list/dict/number) would otherwise reach the search-index
    build and crash mid-way, leaving a partially-indexed item.

    ``previous`` is the value the item already carries, and the cap refuses
    *growth* past it: a value over the cap but no longer than the stored one is
    accepted, so an item that predates the cap can still be edited — including
    by the edit that trims the excess without clearing it in one go.
    """
    if value is None:
        return
    if not isinstance(value, str):
        raise ValidationError(f"{field_name} must be a string or null")
    if (
        max_length is not None
        and len(value) > max_length
        and (previous is None or len(value) > len(previous))
    ):
        raise ValidationError(f"{field_name} must be at most {max_length} characters")


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
    known_statuses: Collection[str] = ITEM_STATUSES,
) -> Item:
    """Create a validated Item from an ItemCreate payload.

    Args:
        payload: Input fields from the client.
        locations_by_id: Optional map of locations used to validate location_id and
            construct a denormalized location_path when provided.
        known_statuses: The live status slugs to validate ``status`` against.

    Returns:
        A fully-populated Item instance with defaults applied.
    """

    raw_name = payload.get("name")
    if raw_name is None:
        raise ValidationError("name is required")
    # Type before shape: the command schema types `name` as `object` so a wrong
    # type answers `validation_error` rather than an HA-core schema rejection,
    # and `.strip()` on a non-string would reach that route as `unknown_error`.
    if not isinstance(raw_name, str):
        raise ValidationError("name is required and must be a non-empty string")
    # Trim whitespace before validation and persistence
    name = raw_name.strip()
    description = payload.get("description")
    # Type before conversion, for the same reason `name` is checked before
    # `.strip()`: the command schema types `quantity` as `object`, and `int()`
    # over a non-numeric string raises `ValueError`, which routes to
    # `unknown_error` instead of naming the field.
    raw_quantity = payload.get("quantity", 1)
    if not _is_int_not_bool(raw_quantity):
        raise ValidationError("quantity must be an integer >= 0")
    quantity = int(raw_quantity)
    status = validate_item_status(
        payload.get("status", DEFAULT_ITEM_STATUS), known_statuses=known_statuses
    )
    checked_out = bool(payload.get("checked_out", False))
    due_date = payload.get("due_date")
    inspection_date = payload.get("inspection_date")
    location_id_raw = payload.get("location_id")
    tags = validate_tags(payload.get("tags"))
    category = payload.get("category")
    low_stock_threshold = payload.get("low_stock_threshold")
    custom_fields = payload.get("custom_fields", {})

    _validate_optional_text(description, "description", max_length=DESCRIPTION_MAX_LENGTH)
    _validate_optional_text(category, "category", max_length=CATEGORY_MAX_LENGTH)
    _validate_item_core_fields(name, quantity, low_stock_threshold)
    validate_custom_fields(custom_fields)
    normalized_due_date = validate_due_date_rules(checked_out=checked_out, due_date=due_date)
    normalized_inspection_date = validate_inspection_date(inspection_date)
    normalized_reminder_date, reminder_interval = validate_reminder_rules(
        reminder_date=payload.get("reminder_date"),
        reminder_interval=payload.get("reminder_interval"),
    )

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
        reminder_date=normalized_reminder_date,
        # Setting a reminder is saying where its series starts, so the anchor
        # follows the date. Only a bump moves one without the other.
        reminder_anchor=normalized_reminder_date,
        reminder_interval=reminder_interval,
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
        _validate_optional_text(
            update["description"],
            "description",
            max_length=DESCRIPTION_MAX_LENGTH,
            previous=new_item.description,
        )
        new_item.description = update["description"]


def _update_quantity(new_item: Item, update: ItemUpdate) -> None:
    if "quantity" in update:
        q = update["quantity"]
        if not _is_int_not_bool(q) or q < 0:
            raise ValidationError("quantity must be an integer >= 0")
        new_item.quantity = q


def _update_status(new_item: Item, update: ItemUpdate, known_statuses: Collection[str]) -> None:
    if "status" in update:
        new_item.status = validate_item_status(update["status"], known_statuses=known_statuses)


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


def _update_reminder(new_item: Item, update: ItemUpdate) -> None:
    """Apply either half of the reminder, holding the pair's rule across both.

    An update naming only one of the two is validated against the item's stored
    other half, so clearing the date of a recurring reminder is refused rather
    than leaving an interval with nothing to count from.

    Writing a *different* date re-anchors the series on it: `ItemUpdate` carries
    no anchor of its own, deliberately, because a household picking a date is
    saying where the series starts. Re-sending the date the item already carries
    says nothing, so it must not move the anchor — the card's editor puts every
    field in every payload, changed or not, and re-anchoring on presence alone
    would let an ordinary save walk a month-end series off its day one short
    month at a time. `Repository.bump_reminder` is the one path that moves the
    date and keeps the anchor, which is what makes a bumped month-end series stay
    on its own day.
    """

    if "reminder_date" not in update and "reminder_interval" not in update:
        return
    previous_reminder_date = new_item.reminder_date
    date_value = update["reminder_date"] if "reminder_date" in update else new_item.reminder_date
    interval_value = (
        update["reminder_interval"] if "reminder_interval" in update else new_item.reminder_interval
    )
    new_item.reminder_date, new_item.reminder_interval = validate_reminder_rules(
        reminder_date=date_value, reminder_interval=interval_value
    )
    if "reminder_date" in update and new_item.reminder_date != previous_reminder_date:
        new_item.reminder_anchor = new_item.reminder_date
    elif new_item.reminder_date is None:
        # The interval was cleared alongside a date that was already absent, or
        # the pair rule left nothing behind. An anchor without a date names a
        # series with no next occurrence.
        new_item.reminder_anchor = None


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
        new_item.tags = validate_tags(update.get("tags") or [], previous=new_item.tags)
    if "category" in update:
        _validate_optional_text(
            update["category"],
            "category",
            max_length=CATEGORY_MAX_LENGTH,
            previous=new_item.category,
        )
        new_item.category = update["category"]
    if "low_stock_threshold" in update:
        thr = update["low_stock_threshold"]
        if thr is not None and (not _is_int_not_bool(thr) or thr < 0):
            raise ValidationError("low_stock_threshold must be an integer >= 0 or null")
        new_item.low_stock_threshold = thr


def _update_custom_fields(new_item: Item, update: ItemUpdate) -> None:
    to_set = update.get("custom_fields_set", {})
    to_unset = update.get("custom_fields_unset", [])
    before = len(new_item.custom_fields)
    if to_set:
        validate_custom_fields(to_set, previous=new_item.custom_fields)
        new_item.custom_fields = {**new_item.custom_fields, **to_set}
    if to_unset:
        new_item.custom_fields = {
            k: v for k, v in new_item.custom_fields.items() if k not in set(to_unset)
        }
    # The key cap bounds the item, not the patch: a two-key patch onto an item
    # already at the limit is what would otherwise walk past it. Judged on the
    # result of the whole call, and only when the call grew the map — so an item
    # that predates the cap can still be edited down.
    after = len(new_item.custom_fields)
    if after > CUSTOM_FIELDS_MAX_KEYS and after > before:
        raise ValidationError(f"custom_fields must have at most {CUSTOM_FIELDS_MAX_KEYS} keys")


def apply_item_update(
    item: Item,
    update: ItemUpdate,
    *,
    locations_by_id: dict[str, Location] | None = None,
    known_statuses: Collection[str] = ITEM_STATUSES,
) -> Item:
    """Apply an update payload to an Item and return a new updated instance."""

    new_item = replace(item)  # shallow copy

    _update_name_and_description(new_item, update)
    _update_quantity(new_item, update)
    _update_status(new_item, update, known_statuses)
    _update_checkout_and_due_date(new_item, update)
    _update_inspection_date(new_item, update)
    _update_reminder(new_item, update)
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


def item_reminder_is_due(item: Item, *, today: str = "") -> bool:
    """Return True once the item's reminder has come round.

    Inclusive of today, unlike the two overdue tests above: a reminder names the
    day something should be done, so that day is when it is asking rather than
    the last day it is not. A one-off counts the same as a series — both are a
    date the household said to be reminded on.
    """

    if not item.reminder_date:
        return False
    return item.reminder_date <= (today or today_utc_date())


def _parse_location_selection(location_ids: Sequence[str]) -> list[uuid.UUID]:
    """The selected location ids as UUIDs, dropping any that will not parse.

    An unparsable id contributes nothing rather than raising, so a selection
    of only bad ids matches nothing — which is what a single bad id has always
    done. The parse belongs here rather than in the per-item predicate: the
    selection is constant for a whole query, and rebuilding the same UUID once
    per candidate is measurable on an inventory of any size.
    """

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
    """True when the item sits in — or under — any of the selected locations."""

    if not needles:
        return True
    if not item.location_id:
        return False
    for needle in needles:
        if item.location_id == needle:
            return True
        if include_subtree and item.location_path.id_path and needle in item.location_path.id_path:
            return True
    return False


def filter_items(
    items: Iterable[Item],
    flt: ItemFilter | None = None,
    *,
    known_statuses: Collection[str] = ITEM_STATUSES,
) -> list[Item]:
    """Filter items according to ItemFilter semantics.

    - q: case-insensitive match in name, description, tags, location display_path
    - tags_any: at least one matches
    - tags_all: all must be present
    - category / categories: case-insensitive equals any of the selection
    - status: exact match against one of the known statuses
    - checked_out: exact match
    - low_stock_only: quantity <= threshold (0 valid, None disables)
    - orphaned_only: only items without a location (location_id is None)
    - overdue_only: due_date set and strictly before today (UTC)
    - inspection_overdue_only: inspection_date set and strictly before today (UTC)
    - reminder_due_only: reminder_date set and on or before today (UTC) — today
      counts, because a reminder names the day it is asking about
    - location_id / location_ids: equals any of the selection; include_subtree
      optionally includes descendants (by prefix of id_path), one flag for all
    - updated_after/created_after: ISO-8601 UTC with 'Z', strictly greater-than
    - updated_before/created_before: ISO-8601 UTC with 'Z', strictly less-than
    """

    if not flt:
        return list(items)

    q = (flt.get("q") or "").strip()
    tags_any = normalize_tags(flt.get("tags_any")) if "tags_any" in flt else []
    tags_all = normalize_tags(flt.get("tags_all")) if "tags_all" in flt else []
    categories = set(selected_categories(flt))
    status = (
        validate_item_status(flt["status"], known_statuses=known_statuses)
        if "status" in flt
        else None
    )
    checked_out = flt.get("checked_out") if "checked_out" in flt else None
    low_stock_only = bool(flt.get("low_stock_only")) if "low_stock_only" in flt else False
    orphaned_only = bool(flt.get("orphaned_only")) if "orphaned_only" in flt else False
    overdue_only = bool(flt.get("overdue_only")) if "overdue_only" in flt else False
    inspection_overdue_only = (
        bool(flt.get("inspection_overdue_only")) if "inspection_overdue_only" in flt else False
    )
    reminder_due_only = bool(flt.get("reminder_due_only")) if "reminder_due_only" in flt else False
    location_ids = selected_location_ids(flt)
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
    # Parsed once for the whole query, beside the bounds, rather than once per
    # candidate item. A selection that parses to nothing keeps its old meaning:
    # it selects nothing, rather than falling through to "no location filter".
    location_needles = _parse_location_selection(location_ids)
    if location_ids and not location_needles:
        return []
    today = (
        today_utc_date() if (overdue_only or inspection_overdue_only or reminder_due_only) else ""
    )

    predicates_active = (
        bool(q)
        or bool(tags_any)
        or bool(tags_all)
        or bool(categories)
        or status is not None
        or checked_out is not None
        or low_stock_only
        or orphaned_only
        or overdue_only
        or inspection_overdue_only
        or reminder_due_only
        or bool(location_ids)
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
        matches_category = (not categories) or (
            (it.category or "").strip().casefold() in categories
        )
        matches_status = (status is None) or (it.status == status)
        matches_checked = (checked_out is None) or (it.checked_out == bool(checked_out))
        matches_low_stock = (not low_stock_only) or item_is_low_stock(it)
        matches_orphaned = (not orphaned_only) or (it.location_id is None)
        matches_overdue = (not overdue_only) or item_is_overdue(it, today=today)
        matches_inspection = (not inspection_overdue_only) or item_inspection_is_overdue(
            it, today=today
        )
        matches_reminder = (not reminder_due_only) or item_reminder_is_due(it, today=today)
        matches_location = _item_matches_locations(it, location_needles, include_subtree)
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
            and matches_reminder
            and matches_location
            and matches_updated
            and matches_created
        )
        if ok:
            filtered.append(it)

    return filtered


#: What an item with no location sorts under in ascending order.
#: A location path's sort key is built from location *names*, so a printable
#: sentinel like ``date_sort_key``'s ``"~"`` would be outranked by any name
#: beginning with an accented or non-Latin letter — "Éclairage" folds to a
#: character well above ``~``. The highest code point cannot be outranked.
UNLOCATED_SORT_KEY: Final[str] = "\U0010ffff"


def location_sort_key(path: LocationPath, order: str) -> str:
    """Return a scalar sort key for an item's denormalized location path.

    Items with no location sort last in BOTH orders — the rule
    :func:`date_sort_key` applies to undated items. Their stored key is the
    empty string, which a plain sort would float to the top of an ascending
    list, so ascending substitutes the sentinel above and descending keeps the
    empty string, which a reversed sort places last. The repository's cursor
    pagination reads the same key, so page boundaries agree with this ordering.
    """

    if not path.sort_key:
        return UNLOCATED_SORT_KEY if order == "asc" else ""
    return path.sort_key


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
    due_date / inspection_date place undated items last in both orders, and
    location does the same for items filed nowhere.
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
    if field not in SORT_FIELDS:
        raise ValidationError(f"sort.field must be one of: {', '.join(sorted(SORT_FIELDS))}")
    if order not in SORT_ORDERS:
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
    elif field == "reminder_date":
        result.sort(key=lambda x: date_sort_key(x.reminder_date, order), reverse=reverse)
    elif field == "location":
        result.sort(key=lambda x: location_sort_key(x.location_path, order), reverse=reverse)
    elif field == "created_at":
        result.sort(key=lambda x: x.created_at, reverse=reverse)
    else:  # updated_at
        result.sort(key=lambda x: x.updated_at, reverse=reverse)

    return result
