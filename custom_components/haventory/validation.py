"""Field-level validation, shared by every surface that accepts input.

A WebSocket command, a service call and an import document refuse the same value
with the same message, and that message names the field, because all three call
these. Nothing here knows an entity's shape: a check that builds an ``Item``, a
status or an attachment lives beside that shape in ``models.py``.

Most caps refuse growth past the stored value rather than the value itself, so
an item that predates a cap can still be edited. ``tests/test_item_form_caps.py``
holds the caps equal to the card editor's copies.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Collection, Mapping
from datetime import datetime
from typing import Final

from .const import STATUS_COLORS
from .exceptions import ValidationError

# Scalar values allowed inside custom_fields.
ScalarValue = str | int | float | bool

STATUS_SLUG_RE = re.compile(r"^[a-z0-9_]{1,64}$")

# `#rrggbb` only: what `<input type="color">` produces and the card can parse.
STATUS_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

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


# Calendar units, so "every 3 months" stays on its day of the month.
REMINDER_UNITS: Final[tuple[str, ...]] = ("days", "weeks", "months")
REMINDER_COUNT_MAX: Final[int] = 1000


def parse_uuid4(value: str | uuid.UUID, *, field_name: str = "id") -> uuid.UUID:
    """Parse a UUID v4 string, or check a ``uuid.UUID``, raising ``ValidationError``."""

    UUID_VERSION_V4: Final[int] = 4
    if isinstance(value, str):
        try:
            value = uuid.UUID(value)
        except ValueError as exc:
            raise ValidationError(
                f"{field_name} must be a UUID v4 string",
                key="invalid_uuid",
                placeholders={"field": field_name},
            ) from exc
    elif not isinstance(value, uuid.UUID):
        raise ValidationError(
            f"{field_name} must be a UUID v4 string",
            key="invalid_uuid",
            placeholders={"field": field_name},
        )
    if value.version != UUID_VERSION_V4:
        raise ValidationError(
            f"{field_name} must be a UUID v4",
            key="invalid_uuid",
            placeholders={"field": field_name},
        )
    return value


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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
        raise ValidationError(
            "name is required and must be a non-empty string", key="name_required"
        )
    return value.strip()


def validate_write_name(name: object) -> str:
    """:func:`validate_required_name` plus the length cap, for a client's write."""

    trimmed = validate_required_name(name)
    if len(trimmed) > NAME_MAX_LENGTH:
        raise ValidationError(
            f"name must be at most {NAME_MAX_LENGTH} characters",
            key="name_too_long",
            placeholders={"max": NAME_MAX_LENGTH},
        )
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
        raise ValidationError(
            f"custom_fields must have at most {CUSTOM_FIELDS_MAX_KEYS} keys",
            key="custom_fields_too_many",
            placeholders={"max": CUSTOM_FIELDS_MAX_KEYS},
        )
    for key, value in values.items():
        if not isinstance(key, str) or not key:
            raise ValidationError(
                "custom_fields keys must be non-empty strings", key="custom_field_key_blank"
            )
        if len(key) > CUSTOM_FIELD_KEY_MAX_LENGTH and key not in prev:
            raise ValidationError(
                f"custom_fields keys must be at most {CUSTOM_FIELD_KEY_MAX_LENGTH} characters",
                key="custom_field_key_too_long",
                placeholders={"max": CUSTOM_FIELD_KEY_MAX_LENGTH},
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
                    f"{CUSTOM_FIELD_VALUE_MAX_LENGTH} characters",
                    key="custom_field_value_too_long",
                    placeholders={"max": CUSTOM_FIELD_VALUE_MAX_LENGTH},
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
            raise ValidationError(
                f"each tag must be at most {TAG_MAX_LENGTH} characters",
                key="tag_too_long",
                placeholders={"max": TAG_MAX_LENGTH},
            )
    if len(normalized) > TAGS_MAX_COUNT and len(normalized) > len(previous_tags):
        raise ValidationError(
            f"tags must have at most {TAGS_MAX_COUNT} entries",
            key="tags_too_many",
            placeholders={"max": TAGS_MAX_COUNT},
        )
    return normalized


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


def validate_due_date_rules(*, checked_out: bool, due_date: str | None) -> str | None:
    """A due date is only valid on a checked-out item, and must be YYYY-MM-DD."""

    if due_date is None:
        return None
    if not checked_out:
        raise ValidationError(
            "due_date is only valid when checked_out is true", key="due_date_not_checked_out"
        )
    return validate_optional_date(due_date, field_name="due_date")


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


def validate_optional_date(value: str | None, *, field_name: str) -> str | None:
    """Validate one optional YYYY-MM-DD field, naming it in any refusal."""

    if value is None:
        return None
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise ValidationError(
            f"{field_name} must be in 'YYYY-MM-DD' format",
            key="date_format",
            placeholders={"field": field_name},
        )
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValidationError(
            f"{field_name} must be a valid calendar date (YYYY-MM-DD)",
            key="date_invalid",
            placeholders={"field": field_name},
        ) from exc
    return value


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
        raise ValidationError(
            f"{field_name} must be at most {max_length} characters",
            key="text_too_long",
            placeholders={"field": field_name, "max": max_length},
        )


def validate_quantity(value: object) -> int:
    """Return the quantity, or refuse it. Spelled out so the return narrows to ``int``."""

    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError("quantity must be an integer >= 0", key="quantity_negative")
    return value


def validate_low_stock_threshold(value: object) -> int | None:
    """Return the low-stock threshold, or refuse it. ``None`` means never low."""

    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError(
            "low_stock_threshold must be an integer >= 0 or null",
            key="low_stock_threshold_negative",
        )
    return value
