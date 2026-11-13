"""The persisted shapes: items, locations, statuses, attachments and reminders.

Every shape is a frozen record: a write builds a new record and the repository
swaps it in, because its indexes and its undo snapshot hold the old one.
Assigning a field is a type error and raises at run time. The collections
inside are tuples, except ``Item.custom_fields``: a ``dict`` typed ``Mapping``,
so the checker refuses an edit while a record stays deep-copyable, which a
read-only mapping proxy is not.

Each shape's ``to_dict`` is the stored and exported form. ``from_dict``, or the
``load_*`` / ``validate_*`` function beside a nested shape, reads it back and
refuses a row no write path could have written, so a load drops and reports the
row rather than guessing. An absent field reads as its default, so an older store
loads without a migration.

Free of I/O.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import (
    Any,
    Final,
    Literal,
    TypeIs,
)

from .const import (
    DEFAULT_STATUS_COLOR,
    DEFAULT_STATUS_ICON,
    STATUS_ICONS,
)
from .exceptions import ValidationError
from .text import normalize_text_for_sort
from .timestamps import (
    is_canonical_utc_timestamp,
    iso_utc_now,
)
from .validation import (
    ATTACHMENT_TITLE_MAX_LENGTH,
    NAME_MAX_LENGTH,
    REMINDER_COUNT_MAX,
    REMINDER_UNITS,
    ScalarValue,
    parse_uuid4,
    validate_optional_date,
    validate_required_name,
    validate_status_color,
    validate_status_slug,
)

# A status is an immutable slug; "ok" is the default. Not a Literal: the set of
# slugs is data read from the store, so status checks take the live set as
# `known_statuses`.
ItemStatus = str
ITEM_STATUSES: Final[tuple[ItemStatus, ...]] = ("ok", "missing", "needs_repair")
DEFAULT_ITEM_STATUS: Final[ItemStatus] = "ok"


# The kind picks the accepted MIME types and the per-item cap (`const.py`), and
# scopes ordering: position 0 of an item's pictures is its cover.
AttachmentKind = Literal["picture", "manual"]
ATTACHMENT_KINDS: Final[tuple[AttachmentKind, ...]] = ("picture", "manual")


@dataclass(frozen=True)
class LocationPath:
    """Denormalized path data for a location or item.

    Attributes:
        id_path: The location ids from root to leaf.
        name_path: The location names from root to leaf.
        display_path: Human-readable path (e.g., "Garage / Shelf A / Bin 3").
        sort_key: Case-insensitive key suitable for lexicographic sorting.
    """

    id_path: tuple[uuid.UUID, ...]
    name_path: tuple[str, ...]
    display_path: str
    sort_key: str

    def to_dict(self) -> dict[str, Any]:
        """The serialized shape, with lists a caller may edit."""

        return {
            "id_path": [str(entry) for entry in self.id_path],
            "name_path": list(self.name_path),
            "display_path": self.display_path,
            "sort_key": self.sort_key,
        }

    @classmethod
    def from_dict(cls, data: object) -> LocationPath:
        """Read back what ``to_dict`` wrote; ``None`` reads as the empty path.

        ``sort_key`` is derived from ``display_path`` and the stored copy is
        not read, so a key written under another normalization cannot outlive
        the load. A non-object or a non-UUID ``id_path`` entry is refused, so a
        load reports the row.
        """

        if data is None:
            return EMPTY_LOCATION_PATH
        if not isinstance(data, Mapping):
            raise ValidationError("a location path must be an object")
        display = str(data.get("display_path", ""))
        return cls(
            id_path=tuple(
                parse_uuid4(str(entry), field_name="path.id_path")
                for entry in (data.get("id_path") or [])
            ),
            name_path=tuple(data.get("name_path") or ()),
            display_path=display,
            sort_key=normalize_text_for_sort(display),
        )


EMPTY_LOCATION_PATH: Final = LocationPath(id_path=(), name_path=(), display_path="", sort_key="")


@dataclass(frozen=True)
class Location:
    """Persisted shape for a location node."""

    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    area_id: str | None = None
    path: LocationPath = EMPTY_LOCATION_PATH

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


@dataclass(frozen=True)
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


@dataclass(frozen=True)
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


@dataclass(frozen=True, slots=True)
class ReminderInterval:
    """How far apart a reminder's occurrences fall. Frozen, so items can share one."""

    unit: str
    count: int


# Not `slots`: `with_location_path` copies the instance dictionary.
@dataclass(frozen=True)
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
    tags: tuple[str, ...] = ()
    category: str | None = None
    low_stock_threshold: int | None = None
    # Shared between an item and the next version of it, so never edited.
    custom_fields: Mapping[str, ScalarValue] = field(default_factory=dict)
    created_at: str = field(default_factory=iso_utc_now)
    updated_at: str = field(default_factory=iso_utc_now)
    version: int = 1
    location_path: LocationPath = EMPTY_LOCATION_PATH
    # Absent from ItemCreate / ItemUpdate: only the attachment commands write it.
    attachments: tuple[AttachmentMeta, ...] = ()

    def with_location_path(self, path: LocationPath) -> Item:
        """This item under a recomputed path; nothing else changes.

        A location rename rewrites the path of every item below it, so this
        copies the instance dictionary rather than calling ``__init__``:
        ``dataclasses.replace`` on a frozen record costs several times as much,
        and a path built from the tree needs no re-check.
        """

        moved = object.__new__(Item)
        moved.__dict__.update(self.__dict__)
        moved.__dict__["location_path"] = path
        return moved

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
            tags=tuple(data.get("tags", ()) or ()),
            category=data.get("category"),
            low_stock_threshold=data.get("low_stock_threshold"),
            custom_fields=dict(data.get("custom_fields", {}) or {}),
            created_at=created_at,
            updated_at=_coerce_canonical_ts(data.get("updated_at"), fallback=created_at),
            version=int(data.get("version", 1)),
            location_path=LocationPath.from_dict(data.get("location_path")),
            attachments=load_attachments(data.get("attachments")),
        )


def new_uuid4() -> uuid.UUID:
    return uuid.uuid4()


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
    raise ValidationError(
        f"status must be one of: {', '.join(sorted(known_statuses))}",
        key="status_unknown",
        placeholders={"statuses": ", ".join(sorted(known_statuses))},
    )


def validate_status_definition(value: object) -> StatusDefinition:
    """Build a :class:`StatusDefinition` from a stored/incoming mapping."""

    if not isinstance(value, dict):
        raise ValidationError("status definition must be an object")
    slug = validate_status_slug(value.get("slug"))
    label = value.get("label")
    if not isinstance(label, str) or not label.strip():
        raise ValidationError(
            "status label is required and must be a non-empty string",
            key="status_label_required",
        )
    if len(label.strip()) > NAME_MAX_LENGTH:
        raise ValidationError(
            "status label must be at most 120 characters",
            key="status_label_too_long",
            placeholders={"max": NAME_MAX_LENGTH},
        )
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
    att_id = parse_uuid4(value.get("id"), field_name="attachment.id")
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
    if not _is_int_not_bool(size) or size < 0:
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
        size=size,
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


def load_attachments(value: object) -> tuple[AttachmentMeta, ...]:
    """Read a stored ``attachments`` list; a missing or non-list value reads as none.

    A malformed entry raises rather than being dropped: dropping it would lose
    the only reference to a file on disk, which the orphan sweep then deletes.
    """

    if not isinstance(value, list):
        return ()
    return tuple(validate_attachment_meta(entry) for entry in value)


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
        raise ValidationError(
            f"reminder_interval.unit must be one of {', '.join(REMINDER_UNITS)}",
            key="reminder_unit_invalid",
            placeholders={"units": ", ".join(REMINDER_UNITS)},
        )
    if not _is_int_not_bool(interval.count) or interval.count < 1:
        raise ValidationError(
            "reminder_interval.count must be an integer >= 1", key="reminder_count_too_small"
        )
    if interval.count > REMINDER_COUNT_MAX:
        raise ValidationError(
            f"reminder_interval.count must be <= {REMINDER_COUNT_MAX}",
            key="reminder_count_too_large",
            placeholders={"max": REMINDER_COUNT_MAX},
        )
    return ReminderInterval(unit=interval.unit, count=int(interval.count))


def validate_reminder_rules(
    *, reminder_date: str | None, reminder_interval: object
) -> tuple[str | None, ReminderInterval | None]:
    """Validate the pair: an interval with no date has nothing to count from."""

    normalized_date = validate_optional_date(reminder_date, field_name="reminder_date")
    interval = validate_reminder_interval(reminder_interval)
    if interval is not None and normalized_date is None:
        raise ValidationError(
            "reminder_interval requires a reminder_date to count from",
            key="reminder_interval_without_date",
        )
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


def _is_int_not_bool(value: object) -> TypeIs[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _coerce_canonical_ts(value: object, *, fallback: str | None = None) -> str:
    """``value`` when canonical, else ``fallback`` when canonical, else now."""

    if is_canonical_utc_timestamp(value):
        return value
    if is_canonical_utc_timestamp(fallback):
        return fallback
    return iso_utc_now()
