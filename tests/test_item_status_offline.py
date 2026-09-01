"""Offline tests for the per-item status field (ok / missing / needs_repair).

What the field means, wherever the meaning is decided rather than served: the
model's creation defaults, validation and filtering, tolerant loading of a
payload written before the field existed, the repository round-trip,
import/export, the service schemas, and the live status set a household can
extend. The repository and WebSocket layers keep their own
homes in ``test_repository_statuses_offline.py`` and
``test_ws_statuses_offline.py``.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import import_export as ie
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    DEFAULT_ITEM_STATUS,
    ITEM_STATUSES,
    ItemCreate,
    ItemUpdate,
    apply_item_update,
    create_item_from_create,
    filter_items,
    validate_item_status,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.services import SCHEMA_ITEM_CREATE, SCHEMA_ITEM_UPDATE
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore

# -----------------------------
# Models
# -----------------------------


def test_create_defaults_to_ok() -> None:
    item = create_item_from_create({"name": "Hammer"})
    assert item.status == DEFAULT_ITEM_STATUS == "ok"


@pytest.mark.parametrize("status", ITEM_STATUSES)
def test_create_accepts_each_known_status(status: str) -> None:
    payload: ItemCreate = {"name": "Hammer", "status": status}  # type: ignore[typeddict-item]
    assert create_item_from_create(payload).status == status


@pytest.mark.parametrize("bad", ["broken", "OK", "", None, 1, True])
def test_create_rejects_unknown_status(bad: object) -> None:
    with pytest.raises(ValidationError, match="status must be one of"):
        create_item_from_create({"name": "Hammer", "status": bad})  # type: ignore[typeddict-item]


def test_update_sets_status_and_bumps_version() -> None:
    item = create_item_from_create({"name": "Hammer"})
    updated = apply_item_update(item, ItemUpdate(status="missing"))
    assert updated.status == "missing"
    assert updated.version == item.version + 1
    # Back to ok is how a flagged state clears.
    cleared = apply_item_update(updated, ItemUpdate(status="ok"))
    assert cleared.status == "ok"


def test_update_rejects_unknown_and_null_status() -> None:
    item = create_item_from_create({"name": "Hammer"})
    with pytest.raises(ValidationError, match="status must be one of"):
        apply_item_update(item, {"status": "lost"})  # type: ignore[typeddict-item]
    with pytest.raises(ValidationError, match="status must be one of"):
        apply_item_update(item, {"status": None})  # type: ignore[typeddict-item]


def test_update_without_status_keeps_it() -> None:
    item = create_item_from_create({"name": "Hammer", "status": "needs_repair"})
    updated = apply_item_update(item, ItemUpdate(name="Hammer Pro"))
    assert updated.status == "needs_repair"


def test_the_strict_and_the_tolerant_read_of_a_status() -> None:
    assert validate_item_status("missing") == "missing"
    with pytest.raises(ValidationError):
        validate_item_status("bogus")
    assert validate_item_status("needs_repair", default=DEFAULT_ITEM_STATUS) == "needs_repair"
    assert validate_item_status(None, default=DEFAULT_ITEM_STATUS) == "ok"
    assert validate_item_status("bogus", default=DEFAULT_ITEM_STATUS) == "ok"
    assert validate_item_status(7, default=DEFAULT_ITEM_STATUS) == "ok"


def test_filter_items_by_status() -> None:
    ok = create_item_from_create({"name": "Wrench"})
    missing = create_item_from_create({"name": "Hammer", "status": "missing"})
    repair = create_item_from_create({"name": "Drill", "status": "needs_repair"})
    items = [ok, missing, repair]

    assert filter_items(items, {"status": "missing"}) == [missing]
    assert filter_items(items, {"status": "needs_repair"}) == [repair]
    assert filter_items(items, {"status": "ok"}) == [ok]
    # Combined with q: both predicates must hold.
    assert filter_items(items, {"status": "missing", "q": "drill"}) == []
    assert filter_items(items, {"status": "needs_repair", "q": "drill"}) == [repair]


def test_filter_items_rejects_unknown_status() -> None:
    items = [create_item_from_create({"name": "Hammer"})]
    with pytest.raises(ValidationError, match="status must be one of"):
        filter_items(items, {"status": "bogus"})  # type: ignore[typeddict-item]


# -----------------------------
# Stored state
# -----------------------------


def test_repository_roundtrip_preserves_status() -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer", "status": "missing"})
    repo.create_item({"name": "Wrench"})

    restored = Repository.from_state(repo.export_state())
    by_name = {i.name: i for i in restored._items_by_id.values()}
    assert by_name["Hammer"].status == "missing"
    assert by_name["Wrench"].status == "ok"
    assert restored.get_counts()["missing_count"] == 1


def test_load_state_tolerates_missing_and_unknown_status() -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer"})
    repo.create_item({"name": "Drill"})
    state = repo.export_state()
    items = list(state["items"].values())
    # A payload written before the field existed, and a hand-edited value.
    del items[0]["status"]
    items[1]["status"] = "shattered"

    restored = Repository.from_state(state)
    assert all(i.status == "ok" for i in restored._items_by_id.values())
    counts = restored.get_counts()
    assert counts["missing_count"] == 0
    assert counts["needs_repair_count"] == 0


# -----------------------------
# The load path
# -----------------------------


@pytest.mark.asyncio
async def test_a_store_written_before_the_field_loads_with_every_status() -> None:
    """An item with no stored status reads as the default, and one naming a slug
    the store does not define reads as it too.

    Nothing rewrites the rows on the way in, so the tolerance has to be in the
    read itself — otherwise a store written before the field existed reaches the
    repository with items carrying no status at all.
    """

    hass = HomeAssistant()
    key = "test_status_on_load"
    store = DomainStore(hass, key=key)
    raw_store = HAStore(hass, 1, key)
    plain, flagged, unknown = (
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
    )
    await raw_store.async_save(
        {
            "schema_version": 0,
            "items": {
                plain: {"id": plain, "name": "Hammer"},
                flagged: {"id": flagged, "name": "Drill", "status": "needs_repair"},
                unknown: {"id": unknown, "name": "Wrench", "status": "shattered"},
            },
            "locations": {},
        }
    )

    repo = Repository.from_state(await store.async_load())

    by_name = {item.name: item for item in repo._items_by_id.values()}
    assert by_name["Hammer"].status == "ok"
    assert by_name["Drill"].status == "needs_repair"
    assert by_name["Wrench"].status == "ok"
    # The store predates the collection too, so the built-ins are what it gets.
    assert sorted(repo.status_slugs()) == ["missing", "needs_repair", "ok"]


# -----------------------------
# Import / export
# -----------------------------


def test_export_document_carries_status_and_reimports() -> None:
    source = Repository()
    source.create_item({"name": "Hammer", "status": "missing"})
    doc = ie.build_export_document(source, schema_version=CURRENT_SCHEMA_VERSION)
    assert doc["items"][0]["status"] == "missing"

    target = Repository()
    report, payload = ie.plan_import(
        target, doc, policy="replace", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is True
    assert payload is not None
    target.load_state(payload)
    assert next(iter(target._items_by_id.values())).status == "missing"


def test_import_document_without_status_is_unchanged_against_ok_item() -> None:
    """A pre-status export re-imported over the same data must not read as an update."""

    repo = Repository()
    repo.create_item({"name": "Hammer"})
    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)
    for item_doc in doc["items"]:
        del item_doc["status"]

    report, _payload = ie.plan_import(
        repo, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is True
    assert report["counts"]["items"]["unchanged"] == 1
    assert report["counts"]["items"]["update"] == 0


def test_import_rejects_invalid_status() -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer"})
    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)
    doc["items"][0]["status"] = "broken"

    report, payload = ie.plan_import(
        repo, doc, policy="replace", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is False
    assert payload is None
    assert any(".status" in e["path"] for e in report["errors"])

    # An explicit null is rejected too — only absence reads as the default.
    doc["items"][0]["status"] = None
    report, payload = ie.plan_import(
        repo, doc, policy="replace", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is False


def test_import_merge_overlays_incoming_status() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Hammer"})
    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)
    doc["items"][0]["status"] = "needs_repair"

    report, payload = ie.plan_import(
        repo, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is True
    assert report["counts"]["items"]["update"] == 1
    assert payload is not None
    assert payload["items"][str(item.id)]["status"] == "needs_repair"


# -----------------------------
# Services
# -----------------------------


def test_service_schemas_accept_status_passthrough() -> None:
    created = SCHEMA_ITEM_CREATE({"name": "Hammer", "status": "missing"})
    assert created["status"] == "missing"
    updated = SCHEMA_ITEM_UPDATE({"item_id": "x", "status": "ok"})
    assert updated["status"] == "ok"


# -----------------------------
# The live status set
# -----------------------------


def test_validate_accepts_a_slug_in_the_live_set_and_rejects_one_outside_it() -> None:
    live = {"ok", "lent_out"}

    assert validate_item_status("lent_out", known_statuses=live) == "lent_out"
    with pytest.raises(ValidationError, match="status must be one of"):
        validate_item_status("missing", known_statuses=live)


def test_the_tolerant_read_keeps_a_custom_slug_and_still_maps_garbage_to_ok() -> None:
    live = {"ok", "lent_out"}

    tolerant = {"known_statuses": live, "default": DEFAULT_ITEM_STATUS}

    assert validate_item_status("lent_out", **tolerant) == "lent_out"
    assert validate_item_status("who_knows", **tolerant) == DEFAULT_ITEM_STATUS
    assert validate_item_status(None, **tolerant) == DEFAULT_ITEM_STATUS


def test_the_default_set_is_still_the_built_ins() -> None:
    """Every caller with no repository to ask keeps meaning what it meant."""

    assert validate_item_status("needs_repair") == "needs_repair"


def test_filtering_by_a_custom_slug_takes_the_index_path() -> None:
    """The fast path guards on the live set, not on the module constant."""

    repo = Repository.from_state(
        {
            "items": {},
            "locations": {},
            "statuses": {
                "ok": {"slug": "ok", "label": "OK", "order": 0},
                "lent_out": {"slug": "lent_out", "label": "Lent out", "order": 1},
            },
        }
    )
    lent = repo.create_item({"name": "Ladder", "status": "lent_out"})
    repo.create_item({"name": "Hammer"})

    # A non-default slug is bucketed, so the index answers before any scan.
    assert repo._status_to_item_ids["lent_out"] == {str(lent.id)}
    page = repo.list_items(flt={"status": "lent_out"})

    assert [i.name for i in page["items"]] == ["Ladder"]


def test_filtering_by_an_undefined_slug_is_a_validation_error() -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer"})

    with pytest.raises(ValidationError, match="status must be one of"):
        repo.list_items(flt={"status": "lent_out"})
