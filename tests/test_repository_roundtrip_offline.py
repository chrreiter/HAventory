"""Offline tests for what must survive an export_state/load_state round trip.

- LocationPath.sort_key, which once serialized without sort_key and reloaded
  as "".
- Cursor pagination must return an empty page when everything after the
  cursor was deleted between pages (it previously re-served page one).
- Status definitions, against the two traps that would silently lose them: the
  loader ordering (items coerced against the built-ins alone) and the save path
  (a collection the repository reads but does not emit).
- Attachment metadata, which is the only record of where a file on disk is.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.exceptions import ConflictError
from custom_components.haventory.models import (
    AttachmentMeta,
    ItemCreate,
    Sort,
    iso_utc_now,
    new_uuid4,
)
from custom_components.haventory.repository import Repository


def test_sort_key_survives_persistence_round_trip() -> None:
    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf Alpha", parent_id=garage.id)
    item = repo.create_item(ItemCreate(name="Hammer", quantity=1, location_id=str(shelf.id)))

    assert repo.get_location(shelf.id).path.sort_key
    assert repo.get_item(item.id).location_path.sort_key

    reloaded = Repository.from_state(repo.export_state())

    assert (
        reloaded.get_location(shelf.id).path.sort_key == repo.get_location(shelf.id).path.sort_key
    )
    assert (
        reloaded.get_item(item.id).location_path.sort_key
        == repo.get_item(item.id).location_path.sort_key
    )


def test_legacy_store_without_sort_key_is_backfilled_on_load() -> None:
    """Pre-WP4 stores never persisted sort_key; loading must derive it."""

    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf Alpha", parent_id=garage.id)
    item = repo.create_item(ItemCreate(name="Hammer", quantity=1, location_id=str(shelf.id)))

    payload = repo.export_state()
    # Simulate a legacy payload: strip every persisted sort_key.
    for loc in payload["locations"].values():
        loc["path"].pop("sort_key", None)
    for it in payload["items"].values():
        it["location_path"].pop("sort_key", None)

    reloaded = Repository.from_state(payload)

    expected = repo.get_location(shelf.id).path.sort_key
    assert expected
    assert reloaded.get_location(shelf.id).path.sort_key == expected
    assert reloaded.get_item(item.id).location_path.sort_key == expected


def test_cursor_returns_empty_page_when_tail_deleted() -> None:
    repo = Repository()
    items = [repo.create_item(ItemCreate(name=f"Item {i:02d}", quantity=1)) for i in range(6)]

    sort = Sort(field="name", order="asc")
    page1 = repo.list_items(sort=sort, limit=3)
    assert [i.name for i in page1["items"]] == ["Item 00", "Item 01", "Item 02"]
    cursor = page1["next_cursor"]
    assert cursor is not None

    # Everything after the cursor disappears between the two page fetches.
    for item in items[3:]:
        repo.delete_item(item.id)

    page2 = repo.list_items(sort=sort, limit=3, cursor=cursor)
    assert page2["items"] == []
    assert page2["next_cursor"] is None


# -----------------------------
# Statuses: the two data-loss traps
# -----------------------------


def _payload_with_custom_status() -> dict:
    """A store carrying a status this build does not seed, with items on it."""

    repo = Repository()
    item = repo.create_item(ItemCreate(name="Ladder"))
    payload = repo.export_state()
    payload["statuses"]["lent_out"] = {
        "slug": "lent_out",
        "label": "Lent out",
        "order": 9,
        "color": "blue",
        "icon": "hand",
    }
    payload["items"][str(item.id)]["status"] = "lent_out"
    return payload


def test_a_custom_status_survives_load_export_load() -> None:
    """The loader-ordering trap.

    the tolerant status read maps an unknown value to "ok". Definitions therefore
    have to load before the item loop, or the first restart after the upgrade
    that introduced a custom status silently rewrites every item carrying it.
    """

    payload = _payload_with_custom_status()

    repo = Repository.from_state(payload)
    reloaded = Repository.from_state(repo.export_state())

    assert "lent_out" in reloaded.status_slugs()
    assert [i.status for i in reloaded._items_by_id.values()] == ["lent_out"]


def test_a_loaded_repository_still_emits_its_statuses() -> None:
    """The erase-on-save trap.

    `async_persist_repo` saves exactly `export_state()`, and `async_save` only
    backfills a missing collection with `{}`. A collection the repository reads
    but does not emit is therefore correct at boot and gone after the first save.
    """

    repo = Repository.from_state(_payload_with_custom_status())

    exported = repo.export_state()

    assert exported["statuses"]["lent_out"] == {
        "slug": "lent_out",
        "label": "Lent out",
        "order": 9,
        "color": "blue",
        "icon": "hand",
    }


def test_a_store_with_no_statuses_section_reads_as_the_built_ins() -> None:
    """Which is what every pre-v6 store carries, permanently."""

    repo = Repository.from_state({"items": {}, "locations": {}})

    assert repo.status_slugs() == frozenset({"ok", "missing", "needs_repair"})


def test_the_default_status_is_re_seeded_even_when_a_document_omits_it() -> None:
    """ "ok" is the value every item falls back to and "flagged" is defined against."""

    repo = Repository.from_state(
        {
            "items": {},
            "locations": {},
            "statuses": {"lent_out": {"slug": "lent_out", "label": "Lent out", "order": 0}},
        }
    )

    assert "ok" in repo.status_slugs()


def test_an_unreadable_status_definition_is_skipped_not_fatal() -> None:
    """An unreadable label costs a display string; refusing would cost the inventory."""

    repo = Repository.from_state(
        {
            "items": {},
            "locations": {},
            "statuses": {
                "lent_out": {"slug": "lent_out", "label": "Lent out", "order": 0},
                "broken": {"slug": "Not A Slug", "label": ""},
            },
        }
    )

    assert "lent_out" in repo.status_slugs()
    assert "broken" not in repo.status_slugs()


# -----------------------------
# Attachments
# -----------------------------


def test_attachments_survive_export_state_to_load_state() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    meta = AttachmentMeta(
        id=new_uuid4(),
        kind="picture",
        filename="drill.png",
        mime="image/png",
        size=42,
        uploaded_at=iso_utc_now(),
    )
    repo.add_attachment(item.id, meta)

    reloaded = Repository.from_state(repo.export_state())

    assert reloaded.get_item(item.id).attachments == [meta]


def test_a_stored_attachments_field_that_is_not_a_list_loads_as_none() -> None:
    """Tolerant of the field's shape, rather than failing the whole item."""

    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    payload = repo.export_state()
    payload["items"][str(item.id)]["attachments"] = "garbage"

    reloaded = Repository.from_state(payload)

    assert reloaded.get_item(item.id).attachments == []
    assert not reloaded.last_load_report.has_corruption


def test_adding_an_attachment_bumps_the_version_and_the_timestamp() -> None:
    """Unlike the derived location path, an attachment edit *is* an item edit."""

    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    meta = AttachmentMeta(
        id=new_uuid4(),
        kind="picture",
        filename="drill.png",
        mime="image/png",
        size=42,
        uploaded_at=iso_utc_now(),
    )

    updated = repo.add_attachment(item.id, meta)

    assert updated.version == item.version + 1
    assert updated.updated_at > item.updated_at


def test_a_stale_expected_version_refuses_the_attachment() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Drill"))
    meta = AttachmentMeta(
        id=new_uuid4(),
        kind="picture",
        filename="drill.png",
        mime="image/png",
        size=42,
        uploaded_at=iso_utc_now(),
    )

    with pytest.raises(ConflictError):
        repo.add_attachment(item.id, meta, expected_version=item.version + 5)
