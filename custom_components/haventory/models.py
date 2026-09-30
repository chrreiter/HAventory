"""Typed models and validation helpers for HAventory.

``Item`` and ``Location`` are the persisted shapes; the create/update/filter/sort
schemas beside them are what a surface hands in. Validation lives here so a
WebSocket command, a service call and an import document refuse the same value
with the same message, and that message names the field.

Free of I/O. `dt_util` is imported only for the household's local calendar day.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Callable, Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import (
    Any,
    Final,
    Literal,
    NotRequired,
    TypedDict,
    TypeGuard,
    get_args,
    get_type_hints,
)

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

# A status is an immutable slug; "ok" is the default. Not a Literal: the set of
# slugs is data read from the store, so status checks take the live set as
# `known_statuses`.
ItemStatus = str
ITEM_STATUSES: Final[tuple[ItemStatus, ...]] = ("ok", "missing", "needs_repair")
DEFAULT_ITEM_STATUS: Final[ItemStatus] = "ok"

STATUS_SLUG_RE = re.compile(r"^[a-z0-9_]{1,64}$")

# `#rrggbb` only: what `<input type="color">` produces and the card can parse.
STATUS_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# The kind picks the accepted MIME types and the per-item cap (`const.py`), and
# scopes ordering: position 0 of an item's pictures is its cover.
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
        """The serialized shape. The lists are copies, so a caller may edit them."""

        return {
            "id_path": [str(entry) for entry in self.id_path],
            "name_path": list(self.name_path),
            "display_path": self.display_path,
            "sort_key": self.sort_key,
        }

    @classmethod
    def from_dict(cls, data: object) -> LocationPath:
        """Read back what ``to_dict`` wrote; ``None`` reads as the empty path.

        An absent ``sort_key`` is derived from ``display_path``. A non-object or
        a non-UUID ``id_path`` entry is refused, so a load reports the row.
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
ATTACHMENT_TITLE_MAX_LENGTH = 200

# The store is one JSON document rewritten in full on every mutation, so every
# free-text and collection field is bounded.
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
        """The one serialized shape: store, export document and wire alike."""

        return {
            "id": str(self.id),
            "name": self.name,
            "parent_id": str(self.parent_id) if self.parent_id is not None else None,
            "area_id": self.area_id,
            "path": self.path.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any], *, fallback_id: str | None = None) -> Location:
        """Read back what ``to_dict`` wrote, refusing a row no write path wrote.

        ``fallback_id`` is the key the row was stored under, for a row with no
        ``id``.
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

    Items store the immutable ``slug``, so renaming the ``label`` never rewrites
    an item. ``order`` is display order alone.
    """

    slug: str
    label: str
    order: int = 0
    # A token the card resolves against the active theme, or a literal `#rrggbb`.
    color: str = DEFAULT_STATUS_COLOR
    icon: str = DEFAULT_STATUS_ICON


@dataclass
class AttachmentMeta:
    """Metadata for one file attached to an item; the bytes live in ``media.py``."""

    id: uuid.UUID
    kind: AttachmentKind
    filename: str
    mime: str
    size: int
    uploaded_at: str
    # Empty means "show the filename".
    title: str = ""
    # Position among the item's attachments of the same kind; picture 0 is the cover.
    order: int = 0


# Calendar units, so "every 3 months" stays on its day of the month.
REMINDER_UNITS: Final[tuple[str, ...]] = ("days", "weeks", "months")
REMINDER_COUNT_MAX: Final[int] = 1000


@dataclass(frozen=True, slots=True)
class ReminderInterval:
    """How far apart a reminder's occurrences fall. Frozen, so items can share one."""

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
    inspection_date: str | None = None  # YYYY-MM-DD
    # `reminder_date` is the next occurrence nobody has marked done, and what a
    # bump advances. `reminder_anchor` is what the series is counted from, and a
    # bump leaves it alone, so a series anchored on the 31st returns to the 31st
    # in every month that has one. Neither exists without the other.
    reminder_date: str | None = None  # YYYY-MM-DD
    reminder_anchor: str | None = None  # YYYY-MM-DD
    reminder_interval: ReminderInterval | None = None
    location_id: uuid.UUID | None = None
    tags: list[str] = field(default_factory=list)
    category: str | None = None
    low_stock_threshold: int | None = None
    custom_fields: dict[str, ScalarValue] = field(default_factory=dict)
    # The lambda defers resolving `iso_utc_now`, which is defined further down.
    created_at: str = field(default_factory=lambda: iso_utc_now())  # noqa: PLW0108
    updated_at: str = field(default_factory=lambda: iso_utc_now())  # noqa: PLW0108
    version: int = 1
    location_path: LocationPath = field(default_factory=lambda: EMPTY_LOCATION_PATH)
    # Absent from ItemCreate / ItemUpdate: only the attachment commands write it.
    attachments: list[AttachmentMeta] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """The stored and exported shape.

        The wire adds ``effective_area_id`` in ``serialization.serialize_item``,
        because it is resolved from the location tree and never stored.
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

        ``fallback_id`` is the key the row was stored under, for a row with no
        ``id``. ``known_statuses`` has to be the live set, or every item on a
        custom status would be rewritten to the default.

        An absent field reads as its default, so an older store loads without a
        migration. A malformed name, id or attachment entry raises, so a load
        drops and reports the row.
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
            created_at=created_at,
            updated_at=_coerce_canonical_ts(data.get("updated_at"), fallback=created_at),
            version=int(data.get("version", 1)),
            location_path=LocationPath.from_dict(data.get("location_path")),
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


def parse_uuid4(value: str | uuid.UUID, *, field_name: str = "id") -> uuid.UUID:
    """Parse a UUID v4 string, or check a ``uuid.UUID``, raising ``ValidationError``."""

    UUID_VERSION_V4: Final[int] = 4
    if isinstance(value, str):
        try:
            value = uuid.UUID(value)
        except ValueError as exc:
            raise ValidationError(f"{field_name} must be a UUID v4 string") from exc
    elif not isinstance(value, uuid.UUID):
        raise ValidationError(f"{field_name} must be a UUID v4 string")
    if value.version != UUID_VERSION_V4:
        raise ValidationError(f"{field_name} must be a UUID v4")
    return value


def iso_utc_now() -> str:
    """The current time as the canonical ``YYYY-MM-DDTHH:MM:SSZ``."""

    return datetime.now(tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_uuid4() -> uuid.UUID:
    return uuid.uuid4()


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_text_for_sort(text: str) -> str:
    """Case- and accent-folded, whitespace-collapsed text for sorting and search.

    The one normalization both sides of a search go through, so
    "case-insensitive, accent-insensitive" means the same thing on each.
    """

    if not text:
        return ""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_text.split()).casefold()


def normalize_tags(tags: list[str] | None) -> list[str]:
    """Lowercase, trim, and de-duplicate a list of tags, preserving order.

    The tolerant reader for an import document. A client's tag list goes
    through :func:`validate_tags` or :func:`selected_tags`, which refuse a
    value that is not a list of strings.
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

    Shared by the write and load paths, so a stored row with a missing, null or
    blank name is refused rather than read as ``""`` or ``"None"``. Not the
    length cap, which the load path does not apply.
    """

    if not isinstance(value, str) or not value.strip():
        raise ValidationError("name is required and must be a non-empty string")
    return value.strip()


def validate_write_name(name: object) -> str:
    """:func:`validate_required_name` plus the length cap, for a client's write."""

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

    ``field_name`` is the key the caller sent, named in the shape refusal; the
    caps name ``custom_fields`` because they bound the item's map.

    The caps refuse *growth* past ``previous``, the map the item already
    carries, so an item that predates a cap can still be edited.
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
    """Normalize an item's tag list and enforce the tag caps. ``None`` clears it.

    The caps apply to what the edit adds beyond ``previous``, the item's current
    tags, so an item that predates them can still be edited down.
    """

    normalized = normalize_string_list(tags, field_name="tags", casefold=True)
    previous_tags = set(previous)
    for tag in normalized:
        if tag not in previous_tags and len(tag) > TAG_MAX_LENGTH:
            raise ValidationError(f"each tag must be at most {TAG_MAX_LENGTH} characters")
    if len(normalized) > TAGS_MAX_COUNT and len(normalized) > len(previous_tags):
        raise ValidationError(f"tags must have at most {TAGS_MAX_COUNT} entries")
    return normalized


ITEM_FILTER_KEYS: Final[frozenset[str]] = frozenset(ItemFilter.__annotations__)


def require_string_list(value: object, *, field_name: str) -> list[str]:
    """Return a caller's list of strings unchanged; ``None`` is the empty list.

    A bare string is refused rather than iterated as its characters. Nothing is
    trimmed or de-duplicated, so a reorder naming one member twice is refused.
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
    field_value = sort.get("field")
    if field_value not in SORT_FIELDS:
        raise ValidationError(f"sort.field must be one of: {', '.join(sorted(SORT_FIELDS))}")
    if sort.get("order") not in SORT_ORDERS:
        raise ValidationError("sort.order must be 'asc' or 'desc'")


def validate_due_date_rules(*, checked_out: bool, due_date: str | None) -> str | None:
    """A due date is only valid on a checked-out item, and must be YYYY-MM-DD."""

    if due_date is None:
        return None
    if not checked_out:
        raise ValidationError("due_date is only valid when checked_out is true")
    return validate_optional_date(due_date, field_name="due_date")


def validate_item_status(
    value: object,
    *,
    known_statuses: Collection[str] = ITEM_STATUSES,
    default: ItemStatus | None = None,
) -> ItemStatus:
    """Return ``value`` when it is one of the live statuses, or refuse it.

    Non-nullable: ``None`` is refused like any unknown value. A load path passes
    ``default`` to read an absent or unknown stored status tolerantly, and must
    pass the store's own ``known_statuses`` alongside it.
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
    """One of the tone tokens, or a `#rrggbb` literal stored lowercased."""

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


_SEED_STATUSES: Final[tuple[tuple[str, str, str, str], ...]] = (
    ("ok", "OK", "green", "check"),
    ("missing", "Missing", "amber", "alert"),
    ("needs_repair", "Needs repair", "amber", "wrench"),
)


def seed_status_definitions() -> dict[str, StatusDefinition]:
    """The built-ins, in display order: what an absent ``statuses`` section means."""

    return {
        slug: StatusDefinition(slug=slug, label=label, order=order, color=color, icon=icon)
        for order, (slug, label, color, icon) in enumerate(_SEED_STATUSES)
    }


def validate_attachment_meta(value: object) -> AttachmentMeta:
    """Build an :class:`AttachmentMeta` from a stored/incoming mapping.

    The id is also the file's name under the media root, hence UUID v4 only.
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
    """Read a stored ``attachments`` list; a missing or non-list value reads as none.

    A malformed entry raises rather than being dropped: dropping it would lose
    the only reference to a file on disk, which the orphan sweep then deletes.
    """

    if not isinstance(value, list):
        return []
    return [validate_attachment_meta(entry) for entry in value]


def validate_optional_date(value: str | None, *, field_name: str) -> str | None:
    """Validate one optional YYYY-MM-DD field, naming it in any refusal."""

    if value is None:
        return None
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ValidationError(f"{field_name} must be in 'YYYY-MM-DD' format")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValidationError(f"{field_name} must be a valid calendar date (YYYY-MM-DD)") from exc
    return value


def validate_reminder_interval(value: object) -> ReminderInterval | None:
    """Validate `{unit, count}` into a `ReminderInterval`, or none.

    A count below 1 is refused: its occurrences would never advance.
    """

    if value is None:
        return None
    if isinstance(value, ReminderInterval):
        interval = value
    elif isinstance(value, Mapping):
        # `count` is left unchecked here so the guards below can name it.
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
    """Validate the pair: an interval with no date has nothing to count from."""

    normalized_date = validate_optional_date(reminder_date, field_name="reminder_date")
    interval = validate_reminder_interval(reminder_interval)
    if interval is not None and normalized_date is None:
        raise ValidationError("reminder_interval requires a reminder_date to count from")
    return normalized_date, interval


def load_reminder_anchor(value: object, *, reminder_date: str | None) -> str | None:
    """Read a stored series anchor; an absent, unreadable or later one reads as the date.

    An anchor after its date describes no series this build can walk.
    """

    if reminder_date is None:
        return None
    if not isinstance(value, str) or not value or value > reminder_date:
        return reminder_date
    try:
        return validate_optional_date(value, field_name="reminder_anchor")
    except ValidationError:
        return reminder_date


def serialize_reminder_interval(interval: ReminderInterval | None) -> dict[str, Any] | None:
    if interval is None:
        return None
    return {"unit": interval.unit, "count": interval.count}


def load_reminder_interval(value: object) -> ReminderInterval | None:
    """Read a stored interval, treating anything unreadable as none."""

    try:
        return validate_reminder_interval(value)
    except ValidationError:
        return None


def walk_location_chain(
    start_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> Iterator[Location]:
    """Yield the locations from ``start_id`` upwards, the node itself first.

    Ends without raising on a parent id no location carries and on an id it has
    already yielded, because a corrupt store can close a chain into a loop and
    the item index walks it on every mutation. :func:`location_chain_to_root`
    is the version that refuses a short chain.
    """

    cursor: str | None = str(start_id)
    seen: set[str] = set()
    while cursor is not None and cursor not in seen:
        location = locations_by_id.get(cursor)
        if location is None:
            return
        seen.add(cursor)
        yield location
        cursor = str(location.parent_id) if location.parent_id is not None else None


def location_chain_to_root(
    leaf_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> list[Location]:
    """The chain root→leaf, refused when it does not reach a root.

    A partial chain would store a display path missing its leading names.
    """

    chain = list(walk_location_chain(leaf_id, locations_by_id=locations_by_id))
    if not chain:
        raise ValidationError("location_id must reference an existing location")
    last_parent = chain[-1].parent_id
    if last_parent is not None:
        if str(last_parent) in {str(node.id) for node in chain}:
            raise ValidationError("location graph too deep or cyclic")
        raise ValidationError("location_id must reference an existing location chain")
    chain.reverse()
    return chain


def build_location_path(location_chain: list[Location]) -> LocationPath:
    """Build a denormalized LocationPath from a chain ordered root->leaf."""

    name_path = [loc.name for loc in location_chain]
    display = " / ".join(name_path)
    return LocationPath(
        id_path=[loc.id for loc in location_chain],
        name_path=name_path,
        display_path=display,
        sort_key=normalize_text_for_sort(display),
    )


def build_location_path_from_map(
    leaf_location_id: str | uuid.UUID, *, locations_by_id: Mapping[str, Location]
) -> LocationPath:
    """The path of one location, refused when its chain does not reach a root."""

    return build_location_path(
        location_chain_to_root(leaf_location_id, locations_by_id=locations_by_id)
    )


def _is_int_not_bool(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_optional_text(
    value: object, field_name: str, *, max_length: int | None = None, previous: str | None = None
) -> None:
    """Ensure an optional free-text field is a string or None, within its cap.

    The cap refuses growth past ``previous``, the stored value, so an item that
    predates the cap can still be edited. No ``max_length`` is the restore mode:
    an import is held to the type only (``docs/data_shapes.md`` → "Input caps").
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
    """Return the quantity, or refuse it. Spelled out so the return narrows to ``int``."""

    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError("quantity must be an integer >= 0")
    return value


def validate_low_stock_threshold(value: object) -> int | None:
    """Return the low-stock threshold, or refuse it. ``None`` means never low."""

    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError("low_stock_threshold must be an integer >= 0 or null")
    return value


@dataclass(frozen=True, slots=True)
class _ItemWrite:
    """One item write in progress: ``draft`` is the field defaults on a create and
    a copy of the stored item on an update, and the rules fill it in."""

    draft: Item
    payload: Mapping[str, Any]
    creating: bool
    locations_by_id: dict[str, Location] | None
    known_statuses: Collection[str]


def _write_name(write: _ItemWrite) -> None:
    """Required on a create; a null on an update leaves the stored name alone."""

    value = write.payload.get("name")
    if value is None and not write.creating:
        return
    write.draft.name = validate_write_name(value)


def _write_optional_text(write: _ItemWrite, *, key: str, max_length: int) -> None:
    """One nullable free-text field; ``key`` names the payload field and attribute."""

    if key not in write.payload:
        return
    value = write.payload[key]
    validate_optional_text(value, key, max_length=max_length, previous=getattr(write.draft, key))
    setattr(write.draft, key, value)


def _write_quantity(write: _ItemWrite) -> None:
    if "quantity" in write.payload:
        write.draft.quantity = validate_quantity(write.payload["quantity"])


def _write_status(write: _ItemWrite) -> None:
    if "status" in write.payload:
        write.draft.status = validate_item_status(
            write.payload["status"], known_statuses=write.known_statuses
        )


def _write_checkout(write: _ItemWrite) -> None:
    """The checkout flag and its due date, judged on what the write leaves behind."""

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
    """Apply either half of the reminder, validated against the item's other half.

    Writing a *different* date re-anchors the series on it. Re-sending the
    stored date must not: clients legally resend unchanged fields, and that
    would walk a bumped month-end series off its day.
    `Repository.bump_reminder` moves the date and keeps the anchor.
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
        draft.reminder_anchor = None


def _write_location(write: _ItemWrite) -> None:
    """Place the item, rebuilding its denormalized path on every write."""

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

    if draft.location_id is None:
        draft.location_path = EMPTY_LOCATION_PATH
    elif locations_by_id:
        draft.location_path = build_location_path_from_map(
            draft.location_id, locations_by_id=locations_by_id
        )


def _write_tags(write: _ItemWrite) -> None:
    if "tags" in write.payload:
        write.draft.tags = validate_tags(write.payload["tags"], previous=write.draft.tags)


def _write_low_stock_threshold(write: _ItemWrite) -> None:
    if "low_stock_threshold" in write.payload:
        write.draft.low_stock_threshold = validate_low_stock_threshold(
            write.payload["low_stock_threshold"]
        )


def _write_custom_fields(write: _ItemWrite) -> None:
    """Patch the map by key: a create names it whole, an update by set and unset.

    The key cap bounds the resulting map, and only when the write grew it.
    """

    draft = write.draft
    set_key = "custom_fields" if write.creating else "custom_fields_set"
    to_set = write.payload.get(set_key)
    to_unset = set(
        require_string_list(
            write.payload.get("custom_fields_unset"), field_name="custom_fields_unset"
        )
    )
    before = len(draft.custom_fields)
    if to_set is not None:
        validate_custom_fields(to_set, previous=draft.custom_fields, field_name=set_key)
        draft.custom_fields = {**draft.custom_fields, **to_set}
    if to_unset:
        draft.custom_fields = {k: v for k, v in draft.custom_fields.items() if k not in to_unset}
    after = len(draft.custom_fields)
    if after > CUSTOM_FIELDS_MAX_KEYS and after > before:
        raise ValidationError(f"custom_fields must have at most {CUSTOM_FIELDS_MAX_KEYS} keys")


#: Every item field a client writes, and its rule. A create and an update walk
#: this one table in this order; a rule leaves the draft alone when the write
#: names none of its keys.
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
    """Create a validated Item; ``locations_by_id`` resolves ``location_id``."""

    created_ts = iso_utc_now()
    draft = Item(id=new_uuid4(), name="", created_at=created_ts, updated_at=created_ts)
    write = _ItemWrite(draft, payload, True, locations_by_id, known_statuses)
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

    new_item = replace(item)
    write = _ItemWrite(new_item, update, False, locations_by_id, known_statuses)
    for rule in _ITEM_FIELD_RULES:
        rule(write)
    new_item.updated_at = monotonic_timestamp_after(item.updated_at)
    new_item.version = item.version + 1
    return new_item


#: Canonical timestamps are fixed-width, so lexicographic order is chronological
#: order. Sorting and range filters rely on it.
_CANONICAL_TS_LENGTH = 20


def monotonic_timestamp_after(previous_ts: str) -> str:
    """The current canonical timestamp, bumped to one second past ``previous_ts``."""

    now_ts = iso_utc_now()
    if now_ts > previous_ts or not is_canonical_utc_timestamp(previous_ts):
        return now_ts
    bumped = datetime.fromisoformat(previous_ts) + timedelta(seconds=1)
    return bumped.isoformat().replace("+00:00", "Z")


def is_canonical_utc_timestamp(ts: object) -> TypeGuard[str]:
    """Return True when ``ts`` is exactly the canonical YYYY-MM-DDTHH:MM:SSZ form.

    The separators are checked by position: ``datetime.fromisoformat`` alone
    accepts forms that would compare wrong against canonical timestamps.
    """

    if not (
        isinstance(ts, str)
        and len(ts) == _CANONICAL_TS_LENGTH
        and ts[4] == ts[7] == "-"
        and ts[10] == "T"
        and ts[13] == ts[16] == ":"
        and ts[19] == "Z"
    ):
        return False
    try:
        datetime.fromisoformat(ts)
    except ValueError:
        return False
    return True


def _coerce_canonical_ts(value: object, *, fallback: str | None = None) -> str:
    """``value`` when canonical, else ``fallback`` when canonical, else now."""

    if is_canonical_utc_timestamp(value):
        return value
    if is_canonical_utc_timestamp(fallback):
        return fallback
    return iso_utc_now()


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


def today_local_date() -> str:
    """Today as YYYY-MM-DD in Home Assistant's configured time zone.

    Every date count and chip measures against this one day. `dt_util.now()`
    reads the zone Home Assistant configured, so no `hass` is needed.
    """
    return dt_util.now().date().isoformat()


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
