"""The persisted records are frozen: a write builds a new record and never edits one.

The repository's indexes and its undo snapshot hold the records a write
replaces, so a record edited in place would leave an index, or a restored
snapshot, describing data that no longer exists.
"""

from __future__ import annotations

import uuid
from dataclasses import FrozenInstanceError, fields
from datetime import date

import pytest
from custom_components.haventory.item_writes import _ItemDraft
from custom_components.haventory.location_paths import build_location_path
from custom_components.haventory.models import (
    AttachmentMeta,
    Item,
    Location,
    LocationPath,
    seed_status_definitions,
)
from custom_components.haventory.repository import Repository

from repository_invariants import collect_index_issues


def _attachment() -> AttachmentMeta:
    return AttachmentMeta(
        id=uuid.uuid4(),
        kind="manual",
        filename="manual.pdf",
        mime="application/pdf",
        size=10,
        uploaded_at="2026-01-01T00:00:00Z",
    )


@pytest.mark.parametrize(
    ("record", "field_name", "value"),
    [
        (Item(id=uuid.uuid4(), name="Drill"), "name", "Saw"),
        (Item(id=uuid.uuid4(), name="Drill"), "tags", ("new",)),
        (Location(id=uuid.uuid4(), parent_id=None, name="Garage"), "name", "Shed"),
        (
            build_location_path([Location(id=uuid.uuid4(), parent_id=None, name="A")]),
            "sort_key",
            "",
        ),
        (_attachment(), "title", "Renamed"),
        (seed_status_definitions()["ok"], "label", "Fine"),
    ],
)
def test_assigning_a_field_of_a_record_raises(
    record: object, field_name: str, value: object
) -> None:
    with pytest.raises(FrozenInstanceError):
        setattr(record, field_name, value)


def test_the_collections_inside_a_record_cannot_be_edited() -> None:
    """Tuples, so neither an item's lists nor a path's can be appended to in place."""

    repo = Repository()
    loc = repo.create_location(name="Garage")
    item = repo.create_item({"name": "Drill", "tags": ["metal"], "location_id": str(loc.id)})

    assert isinstance(item.tags, tuple)
    assert isinstance(item.attachments, tuple)
    assert isinstance(item.location_path.id_path, tuple)
    assert isinstance(item.location_path.name_path, tuple)
    assert isinstance(loc.path.id_path, tuple)
    # The stored and wire shapes are unchanged: lists.
    stored = item.to_dict()
    assert stored["tags"] == ["metal"]
    assert stored["attachments"] == []
    assert stored["location_path"]["name_path"] == ["Garage"]


def test_the_draft_holds_exactly_the_fields_a_client_writes() -> None:
    """A field added to ``Item`` has to be added to the draft, or be decided outside it."""

    decided_outside_the_rules = {"id", "created_at", "updated_at", "version", "attachments"}
    item_fields = {f.name for f in fields(Item)}
    assert {f.name for f in fields(_ItemDraft)} == item_fields - decided_outside_the_rules


def test_an_update_leaves_the_record_it_replaces_as_it_was() -> None:
    repo = Repository()
    before = repo.create_item({"name": "Drill", "tags": ["metal"], "custom_fields": {"a": 1}})

    after = repo.update_item(
        before.id, {"name": "Saw", "tags": ["wood"], "custom_fields_set": {"b": 2}}
    )

    assert (before.name, before.tags, dict(before.custom_fields), before.version) == (
        "Drill",
        ("metal",),
        {"a": 1},
        1,
    )
    assert (after.name, after.tags, dict(after.custom_fields), after.version) == (
        "Saw",
        ("wood",),
        {"a": 1, "b": 2},
        2,
    )
    assert repo.get_item(before.id) is after


def test_a_rename_replaces_the_items_below_and_changes_only_their_path() -> None:
    repo = Repository()
    root = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf", parent_id=str(root.id))
    before = repo.create_item({"name": "Drill", "location_id": str(shelf.id), "tags": ["metal"]})

    repo.update_location(root.id, name="Workshop")
    after = repo.get_item(before.id)

    assert before.location_path.display_path == "Garage / Shelf"
    assert after.location_path.display_path == "Workshop / Shelf"
    assert after is not before
    assert after.to_dict() == {
        **before.to_dict(),
        "location_path": after.location_path.to_dict(),
    }
    assert collect_index_issues(repo) == []


def test_with_location_path_copies_every_other_field() -> None:
    item = Item(id=uuid.uuid4(), name="Drill", tags=("metal",), custom_fields={"a": 1})
    path = LocationPath(
        id_path=(uuid.uuid4(),), name_path=("Shed",), display_path="Shed", sort_key="shed"
    )

    moved = item.with_location_path(path)

    assert moved.location_path is path
    assert moved == Item(
        **{**{f.name: getattr(item, f.name) for f in fields(Item)}, "location_path": path}
    )
    with pytest.raises(FrozenInstanceError):
        moved.name = "Saw"


def test_a_bump_keeps_the_anchor_and_leaves_the_earlier_record_alone() -> None:
    """The bump moves the date without re-anchoring, and builds the item once."""

    repo = Repository()
    item = repo.create_item(
        {
            "name": "Filter",
            "reminder_date": "2026-01-31",
            "reminder_interval": {"unit": "months", "count": 1},
        }
    )

    bumped = repo.bump_reminder(item.id, today=date(2026, 1, 31))

    assert (bumped.reminder_date, bumped.reminder_anchor, bumped.version) == (
        "2026-02-28",
        "2026-01-31",
        2,
    )
    assert (item.reminder_date, item.reminder_anchor, item.version) == (
        "2026-01-31",
        "2026-01-31",
        1,
    )
    assert repo.get_item(item.id) is bumped
    assert collect_index_issues(repo) == []
