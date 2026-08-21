"""Offline tests for attachment titles and ordering on the repository.

Order is per kind and the repository assigns it, so the first picture is the
cover a card shows and a new upload has to land after the ones already there
rather than tie with them. Retitling and reordering are item edits: they bump
the item's version and go through the same optimistic-concurrency check as any
other field.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import ConflictError, NotFoundError, ValidationError
from custom_components.haventory.models import (
    AttachmentMeta,
    ItemCreate,
    iso_utc_now,
    new_uuid4,
)
from custom_components.haventory.repository import Repository


def _attachment(kind: str = "picture", **overrides) -> AttachmentMeta:
    fields = {
        "id": new_uuid4(),
        "kind": kind,
        "filename": "photo.png",
        "mime": "image/png",
        "size": 12,
        "uploaded_at": iso_utc_now(),
    }
    fields.update(overrides)
    return AttachmentMeta(**fields)  # type: ignore[arg-type]


def test_retitling_an_attachment_is_an_item_edit() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Dishwasher"))
    meta = _attachment(kind="manual", filename="scan_0142.pdf", mime="application/pdf")
    item = repo.add_attachment(item.id, meta)

    updated = repo.update_attachment(item.id, meta.id, title="Warranty")

    assert updated.attachments[0].title == "Warranty"
    assert updated.version == item.version + 1


def test_retitling_checks_the_expected_version() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Dishwasher"))
    meta = _attachment()
    repo.add_attachment(item.id, meta)

    with pytest.raises(ConflictError):
        repo.update_attachment(item.id, meta.id, title="Cover", expected_version=1)


def test_retitling_an_unknown_attachment_is_not_found() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Dishwasher"))

    with pytest.raises(NotFoundError):
        repo.update_attachment(item.id, new_uuid4(), title="Nope")


def test_reordering_pictures_makes_the_first_one_the_cover() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    first, second = _attachment(), _attachment()
    repo.add_attachment(item.id, first)
    item = repo.add_attachment(item.id, second)

    updated = repo.reorder_attachments(item.id, "picture", [str(second.id), str(first.id)])

    ordered = sorted(updated.attachments, key=lambda a: a.order)
    assert [a.id for a in ordered] == [second.id, first.id]
    assert [a.order for a in ordered] == [0, 1]


def test_reordering_leaves_the_other_kind_alone() -> None:
    """Order is per kind, so shuffling pictures must not renumber manuals."""

    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    front, back = _attachment(), _attachment()
    first = _attachment(kind="manual", filename="a.pdf", mime="application/pdf")
    second = _attachment(kind="manual", filename="b.pdf", mime="application/pdf")
    for meta in (front, back, first, second):
        item = repo.add_attachment(item.id, meta)

    updated = repo.reorder_attachments(item.id, "picture", [str(back.id), str(front.id)])

    manuals = {a.id: a.order for a in updated.attachments if a.kind == "manual"}
    assert manuals == {first.id: 0, second.id: 1}


def test_adding_appends_within_its_own_kind() -> None:
    """A new upload lands after the ones already there, not tied with the cover.

    The repository assigns the position: every ``AttachmentMeta`` arrives at the
    default 0, so taking the caller's would sort each new picture into the
    middle of the item's existing ones.
    """

    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    front, back = _attachment(), _attachment()
    manual = _attachment(kind="manual", filename="m.pdf", mime="application/pdf")

    item = repo.add_attachment(item.id, front)
    item = repo.add_attachment(item.id, back)
    item = repo.add_attachment(item.id, manual)

    placed = {a.id: a.order for a in item.attachments}
    assert placed == {front.id: 0, back.id: 1, manual.id: 0}


def test_reordering_must_name_every_attachment_of_that_kind() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    first, second = _attachment(), _attachment()
    repo.add_attachment(item.id, first)
    item = repo.add_attachment(item.id, second)

    with pytest.raises(ValidationError, match="every attachment"):
        repo.reorder_attachments(item.id, "picture", [str(first.id)])
