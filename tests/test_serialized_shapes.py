"""The stored and exported shape of an item and a location, and the way back off it.

`tests/fixtures/stored_payload.json` is the golden document: loaded and exported
again it must come back byte for byte. The wire's extra field is checked in
`tests/integration/test_wire_shapes.py`.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.import_export import build_export_document
from custom_components.haventory.models import EMPTY_LOCATION_PATH, Item, Location, LocationPath
from custom_components.haventory.repository import Repository
from custom_components.haventory.serialization import serialize_location
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION

GOLDEN = Path(__file__).resolve().parent / "fixtures" / "stored_payload.json"

#: Exactly what an item carries in the store and in an export document, in order.
STORED_ITEM_KEYS = (
    "id",
    "name",
    "description",
    "quantity",
    "status",
    "checked_out",
    "due_date",
    "inspection_date",
    "reminder_date",
    "reminder_anchor",
    "reminder_interval",
    "location_id",
    "tags",
    "category",
    "low_stock_threshold",
    "custom_fields",
    "created_at",
    "updated_at",
    "version",
    "location_path",
    "attachments",
)
STORED_LOCATION_KEYS = ("id", "name", "parent_id", "area_id", "path")


def golden_text() -> str:
    return GOLDEN.read_text(encoding="utf-8")


def golden_payload() -> dict[str, Any]:
    return json.loads(golden_text())  # type: ignore[no-any-return]


def dumped(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def loaded_repository() -> Repository:
    return Repository.from_state(golden_payload())


def test_the_stored_payload_is_byte_for_byte_what_it_was() -> None:
    """The golden document, loaded and exported again, is the golden document.

    Refactoring the serializers is exactly the kind of change that moves a byte
    without meaning to — a lost key, a reordered field, an ``int()`` dropped —
    and every one of those is a store this build writes differently from the
    last one a household ran.
    """
    exported = loaded_repository().export_state()

    assert dumped(exported) == golden_text()


def test_every_stored_field_reads_back_into_the_model() -> None:
    """``from_dict`` is the inverse of ``to_dict``, field for field.

    The load path and the import path both build their models through it, so a
    field one half of the pair learns and the other does not is a field a
    restart drops without saying so.
    """
    payload = golden_payload()
    known = frozenset(payload["statuses"])
    item = next(entry for entry in payload["items"].values() if entry["name"] == "Cordless drill")
    location = next(entry for entry in payload["locations"].values() if entry["name"] == "Bin 3")

    assert Item.from_dict(item, known_statuses=known).to_dict() == item
    assert Location.from_dict(location).to_dict() == location


def test_a_row_that_carries_no_path_reads_as_the_empty_one() -> None:
    """The nesting may be absent altogether — an import document leaves it out."""

    location = Location.from_dict({"id": str(uuid.uuid4()), "name": "Garage"})

    assert location.path == EMPTY_LOCATION_PATH


@pytest.mark.parametrize("broken", ["garbage", 7, []])
def test_a_path_of_the_wrong_shape_is_refused(broken: object) -> None:
    """Absent is old; present and not an object is corrupt.

    The load path turns this refusal into a dropped row named in the report,
    rather than an entity carrying a path no write path could have written.
    """

    with pytest.raises(ValidationError):
        LocationPath.from_dict(broken)


def test_the_export_document_carries_the_stored_item_shape() -> None:
    """The document is a restore, so it holds what the store holds.

    ``docs/data_shapes.md`` describes it as every source field plus the
    denormalized paths; that is now the same object the store gets, so nothing
    can be added to one without the other.
    """
    repo = loaded_repository()

    document = build_export_document(repo, schema_version=CURRENT_SCHEMA_VERSION)

    assert [tuple(entry) for entry in document["items"]] == [STORED_ITEM_KEYS] * 2
    assert [tuple(entry) for entry in document["locations"]] == [STORED_LOCATION_KEYS] * 4
    stored = golden_payload()
    assert {entry["id"]: entry for entry in document["items"]} == stored["items"]
    assert {entry["id"]: entry for entry in document["locations"]} == stored["locations"]


def test_the_wire_location_is_the_stored_location() -> None:
    """A location has no derived field, so the two shapes are one."""
    repo = loaded_repository()
    location = next(loc for loc in repo.iter_locations() if loc.name == "Bin 3")

    assert serialize_location(location) == location.to_dict()
    assert tuple(serialize_location(location)) == STORED_LOCATION_KEYS


def test_a_serialized_payload_cannot_be_edited_back_into_the_repository() -> None:
    """Every caller gets a payload it owns.

    The collections are copied out, so an import plan or a card-bound frame can
    be rewritten in place without the repository's own item changing under it —
    which, for a mutable field on a live object, would be a corruption with no
    write path behind it and nothing in a log.
    """
    item = Item(
        id=uuid.uuid4(),
        name="Drill",
        tags=["power"],  # type: ignore[arg-type]
        custom_fields={"serial": "X-1"},
        location_path=LocationPath(
            id_path=[],  # type: ignore[arg-type]
            name_path=["Garage"],  # type: ignore[arg-type]
            display_path="Garage",
            sort_key="garage",
        ),
    )
    location = Location(id=item.id, parent_id=None, name="Garage", path=item.location_path)

    payload = item.to_dict()
    payload["tags"].append("stolen")
    payload["custom_fields"]["serial"] = "tampered"
    payload["location_path"]["name_path"].append("Nowhere")
    location.to_dict()["path"]["name_path"].append("Nowhere")

    assert list(item.tags) == ["power"]
    assert item.custom_fields == {"serial": "X-1"}
    assert list(item.location_path.name_path) == ["Garage"]
    assert list(location.path.name_path) == ["Garage"]
