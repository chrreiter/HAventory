"""Typed models and validation helpers for HAventory.

This module defines the persisted shapes for Item and Location, along with
lightweight input schemas for create/update/filter/sort operations. It also
provides validation and normalization helpers to enforce invariants and produce
denormalized location paths.

The intent is to keep these models framework-agnostic and free of I/O. Higher
layers (WebSocket/API, storage) are expected to compose these helpers. The one
Home Assistant import is `dt_util`, for the household's own calendar day: it
reads a module global rather than a `hass`, and every date a user reads or
writes is measured in that day.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Callable, Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any, Final, Literal, NotRequired, TypedDict

from homeassistant.util import dt as dt_util

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

    def to_dict(self) -> dict[str, Any]:
        """The serialized shape, nested under an item's ``location_path`` and a
        location's ``path``.

        The lists are copied: every caller receives a payload it is free to edit,
        and an item's own path must not change because something edited what it
        was handed.
        """

        return {
            "id_path": [str(entry) for entry in self.id_path],
            "name_path": list(self.name_path),
            "display_path": self.display_path,
            "sort_key": self.sort_key,
        }

    @classmethod
    def from_dict(cls, data: object) -> LocationPath:
        """Read back what ``to_dict`` wrote; ``None`` reads as the empty path.

        ``sort_key`` is backfilled from ``display_path`` when the payload
        carries none: stores written before it was persisted have to sort
        alongside the ones that were, and it is derived, so recomputing it
        costs nothing but the read.

        What is refused is a value of the wrong shape — anything present that
        is not an object, and an ``id_path`` entry that is not a UUID v4. A row
        carrying one of those is corrupt rather than merely old, and refusing
        is what lets a load drop it and report it.
        """

        if data is None:
            return cls(id_path=[], name_path=[], display_path="", sort_key="")
        if not isinstance(data, Mapping):
            raise ValidationError("a location path must be an object")
        display = str(data.get("display_path", ""))
        return cls(
            id_path=[
                parse_uuid4(str(entry), field_name="path.id_path")
                for entry in (data.get("id_path") or [])
            ],
            name_path=list(data.get("name_path") or []),
            display_path=display,
            sort_key=str(data.get("sort_key", "")) or normalize_text_for_sort(display),
        )


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

    def to_dict(self) -> dict[str, Any]:
        """The one serialized shape of a location.

        The store, the export document and the wire all send exactly this — a
        location has no derived field the way an item has ``effective_area_id``.
        """

        return {
            "id": str(self.id),
            "name": self.name,
            "parent_id": str(self.parent_id) if self.parent_id is not None else None,
            "area_id": str(self.area_id) if self.area_id is not None else None,
            "path": self.path.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any], *, fallback_id: str | None = None) -> Location:
        """Read back what ``to_dict`` wrote, refusing a row no write path wrote.

        ``fallback_id`` is the key the row was stored under, used when the row
        itself carries no ``id``.

        The name goes through :func:`validate_required_name` rather than
        ``str()``: a missing key would read as ``""`` and a stored ``null`` as
        the literal ``"None"``, putting a location in memory that no write path
        would accept. Raising here is what lets a load drop the row and report
        it instead.
        """

        parent_id = data.get("parent_id")
        area_id = data.get("area_id")
        return cls(
            id=parse_uuid4(str(data.get("id", fallback_id)), field_name="location.id"),
            parent_id=(
                parse_uuid4(str(parent_id), field_name="location.parent_id")
                if parent_id is not None
                else None
            ),
            name=validate_required_name(data.get("name")),
            area_id=str(area_id) if area_id is not None else None,
            path=LocationPath.from_dict(data.get("path")),
        )


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

    def to_dict(self) -> dict[str, Any]:
        """The one serialized shape of an item.

        This is what the store holds and what the export document carries, byte
        for byte. The WebSocket and service surfaces send it with
        ``effective_area_id`` added — resolved from the location tree per
        request and never stored, which is why it is added at that boundary
        (``serialization.serialize_item``) rather than here.

        ``location_path`` is derived too, but it *is* stored: the backend
        recomputes it on every location change and no client can write it, and
        the store carries the last computed value so a boot has the paths
        before the tree is walked.
        """

        return {
            "id": str(self.id),
            "name": self.name,
            "description": self.description,
            "quantity": int(self.quantity),
            "status": self.status,
            "checked_out": bool(self.checked_out),
            "due_date": self.due_date,
            "inspection_date": self.inspection_date,
            "reminder_date": self.reminder_date,
            "reminder_anchor": self.reminder_anchor,
            "reminder_interval": serialize_reminder_interval(self.reminder_interval),
            "location_id": str(self.location_id) if self.location_id is not None else None,
            "tags": list(self.tags),
            "category": self.category,
            "low_stock_threshold": self.low_stock_threshold,
            "custom_fields": dict(self.custom_fields),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "version": int(self.version),
            "location_path": self.location_path.to_dict(),
            "attachments": [serialize_attachment_meta(meta) for meta in self.attachments],
        }

    @classmethod
    def from_dict(
        cls,
        data: Mapping[str, Any],
        *,
        known_statuses: Collection[str] = ITEM_STATUSES,
        fallback_id: str | None = None,
    ) -> Item:
        """Read back what ``to_dict`` wrote, refusing a row no write path wrote.

        ``fallback_id`` is the key the row was stored under, used when the row
        itself carries no ``id``. ``known_statuses`` has to be the live set:
        passing the built-ins while the store defines more would rewrite every
        item on a custom status to the default.

        Absent fields read as the value the build that introduced them writes
        for an item that has none, so a store written by an older build loads
        without a migration touching every row. What is *not* tolerated is a
        malformed value: an unreadable name, id or attachment entry is a corrupt
        row, and raising is what lets a load drop it and report it.
        """

        location_id = data.get("location_id")
        created_at = _coerce_canonical_ts(data.get("created_at"))
        return cls(
            id=parse_uuid4(str(data.get("id", fallback_id)), field_name="item.id"),
            name=validate_required_name(data.get("name")),
            description=data.get("description"),
            quantity=int(data.get("quantity", 0)),
            status=validate_item_status(
                data.get("status"), known_statuses=known_statuses, default=DEFAULT_ITEM_STATUS
            ),
            checked_out=bool(data.get("checked_out", False)),
            due_date=data.get("due_date"),
            inspection_date=data.get("inspection_date"),
            reminder_date=data.get("reminder_date"),
            # Equal to the date for any reminder nobody has bumped, which is
            # what a store written before the anchor existed carries.
            reminder_anchor=load_reminder_anchor(
                data.get("reminder_anchor"), reminder_date=data.get("reminder_date")
            ),
            reminder_interval=load_reminder_interval(data.get("reminder_interval")),
            location_id=(
                parse_uuid4(str(location_id), field_name="item.location_id")
                if location_id is not None
                else None
            ),
            tags=list(data.get("tags", []) or []),
            category=data.get("category"),
            low_stock_threshold=data.get("low_stock_threshold"),
            custom_fields=dict(data.get("custom_fields", {}) or {}),
            # Timestamps compare lexicographically for sort and range filters,
            # so a missing, null or non-canonical one is backfilled rather than
            # carried: the alternative is a row that sorts arbitrarily.
            created_at=created_at,
            updated_at=_coerce_canonical_ts(data.get("updated_at"), fallback=created_at),
            version=int(data.get("version", 1)),
            location_path=LocationPath.from_dict(data.get("location_path")),
            # Tolerant of absence and of a non-list value (both read as none),
            # but not of a malformed *entry*: dropping one would lose the only
            # reference to a file on disk, which the orphan sweep then deletes.
            attachments=load_attachments(data.get("attachments")),
        )


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
    # When true, only items whose due date has come round — today included,
    # unlike `overdue_only` (see filter_items)
    checked_out_due_only: bool
    # When true, only items whose inspection_date has passed (see filter_items)
    inspection_overdue_only: bool
    # When true, only items whose inspection is being asked for — today
    # included, unlike `inspection_overdue_only` (see filter_items)
    inspection_due_only: bool
    # When true, only items whose reminder has come round — today included,
    # like the two `*_due_only` keys above (see filter_items)
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


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_date_yyyy_mm_dd(value: str, *, field_name: str) -> str:
    """Validate and normalize a YYYY-MM-DD date string.

    ``field_name`` is required because the refusal names it: several fields run
    through here, and the message is the whole of what a script, an action call
    or an import document gets back.

    Returns the normalized value or raises ValidationError.
    """

    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ValidationError(f"{field_name} must be in 'YYYY-MM-DD' format")
    try:
        # This ensures the date components are valid (e.g., no Feb 30)
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValidationError(f"{field_name} must be a valid calendar date (YYYY-MM-DD)") from exc
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
    What ``_item_matches_q`` reads both the query and the item's text through, so
    "case-insensitive, accent-insensitive" means one thing on both sides of the
    comparison.
    """

    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_text = nfkd.encode("ascii", "ignore").decode("ascii")
    return ascii_text.casefold().strip()


def normalize_tags(tags: list[str] | None) -> list[str]:
    """Lowercase, trim, and de-duplicate a list of tags, preserving order.

    The tolerant reader, for an import document: it coerces what it is handed
    rather than refusing it, because a restore must not fail on a row an earlier
    release wrote. A tag list arriving from a client goes through
    :func:`validate_tags` or :func:`selected_tags` instead, which refuse a value
    that is not a list of strings rather than absorbing it.
    """

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


def validate_required_name(value: object) -> str:
    """A name that survives a trim, or a ``ValidationError``. Returns it trimmed.

    The one rule every item and location write path enforces, in one place, so
    that the *load* path can enforce it too: a stored row whose name is missing,
    ``null``, not a string, or only whitespace is not something this codebase
    could have written, and reading it as ``""`` — or, for a ``null``, as the
    literal ``"None"`` — puts a row in memory that no write path would accept
    and that the first mutation afterwards makes permanent. An empty name also
    produces no search-index tokens, and reaches the to-do bridge as a line whose
    quantity suffix is all there is to read.

    Deliberately **not** the length cap. The load path grandfathers over-cap
    stored values elsewhere, so refusing one here would reject a store this
    integration itself wrote.
    """

    if not isinstance(value, str) or not value.strip():
        raise ValidationError("name is required and must be a non-empty string")
    return value.strip()


def validate_write_name(name: object) -> str:
    """Validate a name a client wrote and return a trimmed value.

    The write path's rule, for an item and a location alike: what the load path
    requires, plus the length cap the load path deliberately does not apply.
    """

    trimmed = validate_required_name(name)
    if len(trimmed) > NAME_MAX_LENGTH:
        raise ValidationError(f"name must be at most {NAME_MAX_LENGTH} characters")
    return trimmed


def validate_custom_fields(
    values: dict[str, ScalarValue],
    *,
    previous: Mapping[str, ScalarValue] | None = None,
    field_name: str = "custom_fields",
) -> None:
    """Validate custom field keys and values are scalars of allowed types.

    ``field_name`` names the key the *caller* sent in the shape refusal, since
    a patch arrives under a name of its own. The caps keep naming
    ``custom_fields``: what they bound is the item's map, not the patch.

    ``previous`` is the map the item already carries, and the caps refuse
    *growth* past it, the way :func:`validate_tags` treats its ``previous``: a
    key the item already has is not refused for its length, a stored string
    value may stay over the cap as long as the edit does not lengthen it, and
    a patch carrying more keys than the cap passes when the item already
    carried that many. Without ``previous`` (a brand-new item) every cap is
    absolute.
    """

    if not isinstance(values, dict):
        raise ValidationError(f"{field_name} must be a mapping of string keys to scalars")
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


def validate_tags(tags: object, *, previous: Collection[str] = ()) -> list[str]:
    """Normalize an *item's* tag list and enforce the item-side tag caps.

    Every item write crosses here, which is why the shape is checked here too:
    the command schemas type ``tags`` as ``object``, and :func:`normalize_tags`
    iterates whatever it is handed, so a string would reach the store as its
    characters. ``None`` is what clears the list.

    Separate from :func:`selected_tags`, which reads a tag *query*: a filter
    naming sixty tags is a query, not an item, and is not over any limit.

    ``previous`` is the item's current tag list, and the caps are enforced
    against what the edit *adds*. An item that predates the caps can therefore
    still be edited — including by the edit that removes the excess, which an
    absolute check would refuse along with everything else.
    """

    normalized = normalize_string_list(tags, field_name="tags", casefold=True)
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


def require_string_list(value: object, *, field_name: str) -> list[str]:
    """Return a list of strings a caller wrote whole, entry for entry.

    A bare string is the mistake worth naming rather than absorbing: iterating
    one yields characters, so ``categories: "Tools"`` would quietly filter by
    five single letters instead of by a category, and ``tags: "kitchen"`` would
    store seven one-letter tags. ``None`` is the empty list — on an item's tags,
    the value that clears them.

    Nothing is trimmed or de-duplicated here, which is what the two commands
    naming a whole set as a permutation need: ``status/reorder`` and
    ``item/attachment/reorder`` refuse a list that names one member twice, and
    de-duplicating first would let it through.
    """

    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(f"{field_name} must be a list of strings")
    for raw in value:
        if not isinstance(raw, str):
            raise ValidationError(f"{field_name} must be a list of strings")
    return list(value)


def normalize_string_list(value: object, *, field_name: str, casefold: bool = False) -> list[str]:
    """Normalize a list of strings a caller writes whole: trim, drop blanks, dedupe."""

    seen: set[str] = set()
    result: list[str] = []
    for raw in require_string_list(value, field_name=field_name):
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
    for value in normalize_string_list(
        flt.get("categories"), field_name="categories", casefold=True
    ):
        if value not in selection:
            selection.append(value)
    return selection


def selected_tags(flt: ItemFilter, key: Literal["tags_any", "tags_all"]) -> list[str]:
    """The casefolded tags one of a filter's two tag keys names.

    Same shape rule as :func:`selected_categories`, and for the same reason: a
    bare string iterates as its characters, so ``tags_any: "kitchen"`` would
    query seven one-letter tags and quietly answer with nothing. Read through
    here by the scan and by the index pre-filter alike, so a query cannot be
    refused by one and absorbed by the other.
    """

    return normalize_string_list(flt.get(key), field_name=key, casefold=True)


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
    for value in normalize_string_list(flt.get("location_ids"), field_name="location_ids"):
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
    return normalize_date_yyyy_mm_dd(due_date, field_name="due_date")


def validate_item_status(
    value: object,
    *,
    known_statuses: Collection[str] = ITEM_STATUSES,
    default: ItemStatus | None = None,
) -> ItemStatus:
    """Return ``value`` when it is one of the live statuses, or refuse it.

    Status is non-nullable: an item always has one, so ``None`` is rejected the
    same as any other unknown value ("ok" is the way to clear a flagged state).

    ``known_statuses`` is an explicit parameter rather than module-level mutable
    state: the default keeps every caller that has no repository to ask meaning
    what it has always meant, and nothing global needs resetting between tests.

    ``default`` is what a load path passes to read a stored payload tolerantly:
    a store written before the field existed (or hand-edited into an unknown
    value) reads as that status rather than failing the whole item. A caller
    loading a store MUST pass the definitions that store carries — with the
    built-ins alone, every custom status would be silently rewritten to the
    default on the first restart after the upgrade that introduced it.
    """

    if isinstance(value, str) and value in known_statuses:
        return value
    if default is not None:
        return default
    raise ValidationError(f"status must be one of: {', '.join(sorted(known_statuses))}")


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


def validate_optional_date(value: str | None, *, field_name: str) -> str | None:
    """Validate one optional YYYY-MM-DD field, naming it in any refusal.

    Only the shape is checked, because a date in the past means something on
    every field that runs through here: an inspection date behind today is
    overdue, and a reminder anchor behind today is still where its series
    counts from.
    """

    if value is None:
        return None
    return normalize_date_yyyy_mm_dd(value, field_name=field_name)


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

    normalized_date = validate_optional_date(reminder_date, field_name="reminder_date")
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
        return normalize_date_yyyy_mm_dd(value, field_name="reminder_anchor")
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


def walk_location_chain(
    start_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> Iterator[Location]:
    """Yield the locations from ``start_id`` upwards, the node itself first.

    The one walk up the parent chain. It ends without raising on a parent id no
    location carries, on an id it has already yielded, and at
    ``LOCATION_GUARD_MAX_STEPS``: a hand-edited or corrupt store can close a
    chain into a loop, and the item-index path walks it on every mutation, so
    the walk has to end by itself rather than throw there.

    A caller that needs the whole chain therefore cannot read a short answer as
    a complete one — :func:`location_chain_to_root` is that caller's version.
    """

    cursor: str | None = str(start_id)
    seen: set[str] = set()
    while cursor is not None and cursor not in seen and len(seen) < LOCATION_GUARD_MAX_STEPS:
        location = locations_by_id.get(cursor)
        if location is None:
            return
        seen.add(cursor)
        yield location
        cursor = str(location.parent_id) if location.parent_id is not None else None


def location_chain_to_root(
    leaf_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> list[Location]:
    """The chain root→leaf, or a ``ValidationError`` naming what stopped it.

    A chain that does not reach a root is refused rather than shortened,
    because what is built from it is the denormalized path stored on the node
    and on every item under it: a partial chain would store a display path
    missing its leading names.
    """

    chain = list(walk_location_chain(leaf_id, locations_by_id=locations_by_id))
    if not chain:
        raise ValidationError("location_id must reference an existing location")
    last_parent = chain[-1].parent_id
    if last_parent is not None:
        if len(chain) >= LOCATION_GUARD_MAX_STEPS or str(last_parent) in {
            str(node.id) for node in chain
        }:
            raise ValidationError("location graph too deep or cyclic")
        raise ValidationError("location_id must reference an existing location chain")
    chain.reverse()
    return chain


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
    leaf_location_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> LocationPath:
    """The denormalized path of one location, given the map it lives in.

    Raises ``ValidationError`` when the leaf id is unknown or the chain above
    it never reaches a root.
    """

    return build_location_path(
        location_chain_to_root(leaf_location_id, locations_by_id=locations_by_id)
    )


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


def validate_quantity(value: object) -> int:
    """Return the quantity, or refuse the value with the one message there is.

    Public because a caller that holds an unvalidated quantity before it holds
    an item — `haventory/item/set_quantity` and the `items/bulk` row of the same
    kind — checks the value first, so a payload that is wrong about both is
    answered on the value rather than on the id.

    Spelled out rather than through ``_is_int_not_bool`` so the comparison and
    the return narrow to ``int``.
    """

    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError("quantity must be an integer >= 0")
    return value


@dataclass(frozen=True, slots=True)
class _ItemWrite:
    """One item write in progress, as the field rules see it.

    ``draft`` is what the write starts from and what the rules fill in: the
    field defaults on a create, a copy of the stored item on an update. A cap
    that refuses *growth* reads what the item already carries off that same
    draft, which on a create is empty — so one rule serves both paths.
    """

    draft: Item
    payload: Mapping[str, Any]
    creating: bool
    locations_by_id: dict[str, Location] | None
    known_statuses: Collection[str]


def _write_name(write: _ItemWrite) -> None:
    """Required on a create; a null on an update leaves the stored name alone.

    The field is non-nullable and the card's editor sends every field it holds,
    so a null has to read as "this write does not name the name".
    """

    value = write.payload.get("name")
    if value is None and not write.creating:
        return
    # Type before shape: the command schemas type `name` as `object` so a wrong
    # type is answered here as `validation_error` rather than by an HA-core
    # schema rejection, and a `.strip()` on a non-string would leave through
    # `unknown_error` instead of naming the field.
    write.draft.name = validate_write_name(value)


def _write_optional_text(write: _ItemWrite, *, key: str, max_length: int) -> None:
    """One nullable free-text field, held to its cap against what is stored.

    ``key`` names the payload field and the item's attribute alike.
    """

    if key not in write.payload:
        return
    value = write.payload[key]
    _validate_optional_text(value, key, max_length=max_length, previous=getattr(write.draft, key))
    setattr(write.draft, key, value)


def _write_quantity(write: _ItemWrite) -> None:
    # Type before use, for the same reason `name` is checked before `.strip()`:
    # the command schema types `quantity` as `object`, and arithmetic over a
    # non-integer routes to `unknown_error` instead of naming the field.
    if "quantity" in write.payload:
        write.draft.quantity = validate_quantity(write.payload["quantity"])


def _write_status(write: _ItemWrite) -> None:
    if "status" in write.payload:
        write.draft.status = validate_item_status(
            write.payload["status"], known_statuses=write.known_statuses
        )


def _write_checkout(write: _ItemWrite) -> None:
    """The checkout flag and its due date, holding the pair's rule across both.

    Judged on what the write leaves behind rather than on the keys it names, so
    sending the item home without clearing the date is refused rather than
    leaving a due date on an item nobody has out.
    """

    draft = write.draft
    if "checked_out" in write.payload:
        draft.checked_out = bool(write.payload["checked_out"])
    if "due_date" in write.payload:
        draft.due_date = write.payload["due_date"]
    draft.due_date = validate_due_date_rules(checked_out=draft.checked_out, due_date=draft.due_date)


def _write_inspection_date(write: _ItemWrite) -> None:
    if "inspection_date" in write.payload:
        write.draft.inspection_date = validate_optional_date(
            write.payload["inspection_date"], field_name="inspection_date"
        )


def _write_reminder(write: _ItemWrite) -> None:
    """Apply either half of the reminder, holding the pair's rule across both.

    A write naming only one of the two is validated against the item's other
    half, so clearing the date of a recurring reminder is refused rather than
    leaving an interval with nothing to count from.

    Writing a *different* date re-anchors the series on it: the payloads carry
    no anchor of their own, deliberately, because a household picking a date is
    saying where the series starts. Re-sending the date the item already carries
    says nothing, so it must not move the anchor — the card's editor puts every
    field in every payload, changed or not, and re-anchoring on presence alone
    would let an ordinary save walk a month-end series off its day one short
    month at a time. `Repository.bump_reminder` is the one path that moves the
    date and keeps the anchor, which is what makes a bumped month-end series stay
    on its own day.
    """

    payload = write.payload
    draft = write.draft
    if "reminder_date" not in payload and "reminder_interval" not in payload:
        return
    previous_reminder_date = draft.reminder_date
    date_value = payload["reminder_date"] if "reminder_date" in payload else draft.reminder_date
    interval_value = (
        payload["reminder_interval"] if "reminder_interval" in payload else draft.reminder_interval
    )
    draft.reminder_date, draft.reminder_interval = validate_reminder_rules(
        reminder_date=date_value, reminder_interval=interval_value
    )
    if "reminder_date" in payload and draft.reminder_date != previous_reminder_date:
        draft.reminder_anchor = draft.reminder_date
    elif draft.reminder_date is None:
        # The interval was cleared alongside a date that was already absent, or
        # the pair rule left nothing behind. An anchor without a date names a
        # series with no next occurrence.
        draft.reminder_anchor = None


def _write_location(write: _ItemWrite) -> None:
    """Place the item, and keep its denormalized path in step with the tree.

    The path is rebuilt on every write, not only on one that names a location:
    an item whose stored path predates a rename higher up carries the current
    one from its next edit onwards.
    """

    draft = write.draft
    locations_by_id = write.locations_by_id
    if "location_id" in write.payload:
        raw = write.payload["location_id"]
        location_id: uuid.UUID | None = None
        if raw is not None:
            location_id = parse_uuid4(raw, field_name="location_id")
            if locations_by_id is None or str(location_id) not in locations_by_id:
                raise ValidationError("location_id must reference an existing location")
        draft.location_id = location_id

    if draft.location_id is not None and locations_by_id:
        draft.location_path = build_location_path_from_map(
            draft.location_id, locations_by_id=locations_by_id
        )
    elif draft.location_id is None:
        draft.location_path = EMPTY_LOCATION_PATH


def _write_tags(write: _ItemWrite) -> None:
    if "tags" in write.payload:
        write.draft.tags = validate_tags(write.payload["tags"], previous=write.draft.tags)


def _write_low_stock_threshold(write: _ItemWrite) -> None:
    if "low_stock_threshold" not in write.payload:
        return
    threshold = write.payload["low_stock_threshold"]
    if threshold is not None and (not _is_int_not_bool(threshold) or threshold < 0):
        raise ValidationError("low_stock_threshold must be an integer >= 0 or null")
    write.draft.low_stock_threshold = threshold


def _write_custom_fields(write: _ItemWrite) -> None:
    """Patch the map by key — a create names it whole, an update by halves.

    The key cap bounds the item, not the patch: a two-key patch onto an item
    already at the limit is what would otherwise walk past it. Judged on the
    result of the whole write, and only when the write grew the map — so an item
    that predates the cap can still be edited down.
    """

    draft = write.draft
    set_key = "custom_fields" if write.creating else "custom_fields_set"
    to_set = write.payload.get(set_key)
    to_unset = require_string_list(
        write.payload.get("custom_fields_unset"), field_name="custom_fields_unset"
    )
    before = len(draft.custom_fields)
    if to_set is not None:
        validate_custom_fields(to_set, previous=draft.custom_fields, field_name=set_key)
        draft.custom_fields = {**draft.custom_fields, **to_set}
    if to_unset:
        draft.custom_fields = {
            k: v for k, v in draft.custom_fields.items() if k not in set(to_unset)
        }
    after = len(draft.custom_fields)
    if after > CUSTOM_FIELDS_MAX_KEYS and after > before:
        raise ValidationError(f"custom_fields must have at most {CUSTOM_FIELDS_MAX_KEYS} keys")


#: Every item field a client writes, and the rule that writes it. A create and
#: an update walk this one table in this one order, so a field's type, cap and
#: binding to its neighbours is written once and refuses the same value with the
#: same message whichever command carried it. A rule leaves the draft as it
#: stands when the write names none of its keys, which is what lets the one walk
#: serve a full create and a one-field patch.
_ITEM_FIELD_RULES: Final[tuple[Callable[[_ItemWrite], None], ...]] = (
    _write_name,
    partial(_write_optional_text, key="description", max_length=DESCRIPTION_MAX_LENGTH),
    _write_quantity,
    _write_status,
    _write_checkout,
    _write_inspection_date,
    _write_reminder,
    _write_location,
    _write_tags,
    partial(_write_optional_text, key="category", max_length=CATEGORY_MAX_LENGTH),
    _write_low_stock_threshold,
    _write_custom_fields,
)


def create_item_from_create(
    payload: ItemCreate,
    *,
    locations_by_id: dict[str, Location] | None = None,
    known_statuses: Collection[str] = ITEM_STATUSES,
) -> Item:
    """Create a validated Item from an ItemCreate payload.

    ``locations_by_id`` is the map ``location_id`` is checked against and the
    denormalized path is built from; ``known_statuses`` is the live status set.
    """

    created_ts = iso_utc_now()
    # The draft carries the field defaults, and a rule the payload does not
    # reach leaves them where they are — so "the value the item already has" is
    # empty here and every cap is absolute. `name` is the one field with no
    # usable default, and its rule refuses a payload that omits it.
    draft = Item(id=new_uuid4(), name="", created_at=created_ts, updated_at=created_ts)
    write = _ItemWrite(
        draft=draft,
        payload=payload,
        creating=True,
        locations_by_id=locations_by_id,
        known_statuses=known_statuses,
    )
    for rule in _ITEM_FIELD_RULES:
        rule(write)

    return draft


def apply_item_update(
    item: Item,
    update: ItemUpdate,
    *,
    locations_by_id: dict[str, Location] | None = None,
    known_statuses: Collection[str] = ITEM_STATUSES,
) -> Item:
    """Apply an update payload to an Item and return a new updated instance."""

    new_item = replace(item)  # shallow copy
    write = _ItemWrite(
        draft=new_item,
        payload=update,
        creating=False,
        locations_by_id=locations_by_id,
        known_statuses=known_statuses,
    )
    for rule in _ITEM_FIELD_RULES:
        rule(write)

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


def _coerce_canonical_ts(value: object, *, fallback: str | None = None) -> str:
    """Return a canonical UTC timestamp, backfilling non-canonical input.

    Item timestamps compare lexicographically for sort and range filters, so on
    load any missing / null / corrupt value is replaced with a canonical one
    (the fallback when it is itself canonical, otherwise the current time).
    """

    if isinstance(value, str) and is_canonical_utc_timestamp(value):
        return value
    if fallback is not None and is_canonical_utc_timestamp(fallback):
        return fallback
    return iso_utc_now()


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


def today_local_date() -> str:
    """Today's date as YYYY-MM-DD in the instance's time zone.

    One day for the whole household: the calendar entity, the reminder bump,
    the card's chips and these predicates all measure against the day Home
    Assistant is configured for, so a row and a count cannot disagree for the
    hours a UTC day and a local one differ by. `dt_util.now()` reads
    `DEFAULT_TIME_ZONE`, which Home Assistant sets from its own configuration,
    so this needs no `hass` handle.
    """
    return dt_util.now().date().isoformat()


def _date_passed(item: Item, field: str, today: str, *, inclusive: bool) -> bool:
    """Whether the item's ``field`` date has come round by ``today``.

    The one test behind the five named below, which are its five (field,
    inclusive) pairs. An item carrying no date on that field is never counted.
    Both sides are YYYY-MM-DD, which compares correctly as text. An empty
    ``today`` reads the instance's current local date, and reads it only for an
    item that has a date to compare — callers walking many items fill it in
    once rather than paying for the clock per item.
    """

    value: str | None = getattr(item, field)
    if not value:
        return False
    day = today or today_local_date()
    return value <= day if inclusive else value < day


def item_is_overdue(item: Item, *, today: str = "") -> bool:
    """Return True when the item's due date has passed.

    A due date only exists while an item is checked out (see
    ``validate_due_date_rules``), so this needs no separate checked-out test.
    """

    return _date_passed(item, "due_date", today, inclusive=False)


def item_is_due(item: Item, *, today: str = "") -> bool:
    """Return True once the item is due back.

    Inclusive of today, unlike ``item_is_overdue``: a due date names the day the
    item is owed back, so that day is when it is being asked for rather than the
    last day it is not. The two answers differ by exactly the items due today,
    and every overdue item is also due — the same relation
    ``item_inspection_is_due`` has to ``item_inspection_is_overdue``.
    """

    return _date_passed(item, "due_date", today, inclusive=True)


def item_inspection_is_overdue(item: Item, *, today: str = "") -> bool:
    """Return True when the item is past the date it was next due for inspection.

    Independent of the check-out state: an inspection is a fact about the item,
    not about a borrowing, so this walks any item that carries a date.
    """

    return _date_passed(item, "inspection_date", today, inclusive=False)


def item_inspection_is_due(item: Item, *, today: str = "") -> bool:
    """Return True once the item's inspection is being asked for.

    Inclusive of today, like ``item_reminder_is_due`` and unlike
    ``item_inspection_is_overdue``: an inspection date names the day the item is
    next due to be inspected, so that day is when it is being asked for rather
    than the last day it is not. The two answers therefore differ by exactly the
    items whose date is today, and every overdue item is also due.
    """

    return _date_passed(item, "inspection_date", today, inclusive=True)


def item_reminder_is_due(item: Item, *, today: str = "") -> bool:
    """Return True once the item's reminder has come round.

    Inclusive of today, unlike the two overdue tests above: a reminder names the
    day something should be done, so that day is when it is asking rather than
    the last day it is not. A one-off counts the same as a series — both are a
    date the household said to be reminded on.
    """

    return _date_passed(item, "reminder_date", today, inclusive=True)


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
    """True when the item sits in — or under — any of the selected locations.

    An empty selection keeps nothing, which is what a selection of only
    unparsable ids has always meant: the filter names locations, and none of
    them is this item's.
    """

    if not item.location_id:
        return False
    for needle in needles:
        if item.location_id == needle:
            return True
        if include_subtree and item.location_path.id_path and needle in item.location_path.id_path:
            return True
    return False


#: The filter keys these two tables read, spelled out so a table entry is
#: checked against ``ItemFilter`` rather than against a plain string.
DateFilterKey = Literal[
    "overdue_only",
    "checked_out_due_only",
    "inspection_overdue_only",
    "inspection_due_only",
    "reminder_due_only",
]
TimestampBoundKey = Literal["updated_after", "created_after", "updated_before", "created_before"]

#: The five date filters, each with the item field it reads and whether today
#: itself counts. A ``*_due_only`` key counts it because a due date names the
#: day something is being asked for; an ``*overdue*`` key does not, so a pair
#: over one field differs by exactly the items dated today.
_DATE_FILTERS: Final[tuple[tuple[DateFilterKey, str, bool], ...]] = (
    ("overdue_only", "due_date", False),
    ("checked_out_due_only", "due_date", True),
    ("inspection_overdue_only", "inspection_date", False),
    ("inspection_due_only", "inspection_date", True),
    ("reminder_due_only", "reminder_date", True),
)

#: The four timestamp bounds, each with the item field it reads and which side
#: of the bound the item must fall on. Read in this order, which is the order a
#: filter carrying more than one malformed bound is refused in.
_TIMESTAMP_BOUNDS: Final[tuple[tuple[TimestampBoundKey, str, bool], ...]] = (
    ("updated_after", "updated_at", True),
    ("created_after", "created_at", True),
    ("updated_before", "updated_at", False),
    ("created_before", "created_at", False),
)


def _date_predicate(field: str, today: str, *, inclusive: bool) -> Callable[[Item], bool]:
    """One date filter, bound to the field and the day it measures against."""

    def passes(item: Item) -> bool:
        return _date_passed(item, field, today, inclusive=inclusive)

    return passes


def _bound_predicate(field: str, bound: str, *, after: bool) -> Callable[[Item], bool]:
    """One timestamp filter, bound to the field and the bound it compares to.

    Canonical fixed-width 'Z' timestamps compare lexicographically, so an item
    costs no parsing here — only the bound itself was parsed, once, to refuse a
    malformed one.
    """

    def passes(item: Item) -> bool:
        value: str = getattr(item, field)
        return value > bound if after else value < bound

    return passes


def _timestamp_predicates(flt: ItemFilter) -> list[Callable[[Item], bool]]:
    """The timestamp filters a filter carries, refusing a malformed bound.

    A bound the filter names as null is no filter at all; one it names as empty
    is not a timestamp to parse but is still compared against, which is what
    keeps ``updated_before: ""`` meaning what it has always meant.
    """

    predicates: list[Callable[[Item], bool]] = []
    for key, attr, after in _TIMESTAMP_BOUNDS:
        bound = flt.get(key)
        if bound is None:
            continue
        if bound:
            _parse_iso8601_utc(bound, field_name=key)
        predicates.append(_bound_predicate(attr, bound, after=after))
    return predicates


def _filter_predicates(
    flt: ItemFilter, *, known_statuses: Collection[str]
) -> list[Callable[[Item], bool]]:
    """The tests a filter asks for, one per key it carries.

    Built once for the whole query, so a key the filter leaves out costs an item
    nothing, and what a key needs parsed — the status, the location ids, the
    timestamp bounds, the day — is parsed here rather than against every
    candidate. A malformed value is refused here too, in the order the keys are
    read below, so a filter that cannot be honoured raises before any item is
    walked. ``q`` is appended last because it is the only test that normalizes
    text: the cheap ones drop what they can before it runs.
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
        # One clock read for the whole query, and only when a date filter is on.
        today = today_local_date()
        predicates.extend(
            _date_predicate(attr, today, inclusive=inclusive) for attr, inclusive in dated
        )

    location_ids = selected_location_ids(flt)
    if location_ids:
        # Parsed once for the whole query rather than once per candidate item.
        needles = _parse_location_selection(location_ids)
        include_subtree = bool(flt.get("include_subtree"))
        predicates.append(lambda item: _item_matches_locations(item, needles, include_subtree))

    predicates.extend(_timestamp_predicates(flt))

    if q:
        predicates.append(lambda item: _item_matches_q(item, q))
    return predicates


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
    - overdue_only: due_date set and strictly before today
    - checked_out_due_only: due_date set and on or before today
    - inspection_overdue_only: inspection_date set and strictly before today
    - inspection_due_only: inspection_date set and on or before today
    - reminder_due_only: reminder_date set and on or before today
    - "today" in those five is the instance's local day, read once per query
    - the three ``*_due_only`` keys count today and the two ``*overdue*`` ones do
      not: a due date names the day something is being asked for, not the last
      day it is not
    - location_id / location_ids: equals any of the selection; include_subtree
      optionally includes descendants (by prefix of id_path), one flag for all
    - updated_after/created_after: ISO-8601 UTC with 'Z', strictly greater-than
    - updated_before/created_before: ISO-8601 UTC with 'Z', strictly less-than

    Each key the filter carries becomes one test, built once by
    :func:`_filter_predicates`; an item is walked against those and no others,
    and stops at the first one it fails.
    """

    if not flt:
        return list(items)

    predicates = _filter_predicates(flt, known_statuses=known_statuses)
    if not predicates:
        # A filter carrying only presentation hints, such as low_stock_first.
        return list(items)
    return [item for item in items if all(passes(item) for passes in predicates)]


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

    Orders, it does not validate: :func:`validate_sort` refuses an unknown field
    or order at the WebSocket boundary, which is where a client's typo has to be
    named. A field this does not know falls to the default ordering.
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
