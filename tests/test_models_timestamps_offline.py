"""Offline tests pinning the canonical-timestamp invariant.

Sorting and range filters compare timestamps lexicographically, so validation
must accept EXACTLY the canonical YYYY-MM-DDTHH:MM:SSZ form. fromisoformat
alone would also accept a space separator, ISO week dates, or basic-format
times — inputs that then compare chronologically wrong as strings.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import import_export as ie
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    ItemCreate,
    ItemFilter,
    filter_items,
    is_canonical_utc_timestamp,
    iso_utc_now,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION


def test_is_canonical_accepts_only_the_canonical_form() -> None:
    assert is_canonical_utc_timestamp("2026-07-23T10:00:00Z")
    assert is_canonical_utc_timestamp(iso_utc_now())

    rejected = [
        "2026-07-23 10:00:00Z",  # space separator
        "2026-07-23x10:00:00Z",  # arbitrary separator
        "2026-W30-4T10:00:00Z",  # ISO week date
        "2026-07-23T101010.4Z",  # basic-format time with fraction
        "2026-07-23T10:00:00",  # no Z
        "2026-07-23T10:00Z",  # wrong length
        "2026-07-23T10:00:00+00:00",  # offset form
        "2026-13-23T10:00:00Z",  # shape ok but not a real date
        None,
        20260723,
    ]
    for ts in rejected:
        assert not is_canonical_utc_timestamp(ts), ts


def test_filter_rejects_non_canonical_bounds() -> None:
    repo = Repository()
    repo.create_item(ItemCreate(name="Widget", quantity=1))
    items = list(repo._items_by_id.values())

    with pytest.raises(ValidationError):
        filter_items(items, ItemFilter(updated_after="2026-07-23 10:00:00Z"))
    with pytest.raises(ValidationError):
        filter_items(items, ItemFilter(created_after="2026-07-23x10:00:00Z"))


def test_filter_accepts_canonical_bounds() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget", quantity=1))
    items = list(repo._items_by_id.values())

    past = "2000-01-01T00:00:00Z"
    future = "2999-01-01T00:00:00Z"
    assert [i.id for i in filter_items(items, ItemFilter(updated_after=past))] == [item.id]
    assert filter_items(items, ItemFilter(updated_after=future)) == []


def test_import_rejects_non_canonical_item_timestamps() -> None:
    repo = Repository()
    source = Repository()
    item = source.create_item(ItemCreate(name="Widget", quantity=1))
    doc = ie.build_export_document(source, schema_version=CURRENT_SCHEMA_VERSION)
    doc["items"][0]["updated_at"] = "2026-07-23 10:00:00Z"

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is False
    assert target is None
    assert any("updated_at" in err.get("path", "") for err in report["errors"])
    # The canonical timestamp from our own export is fine.
    assert is_canonical_utc_timestamp(item.updated_at)


def test_import_rejects_explicit_null_timestamp() -> None:
    """A present-but-null timestamp must be rejected (would store as 'None')."""
    repo = Repository()
    source = Repository()
    source.create_item(ItemCreate(name="Widget", quantity=1))
    doc = ie.build_export_document(source, schema_version=CURRENT_SCHEMA_VERSION)
    doc["items"][0]["updated_at"] = None

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is False
    assert target is None
    assert any("updated_at" in err.get("path", "") for err in report["errors"])


def test_import_backfills_omitted_timestamp() -> None:
    """An omitted timestamp is allowed and loads as a canonical value."""
    repo = Repository()
    source = Repository()
    source.create_item(ItemCreate(name="Widget", quantity=1))
    doc = ie.build_export_document(source, schema_version=CURRENT_SCHEMA_VERSION)
    doc["items"][0].pop("updated_at")
    doc["items"][0].pop("created_at")

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is True
    assert target is not None

    repo.load_state(target)
    loaded = next(iter(repo._items_by_id.values()))
    assert is_canonical_utc_timestamp(loaded.created_at)
    assert is_canonical_utc_timestamp(loaded.updated_at)


def test_load_state_backfills_non_canonical_timestamps() -> None:
    """Corrupt/missing timestamps in a persisted payload are healed on load."""
    repo = Repository()
    source = Repository()
    source.create_item(ItemCreate(name="Widget", quantity=1))
    payload = source.export_state()

    item_key = next(iter(payload["items"]))
    payload["items"][item_key]["updated_at"] = "None"  # what a stored null becomes
    payload["items"][item_key].pop("created_at")  # missing entirely

    repo.load_state(payload)
    loaded = repo._items_by_id[item_key]
    assert is_canonical_utc_timestamp(loaded.created_at)
    assert is_canonical_utc_timestamp(loaded.updated_at)
