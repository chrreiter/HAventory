"""Offline tests for status-definition and attachment-ordering mutators.

The status vocabulary is the one collection whose entries items *reference*, so
deleting one is the only vocabulary edit that can orphan data. These tests pin
the refusal and the reassign escape hatch, and the reindexing that has to follow
a reassignment for the status filter to keep agreeing with the stored value.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import ConflictError, NotFoundError, ValidationError
from custom_components.haventory.models import (
    AttachmentMeta,
    ItemCreate,
    ItemFilter,
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


# -----------------------------
# Creating and updating
# -----------------------------


def test_a_created_status_joins_the_live_vocabulary() -> None:
    repo = Repository()

    created = repo.create_status({"slug": "lent_out", "label": "Lent out", "color": "blue"})

    assert created.slug == "lent_out"
    assert "lent_out" in repo.status_slugs()
    assert repo.create_item({"name": "Ladder", "status": "lent_out"}).status == "lent_out"


def test_a_created_status_lands_last_when_it_names_no_order() -> None:
    repo = Repository()

    created = repo.create_status({"slug": "lent_out", "label": "Lent out"})

    assert [d.slug for d in repo.list_statuses()][-1] == "lent_out"
    assert created.order == len(repo.list_statuses()) - 1


def test_a_duplicate_slug_is_refused() -> None:
    repo = Repository()

    with pytest.raises(ValidationError, match="already"):
        repo.create_status({"slug": "missing", "label": "Gone"})


def test_a_rename_touches_no_item() -> None:
    """The slug is the identity, so a label edit is not an item edit."""

    repo = Repository()
    item = repo.create_item({"name": "Saw", "status": "needs_repair"})
    before = repo.get_item(item.id)

    repo.update_status("needs_repair", {"label": "Broken"})

    after = repo.get_item(item.id)
    assert after.status == "needs_repair"
    assert (after.version, after.updated_at) == (before.version, before.updated_at)


def test_updating_an_unknown_status_is_not_found() -> None:
    repo = Repository()

    with pytest.raises(NotFoundError):
        repo.update_status("lent_out", {"label": "Lent out"})


def test_a_slug_cannot_be_edited() -> None:
    """Items store it, so changing it would strand every one of them."""

    repo = Repository()

    with pytest.raises(ValidationError, match="slug"):
        repo.update_status("missing", {"slug": "gone"})


# -----------------------------
# Reordering
# -----------------------------


def test_reordering_rewrites_display_order() -> None:
    repo = Repository()

    repo.reorder_statuses(["needs_repair", "ok", "missing"])

    assert [d.slug for d in repo.list_statuses()] == ["needs_repair", "ok", "missing"]


def test_reordering_must_name_every_slug_exactly_once() -> None:
    repo = Repository()

    with pytest.raises(ValidationError, match="every status"):
        repo.reorder_statuses(["ok", "missing"])

    with pytest.raises(ValidationError, match="every status"):
        repo.reorder_statuses(["ok", "missing", "missing"])


# -----------------------------
# Deleting — the only edit that can orphan an item
# -----------------------------


def test_the_default_status_can_never_be_deleted() -> None:
    """`ok` is what an unknown value coerces to and what "flagged" is defined
    against, so nothing may remove it."""

    repo = Repository()

    with pytest.raises(ValidationError, match="default"):
        repo.delete_status("ok")


def test_an_unused_status_deletes_outright() -> None:
    repo = Repository()

    removed, moved = repo.delete_status("needs_repair")

    assert removed.slug == "needs_repair"
    assert moved == 0
    assert "needs_repair" not in repo.status_slugs()


def test_a_status_in_use_is_refused_without_a_target() -> None:
    repo = Repository()
    repo.create_item({"name": "Ladder", "status": "missing"})

    with pytest.raises(ValidationError, match="1 item"):
        repo.delete_status("missing")

    assert "missing" in repo.status_slugs()


def test_reassigning_moves_the_items_and_then_deletes() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Ladder", "status": "missing"})
    before = repo.get_item(item.id)

    removed, moved = repo.delete_status("missing", reassign_to="ok")

    assert (removed.slug, moved) == ("missing", 1)
    assert "missing" not in repo.status_slugs()
    after = repo.get_item(item.id)
    assert after.status == "ok"
    assert after.version == before.version + 1


def test_a_reassigned_item_leaves_the_old_status_index() -> None:
    """The filter reads the index, so a stale bucket would keep serving an item
    under a status that no longer exists."""

    repo = Repository()
    repo.create_item({"name": "Ladder", "status": "missing"})

    repo.delete_status("missing", reassign_to="needs_repair")

    assert repo.get_counts()["status_counts"]["needs_repair"] == 1
    page = repo.list_items(flt=ItemFilter(status="needs_repair"))
    assert [i.name for i in page["items"]] == ["Ladder"]


def test_reassigning_to_an_unknown_or_identical_status_is_refused() -> None:
    repo = Repository()
    repo.create_item({"name": "Ladder", "status": "missing"})

    with pytest.raises(ValidationError):
        repo.delete_status("missing", reassign_to="nowhere")

    with pytest.raises(ValidationError):
        repo.delete_status("missing", reassign_to="missing")


# -----------------------------
# Attachment title and order
# -----------------------------


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
