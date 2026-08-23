"""One ``to_dict()`` per model, the way back off it, and the three shapes.

An item is serialized for three places, and they are not the same shape:

* the **store**, and the **export document**, which are byte-for-byte the one
  ``Item.to_dict()`` produces;
* the **wire** — WebSocket results and service responses — which is that plus
  ``effective_area_id``, resolved from the location tree per request and stored
  nowhere.

Held together here rather than in the three modules that emit them: the fields
were hand-written three times and drifted, and the way that drift shows up is a
restore that quietly loses something, or a card that reads a key from one
surface and not another. ``from_dict`` is the fourth place the field list is
written out, which is why the inverse is asserted here too.

``tests/fixtures/stored_payload.json`` is the golden document. It was generated
from the serializers as they stood before they were consolidated, so what the
round trip below asserts is that the consolidation moved no byte of a store.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from custom_components.haventory.import_export import build_export_document
from custom_components.haventory.models import EMPTY_LOCATION_PATH, Item, Location, LocationPath
from custom_components.haventory.repository import Repository
from custom_components.haventory.serialization import serialize_item, serialize_location
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime

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
#: The one field the wire adds. Resolved per request; no store can answer for it.
WIRE_ONLY_ITEM_KEYS = frozenset({"effective_area_id"})


def golden_text() -> str:
    return GOLDEN.read_text(encoding="utf-8")


def golden_payload() -> dict[str, Any]:
    return json.loads(golden_text())  # type: ignore[no-any-return]


def dumped(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def loaded_repository() -> Repository:
    return Repository.from_state(golden_payload())


def hass_with(repo: Repository) -> HomeAssistant:
    hass = HomeAssistant()
    install_runtime(hass, repository=repo)
    return hass


# --------------------------------------------------------------------------- #
# The store
# --------------------------------------------------------------------------- #


def test_the_stored_payload_is_byte_for_byte_what_it_was() -> None:
    """The golden document, loaded and exported again, is the golden document.

    #482 pulls the stored-shape changes forward so #229's collapse lands on a
    shape that has stopped moving. Consolidating three hand-written serializers
    into one is exactly the kind of change that moves a byte without meaning to
    — a lost key, a reordered field, an ``int()`` dropped — and every one of
    those is a store this build writes differently from the last.
    """
    exported = loaded_repository().export_state()

    assert dumped(exported) == golden_text()


def test_the_golden_document_covers_the_fields_that_could_drift() -> None:
    """A golden file is only worth what it contains.

    Byte equality against a document of two empty items would pass through any
    of the mistakes above, so the coverage the fixture is supposed to have is
    asserted rather than assumed.
    """
    payload = golden_payload()
    items = list(payload["items"].values())
    filled = next(item for item in items if item["name"] == "Cordless drill")

    # Every field spelled out, and a second item carrying the null/empty
    # spelling of each optional one.
    assert tuple(filled) == STORED_ITEM_KEYS
    assert any(item["reminder_interval"] is None for item in items)
    assert any(item["location_path"]["id_path"] == [] for item in items)
    assert any(item["attachments"] == [] for item in items)

    # The parts most easily lost: a custom status, a three-deep path, an
    # accented name that normalises differently, both attachment kinds, and a
    # custom field of each scalar type.
    assert "lent_out" in payload["statuses"]
    assert filled["location_path"]["name_path"] == ["Garage", "Shelf A", "Bin 3"]
    assert any("ü" in loc["name"].lower() for loc in payload["locations"].values())
    assert [a["kind"] for a in filled["attachments"]] == ["picture", "manual"]
    assert sorted(type(v).__name__ for v in filled["custom_fields"].values()) == [
        "bool",
        "int",
        "str",
    ]


@pytest.mark.parametrize("collection", ["items", "locations"])
def test_a_changed_entity_breaks_the_golden_comparison(collection: str) -> None:
    """The comparison has to be able to fail, on both collections.

    A byte-equality assertion is worthless if the two sides are computed from
    each other, and this is the check that they are not.
    """
    payload = golden_payload()
    entity = next(iter(payload[collection].values()))
    entity["name"] = f"{entity['name']} (edited)"

    assert dumped(Repository.from_state(payload).export_state()) != golden_text()


# --------------------------------------------------------------------------- #
# The way back
# --------------------------------------------------------------------------- #


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


# --------------------------------------------------------------------------- #
# The three surfaces
# --------------------------------------------------------------------------- #


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


def test_the_wire_item_is_the_stored_item_plus_the_derived_area() -> None:
    """The one difference between the wire and the store, asserted as the only one."""
    repo = loaded_repository()
    hass = hass_with(repo)
    item = next(item for item in repo.list_items()["items"] if item.name == "Cordless drill")

    payload = serialize_item(hass, item)

    assert set(payload) - set(STORED_ITEM_KEYS) == WIRE_ONLY_ITEM_KEYS
    assert set(STORED_ITEM_KEYS) - set(payload) == set()
    assert {key: payload[key] for key in STORED_ITEM_KEYS} == item.to_dict()
    # Inherited from the tree's root, which is the Garage and carries the area.
    assert payload["effective_area_id"] == "garage_area"


def test_the_wire_location_is_the_stored_location() -> None:
    """A location has no derived field, so the two shapes are one."""
    repo = loaded_repository()
    location = next(loc for loc in repo._locations_by_id.values() if loc.name == "Bin 3")

    assert serialize_location(location) == location.to_dict()
    assert tuple(serialize_location(location)) == STORED_LOCATION_KEYS


def test_an_item_with_no_location_serializes_a_null_area() -> None:
    """The wire's one extra field has to answer for an item that has no tree.

    ``effective_area_id`` is resolved per request and best-effort, so the
    interesting case is the one where the resolution has nothing to walk.
    """
    repo = loaded_repository()
    hass = hass_with(repo)
    orphan = next(item for item in repo.list_items()["items"] if item.location_id is None)

    payload = serialize_item(hass, orphan)

    assert payload["effective_area_id"] is None
    assert payload["location_path"] == EMPTY_LOCATION_PATH.to_dict()


# --------------------------------------------------------------------------- #
# The copies
# --------------------------------------------------------------------------- #


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
        tags=["power"],
        custom_fields={"serial": "X-1"},
        location_path=LocationPath(
            id_path=[], name_path=["Garage"], display_path="Garage", sort_key="garage"
        ),
    )
    location = Location(id=item.id, parent_id=None, name="Garage", path=item.location_path)

    payload = item.to_dict()
    payload["tags"].append("stolen")
    payload["custom_fields"]["serial"] = "tampered"
    payload["location_path"]["name_path"].append("Nowhere")
    location.to_dict()["path"]["name_path"].append("Nowhere")

    assert item.tags == ["power"]
    assert item.custom_fields == {"serial": "X-1"}
    assert item.location_path.name_path == ["Garage"]
    assert location.path.name_path == ["Garage"]
