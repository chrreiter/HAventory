"""Planning an import and building an export document, with no Home Assistant.

Covers the round trip, per-policy classification, what a document may omit or exceed, the
refusal sentences the import sheet prints, and the name-collision warnings.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from custom_components.haventory import import_export as ie
from custom_components.haventory.migrations import PRE_COLLAPSE_SCHEMA_VERSIONS
from custom_components.haventory.models import validate_attachment_meta
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
from custom_components.haventory.validation import (
    CATEGORY_MAX_LENGTH,
    CUSTOM_FIELD_KEY_MAX_LENGTH,
    CUSTOM_FIELD_VALUE_MAX_LENGTH,
    CUSTOM_FIELDS_MAX_KEYS,
    DESCRIPTION_MAX_LENGTH,
    NAME_MAX_LENGTH,
    TAG_MAX_LENGTH,
    TAGS_MAX_COUNT,
)

#: One above everything the import side takes in: a document from a newer build.
FROM_A_NEWER_BUILD = max(PRE_COLLAPSE_SCHEMA_VERSIONS) + 1
NEW_ID = "44444444-4444-4444-8444-444444444444"


def _plan(repo: Repository, doc: Any, policy: str = "merge") -> tuple[dict, dict | None]:
    return ie.plan_import(
        repo,
        doc,
        policy=policy,  # type: ignore[arg-type]
        current_schema_version=CURRENT_SCHEMA_VERSION,
    )


def _export(repo: Repository) -> dict:
    return ie.build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)


def _attachment_doc(**overrides: Any) -> dict:
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


def _seed(repo: Repository) -> dict[str, str]:
    """A tree, a custom status, and items carrying every field an export has to keep."""

    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf A", parent_id=str(garage.id))
    repo.create_status({"slug": "lent_out", "label": "Lent out", "color": "blue", "icon": "hand"})
    hammer = repo.create_item(
        {
            "name": "Hammer",
            "quantity": 2,
            "location_id": str(shelf.id),
            "tags": ["tools", "red"],
            "category": "Hardware",
            "custom_fields": {"serial": "H-1"},
            "reminder_date": "2026-08-31",
            "reminder_interval": {"unit": "months", "count": 1},
        }
    )
    repo.add_attachment(hammer.id, validate_attachment_meta(_attachment_doc()))
    # Bumped once, so the series carries an anchor the date alone cannot give.
    repo.bump_reminder(str(hammer.id), today=date(2026, 8, 31))
    nails = repo.create_item({"name": "Nails", "quantity": 100})
    ladder = repo.create_item({"name": "Ladder", "status": "lent_out"})
    return {
        "garage": str(garage.id),
        "shelf": str(shelf.id),
        "hammer": str(hammer.id),
        "nails": str(nails.id),
        "ladder": str(ladder.id),
    }


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


def _location_doc(**overrides: object) -> dict:
    doc = {"id": "33333333-3333-4333-8333-333333333333", "name": "Garage", "parent_id": None}
    doc.update(overrides)
    return doc


def _doc(
    items: list[dict] | None = None, locations: list[dict] | None = None, **extra: Any
) -> dict:
    return {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": items or [],
        "locations": locations or [],
        **extra,
    }


def _only_error(report: dict) -> tuple[str, str]:
    """The one refusal a document earned, as the sheet prints it."""

    assert len(report["errors"]) == 1, report["errors"]
    entry = report["errors"][0]
    return entry["path"], entry["message"]


def _by_id(doc: dict, item_id: str) -> dict:
    return next(i for i in doc["items"] if i["id"] == item_id)


# ---- export and round trip ----------------------------------------------------------


def test_build_export_document_full() -> None:
    repo = Repository()
    ids = _seed(repo)

    doc = _export(repo)

    assert doc["haventory_export_version"] == ie.EXPORT_VERSION
    assert doc["schema_version"] == CURRENT_SCHEMA_VERSION
    assert doc["integration_version"]
    assert doc["exported_at"].endswith("Z")
    assert {i["id"] for i in doc["items"]} == {ids["hammer"], ids["nails"], ids["ladder"]}
    assert {loc["id"] for loc in doc["locations"]} == {ids["garage"], ids["shelf"]}
    assert _by_id(doc, ids["hammer"])["location_path"]["display_path"] == "Garage / Shelf A"


def test_build_export_document_filtered_includes_ancestor_locations() -> None:
    repo = Repository()
    ids = _seed(repo)

    doc = ie.build_export_document(
        repo, item_filter={"q": "Hammer"}, schema_version=CURRENT_SCHEMA_VERSION
    )

    assert {i["id"] for i in doc["items"]} == {ids["hammer"]}
    assert {loc["id"] for loc in doc["locations"]} == {ids["garage"], ids["shelf"]}


def test_a_round_trip_into_an_empty_repository_reproduces_everything() -> None:
    """Attachments, a bumped reminder series and a custom status all ride in the document."""

    source = Repository()
    ids = _seed(source)
    doc = _export(source)
    hammer = _by_id(doc, ids["hammer"])
    assert (hammer["reminder_date"], hammer["reminder_anchor"]) == ("2026-09-30", "2026-08-31")

    target = Repository()
    report, payload = _plan(target, doc)
    assert report["valid"] is True, report["errors"]
    assert payload is not None
    target.load_state(payload)

    again = _export(target)
    assert again["items"] == doc["items"]
    assert again["locations"] == doc["locations"]
    assert again["statuses"] == doc["statuses"]
    assert {s["slug"] for s in doc["statuses"]} >= {"lent_out"}


def test_an_imported_item_without_a_quantity_lands_with_one() -> None:
    source = Repository()
    ids = _seed(source)
    doc = _export(source)
    _by_id(doc, ids["nails"]).pop("quantity")

    target = Repository()
    report, payload = _plan(target, doc)
    assert report["valid"] is True
    assert payload is not None
    target.load_state(payload)

    assert target.get_item(ids["nails"]).quantity == 1


# ---- classification per policy ------------------------------------------------------


def test_preview_reimport_all_unchanged() -> None:
    repo = Repository()
    _seed(repo)

    report, _ = _plan(repo, _export(repo))

    assert report["valid"] is True
    assert report["counts"]["items"] == {
        "total": 3,
        "add": 0,
        "update": 0,
        "conflict": 0,
        "unchanged": 3,
    }
    assert report["counts"]["locations"]["unchanged"] == len(list(repo.iter_locations()))


def _plain_repo(*, reminder: bool = False) -> Repository:
    """Items that carry only default values for the fields a document may omit."""

    repo = Repository()
    loc = repo.create_location(name="Garage")
    repo.create_item({"name": "Hammer", "location_id": str(loc.id)})
    if reminder:
        repo.create_item(
            {
                "name": "Filter",
                "reminder_date": "2026-09-01",
                "reminder_interval": {"unit": "months", "count": 3},
            }
        )
    return repo


@pytest.mark.parametrize(
    ("dropped", "reminder"),
    [
        (("status",), False),
        (("reminder_date", "reminder_interval"), False),
        (("reminder_anchor",), True),
        (("attachments",), False),
        (("statuses",), False),
    ],
    ids=["status", "reminders", "anchor", "attachments", "statuses_section"],
)
def test_a_document_written_before_a_field_existed_compares_unchanged(
    dropped: tuple[str, ...], reminder: bool
) -> None:
    repo = _plain_repo(reminder=reminder)
    doc = _export(repo)
    for name in dropped:
        doc.pop(name, None)
        for entry in doc["items"]:
            entry.pop(name, None)

    report, target = _plan(repo, doc, "skip")

    assert report["valid"] is True, report["errors"]
    counts = report["counts"]["items"]
    assert counts["unchanged"] == counts["total"] == len(doc["items"])
    assert target is not None
    assert set(target["statuses"]) >= {"ok", "missing", "needs_repair"}


def test_preview_skip_marks_conflict_replace_marks_update() -> None:
    repo = Repository()
    ids = _seed(repo)
    doc = _export(repo)
    _by_id(doc, ids["hammer"])["name"] = "Hammer XL"

    skip_rep, skip_target = _plan(repo, doc, "skip")
    assert ids["hammer"] in skip_rep["items"]["conflict"]
    assert skip_rep["items"]["update"] == []
    assert skip_target["items"][ids["hammer"]]["name"] == "Hammer"

    repl_rep, repl_target = _plan(repo, doc, "replace")
    assert ids["hammer"] in repl_rep["items"]["update"]
    assert repl_rep["items"]["conflict"] == []
    assert repl_target["items"][ids["hammer"]]["name"] == "Hammer XL"


def test_merge_unions_tags_attachments_and_custom_fields_and_overlays_scalars() -> None:
    repo = Repository()
    ids = _seed(repo)
    stored_attachment = _attachment_doc()
    incoming_attachment = _attachment_doc(
        id="8b2c1a44-5d6e-4f70-8192-a3b4c5d6e7f8", filename="manual.png"
    )
    doc = _export(repo)
    hammer = _by_id(doc, ids["hammer"])
    hammer["tags"] = ["blue"]
    hammer["custom_fields"] = {"weight": "1kg"}
    hammer["status"] = "needs_repair"
    hammer["attachments"] = [incoming_attachment]

    report, target = _plan(repo, doc, "merge")

    assert ids["hammer"] in report["items"]["update"]
    merged = target["items"][ids["hammer"]]
    assert set(merged["tags"]) == {"tools", "red", "blue"}
    assert merged["custom_fields"] == {"serial": "H-1", "weight": "1kg"}
    assert merged["status"] == "needs_repair"
    assert {a["id"] for a in merged["attachments"]} == {
        stored_attachment["id"],
        incoming_attachment["id"],
    }


def test_replace_into_empty_and_add_new_item() -> None:
    repo = Repository()
    _seed(repo)
    doc = _export(repo)
    doc["items"].append(_item_doc(id="11111111-1111-4111-8111-111111111111", name="Wrench"))

    report, target = _plan(repo, doc, "replace")

    assert "11111111-1111-4111-8111-111111111111" in report["items"]["add"]
    assert "11111111-1111-4111-8111-111111111111" in target["items"]


# ---- refusals -----------------------------------------------------------------------

_KEYED_BY_ID = {"22222222-2222-4222-8222-222222222222": {"name": "Ghost"}}

#: (document, path, message fragment). A document refused as a whole carries no
#: partial result and an empty warnings list, so the card always has one shape to render.
_DOCUMENT_REFUSALS: tuple[tuple[Any, str, str], ...] = (
    ("not a dict", "document", "must be a JSON object"),
    ({"items": [], "locations": []}, "haventory_export_version", "missing export version"),
    (_doc() | {"items": {}}, "items", "items must be an array of objects"),
    (_doc() | {"locations": 5}, "locations", "locations must be an array of objects"),
    (
        _doc() | {"haventory_export_version": 99},
        "haventory_export_version",
        "unsupported export version 99",
    ),
    *(
        (
            _doc() | {section: _KEYED_BY_ID},
            section,
            f"{section} must be an array of objects",
        )
        for section in ("items", "locations", "statuses")
    ),
    (_doc() | {"schema_version": FROM_A_NEWER_BUILD}, "schema_version", "upgrade HAventory"),
    *(
        (_doc() | {"schema_version": stamp}, "schema_version", f"schema version {stamp}")
        for stamp in sorted(PRE_COLLAPSE_SCHEMA_VERSIONS)
    ),
)


@pytest.mark.parametrize(("doc", "path", "fragment"), _DOCUMENT_REFUSALS)
def test_a_document_refused_as_a_whole(doc: Any, path: str, fragment: str) -> None:
    report, target = _plan(Repository(), doc)

    assert target is None
    assert report["valid"] is False
    assert report["warnings"] == []
    assert any(e["path"] == path and fragment in e["message"] for e in report["errors"]), report[
        "errors"
    ]
    schema = doc.get("schema_version") if isinstance(doc, dict) else None
    if schema in PRE_COLLAPSE_SCHEMA_VERSIONS:
        message = report["errors"][0]["message"]
        assert "0.8" in message
        assert "upgrade HAventory" not in message


#: Every field-level refusal an item document can earn, spelled the way the
#: import sheet prints it. The card renders each entry as "path: message"
#: verbatim, so both halves are the contract: a row changing is a user-visible
#: change whether or not the code still refuses.
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
    # Only an absent status reads as the default; a present null names no state.
    ({"status": None}, "items[0].status", "status must be one of: missing, needs_repair, ok"),
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
        {"attachments": [_attachment_doc(mime="")]},
        "items[0].attachments[0]",
        "attachment mime is required and must be a non-empty string",
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
        {"reminder_anchor": "whenever"},
        "items[0].reminder_anchor",
        "reminder_anchor must be in 'YYYY-MM-DD' format",
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
    report, target = _plan(Repository(), _doc([_item_doc(**overrides)]))

    assert target is None
    assert _only_error(report) == (path, message)


@pytest.mark.parametrize(("overrides", "path", "message"), _LOCATION_REFUSALS)
def test_a_location_refusal_names_the_field_and_says_what_it_says(
    overrides: dict, path: str, message: str
) -> None:
    report, target = _plan(Repository(), _doc(locations=[_location_doc(**overrides)]))

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
    report, target = _plan(Repository(), _doc([_item_doc()], statuses=section))

    assert target is None
    assert _only_error(report) == (path, message)


def test_preview_broken_reference_reports_error() -> None:
    doc = _doc([_item_doc(location_id="33333333-3333-4333-8333-333333333333")])

    report, target = _plan(Repository(), doc)

    assert report["valid"] is False
    assert target is None
    assert any("location_id" in e["path"] for e in report["errors"])


def test_preview_names_the_row_and_the_field_a_bad_date_is_in() -> None:
    doc = _doc(
        [_item_doc(), _item_doc(id="33333333-3333-4333-8333-333333333333", reminder_date="soon")]
    )

    report, _ = _plan(Repository(), doc)

    assert report["valid"] is False
    assert {e["path"] for e in report["errors"]} == {"items[1].reminder_date"}


# ---- documents the load path accepts ------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        # Values legal in a store written before the caps existed, which exports and loads
        # unchanged: a document is a restore, as tolerant as ``load_state``.
        {"description": "d" * (DESCRIPTION_MAX_LENGTH + 1)},
        {"category": "c" * (CATEGORY_MAX_LENGTH + 1)},
        {"tags": ["t" * (TAG_MAX_LENGTH + 1)]},
        {"tags": [f"t{i}" for i in range(TAGS_MAX_COUNT + 1)]},
        {"custom_fields": {f"k{i}": i for i in range(CUSTOM_FIELDS_MAX_KEYS + 1)}},
        {"custom_fields": {"k" * (CUSTOM_FIELD_KEY_MAX_LENGTH + 1): 1}},
        {"custom_fields": {"k": "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 1)}},
        {"due_date": "2026-01-01", "checked_out": True},
        {
            "name": "n" * NAME_MAX_LENGTH,
            "description": "d" * DESCRIPTION_MAX_LENGTH,
            "category": "c" * CATEGORY_MAX_LENGTH,
            "tags": ["t" * TAG_MAX_LENGTH],
            "custom_fields": {
                "k" * CUSTOM_FIELD_KEY_MAX_LENGTH: "v" * CUSTOM_FIELD_VALUE_MAX_LENGTH
            },
        },
        {"reminder_date": "2026-09-01", "reminder_interval": {"unit": "months", "count": 3}},
    ],
    ids=[
        "description",
        "category",
        "tag_length",
        "tag_count",
        "custom_field_count",
        "custom_field_key",
        "custom_field_value",
        "checked_out_due_date",
        "every_cap",
        "reminder",
    ],
)
def test_a_document_the_load_path_accepts_imports(overrides: dict) -> None:
    report, target = _plan(Repository(), _doc([_item_doc(**overrides)]))

    assert report["valid"] is True, report["errors"]
    assert target is not None


def test_a_legacy_over_cap_item_round_trips_through_export_and_import() -> None:
    repo = Repository()
    item = repo.create_item({"name": "Ghost"})
    # A store written before the caps existed: edit the persisted dict the way no
    # current write can, then load it, which re-validates nothing.
    state = repo.export_state()
    stored = state["items"][str(item.id)]
    stored["description"] = "d" * (DESCRIPTION_MAX_LENGTH + 500)
    stored["tags"] = [f"tag-{i}" for i in range(TAGS_MAX_COUNT + 5)]
    stored["custom_fields"] = {"note": "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 200)}
    repo.load_state(state)

    fresh = Repository()
    report, target = _plan(fresh, _export(repo))
    assert report["valid"] is True, report["errors"]
    assert target is not None

    fresh.load_state(target)
    restored = fresh.get_item(item.id)
    assert restored.description == "d" * (DESCRIPTION_MAX_LENGTH + 500)
    assert len(restored.tags) == TAGS_MAX_COUNT + 5
    assert restored.custom_fields["note"] == "v" * (CUSTOM_FIELD_VALUE_MAX_LENGTH + 200)


# ---- name-collision warnings --------------------------------------------------------


def _rebuilt(name: str) -> dict:
    """An item doc whose id is absent here, standing for a hand-rebuilt entity."""

    return _item_doc(id=NEW_ID, name=name)


def test_an_incoming_name_taken_by_another_id_is_warned_about() -> None:
    repo = Repository()
    stored = repo.create_item({"name": "Hammer"})

    report, target = _plan(repo, _doc([_rebuilt("Hammer")]))

    # A warning tells; the id still decides.
    assert report["valid"] is True, report["errors"]
    assert target is not None
    assert len(report["warnings"]) == 1
    warning = report["warnings"][0]
    assert warning["code"] == "name_collision"
    assert warning["path"] == "items[0]"
    assert warning["name"] == "Hammer"
    assert warning["existing_ids"] == [str(stored.id)]
    assert report["items"]["add"] == [NEW_ID]


def test_a_location_collision_names_the_stored_path() -> None:
    repo = Repository()
    garage = repo.create_location(name="Garage")
    shelf = repo.create_location(name="Shelf A", parent_id=str(garage.id))

    report, target = _plan(repo, _doc(locations=[_location_doc(name="Shelf A")]))

    assert report["valid"] is True, report["errors"]
    assert target is not None
    warning = report["warnings"][0]
    assert (warning["code"], warning["path"]) == ("name_collision", "locations[0]")
    assert warning["existing_ids"] == [str(shelf.id)]
    assert "Garage / Shelf A" in warning["message"]


@pytest.mark.parametrize("changed", [False, True], ids=["unchanged", "changed_inventory"])
@pytest.mark.parametrize("policy", ["merge", "replace", "skip"])
def test_a_reimported_export_warns_about_nothing(policy: str, changed: bool) -> None:
    """`unchanged`, `update` and `conflict` are the same entity by id, never a collision."""

    repo = Repository()
    ids = _seed(repo)
    # Namesakes of other entities are legitimate and not what a warning is for.
    repo.create_item({"name": "Hammer"})
    repo.create_location(name="Hammer")
    doc = _export(repo)
    if changed:
        repo.update_item(ids["hammer"], {"quantity": 99})

    report, target = _plan(repo, doc, policy)

    assert report["valid"] is True, report["errors"]
    assert target is not None
    assert report["warnings"] == []


@pytest.mark.parametrize("incoming_name", ["hammer", "HAMMER", "  Hammer  ", "Hämmer"])
def test_names_differing_only_by_case_spacing_or_accent_still_collide(incoming_name: str) -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer"})

    report, _ = _plan(repo, _doc([_rebuilt(incoming_name)]))

    assert [w["code"] for w in report["warnings"]] == ["name_collision"]


def test_no_warning_when_the_colliding_stored_entity_is_the_same_id() -> None:
    repo = Repository()
    stored = repo.create_item({"name": "Hammer"})

    report, _ = _plan(repo, _doc([_item_doc(id=str(stored.id), name="Hammer", quantity=7)]))

    assert report["items"]["update"] == [str(stored.id)]
    assert report["warnings"] == []


def _shelf_doc(loc_id: str, display_path: str) -> dict:
    return _location_doc(id=loc_id, name="Shelf A", path={"display_path": display_path})


def test_every_stored_entity_of_a_colliding_name_is_reported() -> None:
    """A hand-rebuilt tree collides several deep on a repeated leaf name."""

    repo = Repository()
    garage = repo.create_location(name="Garage")
    cellar = repo.create_location(name="Cellar")
    garage_shelf = repo.create_location(name="Shelf A", parent_id=str(garage.id))
    cellar_shelf = repo.create_location(name="Shelf A", parent_id=str(cellar.id))

    report, _ = _plan(
        repo,
        _doc(locations=[_shelf_doc("55555555-5555-4555-8555-555555555555", "Garage / Shelf A")]),
    )

    assert report["valid"] is True, report["errors"]
    warning = report["warnings"][0]
    assert sorted(warning["existing_ids"]) == sorted([str(garage_shelf.id), str(cellar_shelf.id)])
    assert '"Cellar / Shelf A"' in warning["message"]
    assert '"Garage / Shelf A"' in warning["message"]


def test_two_incoming_entries_of_one_name_do_not_render_identically() -> None:
    repo = Repository()
    repo.create_location(name="Shelf A")
    doc = _doc(
        locations=[
            _shelf_doc("55555555-5555-4555-8555-555555555555", "Garage / Shelf A"),
            _shelf_doc("66666666-6666-4666-8666-666666666666", "Cellar / Shelf A"),
        ]
    )

    report, _ = _plan(repo, doc)

    messages = [w["message"] for w in report["warnings"]]
    assert len(set(messages)) == len(messages) == 2  # noqa: PLR2004
    assert any('"Garage / Shelf A" would be added' in m for m in messages)
    assert any('"Cellar / Shelf A" would be added' in m for m in messages)


def test_an_item_collision_counts_the_stored_namesakes_and_places_the_incoming() -> None:
    repo = Repository()
    first = repo.create_item({"name": "Hammer"})
    second = repo.create_item({"name": "hammer"})
    incoming = _rebuilt("Hammer") | {"location_path": {"display_path": "Garage / Shelf A"}}

    report, _ = _plan(repo, _doc([incoming]))

    warning = report["warnings"][0]
    assert sorted(warning["existing_ids"]) == sorted([str(first.id), str(second.id)])
    assert '"Hammer" in "Garage / Shelf A" would be added' in warning["message"]
    assert "2 items here already go by that name" in warning["message"]


def test_a_collision_message_stays_one_line_however_many_entries_collide() -> None:
    colliding = 12
    repo = Repository()
    for i in range(colliding):
        parent = repo.create_location(name=f"Room {i}")
        repo.create_location(name="Drawer 1", parent_id=str(parent.id))
    drawer = _location_doc(
        id="55555555-5555-4555-8555-555555555555",
        name="Drawer 1",
        path={"display_path": "Room 0 / Drawer 1"},
    )

    report, _ = _plan(repo, _doc(locations=[drawer]))

    warning = report["warnings"][0]
    assert len(warning["existing_ids"]) == colliding
    # The subject plus the quoted stored paths, and no more.
    assert warning["message"].count("Drawer 1") == ie.COLLISION_LABELS_SHOWN + 1
    assert f"and {colliding - ie.COLLISION_LABELS_SHOWN} more" in warning["message"]


def test_a_collision_message_does_not_repeat_the_sheet_lead() -> None:
    repo = Repository()
    repo.create_item({"name": "Hammer"})

    report, _ = _plan(repo, _doc([_rebuilt("Hammer")]))

    message = report["warnings"][0]["message"]
    assert "Import matches on the id alone" not in message
    assert message.count(".") == 1


def test_warnings_do_not_reach_import_execute() -> None:
    """The preview tells; the id still decides."""

    repo = Repository()
    repo.create_item({"name": "Hammer"})

    report, target = _plan(repo, _doc([_rebuilt("Hammer")]))
    assert report["warnings"]
    assert target is not None

    repo.load_state(target)

    assert sorted(item.name for item in repo.list_items()["items"]) == ["Hammer", "Hammer"]
