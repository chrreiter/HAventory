"""The keys the backend puts on the wire, pinned for the card's types to be checked against.

``cards/haventory-card/src/store/types.ts`` is a hand-written copy of the shapes
the serializers here produce. Neither language can read the other, so the two
meet in ``tests/fixtures/wire_shapes.json``:

* this module drives the real commands, serializers and event doors, and
  derives each output shape's keys from what they actually sent: a key in every
  sample is ``required``, a key in only some is ``optional``. For the input
  shapes it reads the ``TypedDict`` key sets the backend validates against.
* ``wire-shapes.test.ts`` holds a key spec per TypeScript interface that the
  compiler ties to the interface, and compares it with the same file.

So a field added, removed or renamed on either side fails one of the two
halves of the gate, by name. When this module fails because the server's
shapes moved, regenerate the file (the failure prints the command), then make
``types.ts`` agree until the card's test passes.

The samples have to cover the absence of every optional key as well as its
presence, or an optional key reads as required: hence the tree read with and
without a filter, the ``items`` event with and without a row, and a refusal
that names no translation.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

import pytest
from custom_components.haventory.events import notify_dataset_replaced
from custom_components.haventory.item_writes import ItemCreate, ItemUpdate
from custom_components.haventory.query import ITEM_FILTER_KEYS, SORT_FIELDS, SORT_ORDERS, Sort
from custom_components.haventory.repository import Repository
from custom_components.haventory.subscriptions import notify_backend_unavailable
from homeassistant.core import HomeAssistant

from runtime_helpers import ws_hass
from ws_helpers import RecordingConn, ws_send

FIXTURES = Path(__file__).resolve().parent / "fixtures"
WIRE_SHAPES = FIXTURES / "wire_shapes.json"
GOLDEN = FIXTURES / "stored_payload.json"
REGENERATE_ENV = "HAVENTORY_WRITE_WIRE_SHAPES"
REGENERATE_COMMAND = (
    f"{REGENERATE_ENV}=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "
    "uv run pytest -q tests/test_wire_shapes_offline.py"
)

TOPICS = ("items", "locations", "stats", "statuses")
#: The event shape for each topic; a teardown notice is one shape on all four.
EVENT_SHAPES = {
    "items": "ItemsEventPayload",
    "locations": "LocationsEventPayload",
    "stats": "StatsEventPayload",
    "statuses": "StatusesEventPayload",
}
TEARDOWN_ACTION = "unavailable"

Samples = dict[str, list[dict[str, Any]]]


class _Sender:
    """Sends frames with fresh ids and asserts the ones that must succeed did."""

    def __init__(self, hass: HomeAssistant, conn: RecordingConn) -> None:
        self.hass = hass
        self.conn = conn
        self.next_id = 1

    async def send(self, type_: str, **payload: Any) -> dict[str, Any]:
        self.next_id += 1
        return await ws_send(self.hass, self.next_id, type_, conn=self.conn, **payload)

    async def ok(self, type_: str, **payload: Any) -> Any:
        envelope = await self.send(type_, **payload)
        assert envelope["success"] is True, (type_, envelope)
        return envelope["result"]

    async def refused(self, type_: str, **payload: Any) -> dict[str, Any]:
        envelope = await self.send(type_, **payload)
        assert envelope["success"] is False, (type_, envelope)
        return envelope["error"]  # type: ignore[no-any-return]


def _walk_tree(nodes: Iterable[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    for node in nodes:
        yield node
        yield from _walk_tree(node["children"])


async def collect_samples() -> Samples:
    """Every output shape the card types, as the backend sends it today."""

    repo = Repository.from_state(json.loads(GOLDEN.read_text(encoding="utf-8")))
    hass = ws_hass(repository=repo)
    conn = RecordingConn()
    ws = _Sender(hass, conn)
    for topic in TOPICS:
        await ws.ok("haventory/subscribe", topic=topic)

    listed = await ws.ok("haventory/item/list")
    locations = await ws.ok("haventory/location/list")
    garage = next(loc for loc in locations if loc["parent_id"] is None)
    created = await ws.ok(
        "haventory/item/create",
        name="Glue",
        quantity=1,
        location_id=garage["id"],
        reminder_date="2027-01-01",
        reminder_interval={"unit": "weeks", "count": 2},
    )
    await ws.ok(
        "haventory/item/update", item_id=created["id"], expected_version=1, name="Wood glue"
    )
    await ws.ok("haventory/location/create", name="Attic")
    trees = [
        *await ws.ok("haventory/location/tree"),
        *await ws.ok("haventory/location/tree", filter={"q": "drill"}),
    ]
    stats = await ws.ok("haventory/stats")
    statuses = await ws.ok("haventory/status/list")
    await ws.ok("haventory/status/create", slug="borrowed", label="Borrowed")
    await ws.ok("haventory/status/reorder", slugs=[s["slug"] for s in statuses] + ["borrowed"])
    bulk = await ws.ok(
        "haventory/items/bulk",
        operations=[
            {
                "op_id": "stale",
                "kind": "item_update",
                "payload": {"item_id": created["id"], "expected_version": 1, "name": "x"},
            },
            {"op_id": "unknown", "kind": "no_such_kind", "payload": {}},
        ],
    )
    errors = [
        # A refusal that names a translation and fills placeholders.
        await ws.refused(
            "haventory/item/update", item_id=created["id"], expected_version=1, name="x"
        ),
        # One Home Assistant answers before any handler runs: no translation, no data.
        await ws.refused("haventory/item/create"),
        await ws.refused("haventory/item/get", item_id=str(uuid.uuid4())),
    ]
    notify_dataset_replaced(hass)
    notify_backend_unavailable(hass)

    items: list[dict[str, Any]] = [*listed["items"], created]
    events = conn.events()
    samples: Samples = {
        "Item": items,
        "LocationPath": [
            *(item["location_path"] for item in items),
            *(loc["path"] for loc in locations),
        ],
        "Attachment": [att for item in items for att in item["attachments"]],
        "ReminderInterval": [i["reminder_interval"] for i in items if i["reminder_interval"]],
        "Location": locations,
        "LocationTreeNode": list(_walk_tree(trees)),
        "StatusDefinition": statuses,
        "StatsCounts": [
            stats,
            *(e["counts"] for e in events if e["topic"] == "stats" and "counts" in e),
        ],
        "ServerError": errors,
        "BulkOpError": [row["error"] for row in bulk["results"].values() if not row["success"]],
        "BackendUnavailableEventPayload": [e for e in events if e["action"] == TEARDOWN_ACTION],
    }
    for topic, shape in EVENT_SHAPES.items():
        samples[shape] = [
            e for e in events if e["topic"] == topic and e["action"] != TEARDOWN_ACTION
        ]
    return samples


def key_spec(samples: list[dict[str, Any]]) -> dict[str, list[str]]:
    """``required`` for a key in every sample, ``optional`` for one in only some."""

    present = [frozenset(sample) for sample in samples]
    every = frozenset.intersection(*present)
    some = frozenset.union(*present)
    return {"required": sorted(every), "optional": sorted(some - every)}


def build_document(samples: Samples) -> dict[str, Any]:
    empty = sorted(shape for shape, found in samples.items() if not found)
    assert not empty, f"no sample collected for: {', '.join(empty)}"
    return {
        "outputs": {shape: key_spec(found) for shape, found in sorted(samples.items())},
        "inputs": {
            "ItemCreate": sorted(ItemCreate.__annotations__),
            "ItemFilter": sorted(ITEM_FILTER_KEYS),
            "ItemUpdate": sorted(ItemUpdate.__annotations__),
            "Sort": sorted(Sort.__annotations__),
        },
        "values": {
            "SortField": sorted(SORT_FIELDS),
            "SortOrder": sorted(SORT_ORDERS),
        },
    }


def dumped(document: Mapping[str, Any]) -> str:
    return json.dumps(document, indent=2) + "\n"


def describe_drift(pinned: Mapping[str, Any], live: Mapping[str, Any]) -> list[str]:
    """One line per key that moved, named by section, shape and field."""

    lines: list[str] = []
    for section in sorted(set(pinned) | set(live)):
        old, new = pinned.get(section, {}), live.get(section, {})
        for shape in sorted(set(old) | set(new)):
            if shape not in new:
                lines.append(f"{section}.{shape}: no longer produced")
            elif shape not in old:
                lines.append(f"{section}.{shape}: new shape {new[shape]}")
            elif isinstance(new[shape], dict):
                known = set(old[shape]["required"]) | set(old[shape]["optional"])
                for kind in ("required", "optional"):
                    for key in sorted(set(new[shape][kind]) - set(old[shape][kind])):
                        change = "is now" if key in known else "is new and"
                        lines.append(f"{section}.{shape}: `{key}` {change} {kind}")
                gone = known - set(new[shape]["required"]) - set(new[shape]["optional"])
                lines.extend(
                    f"{section}.{shape}: `{key}` is no longer sent" for key in sorted(gone)
                )
            else:
                lines.extend(
                    f"{section}.{shape}: `{key}` added"
                    for key in sorted(set(new[shape]) - set(old[shape]))
                )
                lines.extend(
                    f"{section}.{shape}: `{key}` removed"
                    for key in sorted(set(old[shape]) - set(new[shape]))
                )
    return lines


@pytest.mark.asyncio
async def test_the_pinned_wire_shapes_are_what_the_backend_sends() -> None:
    """The file the card's types are checked against matches the live serializers."""

    live = build_document(await collect_samples())
    if os.environ.get(REGENERATE_ENV):
        WIRE_SHAPES.write_text(dumped(live), encoding="utf-8")

    pinned = json.loads(WIRE_SHAPES.read_text(encoding="utf-8"))
    drift = describe_drift(pinned, live)
    assert not drift, (
        "The backend's wire shapes moved:\n  "
        + "\n  ".join(drift)
        + f"\nRegenerate {WIRE_SHAPES.relative_to(FIXTURES.parent.parent)} with\n  "
        + REGENERATE_COMMAND
        + "\nthen update cards/haventory-card/src/store/types.ts until wire-shapes.test.ts passes."
    )
    # The drift report reads key sets; this also holds the lists' sorted order.
    assert pinned == live


def test_a_key_in_only_some_samples_is_optional() -> None:
    assert key_spec([{"a": 1, "b": 2}, {"a": 3}]) == {"required": ["a"], "optional": ["b"]}


def test_the_drift_report_names_the_field() -> None:
    pinned = {"outputs": {"Item": {"required": ["id", "name"], "optional": []}}}
    live = {"outputs": {"Item": {"required": ["id"], "optional": ["name", "tags"]}}}

    assert describe_drift(pinned, live) == [
        "outputs.Item: `name` is now optional",
        "outputs.Item: `tags` is new and optional",
    ]
    assert describe_drift(live, pinned) == [
        "outputs.Item: `name` is now required",
        "outputs.Item: `tags` is no longer sent",
    ]
