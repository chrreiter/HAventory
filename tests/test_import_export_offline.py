"""Offline tests for HAventory JSON import/export (data safety).

Covers the ``import_export`` module and the three WebSocket commands
(``haventory/export``, ``haventory/import/preview``, ``haventory/import/execute``):

- full and filtered export to a versioned document,
- round-trip (export → import into an empty instance reproduces the data),
- preview classification (add / update / conflict / unchanged) per policy,
- merge / replace / skip conflict resolution,
- structured errors for invalid documents (envelope, entity, and referential),
- an invalid-field case for export (matching the suite's convention),
- execute rollback so a failed persist never leaves partial state.
"""

from __future__ import annotations

import pytest
from custom_components.haventory import import_export as ie
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import StorageError, ValidationError
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

# The `_seed` helper always creates exactly this many items and locations.
SEEDED_ITEMS = 2
SEEDED_LOCATIONS = 2


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        if not callable(h) or getattr(h, "_ws_command", None) != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        return await h(hass, None, req)
    raise AssertionError("No handler responded for type " + type_)


def _new_hass() -> HomeAssistant:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


def _seed(repo: Repository) -> dict[str, str]:
    """Populate a repo with a small tree and a couple of items."""

    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf A", parent_id=str(garage.id))
    hammer = repo.create_item(
        {
            "name": "Hammer",
            "quantity": 2,
            "location_id": str(shelf.id),
            "tags": ["tools", "red"],
            "category": "Hardware",
            "custom_fields": {"serial": "H-1"},
        }
    )
    nails = repo.create_item({"name": "Nails", "quantity": 100})
    return {
        "garage": str(garage.id),
        "shelf": str(shelf.id),
        "hammer": str(hammer.id),
        "nails": str(nails.id),
    }


# -----------------------------
# Export (module + WS)
# -----------------------------


def test_build_export_document_full() -> None:
    repo = Repository()
    ids = _seed(repo)

    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)

    assert doc["haventory_export_version"] == ie.EXPORT_VERSION
    assert doc["schema_version"] == CURRENT_SCHEMA_VERSION
    assert doc["integration_version"]
    assert doc["exported_at"].endswith("Z")
    assert {i["id"] for i in doc["items"]} == {ids["hammer"], ids["nails"]}
    assert {loc["id"] for loc in doc["locations"]} == {ids["garage"], ids["shelf"]}
    hammer_doc = next(i for i in doc["items"] if i["id"] == ids["hammer"])
    assert hammer_doc["location_path"]["display_path"] == "Garage / Shelf A"


def test_build_export_document_filtered_includes_ancestor_locations() -> None:
    repo = Repository()
    ids = _seed(repo)

    # Filter to just the Hammer (search by name); Nails must be excluded.
    doc = ie.build_export_document(
        repo, item_filter={"q": "Hammer"}, schema_version=CURRENT_SCHEMA_VERSION
    )

    assert {i["id"] for i in doc["items"]} == {ids["hammer"]}
    # Both ancestor locations of the Hammer are kept so the doc stays consistent.
    assert {loc["id"] for loc in doc["locations"]} == {ids["garage"], ids["shelf"]}


@pytest.mark.asyncio
async def test_ws_export_returns_document() -> None:
    hass = _new_hass()
    _seed(hass.data[DOMAIN]["repository"])

    res = await _send(hass, 1, "haventory/export")
    assert res["success"] is True, res
    doc = res["result"]
    assert doc["haventory_export_version"] == ie.EXPORT_VERSION
    assert len(doc["items"]) == SEEDED_ITEMS


@pytest.mark.asyncio
async def test_ws_export_invalid_filter_field() -> None:
    """Invalid-field case: a non-object filter never reaches the handler.

    ``haventory/export`` declares ``filter`` as a dict, so Home Assistant
    refuses the frame with the transport-level ``invalid_format`` before
    dispatch — not with the handler's own ``validation_error``.
    """

    hass = _new_hass()
    res = await _send(hass, 1, "haventory/export", filter="not-an-object")
    assert res["success"] is False, res
    assert res["error"]["code"] == "invalid_format"


# -----------------------------
# Round-trip guarantee (unit)
# -----------------------------


def test_round_trip_into_empty_reproduces_data() -> None:
    source = Repository()
    _seed(source)
    doc = ie.build_export_document(source, schema_version=CURRENT_SCHEMA_VERSION)

    target = Repository()
    report, payload = ie.plan_import(
        target, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is True
    assert payload is not None
    target.load_state(payload)

    reexport = ie.build_export_document(target, schema_version=CURRENT_SCHEMA_VERSION)
    assert reexport["items"] == doc["items"]
    assert reexport["locations"] == doc["locations"]


@pytest.mark.asyncio
async def test_round_trip_via_ws_execute() -> None:
    """End-to-end round-trip through the export + execute WS commands."""

    src = _new_hass()
    _seed(src.data[DOMAIN]["repository"])
    exported = (await _send(src, 1, "haventory/export"))["result"]

    dst = _new_hass()
    preview = await _send(dst, 2, "haventory/import/preview", document=exported)
    assert preview["success"] is True
    assert preview["result"]["valid"] is True
    assert preview["result"]["counts"]["items"]["add"] == SEEDED_ITEMS

    applied = await _send(dst, 3, "haventory/import/execute", document=exported)
    assert applied["success"] is True, applied
    assert applied["result"]["applied"] is True
    assert applied["result"]["totals"]["items_total"] == SEEDED_ITEMS

    re_export = (await _send(dst, 4, "haventory/export"))["result"]
    assert re_export["items"] == exported["items"]
    assert re_export["locations"] == exported["locations"]


# -----------------------------
# Preview classification & policies
# -----------------------------


def _doc_from(repo: Repository) -> dict:
    return ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)


def test_preview_reimport_all_unchanged() -> None:
    repo = Repository()
    _seed(repo)
    doc = _doc_from(repo)
    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is True
    assert report["counts"]["items"]["unchanged"] == SEEDED_ITEMS
    assert report["counts"]["items"]["add"] == 0
    assert report["counts"]["locations"]["unchanged"] == SEEDED_LOCATIONS


def test_preview_skip_marks_conflict_replace_marks_update() -> None:
    repo = Repository()
    ids = _seed(repo)
    doc = _doc_from(repo)
    # Mutate the exported Hammer so its content differs from the stored one.
    for it in doc["items"]:
        if it["id"] == ids["hammer"]:
            it["name"] = "Hammer XL"

    skip_rep, skip_target = ie.plan_import(
        repo, doc, policy="skip", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert ids["hammer"] in skip_rep["items"]["conflict"]
    assert skip_rep["items"]["update"] == []
    # skip keeps the existing name in the target payload
    assert skip_target["items"][ids["hammer"]]["name"] == "Hammer"

    repl_rep, repl_target = ie.plan_import(
        repo, doc, policy="replace", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert ids["hammer"] in repl_rep["items"]["update"]
    assert repl_rep["items"]["conflict"] == []
    assert repl_target["items"][ids["hammer"]]["name"] == "Hammer XL"


def test_merge_unions_tags_and_merges_custom_fields() -> None:
    repo = Repository()
    ids = _seed(repo)
    doc = _doc_from(repo)
    for it in doc["items"]:
        if it["id"] == ids["hammer"]:
            it["tags"] = ["blue"]  # differs from stored ["tools","red"]
            it["custom_fields"] = {"weight": "1kg"}  # stored has {"serial":"H-1"}

    report, target = ie.plan_import(
        repo, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert ids["hammer"] in report["items"]["update"]
    merged = target["items"][ids["hammer"]]
    assert set(merged["tags"]) == {"tools", "red", "blue"}
    assert merged["custom_fields"] == {"serial": "H-1", "weight": "1kg"}


def test_replace_into_empty_and_add_new_item() -> None:
    repo = Repository()
    _seed(repo)
    doc = _doc_from(repo)
    # Add a brand-new item id to the document.
    new_id = "11111111-1111-4111-8111-111111111111"
    doc["items"].append(
        {
            "id": new_id,
            "name": "Wrench",
            "quantity": 1,
            "location_id": None,
            "tags": [],
            "custom_fields": {},
        }
    )
    report, target = ie.plan_import(
        repo, doc, policy="replace", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert new_id in report["items"]["add"]
    assert new_id in target["items"]


# -----------------------------
# Invalid documents
# -----------------------------


@pytest.mark.parametrize(
    "doc",
    [
        "not a dict",
        {"items": [], "locations": []},  # missing versions
        {"haventory_export_version": 1, "schema_version": 4, "items": {}, "locations": 5},
        {"haventory_export_version": 99, "schema_version": 4, "items": [], "locations": []},
    ],
)
def test_preview_invalid_envelope_reports_errors(doc) -> None:
    repo = Repository()
    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is False
    assert target is None
    assert report["errors"]


def test_preview_invalid_entity_reports_paths() -> None:
    repo = Repository()
    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [{"id": "not-a-uuid", "name": ""}],
        "locations": [],
    }
    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is False
    assert target is None
    paths = {e["path"] for e in report["errors"]}
    assert "items[0].id" in paths
    assert "items[0].name" in paths


def test_preview_broken_reference_reports_error() -> None:
    repo = Repository()
    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "name": "Ghost",
                "quantity": 1,
                "location_id": "33333333-3333-4333-8333-333333333333",
                "tags": [],
                "custom_fields": {},
            }
        ],
        "locations": [],
    }
    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is False
    assert target is None
    assert any("location_id" in e["path"] for e in report["errors"])


def test_preview_schema_version_newer_than_supported() -> None:
    repo = Repository()
    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION + 5,
        "items": [],
        "locations": [],
    }
    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is False
    assert any(e["path"] == "schema_version" for e in report["errors"])


def test_plan_import_rejects_unknown_policy() -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        ie.plan_import(repo, _doc_from(repo), policy="bogus")  # type: ignore[arg-type]


# -----------------------------
# WS import/execute — errors & rollback
# -----------------------------


@pytest.mark.asyncio
async def test_ws_import_execute_invalid_document_is_validation_error() -> None:
    hass = _new_hass()
    bad = {"haventory_export_version": 1, "schema_version": CURRENT_SCHEMA_VERSION, "items": 3}
    res = await _send(hass, 1, "haventory/import/execute", document=bad)
    assert res["success"] is False, res
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["data"]["errors"]


@pytest.mark.asyncio
async def test_ws_import_execute_rolls_back_on_persist_failure() -> None:
    hass = _new_hass()
    repo: Repository = hass.data[DOMAIN]["repository"]
    _seed(repo)
    before_counts = repo.get_counts()

    # A document that would add a fresh item, then make persistence fail.
    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)
    doc["items"].append(
        {
            "id": "44444444-4444-4444-8444-444444444444",
            "name": "Screwdriver",
            "quantity": 1,
            "location_id": None,
            "tags": [],
            "custom_fields": {},
        }
    )

    class _FailingStore:
        schema_version = CURRENT_SCHEMA_VERSION

        async def async_save(self, _payload):
            raise StorageError("disk full")

    hass.data[DOMAIN]["store"] = _FailingStore()

    res = await _send(hass, 1, "haventory/import/execute", document=doc)
    assert res["success"] is False, res
    assert res["error"]["code"] == "storage_error"
    # State rolled back: the new item must NOT be present and counts unchanged.
    assert repo.get_counts() == before_counts
    assert "44444444-4444-4444-8444-444444444444" not in repo._items_by_id
