"""Offline tests for HAventory JSON import/export (data safety).

Covers the ``import_export`` module and the three WebSocket commands
(``haventory/export``, ``haventory/import/preview``, ``haventory/import/execute``):

- full and filtered export to a versioned document,
- round-trip (export → import into an empty instance reproduces the data),
- preview classification (add / update / conflict / unchanged) per policy,
- merge / replace / skip conflict resolution,
- structured errors for invalid documents (envelope, entity, and referential),
- an invalid-field case for export (matching the suite's convention),
- execute rollback so a failed persist never leaves partial state,
- the two sections whose absence has to keep meaning something permanently:
  ``statuses`` (absent = the built-ins) and per-item ``attachments``
  (metadata only, so a reference can outlive the file it names).
"""

from __future__ import annotations

from datetime import date

import pytest
from custom_components.haventory import import_export as ie
from custom_components.haventory import media
from custom_components.haventory.exceptions import StorageError, ValidationError
from custom_components.haventory.migrations import PRE_COLLAPSE_SCHEMA_VERSIONS
from custom_components.haventory.models import (
    CATEGORY_MAX_LENGTH,
    CUSTOM_FIELD_KEY_MAX_LENGTH,
    CUSTOM_FIELD_VALUE_MAX_LENGTH,
    CUSTOM_FIELDS_MAX_KEYS,
    DESCRIPTION_MAX_LENGTH,
    NAME_MAX_LENGTH,
    TAG_MAX_LENGTH,
    TAGS_MAX_COUNT,
    ReminderInterval,
    validate_attachment_meta,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
from homeassistant.core import HomeAssistant

from runtime_helpers import repo_of, runtime_of, ws_hass
from ws_helpers import ws_send

# The `_seed` helper always creates exactly this many items and locations.
SEEDED_ITEMS = 2
SEEDED_LOCATIONS = 2

#: One above everything the import side takes in: a document from a build that
#: knows a shape this one does not.
FROM_A_NEWER_BUILD = max(PRE_COLLAPSE_SCHEMA_VERSIONS) + 1


def _new_hass() -> HomeAssistant:
    hass = ws_hass()
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
    _seed(repo_of(hass))

    res = await ws_send(hass, 1, "haventory/export")
    assert res["success"] is True, res
    doc = res["result"]
    assert doc["haventory_export_version"] == ie.EXPORT_VERSION
    assert len(doc["items"]) == SEEDED_ITEMS


@pytest.mark.asyncio
async def test_ws_export_invalid_filter_field() -> None:
    """Invalid-field case: a non-object filter is the handler's to refuse.

    ``haventory/export`` declares ``filter`` as ``object`` so the frame reaches
    the handler and answers ``validation_error``, rather than being refused by
    Home Assistant with a transport-level ``invalid_format`` that never passes
    through the guard.
    """

    hass = _new_hass()
    res = await ws_send(hass, 1, "haventory/export", filter="not-an-object")
    assert res["success"] is False, res
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_ws_export_unknown_filter_key_is_named() -> None:
    """A typo'd filter key is refused rather than dropped, and named."""

    hass = _new_hass()
    res = await ws_send(hass, 1, "haventory/export", filter={"search": "hammer"})
    assert res["success"] is False, res
    assert res["error"]["code"] == "validation_error"
    assert "search" in res["error"]["message"]


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
    _seed(repo_of(src))
    exported = (await ws_send(src, 1, "haventory/export"))["result"]

    dst = _new_hass()
    preview = await ws_send(dst, 2, "haventory/import/preview", document=exported)
    assert preview["success"] is True
    assert preview["result"]["valid"] is True
    assert preview["result"]["counts"]["items"]["add"] == SEEDED_ITEMS

    applied = await ws_send(dst, 3, "haventory/import/execute", document=exported)
    assert applied["success"] is True, applied
    assert applied["result"]["applied"] is True
    assert applied["result"]["totals"]["items_total"] == SEEDED_ITEMS

    re_export = (await ws_send(dst, 4, "haventory/export"))["result"]
    assert re_export["items"] == exported["items"]
    assert re_export["locations"] == exported["locations"]


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


@pytest.mark.parametrize("section", ["items", "locations", "statuses"])
def test_a_section_keyed_by_id_is_not_a_document(section: str) -> None:
    """The stored payload's shape is not a document's, and never was one.

    ``build_export_document`` writes every document a user holds, and it writes
    arrays. A map read as a section would take the payload of an in-process
    snapshot as a backup, entity ids silently dropped.
    """

    repo = Repository()
    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [],
        "locations": [],
        section: {"22222222-2222-4222-8222-222222222222": {"name": "Ghost"}},
    }

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert target is None
    assert _only_error(report) == (section, f"{section} must be an array of objects")


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
        "schema_version": FROM_A_NEWER_BUILD,
        "items": [],
        "locations": [],
    }
    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is False
    message = next(e["message"] for e in report["errors"] if e["path"] == "schema_version")
    assert "upgrade HAventory" in message


@pytest.mark.parametrize("stamped", sorted(PRE_COLLAPSE_SCHEMA_VERSIONS))
def test_a_document_stamped_before_the_collapse_is_sent_back_to_0_8(stamped: int) -> None:
    """The refusal names re-exporting on 0.8.x, not upgrading.

    Every export taken before the collapse carries such a stamp, and the number
    is above this build's — so it lands in the same check as a document from a
    newer build, where "upgrade HAventory" is advice nothing can act on.
    """

    source = Repository()
    _seed(source)
    doc = {**_doc_from(source), "schema_version": stamped}

    target = Repository()
    report, payload = ie.plan_import(
        target, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["valid"] is False
    assert payload is None
    message = next(e["message"] for e in report["errors"] if e["path"] == "schema_version")
    assert str(stamped) in message
    assert "0.8" in message
    assert "upgrade HAventory" not in message


def test_plan_import_rejects_unknown_policy() -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        ie.plan_import(repo, _doc_from(repo), policy="bogus")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_ws_import_execute_invalid_document_is_validation_error() -> None:
    hass = _new_hass()
    bad = {"haventory_export_version": 1, "schema_version": CURRENT_SCHEMA_VERSION, "items": 3}
    res = await ws_send(hass, 1, "haventory/import/execute", document=bad)
    assert res["success"] is False, res
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["data"]["errors"]


@pytest.mark.asyncio
async def test_ws_import_execute_rolls_back_on_persist_failure() -> None:
    hass = _new_hass()
    repo: Repository = repo_of(hass)
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

    runtime_of(hass).store = _FailingStore()

    res = await ws_send(hass, 1, "haventory/import/execute", document=doc)
    assert res["success"] is False, res
    assert res["error"]["code"] == "storage_error"
    # State rolled back: the new item must NOT be present and counts unchanged.
    assert repo.get_counts() == before_counts
    assert "44444444-4444-4444-8444-444444444444" not in repo._items_by_id


def _repo_with_custom_status() -> Repository:
    repo = Repository()
    state = repo.export_state()
    state["statuses"]["lent_out"] = {
        "slug": "lent_out",
        "label": "Lent out",
        "order": 9,
        "color": "blue",
        "icon": "hand",
    }
    repo.load_state(state)
    return repo


def test_export_carries_the_status_definitions() -> None:
    """Items store only a slug, so the labels have to ride in the same document."""

    doc = ie.build_export_document(
        _repo_with_custom_status(), schema_version=CURRENT_SCHEMA_VERSION
    )

    assert {
        "slug": "lent_out",
        "label": "Lent out",
        "order": 9,
        "color": "blue",
        "icon": "hand",
    } in doc["statuses"]


def test_a_document_with_no_statuses_section_reads_as_the_built_ins() -> None:
    """The permanent fallback that keeps every pre-v6 export importable."""

    repo = Repository()
    doc = _doc_from(repo)
    doc.pop("statuses")
    doc["items"] = [{**doc_item, "status": "missing"} for doc_item in doc["items"]]

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is True
    assert set(target["statuses"]) == {"ok", "missing", "needs_repair"}


def test_a_document_defining_a_custom_slug_its_items_use_imports_cleanly() -> None:
    source = _repo_with_custom_status()
    ladder = source.create_item({"name": "Ladder", "status": "lent_out"})
    doc = _doc_from(source)

    target_repo = Repository()
    report, target = ie.plan_import(target_repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is True, report["errors"]
    assert target["statuses"]["lent_out"]["label"] == "Lent out"
    assert target["items"][str(ladder.id)]["status"] == "lent_out"


def test_a_document_whose_item_references_an_undefined_slug_is_rejected() -> None:
    """A slug nothing defines would import as a state no surface can name."""

    repo = Repository()
    repo.create_item({"name": "Ladder"})
    doc = _doc_from(repo)
    doc["items"][0]["status"] = "lent_out"

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is False
    assert target is None
    assert any(
        e["path"] == "items[0].status" and "status must be one of" in e["message"]
        for e in report["errors"]
    )


def test_a_malformed_status_definition_is_reported_with_its_path() -> None:
    repo = Repository()
    doc = _doc_from(repo)
    doc["statuses"] = [{"slug": "Not A Slug", "label": "Nope"}]

    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is False
    assert any(e["path"] == "statuses[0]" for e in report["errors"])


def _attachment_doc(**overrides) -> dict:
    doc = {
        "id": "3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f",
        "kind": "picture",
        "filename": "photo.png",
        "mime": "image/png",
        "size": 1234,
        "uploaded_at": "2026-08-05T10:00:00Z",
    }
    doc.update(overrides)
    return doc


def test_a_round_trip_preserves_attachment_metadata() -> None:
    source = Repository()
    item = source.create_item({"name": "Drill"})
    source.add_attachment(item.id, validate_attachment_meta(_attachment_doc()))
    doc = _doc_from(source)

    target = Repository()
    report, payload = ie.plan_import(
        target, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is True, report["errors"]
    target.load_state(payload)

    assert [a.filename for a in target.get_item(item.id).attachments] == ["photo.png"]


def test_a_document_with_a_malformed_attachment_entry_is_rejected_in_preview() -> None:
    repo = Repository()
    repo.create_item({"name": "Drill"})
    doc = _doc_from(repo)
    doc["items"][0]["attachments"] = [_attachment_doc(mime="")]

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is False
    assert target is None
    assert any(e["path"] == "items[0].attachments[0]" for e in report["errors"])


def test_merge_unions_attachments_by_id() -> None:
    """An entry the other side does not mention still names a file on disk."""

    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    kept = validate_attachment_meta(_attachment_doc())
    repo.add_attachment(item.id, kept)

    doc = _doc_from(repo)
    incoming = _attachment_doc(id="8b2c1a44-5d6e-4f70-8192-a3b4c5d6e7f8", filename="manual.png")
    doc["items"][0]["attachments"] = [incoming]
    doc["items"][0]["name"] = "Drill (renamed)"

    report, payload = ie.plan_import(
        repo, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["valid"] is True, report["errors"]
    merged = payload["items"][str(item.id)]["attachments"]
    assert {a["id"] for a in merged} == {str(kept.id), incoming["id"]}


def test_referenced_attachments_lists_every_pair_the_payload_carries() -> None:
    """The preview's missing-file count is built from this; the module does no I/O."""

    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    repo.add_attachment(item.id, validate_attachment_meta(_attachment_doc()))

    pairs = ie.referenced_attachments(repo.export_state())

    assert pairs == [(str(item.id), _attachment_doc(title="", order=0))]


@pytest.mark.asyncio
async def test_import_preview_reports_references_with_no_file_on_this_install() -> None:
    """A JSON export carries metadata and not bytes, so this is a caveat, not an error."""

    hass = _new_hass()
    repo = repo_of(hass)
    item = repo.create_item({"name": "Drill"})
    repo.add_attachment(item.id, validate_attachment_meta(_attachment_doc()))
    doc = _doc_from(repo)

    res = await ws_send(hass, 1, "haventory/import/preview", document=doc, policy="merge")

    assert res["success"] is True
    assert res["result"]["attachments"] == {"referenced": 1, "missing": 1}


@pytest.mark.asyncio
async def test_import_replace_deletes_a_file_whose_metadata_it_overwrote() -> None:
    """`replace` overwrites an item's attachment list, references and all.

    Metadata is the only record of where a file is, so an entry the incoming
    document does not carry has to take its bytes with it — otherwise nothing
    would ever collect them. (An import never *drops* an item: a document that
    omits one leaves it exactly as it stands.)
    """

    hass = _new_hass()
    repo = repo_of(hass)
    item = repo.create_item({"name": "Drill"})
    meta = validate_attachment_meta(_attachment_doc())
    repo.add_attachment(item.id, meta)
    path = media.attachment_path(media.media_root(hass), str(item.id), str(meta.id), meta.mime)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n")

    # The same item, renamed and carrying no attachments at all.
    document = _doc_from(repo)
    document["items"][0]["attachments"] = []
    document["items"][0]["name"] = "Drill (restored)"
    res = await ws_send(hass, 1, "haventory/import/execute", document=document, policy="replace")

    assert res["success"] is True, res
    assert repo.get_item(item.id).attachments == []
    assert not path.exists()


@pytest.mark.asyncio
async def test_import_merge_keeps_a_file_the_document_does_not_mention() -> None:
    """The other side of the same coin: `merge` unions, so nothing is orphaned."""

    hass = _new_hass()
    repo = repo_of(hass)
    item = repo.create_item({"name": "Drill"})
    meta = validate_attachment_meta(_attachment_doc())
    repo.add_attachment(item.id, meta)
    path = media.attachment_path(media.media_root(hass), str(item.id), str(meta.id), meta.mime)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n")

    document = _doc_from(repo)
    document["items"][0]["attachments"] = []
    document["items"][0]["name"] = "Drill (restored)"
    res = await ws_send(hass, 1, "haventory/import/execute", document=document, policy="merge")

    assert res["success"] is True, res
    assert [str(a.id) for a in repo.get_item(item.id).attachments] == [str(meta.id)]
    assert path.is_file()


def _item_doc(**overrides: object) -> dict:
    doc = {
        "id": "22222222-2222-4222-8222-222222222222",
        "name": "Ghost",
        "quantity": 1,
        "tags": [],
        "custom_fields": {},
    }
    doc.update(overrides)
    return doc


def _envelope(item: dict) -> dict:
    return {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [item],
        "locations": [],
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"description": "d" * (DESCRIPTION_MAX_LENGTH + 1)},
        {"category": "c" * (CATEGORY_MAX_LENGTH + 1)},
        {"tags": ["t" * (TAG_MAX_LENGTH + 1)]},
        {"tags": [f"t{i}" for i in range(TAGS_MAX_COUNT + 1)]},
        {"custom_fields": {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 1)}},
        {"custom_fields": {"k" * (CUSTOM_FIELD_KEY_MAX_LENGTH + 1): 1}},
        {"custom_fields": {"k": "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 1)}},
    ],
)
def test_preview_accepts_pre_cap_data_the_load_path_accepts(overrides: dict) -> None:
    """Issue #437: a document is a restore, as tolerant as ``load_state``.

    Every one of these values is legal in a store written before the caps
    existed, loads fine and exports unchanged — so the export has to import
    back, or the backup this build wrote cannot be restored.
    """

    repo = Repository()
    report, target = ie.plan_import(
        repo, _envelope(_item_doc(**overrides)), current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["valid"] is True, report["errors"]
    assert target is not None


def test_a_legacy_over_cap_item_round_trips_through_export_and_import() -> None:
    """The #437 acceptance path: load pre-cap data, export it, import the export."""

    repo = Repository()
    item = repo.create_item({"name": "Ghost"})
    # A store written before the caps existed: mutate the persisted dict the way
    # no current edit can, then load it — which deliberately re-validates nothing.
    state = repo.export_state()
    stored = state["items"][str(item.id)]
    stored["description"] = "d" * (DESCRIPTION_MAX_LENGTH + 500)
    stored["tags"] = [f"tag-{i}" for i in range(TAGS_MAX_COUNT + 5)]
    stored["custom_fields"] = {"note": "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 200)}
    repo.load_state(state)

    document = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)

    # Restore onto a fresh install: nothing pre-exists to grandfather against.
    fresh = Repository()
    report, target = ie.plan_import(fresh, document, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is True, report["errors"]
    assert target is not None

    fresh.load_state(target)
    restored = fresh.get_item(item.id)
    assert restored.description == "d" * (DESCRIPTION_MAX_LENGTH + 500)
    assert len(restored.tags) == TAGS_MAX_COUNT + 5
    assert restored.custom_fields["note"] == "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 200)


def test_preview_reports_a_long_location_name() -> None:
    repo = Repository()
    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [],
        "locations": [
            {
                "id": "33333333-3333-4333-8333-333333333333",
                "name": "l" * (NAME_MAX_LENGTH + 1),
                "parent_id": None,
            }
        ],
    }
    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is False
    assert target is None
    assert "locations[0].name" in {e["path"] for e in report["errors"]}


def test_preview_accepts_a_due_date_on_a_checked_out_item() -> None:
    """The invariant is due_date ⇔ checked_out, not "no due dates"."""

    repo = Repository()
    report, target = ie.plan_import(
        repo,
        _envelope(_item_doc(due_date="2026-01-01", checked_out=True)),
        current_schema_version=CURRENT_SCHEMA_VERSION,
    )

    assert report["valid"] is True, report["errors"]
    assert target is not None


def test_preview_accepts_an_item_at_every_cap() -> None:
    """Every document the contract documents still imports."""

    repo = Repository()
    report, target = ie.plan_import(
        repo,
        _envelope(
            _item_doc(
                name="n" * NAME_MAX_LENGTH,
                description="d" * DESCRIPTION_MAX_LENGTH,
                category="c" * CATEGORY_MAX_LENGTH,
                tags=["t" * TAG_MAX_LENGTH],
                custom_fields={
                    "k" * CUSTOM_FIELD_KEY_MAX_LENGTH: "v" * CUSTOM_FIELD_VALUE_MAX_LENGTH
                },
            )
        ),
        current_schema_version=CURRENT_SCHEMA_VERSION,
    )

    assert report["valid"] is True, report["errors"]
    assert target is not None


def _location_doc(**overrides: object) -> dict:
    doc = {
        "id": "33333333-3333-4333-8333-333333333333",
        "name": "Garage",
        "parent_id": None,
    }
    doc.update(overrides)
    return doc


def _only_error(report: dict) -> tuple[str, str]:
    """The one refusal a document earned, as the sheet prints it."""

    assert len(report["errors"]) == 1, report["errors"]
    entry = report["errors"][0]
    return entry["path"], entry["message"]


#: Every field-level refusal an item document can earn, spelled the way the
#: import sheet prints it. The card renders each entry as "path: message"
#: verbatim, so both halves are the contract — a validator moved behind one of
#: these rows has to keep saying the same sentence about the same field, and a
#: row changing is a user-visible change whether or not the code still refuses.
_ITEM_REFUSALS: tuple[tuple[dict, str, str], ...] = (
    ({"id": None}, "items[0].id", "must be a non-empty UUID v4 string"),
    ({"id": "not-a-uuid"}, "items[0].id", "items[0].id must be a UUID v4 string"),
    ({"name": "   "}, "items[0].name", "name is required and must be a non-empty string"),
    (
        {"name": "n" * (NAME_MAX_LENGTH + 1)},
        "items[0].name",
        "name must be at most 120 characters",
    ),
    ({"description": 5}, "items[0].description", "description must be a string or null"),
    ({"category": []}, "items[0].category", "category must be a string or null"),
    ({"quantity": "two"}, "items[0].quantity", "quantity must be an integer >= 0"),
    ({"quantity": -1}, "items[0].quantity", "quantity must be an integer >= 0"),
    (
        {"low_stock_threshold": "x"},
        "items[0].low_stock_threshold",
        "low_stock_threshold must be an integer >= 0 or null",
    ),
    ({"tags": "kitchen"}, "items[0].tags", "tags must be an array of strings"),
    ({"custom_fields": []}, "items[0].custom_fields", "custom_fields must be an object"),
    (
        {"custom_fields": {"": 1}},
        "items[0].custom_fields",
        "custom_fields keys must be non-empty strings",
    ),
    (
        {"custom_fields": {"k": [1]}},
        "items[0].custom_fields.k",
        "custom_fields values must be scalar",
    ),
    ({"status": "nope"}, "items[0].status", "status must be one of: missing, needs_repair, ok"),
    (
        {"created_at": "2026-01-01"},
        "items[0].created_at",
        "created_at must be an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)",
    ),
    ({"attachments": {}}, "items[0].attachments", "attachments must be an array of objects"),
    (
        {"attachments": [{"id": "x"}]},
        "items[0].attachments[0]",
        "attachment.id must be a UUID v4 string",
    ),
    (
        {"due_date": "2026-01-01"},
        "items[0].due_date",
        "due_date is only valid when checked_out is true",
    ),
    (
        {"due_date": "soon", "checked_out": True},
        "items[0].due_date",
        "due_date must be in 'YYYY-MM-DD' format",
    ),
    (
        {"inspection_date": "soon"},
        "items[0].inspection_date",
        "inspection_date must be in 'YYYY-MM-DD' format",
    ),
    (
        {"inspection_date": "2026-02-30"},
        "items[0].inspection_date",
        "inspection_date must be a valid calendar date (YYYY-MM-DD)",
    ),
    (
        {"reminder_date": "next week"},
        "items[0].reminder_date",
        "reminder_date must be in 'YYYY-MM-DD' format",
    ),
    (
        {"reminder_date": "2026-02-30"},
        "items[0].reminder_date",
        "reminder_date must be a valid calendar date (YYYY-MM-DD)",
    ),
    (
        {"reminder_anchor": "2026-01-01"},
        "items[0].reminder_anchor",
        "reminder_anchor requires a reminder_date to lead to",
    ),
    (
        {"reminder_date": "2026-01-01", "reminder_anchor": "2026-02-01"},
        "items[0].reminder_anchor",
        "reminder_anchor must not be later than reminder_date",
    ),
    (
        {"reminder_date": "2026-09-01", "reminder_anchor": "2026-02-30"},
        "items[0].reminder_anchor",
        "reminder_anchor must be a valid calendar date (YYYY-MM-DD)",
    ),
    # A misspelled unit is the one the tolerant loader would drop in silence.
    (
        {"reminder_date": "2026-09-01", "reminder_interval": {"unit": "month", "count": 3}},
        "items[0].reminder_interval",
        "reminder_interval.unit must be one of days, weeks, months",
    ),
    (
        {"reminder_date": "2026-09-01", "reminder_interval": {"unit": "months", "count": 0}},
        "items[0].reminder_interval",
        "reminder_interval.count must be an integer >= 1",
    ),
    # An interval with nothing to count from produces no occurrence, ever.
    (
        {"reminder_interval": {"unit": "months", "count": 3}},
        "items[0].reminder_interval",
        "reminder_interval requires a reminder_date to count from",
    ),
    (
        {"location_id": "nope"},
        "items[0].location_id",
        "items[0].location_id must be a UUID v4 string",
    ),
)

#: The same contract for a location document.
_LOCATION_REFUSALS: tuple[tuple[dict, str, str], ...] = (
    ({"id": "x"}, "locations[0].id", "locations[0].id must be a UUID v4 string"),
    ({"name": ""}, "locations[0].name", "name is required and must be a non-empty string"),
    (
        {"name": "l" * (NAME_MAX_LENGTH + 1)},
        "locations[0].name",
        "name must be at most 120 characters",
    ),
    (
        {"parent_id": "x"},
        "locations[0].parent_id",
        "locations[0].parent_id must be a UUID v4 string",
    ),
    ({"area_id": 3}, "locations[0].area_id", "area_id must be a string or null"),
)


@pytest.mark.parametrize(("overrides", "path", "message"), _ITEM_REFUSALS)
def test_an_item_refusal_names_the_field_and_says_what_it_says(
    overrides: dict, path: str, message: str
) -> None:
    """The whole of what a user gets back about a row is these two strings."""

    repo = Repository()
    report, target = ie.plan_import(
        repo, _envelope(_item_doc(**overrides)), current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert target is None
    assert _only_error(report) == (path, message)


@pytest.mark.parametrize(("overrides", "path", "message"), _LOCATION_REFUSALS)
def test_a_location_refusal_names_the_field_and_says_what_it_says(
    overrides: dict, path: str, message: str
) -> None:
    repo = Repository()
    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [],
        "locations": [_location_doc(**overrides)],
    }

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert target is None
    assert _only_error(report) == (path, message)


@pytest.mark.parametrize(
    ("section", "path", "message"),
    [
        (5, "statuses", "statuses must be an array of objects"),
        (
            [{"slug": "!!"}],
            "statuses[0]",
            "status slug must be 1-64 characters of lowercase letters, digits or underscores",
        ),
    ],
)
def test_a_status_section_refusal_names_the_entry_and_says_what_it_says(
    section: object, path: str, message: str
) -> None:
    repo = Repository()
    doc = {**_envelope(_item_doc()), "statuses": section}

    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert target is None
    assert _only_error(report) == (path, message)


def test_a_clean_round_trip_still_imports() -> None:
    """An export of a real inventory passes every new import-side check."""

    repo = Repository()
    loc = repo.create_location(name="Garage")
    repo.create_item(
        {
            "name": "Hammer",
            "description": "Claw hammer",
            "category": "tools",
            "tags": ["heavy", "metal"],
            "custom_fields": {"weight": "1.2kg"},
            "location_id": str(loc.id),
        }
    )

    report, target = ie.plan_import(
        repo, _doc_from(repo), current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["valid"] is True, report["errors"]
    assert target is not None


def _rebuilt_item_doc(name: str, item_id: str = "44444444-4444-4444-8444-444444444444") -> dict:
    """An item doc whose id is absent here, standing for a hand-rebuilt entity."""

    return _item_doc(id=item_id, name=name)


def test_an_incoming_name_taken_by_another_id_is_warned_about() -> None:
    """The hazard the docs describe: rebuilt ids duplicate rather than merge."""

    repo = Repository()
    stored = repo.create_item({"name": "Hammer"})

    report, target = ie.plan_import(
        repo, _envelope(_rebuilt_item_doc("Hammer")), current_schema_version=CURRENT_SCHEMA_VERSION
    )

    # A warning tells; the id still decides.
    assert report["valid"] is True, report["errors"]
    assert target is not None
    assert len(report["warnings"]) == 1
    warning = report["warnings"][0]
    assert warning["code"] == "name_collision"
    assert warning["path"] == "items[0]"
    assert warning["name"] == "Hammer"
    assert warning["existing_ids"] == [str(stored.id)]
    # Classification is untouched: the entity is still an add.
    assert report["items"]["add"] == ["44444444-4444-4444-8444-444444444444"]


def test_a_location_collision_names_the_stored_path() -> None:
    """Two legitimate "Shelf A"s under different parents are common."""

    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf A", parent_id=str(garage.id))

    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [],
        "locations": [
            {"id": "55555555-5555-4555-8555-555555555555", "name": "Shelf A", "parent_id": None}
        ],
    }
    report, target = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is True, report["errors"]
    assert target is not None
    warning = report["warnings"][0]
    assert warning["code"] == "name_collision"
    assert warning["path"] == "locations[0]"
    assert warning["existing_ids"] == [str(shelf.id)]
    assert "Garage / Shelf A" in warning["message"]


@pytest.mark.parametrize("policy", ["merge", "replace", "skip"])
def test_a_clean_round_trip_warns_about_nothing(policy: str) -> None:
    """The case a false positive would hit first.

    Every entity of a re-imported export classifies `unchanged` or `update`, so
    a check that fired here would fire on every healthy document — which is
    worse than no check at all.
    """

    repo = Repository()
    _seed(repo)
    # Two entities deliberately sharing a name with a third, to prove a
    # legitimate namesake is not what this warns about.
    repo.create_item({"name": "Hammer"})
    repo.create_location(name="Hammer")

    report, target = ie.plan_import(
        repo, _doc_from(repo), policy=policy, current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["valid"] is True, report["errors"]
    assert target is not None
    assert report["warnings"] == []


@pytest.mark.parametrize("policy", ["merge", "replace", "skip"])
def test_a_round_trip_onto_a_changed_inventory_still_warns_about_nothing(policy: str) -> None:
    """`update` and `conflict` are the same entity by id — not a collision."""

    repo = Repository()
    ids = _seed(repo)
    doc = _doc_from(repo)
    # Change one stored item so the document classifies it update/conflict
    # rather than unchanged, depending on the policy.
    repo.update_item(ids["hammer"], {"quantity": 99})

    report, _ = ie.plan_import(
        repo, doc, policy=policy, current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["warnings"] == []


@pytest.mark.parametrize("incoming_name", ["hammer", "HAMMER", "  Hammer  ", "Hämmer"])
def test_names_differing_only_by_case_spacing_or_accent_still_collide(incoming_name: str) -> None:
    """Compared the way the repository compares names, not byte for byte."""

    repo = Repository()
    repo.create_item({"name": "Hammer"})

    report, _ = ie.plan_import(
        repo,
        _envelope(_rebuilt_item_doc(incoming_name)),
        current_schema_version=CURRENT_SCHEMA_VERSION,
    )

    assert [w["code"] for w in report["warnings"]] == ["name_collision"]


def test_no_warning_when_the_colliding_stored_entity_is_the_same_id() -> None:
    """Same id means the same entity — an update, not a duplicate."""

    repo = Repository()
    stored = repo.create_item({"name": "Hammer"})

    report, _ = ie.plan_import(
        repo,
        _envelope(_item_doc(id=str(stored.id), name="Hammer", quantity=7)),
        current_schema_version=CURRENT_SCHEMA_VERSION,
    )

    assert report["items"]["update"] == [str(stored.id)]
    assert report["warnings"] == []


def test_an_invalid_document_returns_warnings_as_an_empty_list() -> None:
    """One shape for the card to render, valid or not — never a missing key."""

    repo = Repository()
    bad = {"haventory_export_version": 1, "schema_version": CURRENT_SCHEMA_VERSION, "items": 3}

    report, target = ie.plan_import(repo, bad, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is False
    assert target is None
    assert report["warnings"] == []


def test_warnings_do_not_reach_import_execute() -> None:
    """The preview tells; the id still decides. Execute is unchanged."""

    repo = Repository()
    repo.create_item({"name": "Hammer"})

    report, target = ie.plan_import(
        repo, _envelope(_rebuilt_item_doc("Hammer")), current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["warnings"]
    assert target is not None

    repo.load_state(target)
    # Both survive: the warning flagged the duplicate, it did not prevent it.
    names = sorted(item.name for item in repo._items_by_id.values())
    assert names == ["Hammer", "Hammer"]


@pytest.mark.asyncio
async def test_ws_import_preview_carries_the_warnings() -> None:
    hass = _new_hass()
    repo_of(hass).create_item({"name": "Hammer"})

    res = await ws_send(
        hass, 1, "haventory/import/preview", document=_envelope(_rebuilt_item_doc("Hammer"))
    )

    assert res["success"] is True, res
    assert res["result"]["valid"] is True
    assert [w["code"] for w in res["result"]["warnings"]] == ["name_collision"]


def test_every_stored_entity_of_a_colliding_name_is_reported() -> None:
    """Repeated leaf names are how location trees are shaped.

    A hand-rebuilt tree collides several deep on "Shelf A" at once, and naming
    one arbitrary stored location would point the path quote at the wrong
    counterpart — the one job that quote exists to do.
    """

    repo = Repository()
    garage = repo.create_location(name="Garage")
    cellar = repo.create_location(name="Cellar")
    garage_shelf = repo.create_location(name="Shelf A", parent_id=str(garage.id))
    cellar_shelf = repo.create_location(name="Shelf A", parent_id=str(cellar.id))

    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [],
        "locations": [
            {
                "id": "55555555-5555-4555-8555-555555555555",
                "name": "Shelf A",
                "parent_id": None,
                "path": {"display_path": "Garage / Shelf A"},
            }
        ],
    }
    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is True, report["errors"]
    warning = report["warnings"][0]
    assert sorted(warning["existing_ids"]) == sorted([str(garage_shelf.id), str(cellar_shelf.id)])
    # Both stored paths are named, so neither line claims a counterpart it does
    # not have.
    assert '"Cellar / Shelf A"' in warning["message"]
    assert '"Garage / Shelf A"' in warning["message"]


def test_two_incoming_entries_of_one_name_do_not_render_identically() -> None:
    """Each line has to say which incoming entry it is about.

    Naming the subject by bare name alone leaves two hand-rebuilt "Shelf A"s as
    two byte-identical bullets in the import sheet.
    """

    repo = Repository()
    repo.create_location(name="Shelf A")

    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [],
        "locations": [
            {
                "id": "55555555-5555-4555-8555-555555555555",
                "name": "Shelf A",
                "parent_id": None,
                "path": {"display_path": "Garage / Shelf A"},
            },
            {
                "id": "66666666-6666-4666-8666-666666666666",
                "name": "Shelf A",
                "parent_id": None,
                "path": {"display_path": "Cellar / Shelf A"},
            },
        ],
    }
    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    incoming_entries = 2
    messages = [w["message"] for w in report["warnings"]]
    assert len(messages) == incoming_entries
    assert len(set(messages)) == incoming_entries
    assert any('"Garage / Shelf A" would be added' in m for m in messages)
    assert any('"Cellar / Shelf A" would be added' in m for m in messages)


def test_an_item_collision_counts_the_stored_namesakes_and_places_the_incoming() -> None:
    """An item has no path of its own, so the count and its location carry it."""

    repo = Repository()
    first = repo.create_item({"name": "Hammer"})
    second = repo.create_item({"name": "hammer"})

    report, _ = ie.plan_import(
        repo,
        _envelope(
            _item_doc(
                id="44444444-4444-4444-8444-444444444444",
                name="Hammer",
                location_path={"display_path": "Garage / Shelf A"},
            )
        ),
        current_schema_version=CURRENT_SCHEMA_VERSION,
    )

    warning = report["warnings"][0]
    assert sorted(warning["existing_ids"]) == sorted([str(first.id), str(second.id)])
    assert '"Hammer" in "Garage / Shelf A" would be added' in warning["message"]
    assert "2 items here already go by that name" in warning["message"]


def test_a_collision_message_stays_one_line_however_many_entries_collide() -> None:
    """A repeated leaf name can collide a dozen deep; the message still fits."""

    colliding = 12
    repo = Repository()
    for i in range(colliding):
        parent = repo.create_location(name=f"Room {i}")
        repo.create_location(name="Drawer 1", parent_id=str(parent.id))

    doc = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [],
        "locations": [
            {
                "id": "55555555-5555-4555-8555-555555555555",
                "name": "Drawer 1",
                "parent_id": None,
                "path": {"display_path": "Room 0 / Drawer 1"},
            }
        ],
    }
    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    warning = report["warnings"][0]
    # Every colliding id is reported; only the first few are named.
    assert len(warning["existing_ids"]) == colliding
    # The subject plus the quoted stored paths, and no more.
    assert warning["message"].count("Drawer 1") == ie.COLLISION_LABELS_SHOWN + 1
    assert f"and {colliding - ie.COLLISION_LABELS_SHOWN} more" in warning["message"]


def test_a_collision_message_does_not_repeat_the_sheet_lead() -> None:
    """The sheet renders one of these per clash under a lead that explains it.

    A line that restates the explanation puts the same claim on screen once per
    entry, which is what turns the block into a wall.
    """

    repo = Repository()
    repo.create_item({"name": "Hammer"})

    report, _ = ie.plan_import(
        repo, _envelope(_rebuilt_item_doc("Hammer")), current_schema_version=CURRENT_SCHEMA_VERSION
    )

    message = report["warnings"][0]["message"]
    assert "Import matches on the id alone" not in message
    assert message.count(".") == 1


def test_a_reminder_survives_an_export_and_import() -> None:
    """An export is the only way back to an older build, so it has to carry them.

    Without the two fields in the document, a household that exported, wiped and
    re-imported would find every reminder silently gone — the export would still
    have looked complete.
    """

    source = Repository()
    ids = _seed(source)
    item_id = ids["hammer"]
    source.update_item(
        item_id,
        {"reminder_date": "2026-09-01", "reminder_interval": {"unit": "months", "count": 3}},
    )

    doc = ie.build_export_document(source, schema_version=CURRENT_SCHEMA_VERSION)
    exported = next(i for i in doc["items"] if i["id"] == item_id)
    assert exported["reminder_date"] == "2026-09-01"
    assert exported["reminder_interval"] == {"unit": "months", "count": 3}

    target = Repository()
    report, payload = ie.plan_import(
        target, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )
    assert report["valid"] is True
    target.load_state(payload)

    restored = target.get_item(item_id)
    assert restored.reminder_date == "2026-09-01"
    assert restored.reminder_interval == ReminderInterval(unit="months", count=3)


def test_a_document_written_before_reminders_existed_imports_unchanged() -> None:
    """A pre-v8 export has neither field; absent has to keep reading as none."""

    source = Repository()
    ids = _seed(source)
    doc = ie.build_export_document(source, schema_version=CURRENT_SCHEMA_VERSION)
    for entry in doc["items"]:
        entry.pop("reminder_date", None)
        entry.pop("reminder_interval", None)

    target = Repository()
    report, payload = ie.plan_import(
        target, doc, policy="merge", current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["valid"] is True
    target.load_state(payload)
    assert target.get_item(ids["hammer"]).reminder_date is None


def test_an_older_export_compares_as_unchanged_against_a_reminderless_item() -> None:
    """Absent must not read as a change, or every old document becomes an update."""

    repo = Repository()
    _seed(repo)
    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)
    for entry in doc["items"]:
        entry.pop("reminder_date", None)
        entry.pop("reminder_interval", None)

    report, _ = ie.plan_import(
        repo, doc, policy="skip", current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["counts"]["items"]["unchanged"] == SEEDED_ITEMS


def test_preview_accepts_a_reminder_the_write_path_would_accept() -> None:
    """The new checks refuse bad rows, not reminders."""

    repo = Repository()
    report, target = ie.plan_import(
        repo,
        _envelope(
            _item_doc(
                reminder_date="2026-09-01",
                reminder_interval={"unit": "months", "count": 3},
            )
        ),
        current_schema_version=CURRENT_SCHEMA_VERSION,
    )

    assert report["valid"] is True, report["errors"]
    assert target is not None


def test_preview_names_the_row_and_the_field_a_bad_date_is_in() -> None:
    """A refusal nobody can act on is a refusal that costs the whole document.

    The user reads one message; it has to say which item and which field, or
    finding the row means reading the export by hand.
    """

    repo = Repository()
    doc = _envelope(_item_doc())
    doc["items"].append(_item_doc(id="33333333-3333-4333-8333-333333333333", reminder_date="soon"))

    report, _ = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is False
    errors = {e["path"] for e in report["errors"]}
    assert errors == {"items[1].reminder_date"}


def test_a_bumped_series_survives_an_export_and_import() -> None:
    """The anchor is the point of the field, so a backup that loses it loses the fix.

    A round trip through a document has to bring back a series measured from
    31 August and marked done through September — not one that re-anchors on the
    30th and drifts from there.
    """

    repo = Repository()
    item = repo.create_item(
        {
            "name": "Meter reading",
            "reminder_date": "2026-08-31",
            "reminder_interval": {"unit": "months", "count": 1},
        }
    )
    repo.bump_reminder(str(item.id), today=date(2026, 8, 31))
    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)

    exported = doc["items"][0]
    assert (exported["reminder_date"], exported["reminder_anchor"]) == ("2026-09-30", "2026-08-31")

    target = Repository()
    report, payload = ie.plan_import(target, doc, current_schema_version=CURRENT_SCHEMA_VERSION)
    assert report["valid"] is True, report["errors"]
    assert payload is not None
    target.load_state(payload)

    restored = target.get_item(str(item.id))
    assert (restored.reminder_date, restored.reminder_anchor) == ("2026-09-30", "2026-08-31")


def test_a_document_written_before_the_anchor_existed_imports_unchanged() -> None:
    """Every export up to v8 carries none, and a re-import must not read as an edit."""

    repo = Repository()
    _seed(repo)
    repo.create_item(
        {
            "name": "HVAC filter",
            "reminder_date": "2026-09-01",
            "reminder_interval": {"unit": "months", "count": 3},
        }
    )
    doc = ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)
    for entry in doc["items"]:
        entry.pop("reminder_anchor", None)

    report, _payload = ie.plan_import(repo, doc, current_schema_version=CURRENT_SCHEMA_VERSION)

    assert report["valid"] is True, report["errors"]
    assert report["counts"]["items"]["unchanged"] == report["counts"]["items"]["total"]


@pytest.mark.parametrize(
    ("overrides", "path"),
    [
        ({"reminder_anchor": "whenever"}, "items[0].reminder_anchor"),
        # An anchor beyond its own date leads to no occurrence at all.
        (
            {"reminder_date": "2026-09-01", "reminder_anchor": "2026-10-01"},
            "items[0].reminder_anchor",
        ),
        ({"reminder_anchor": "2026-09-01"}, "items[0].reminder_anchor"),
    ],
)
def test_preview_refuses_an_anchor_that_leads_nowhere(overrides: dict, path: str) -> None:
    """A document is the one way an anchor could arrive that no write path allows."""

    repo = Repository()
    report, target = ie.plan_import(
        repo, _envelope(_item_doc(**overrides)), current_schema_version=CURRENT_SCHEMA_VERSION
    )

    assert report["valid"] is False
    assert target is None
    assert path in {e["path"] for e in report["errors"]}
