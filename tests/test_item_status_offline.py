"""Offline tests for the per-item status field (ok / missing / needs_repair).

Scenarios cover creation defaults and validation, updates, filtering (scan and
index paths), repository counts and round-trip, the v4 -> v5 migration that
backfills the field, tolerant loading of payloads written before it existed,
WS command surfaces, import/export, and the service schemas.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import import_export as ie
from custom_components.haventory import migrations
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    DEFAULT_ITEM_STATUS,
    ITEM_STATUSES,
    ItemCreate,
    ItemUpdate,
    apply_item_update,
    coerce_item_status,
    create_item_from_create,
    filter_items,
    validate_item_status,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.services import SCHEMA_ITEM_CREATE, SCHEMA_ITEM_UPDATE
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store as HAStore

from runtime_helpers import install_runtime
from ws_helpers import ws_send

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


def test_validate_and_coerce_helpers() -> None:
    assert validate_item_status("missing") == "missing"
    with pytest.raises(ValidationError):
        validate_item_status("bogus")
    assert coerce_item_status("needs_repair") == "needs_repair"
    assert coerce_item_status(None) == "ok"
    assert coerce_item_status("bogus") == "ok"
    assert coerce_item_status(7) == "ok"


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
# Repository
# -----------------------------


def test_repository_counts_and_index_follow_status_changes() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Hammer", "status": "missing"})
    repo.create_item({"name": "Drill", "status": "needs_repair"})
    repo.create_item({"name": "Wrench"})

    counts = repo.get_counts()
    assert counts["missing_count"] == 1
    assert counts["needs_repair_count"] == 1

    # The default status is deliberately not bucketed.
    idx = repo._debug_get_internal_indexes()
    assert "ok" not in idx["status_to_item_ids"]
    assert idx["status_to_item_ids"]["missing"] == {str(item.id)}

    repo.update_item(item.id, ItemUpdate(status="ok"))
    counts = repo.get_counts()
    assert counts["missing_count"] == 0
    assert "missing" not in repo._debug_get_internal_indexes()["status_to_item_ids"]


def test_repository_delete_clears_status_index() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Hammer", "status": "missing"})
    repo.delete_item(item.id)
    assert repo.get_counts()["missing_count"] == 0
    assert "missing" not in repo._debug_get_internal_indexes()["status_to_item_ids"]


def test_repository_list_items_filters_by_status_via_index() -> None:
    repo = Repository()
    repo.create_item({"name": "Wrench"})
    missing = repo.create_item({"name": "Hammer", "status": "missing", "category": "tools"})
    repo.create_item({"name": "Drill", "status": "needs_repair", "category": "tools"})

    page = repo.list_items(flt={"status": "missing"})
    assert [str(i.id) for i in page["items"]] == [str(missing.id)]
    assert page["total"] == 1

    # Intersects with other indexed filters.
    page = repo.list_items(flt={"status": "missing", "category": "tools"})
    assert [str(i.id) for i in page["items"]] == [str(missing.id)]
    page = repo.list_items(flt={"status": "missing", "category": "kitchen"})
    assert page["items"] == [] and page["total"] == 0

    # "ok" takes the scan path (not bucketed) and still filters correctly.
    page = repo.list_items(flt={"status": "ok"})
    assert [i.name for i in page["items"]] == ["Wrench"]


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
# Migration (v4 -> v5)
# -----------------------------


def _v4_payload() -> dict:
    return {
        "schema_version": 4,
        "items": {
            "a": {"id": "a", "name": "Hammer"},
            "b": {"id": "b", "name": "Drill", "status": "needs_repair"},
            "c": {"id": "c", "name": "Wrench", "status": "shattered"},
        },
        "locations": {},
    }


def test_migrate_4_to_5_backfills_and_coerces_status() -> None:
    migrated = migrations.migrate_4_to_5(_v4_payload())
    items = migrated["items"]
    assert items["a"]["status"] == "ok"
    assert items["b"]["status"] == "needs_repair"
    assert items["c"]["status"] == "ok"


def test_migrate_4_to_5_is_idempotent() -> None:
    once = migrations.migrate_4_to_5(_v4_payload())
    twice = migrations.migrate_4_to_5(once)
    assert twice == once


def test_migrate_chain_from_v0_stamps_status_and_version() -> None:
    payload = {"schema_version": 0, "items": {"a": {"id": "a", "name": "Hammer"}}}
    migrated = migrations.migrate(payload, from_version=0, to_version=CURRENT_SCHEMA_VERSION)
    assert migrated["schema_version"] == CURRENT_SCHEMA_VERSION
    assert migrated["items"]["a"]["status"] == "ok"
    assert migrated["locations"] == {}


@pytest.mark.asyncio
async def test_domain_store_migrates_v4_store_on_load() -> None:
    """A store written at v4 loads at v5 with every item's status backfilled."""

    hass = HomeAssistant()
    key = "test_status_migration_v4_store"
    store = DomainStore(hass, key=key)
    raw_store = HAStore(hass, 1, key)
    await raw_store.async_save(_v4_payload())

    loaded = await store.async_load()
    assert loaded["schema_version"] == CURRENT_SCHEMA_VERSION
    assert loaded["items"]["a"]["status"] == "ok"
    assert loaded["items"]["b"]["status"] == "needs_repair"

    # The migrated payload was persisted back, not just returned.
    on_disk = await raw_store.async_load()
    assert on_disk["schema_version"] == CURRENT_SCHEMA_VERSION
    assert on_disk["items"]["a"]["status"] == "ok"


# -----------------------------
# WebSocket commands
# -----------------------------


def _new_hass() -> HomeAssistant:
    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)
    return hass


@pytest.mark.asyncio
async def test_ws_item_create_and_update_status() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer", status="missing")
    assert res["success"] is True
    assert res["result"]["status"] == "missing"
    item_id = res["result"]["id"]

    res = await ws_send(hass, 2, "haventory/item/update", item_id=item_id, status="needs_repair")
    assert res["success"] is True
    assert res["result"]["status"] == "needs_repair"

    res = await ws_send(hass, 3, "haventory/item/get", item_id=item_id)
    assert res["result"]["status"] == "needs_repair"


@pytest.mark.asyncio
async def test_ws_item_create_defaults_status_and_rejects_bad_values() -> None:
    hass = _new_hass()

    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer")
    assert res["success"] is True
    assert res["result"]["status"] == "ok"
    item_id = res["result"]["id"]

    res = await ws_send(hass, 2, "haventory/item/create", name="Drill", status="lost")
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    res = await ws_send(hass, 3, "haventory/item/update", item_id=item_id, status=None)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_ws_item_list_filters_by_status() -> None:
    hass = _new_hass()
    await ws_send(hass, 1, "haventory/item/create", name="Hammer", status="missing")
    await ws_send(hass, 2, "haventory/item/create", name="Wrench")

    res = await ws_send(hass, 3, "haventory/item/list", filter={"status": "missing"})
    assert res["success"] is True
    assert [i["name"] for i in res["result"]["items"]] == ["Hammer"]
    assert res["result"]["total"] == 1

    res = await ws_send(hass, 4, "haventory/item/list", filter={"status": "bogus"})
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_ws_stats_and_health_reflect_status() -> None:
    hass = _new_hass()
    await ws_send(hass, 1, "haventory/item/create", name="Hammer", status="missing")
    await ws_send(hass, 2, "haventory/item/create", name="Drill", status="needs_repair")

    res = await ws_send(hass, 3, "haventory/stats")
    assert res["result"]["missing_count"] == 1
    assert res["result"]["needs_repair_count"] == 1

    res = await ws_send(hass, 4, "haventory/health")
    assert res["result"]["healthy"] is True
    assert res["result"]["issues"] == []


@pytest.mark.asyncio
async def test_ws_bulk_item_update_sets_status() -> None:
    hass = _new_hass()
    res = await ws_send(hass, 1, "haventory/item/create", name="Hammer")
    item_id = res["result"]["id"]

    res = await ws_send(
        hass,
        2,
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "a",
                "kind": "item_update",
                "payload": {"item_id": item_id, "status": "missing"},
            }
        ],
    )
    assert res["success"] is True
    outcome = res["result"]["results"]["a"]
    assert outcome["success"] is True
    assert outcome["result"]["status"] == "missing"


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
# The live status set (schema v6)
# -----------------------------


def test_validate_accepts_a_slug_in_the_live_set_and_rejects_one_outside_it() -> None:
    live = {"ok", "lent_out"}

    assert validate_item_status("lent_out", known_statuses=live) == "lent_out"
    with pytest.raises(ValidationError, match="status must be one of"):
        validate_item_status("missing", known_statuses=live)


def test_coerce_keeps_a_custom_slug_and_still_maps_garbage_to_ok() -> None:
    live = {"ok", "lent_out"}

    assert coerce_item_status("lent_out", known_statuses=live) == "lent_out"
    assert coerce_item_status("who_knows", known_statuses=live) == DEFAULT_ITEM_STATUS
    assert coerce_item_status(None, known_statuses=live) == DEFAULT_ITEM_STATUS


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
