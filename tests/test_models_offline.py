"""Offline tests for HAventory models and helpers.

Scenarios cover creation defaults, invalid payloads, tag normalization, field
clearing via updates, denormalized location path generation, attachment
metadata, and status definitions.
"""

from __future__ import annotations

import re
import uuid

import pytest
from custom_components.haventory.const import (
    DEFAULT_STATUS_COLOR,
    DEFAULT_STATUS_ICON,
    STATUS_COLORS,
)
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    ATTACHMENT_TITLE_MAX_LENGTH,
    EMPTY_LOCATION_PATH,
    Item,
    ItemCreate,
    ItemUpdate,
    Location,
    LocationPath,
    apply_item_update,
    build_location_path,
    build_location_path_from_map,
    create_item_from_create,
    iso_utc_now,
    load_attachments,
    monotonic_timestamp_after,
    new_uuid4_str,
    seed_status_definitions,
    serialize_attachment_meta,
    serialize_status_definition,
    validate_attachment_meta,
    validate_status_definition,
)

UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I
)


def _make_location(id: str, name: str, parent_id: str | None) -> Location:
    return Location(
        id=uuid.UUID(id),
        parent_id=(uuid.UUID(parent_id) if parent_id is not None else None),
        name=name,
        path=EMPTY_LOCATION_PATH,
    )


@pytest.mark.asyncio
async def test_create_with_defaults_and_optionals() -> None:
    # Create with minimal payload → defaults applied, UUID/ISO timestamps, version=1
    payload: ItemCreate = {"name": "Hammer", "tags": ["Tools", "  tools  ", "DIY"]}
    item = create_item_from_create(payload)

    assert isinstance(item, Item)
    assert item.name == "Hammer"
    assert item.quantity == 1
    assert item.checked_out is False
    assert item.due_date is None
    assert item.location_id is None
    assert item.tags == ["tools", "diy"]
    assert item.version == 1
    assert UUID4_RE.match(str(item.id))
    assert item.created_at.endswith("Z") and item.updated_at.endswith("Z")
    assert item.location_path == EMPTY_LOCATION_PATH


@pytest.mark.asyncio
async def test_invalid_due_date_requires_checked_out() -> None:
    # Invalid: due_date without checked_out → ValidationError
    with pytest.raises(ValidationError):
        create_item_from_create({"name": "Cordless Drill", "due_date": "2024-12-31"})


@pytest.mark.asyncio
async def test_tag_normalization_and_update_clears_fields() -> None:
    # Normalize tags on create and allow clearing via update.
    item = create_item_from_create({"name": "Battery", "tags": ["Li-Ion", " li-ion ", "Spare"]})
    assert item.tags == ["li-ion", "spare"]

    updated = apply_item_update(item, ItemUpdate(tags=[]))
    assert updated.tags == []

    updated2 = apply_item_update(updated, ItemUpdate(description=None, category=None))
    assert updated2.description is None and updated2.category is None


@pytest.mark.asyncio
async def test_denormalized_location_path_generation() -> None:
    # Build a simple 3-level location chain and ensure display/sort paths
    root_id = new_uuid4_str()
    mid_id = new_uuid4_str()
    leaf_id = new_uuid4_str()
    root = _make_location(root_id, "Garage", None)
    mid = _make_location(mid_id, "Shelf A", root_id)
    leaf = _make_location(leaf_id, "Bin 3", mid_id)
    path = build_location_path([root, mid, leaf])

    assert isinstance(path, LocationPath)
    assert [str(x) for x in path.id_path] == [root_id, mid_id, leaf_id]
    assert path.name_path == ["Garage", "Shelf A", "Bin 3"]
    assert path.display_path == "Garage / Shelf A / Bin 3"
    assert path.sort_key == "garage / shelf a / bin 3"

    # When creating with a valid location_id and map, item has location_path
    by_id: dict[str, Location] = {root_id: root, mid_id: mid, leaf_id: leaf}
    item = create_item_from_create(
        {"name": "Tape", "location_id": leaf_id, "checked_out": True, "due_date": "2024-01-02"},
        locations_by_id=by_id,
    )
    assert str(item.location_id) == leaf_id
    assert item.location_path.display_path == "Garage / Shelf A / Bin 3"

    # And lookup via map works from leaf
    path2 = build_location_path_from_map(uuid.UUID(leaf_id), locations_by_id=by_id)
    assert path2.display_path == path.display_path


@pytest.mark.asyncio
async def test_invalid_location_reference() -> None:
    # Invalid: location_id unknown → ValidationError
    fake_id = new_uuid4_str()
    with pytest.raises(ValidationError):
        create_item_from_create(
            {"name": "Glue", "location_id": fake_id, "checked_out": True, "due_date": "2024-01-02"},
            locations_by_id={},
        )


@pytest.mark.asyncio
async def test_update_version_and_updated_at_changes() -> None:
    # Update increments version and refreshes updated_at
    item = create_item_from_create({"name": "Saw"})
    updated = apply_item_update(item, ItemUpdate(quantity=3))
    assert updated.version == item.version + 1
    assert updated.updated_at != item.updated_at


@pytest.mark.asyncio
async def test_monotonic_timestamp_after_strictly_increases() -> None:
    # monotonic_timestamp_after returns a value strictly greater than prev and ends with 'Z'
    prev = iso_utc_now()
    nxt = monotonic_timestamp_after(prev)
    assert nxt.endswith("Z")
    assert nxt > prev


@pytest.mark.asyncio
async def test_create_trims_name_and_accepts_trailing_spaces() -> None:
    # Create accepts name with spaces and stores trimmed value
    item = create_item_from_create({"name": "  Widget  "})
    assert item.name == "Widget"


@pytest.mark.asyncio
async def test_update_trims_name_and_accepts_trailing_spaces() -> None:
    # Update accepts name with spaces and stores trimmed value
    item = create_item_from_create({"name": "Start"})
    updated = apply_item_update(item, ItemUpdate(name="  Wrench  "))
    assert updated.name == "Wrench"


@pytest.mark.asyncio
async def test_rejects_name_empty_after_trim_on_create_and_update() -> None:
    # Reject names that become empty after trimming on create and update
    with pytest.raises(ValidationError):
        create_item_from_create({"name": "   "})

    item = create_item_from_create({"name": "Valid"})
    with pytest.raises(ValidationError):
        apply_item_update(item, ItemUpdate(name="    "))


@pytest.mark.asyncio
async def test_inspection_date_accepted_without_checked_out() -> None:
    # inspection_date can be set without checked_out=True (unlike due_date)
    item = create_item_from_create({"name": "Battery", "inspection_date": "2024-12-31"})
    assert item.inspection_date == "2024-12-31"
    assert item.checked_out is False

    # Update inspection_date on non-checked-out item
    updated = apply_item_update(item, ItemUpdate(inspection_date="2025-01-15"))
    assert updated.inspection_date == "2025-01-15"
    assert updated.checked_out is False


@pytest.mark.asyncio
async def test_invalid_inspection_date_format_raises_validation_error() -> None:
    # Invalid inspection_date format → ValidationError
    with pytest.raises(ValidationError):
        create_item_from_create({"name": "Equipment", "inspection_date": "12/31/2024"})

    with pytest.raises(ValidationError):
        create_item_from_create({"name": "Equipment", "inspection_date": "2024-13-01"})

    item = create_item_from_create({"name": "Equipment"})
    with pytest.raises(ValidationError):
        apply_item_update(item, ItemUpdate(inspection_date="invalid-date"))


# -----------------------------
# Attachment metadata
# -----------------------------


def _attachment_doc(**overrides) -> dict:
    doc = {
        "id": new_uuid4_str(),
        "kind": "picture",
        "filename": "photo.png",
        "mime": "image/png",
        "size": 1234,
        "uploaded_at": iso_utc_now(),
    }
    doc.update(overrides)
    return doc


def test_a_fresh_item_carries_no_attachments() -> None:
    item = create_item_from_create(ItemCreate(name="Drill"))

    assert item.attachments == []


def test_attachments_are_not_settable_through_create_or_update() -> None:
    """The two attachment commands are the only writers of the field."""

    item = create_item_from_create({"name": "Drill", "attachments": [_attachment_doc()]})
    assert item.attachments == []

    updated = apply_item_update(item, {"attachments": [_attachment_doc()]})
    assert updated.attachments == []


def test_valid_attachment_metadata_round_trips() -> None:
    doc = _attachment_doc()

    meta = validate_attachment_meta(doc)

    assert serialize_attachment_meta(meta) == {**doc, "title": "", "order": 0}


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({"id": "not-a-uuid"}, "attachment.id"),
        ({"id": "00000000-0000-0000-0000-000000000000"}, "attachment.id"),
        ({"kind": "video"}, "kind must be one of"),
        ({"filename": ""}, "filename"),
        ({"mime": None}, "mime"),
        ({"size": -1}, "size"),
        ({"size": True}, "size"),
        ({"uploaded_at": "2026-08-05"}, "uploaded_at"),
    ],
)
def test_malformed_attachment_metadata_is_rejected(overrides: dict, match: str) -> None:
    with pytest.raises(ValidationError, match=re.escape(match)):
        validate_attachment_meta(_attachment_doc(**overrides))


def test_attachments_absent_or_non_list_read_as_none() -> None:
    """A store written before the field existed must not fail the whole item."""

    assert load_attachments(None) == []
    assert load_attachments("garbage") == []


def test_a_malformed_entry_is_not_silently_dropped() -> None:
    """Dropping one would lose the only reference to a file the sweep then deletes."""

    with pytest.raises(ValidationError):
        load_attachments([_attachment_doc(), {"id": "nope"}])


def test_attachment_metadata_carries_a_title_and_an_order() -> None:
    doc = _attachment_doc(title="Dishwasher manual (EN)", order=2)

    assert serialize_attachment_meta(validate_attachment_meta(doc)) == doc


def test_title_and_order_default_when_a_document_predates_them() -> None:
    """An empty title reads as "use the filename" rather than duplicating it."""

    meta = validate_attachment_meta(_attachment_doc())

    assert meta.title == ""
    assert meta.order == 0


@pytest.mark.parametrize(
    ("overrides", "match"),
    [
        ({"order": -1}, "order"),
        ({"order": "first"}, "order"),
        ({"order": True}, "order"),
        ({"title": 7}, "title"),
        ({"title": "x" * (ATTACHMENT_TITLE_MAX_LENGTH + 1)}, "title"),
    ],
)
def test_a_malformed_title_or_order_is_rejected(overrides: dict, match: str) -> None:
    with pytest.raises(ValidationError, match=re.escape(match)):
        validate_attachment_meta(_attachment_doc(**overrides))


# -----------------------------
# Status definitions
# -----------------------------


def test_the_seed_is_the_three_built_ins_in_display_order() -> None:
    seeded = seed_status_definitions()

    assert [d.slug for d in sorted(seeded.values(), key=lambda d: d.order)] == [
        "ok",
        "missing",
        "needs_repair",
    ]


def test_a_status_definition_round_trips() -> None:
    doc = {
        "slug": "lent_out",
        "label": "Lent out",
        "order": 7,
        "color": "blue",
        "icon": "hand",
    }

    assert serialize_status_definition(validate_status_definition(doc)) == doc


def test_appearance_defaults_when_a_document_predates_it() -> None:
    """Every v6 store written before this change carries neither field."""

    definition = validate_status_definition({"slug": "lent_out", "label": "Lent out"})

    assert definition.color == DEFAULT_STATUS_COLOR
    assert definition.icon == DEFAULT_STATUS_ICON


def test_the_seed_carries_the_built_in_appearance() -> None:
    seeded = seed_status_definitions()

    assert (seeded["ok"].color, seeded["ok"].icon) == ("green", "check")
    assert (seeded["missing"].color, seeded["missing"].icon) == ("amber", "alert")
    assert (seeded["needs_repair"].color, seeded["needs_repair"].icon) == ("amber", "wrench")


@pytest.mark.parametrize(
    "overrides",
    [
        {"slug": "Lent Out"},
        {"slug": "lent-out"},
        {"slug": ""},
        {"slug": None},
        {"label": "  "},
        {"label": 3},
        {"order": "first"},
        {"color": "puce"},
        # Neither shorthand nor a named CSS colour: one spelling reaches the
        # card, and anything else is a fill a browser silently drops.
        {"color": "#f00"},
        {"color": "#ff00zz"},
        {"color": "rebeccapurple"},
        {"color": 3},
        {"icon": "mdi:hand-extended"},
        {"icon": ""},
    ],
)
def test_a_malformed_status_definition_is_rejected(overrides: dict) -> None:
    doc = {"slug": "lent_out", "label": "Lent out", "order": 0, **overrides}

    with pytest.raises(ValidationError):
        validate_status_definition(doc)


def test_a_literal_colour_is_accepted_beside_the_tokens() -> None:
    """A household wanting its own colour is not confined to the ten.

    The ten stay the offered palette; a `#rrggbb` is the escape hatch beside
    them, and the card derives the ink for it rather than looking one up.
    """

    doc = {"slug": "lent_out", "label": "Lent out", "order": 0, "color": "#2F6F4F"}

    definition = validate_status_definition(doc)

    # Case-folded, so one colour has one spelling in the store.
    assert definition.color == "#2f6f4f"


def test_a_document_written_under_the_narrow_rule_still_loads() -> None:
    """Widening the rule is additive: every stored token stays valid."""

    for token in STATUS_COLORS:
        doc = {"slug": "s", "label": "S", "order": 0, "color": token}
        assert validate_status_definition(doc).color == token


def test_every_colour_has_a_light_and_a_strong_variant() -> None:
    """Ten tokens, five hues. The card renders each as a chip fill, so the two
    vocabularies must stay symmetric or a hue arrives with no strong form."""

    light = [c for c in STATUS_COLORS if not c.endswith("_strong")]
    strong = [c for c in STATUS_COLORS if c.endswith("_strong")]

    assert light
    assert sorted(f"{hue}_strong" for hue in light) == sorted(strong)
