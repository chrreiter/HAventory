"""The item create and update inputs, and the rules that apply them.

A create and an update walk the one table ``_ITEM_FIELD_RULES`` in its order, so
a field is checked the same way on both, and a rule that depends on another field
(a due date on ``checked_out``, a reminder interval on its date) judges what the
write leaves behind. A rule leaves the draft alone when the payload does not name
its keys, which is how an update keeps a field. Only ``apply_item_update`` moves
``version`` and ``updated_at``.

``Item`` is frozen, so the rules edit an ``_ItemDraft`` of the client-writable
fields, and the new item is built from it once every rule has passed.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass, replace
from typing import Any, Final, NotRequired, TypedDict

from .exceptions import ValidationError
from .location_paths import build_location_path_from_map
from .models import (
    EMPTY_LOCATION_PATH,
    ITEM_STATUSES,
    Item,
    ItemStatus,
    Location,
    LocationPath,
    ReminderInterval,
    new_uuid4,
    validate_item_status,
    validate_reminder_rules,
)
from .timestamps import iso_utc_now, monotonic_timestamp_after
from .validation import (
    CATEGORY_MAX_LENGTH,
    CUSTOM_FIELDS_MAX_KEYS,
    DESCRIPTION_MAX_LENGTH,
    ScalarValue,
    parse_uuid4,
    require_string_list,
    validate_custom_fields,
    validate_due_date_rules,
    validate_low_stock_threshold,
    validate_optional_date,
    validate_optional_text,
    validate_quantity,
    validate_tags,
    validate_write_name,
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


@dataclass(slots=True)
class _ItemDraft:
    """The fields of ``Item`` a client writes, editable while the rules run.

    Every other field (``id``, the timestamps, ``version``, ``attachments``) is
    decided outside the rule table, and ``tests/test_frozen_records_offline.py``
    holds this list equal to ``Item``'s.
    """

    name: str
    description: str | None
    quantity: int
    status: ItemStatus
    checked_out: bool
    due_date: str | None
    inspection_date: str | None
    reminder_date: str | None
    reminder_anchor: str | None
    reminder_interval: ReminderInterval | None
    location_id: uuid.UUID | None
    location_path: LocationPath
    tags: tuple[str, ...]
    category: str | None
    low_stock_threshold: int | None
    custom_fields: Mapping[str, ScalarValue]

    @classmethod
    def of(cls, item: Item) -> _ItemDraft:
        return cls(
            name=item.name,
            description=item.description,
            quantity=item.quantity,
            status=item.status,
            checked_out=item.checked_out,
            due_date=item.due_date,
            inspection_date=item.inspection_date,
            reminder_date=item.reminder_date,
            reminder_anchor=item.reminder_anchor,
            reminder_interval=item.reminder_interval,
            location_id=item.location_id,
            location_path=item.location_path,
            tags=item.tags,
            category=item.category,
            low_stock_threshold=item.low_stock_threshold,
            custom_fields=item.custom_fields,
        )

    def build(self, base: Item, *, updated_at: str, version: int) -> Item:
        """``base`` with the drafted fields, as a new item."""

        return replace(
            base,
            name=self.name,
            description=self.description,
            quantity=self.quantity,
            status=self.status,
            checked_out=self.checked_out,
            due_date=self.due_date,
            inspection_date=self.inspection_date,
            reminder_date=self.reminder_date,
            reminder_anchor=self.reminder_anchor,
            reminder_interval=self.reminder_interval,
            location_id=self.location_id,
            location_path=self.location_path,
            tags=self.tags,
            category=self.category,
            low_stock_threshold=self.low_stock_threshold,
            custom_fields=self.custom_fields,
            updated_at=updated_at,
            version=version,
        )


@dataclass(frozen=True, slots=True)
class _ItemWrite:
    """One item write in progress: ``draft`` starts as the field defaults on a
    create and as the stored item's fields on an update, and the rules fill it in."""

    draft: _ItemDraft
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


def _write_description(write: _ItemWrite) -> None:
    if "description" in write.payload:
        value = write.payload["description"]
        validate_optional_text(
            value,
            "description",
            max_length=DESCRIPTION_MAX_LENGTH,
            previous=write.draft.description,
        )
        write.draft.description = value


def _write_category(write: _ItemWrite) -> None:
    if "category" in write.payload:
        value = write.payload["category"]
        validate_optional_text(
            value, "category", max_length=CATEGORY_MAX_LENGTH, previous=write.draft.category
        )
        write.draft.category = value


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
                raise ValidationError(
                    "location_id must reference an existing location", key="location_not_found"
                )
        draft.location_id = location_id

    if draft.location_id is None:
        draft.location_path = EMPTY_LOCATION_PATH
    elif locations_by_id:
        draft.location_path = build_location_path_from_map(
            draft.location_id, locations_by_id=locations_by_id
        )


def _write_tags(write: _ItemWrite) -> None:
    if "tags" in write.payload:
        write.draft.tags = tuple(validate_tags(write.payload["tags"], previous=write.draft.tags))


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
        raise ValidationError(
            f"custom_fields must have at most {CUSTOM_FIELDS_MAX_KEYS} keys",
            key="custom_fields_too_many",
            placeholders={"max": CUSTOM_FIELDS_MAX_KEYS},
        )


#: Every item field a client writes, and its rule. A create and an update walk
#: this one table in this order; a rule leaves the draft alone when the write
#: names none of its keys.
_ITEM_FIELD_RULES: Final[tuple[Callable[[_ItemWrite], None], ...]] = (
    _write_name,
    _write_description,
    _write_quantity,
    _write_status,
    _write_checkout,
    _write_inspection_date,
    _write_reminder,
    _write_location,
    _write_tags,
    _write_category,
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
    defaults = Item(id=new_uuid4(), name="", created_at=created_ts, updated_at=created_ts)
    draft = _ItemDraft.of(defaults)
    write = _ItemWrite(draft, payload, True, locations_by_id, known_statuses)
    for rule in _ITEM_FIELD_RULES:
        rule(write)
    return draft.build(defaults, updated_at=created_ts, version=defaults.version)


def apply_item_update(
    item: Item,
    update: ItemUpdate,
    *,
    locations_by_id: dict[str, Location] | None = None,
    known_statuses: Collection[str] = ITEM_STATUSES,
) -> Item:
    """Apply an update payload to an Item and return a new updated instance."""

    draft = _ItemDraft.of(item)
    write = _ItemWrite(draft, update, False, locations_by_id, known_statuses)
    for rule in _ITEM_FIELD_RULES:
        rule(write)
    return draft.build(
        item, updated_at=monotonic_timestamp_after(item.updated_at), version=item.version + 1
    )
