"""Integration: what a client receives when a command fails.

An error frame carries a `data` object Home Assistant's own `error_message` has no room for,
and it must reach a real client intact. Refusals Home Assistant makes itself, a reused id or
a command this build lacks, are answered by the connection before any handler runs. A failure
the integration did not expect says nothing of its cause, and a write that failed announces
nothing to subscribers.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import pytest
from custom_components.haventory import ops
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.ws import UNEXPECTED_ERROR_MESSAGE
from homeassistant.core import HomeAssistant


async def test_the_error_context_reaches_the_client_intact(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """`data` arrives with the request fields the taxonomy promised, not just `op`."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/get", "item_id": "does-not-exist"})
    resp = await client.receive_json()

    assert resp["success"] is False, resp
    assert resp["error"]["code"] == "not_found"
    assert resp["error"]["data"] == {"op": "item_get", "item_id": "does-not-exist"}


async def test_a_nested_error_payload_survives_the_wire(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """The richest `data` there is: a list of objects, not a flat string map.

    An import document is rejected with one entry per problem, and the card
    shows them field by field — so anything that flattened or dropped the
    nesting on the way out would cost the whole message.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json(
        {
            "id": 1,
            "type": "haventory/import/execute",
            "document": {"haventory_export_version": "one", "items": "nope"},
        }
    )
    resp = await client.receive_json()

    assert resp["success"] is False, resp
    assert resp["error"]["code"] == "validation_error"
    errors = resp["error"]["data"]["errors"]
    assert errors, resp
    assert all(isinstance(entry, dict) and "path" in entry for entry in errors), errors
    assert {entry["path"] for entry in errors} == {
        "haventory_export_version",
        "schema_version",
        "items",
    }


async def test_home_assistants_own_refusal_carries_no_data_key(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """The counter-case: `data` is ours, not something every frame arrives with.

    A frame the command schema rejects is answered by Home Assistant before
    `ws_guard` runs, and its envelope has no `data` at all. Without this the
    assertions above would also pass if a real connection simply added the key
    to everything.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/get"})
    resp = await client.receive_json()

    assert resp["success"] is False, resp
    assert resp["error"]["code"] == "invalid_format", resp
    assert "data" not in resp["error"], resp


async def test_a_reused_frame_id_is_refused_before_the_command_runs(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """A connection tracks `last_id`, so a card that reuses an id is told so."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 7, "type": "haventory/item/create", "name": "First"})
    assert (await client.receive_json())["success"] is True

    await client.send_json({"id": 7, "type": "haventory/item/create", "name": "Second"})
    refused = await client.receive_json()
    assert refused["success"] is False, refused
    assert refused["error"]["code"] == "id_reuse", refused

    # Refused by the connection, so the handler never ran and nothing was created.
    await client.send_json({"id": 8, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert [item["name"] for item in listed["result"]["items"]] == ["First"]


async def test_a_command_this_build_does_not_have_is_answered_not_ignored(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """What a newer card meets on an older backend: an answer it can branch on."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/teleport"})
    resp = await client.receive_json()

    assert resp["success"] is False, resp
    assert resp["error"]["code"] == "unknown_command", resp


async def test_an_unexpected_failure_answers_generically(
    monkeypatch, setup_entry, ws_connect
) -> None:
    """The exception text and traceback stay in the log, for a whole command and for one bulk op."""

    def boom(detail: str) -> Callable[..., Any]:
        def _raise(*_args: Any, **_kwargs: Any) -> Any:
            raise RuntimeError(detail)

        return _raise

    await setup_entry()
    ws = await ws_connect()

    monkeypatch.setattr(ops, "serialize_item", boom("SECRET-INTERNAL-DETAIL"))
    res = await ws.send("haventory/item/create", name="Widget")
    assert res["error"]["code"] == "unknown_error", res
    assert res["error"]["message"] == UNEXPECTED_ERROR_MESSAGE
    assert res["error"]["data"]["op"] == "item_create"
    assert "SECRET-INTERNAL-DETAIL" not in json.dumps(res)
    assert "Traceback" not in json.dumps(res)
    monkeypatch.undo()

    item = (await ws.send("haventory/item/create", name="Gadget", quantity=1))["result"]
    monkeypatch.setitem(ops.OPS, "item_update", boom("SECRET-OP-DETAIL"))
    operations = [
        {"op_id": "boom", "kind": "item_update", "payload": {"item_id": item["id"], "name": "X"}},
        {
            "op_id": "good",
            "kind": "item_adjust_quantity",
            "payload": {"item_id": item["id"], "delta": 1},
        },
    ]
    res = await ws.send("haventory/items/bulk", operations=operations)

    # It may have left its row half-applied, so the batch is undone whole.
    assert res["error"]["code"] == "unknown_error", res
    assert res["error"]["message"] == UNEXPECTED_ERROR_MESSAGE
    assert "SECRET-OP-DETAIL" not in json.dumps(res)
    assert "Traceback" not in json.dumps(res)
    got = await ws.send("haventory/item/get", item_id=item["id"])
    assert got["result"]["quantity"] == item["quantity"]


def _op(kind: str, **payload: Any) -> dict[str, Any]:
    return {"op_id": kind, "kind": kind, "payload": payload}


# (id, command, payload for the seeded item id and the Garage location id)
MUTATIONS: list[tuple[str, str, Callable[[str, str], dict[str, Any]]]] = [
    ("item_create", "item/create", lambda _i, _l: {"name": "Fresh"}),
    ("item_update", "item/update", lambda i, _l: {"item_id": i, "quantity": 5}),
    ("item_delete", "item/delete", lambda i, _l: {"item_id": i}),
    ("adjust_quantity", "item/adjust_quantity", lambda i, _l: {"item_id": i, "delta": 1}),
    ("set_quantity", "item/set_quantity", lambda i, _l: {"item_id": i, "quantity": 7}),
    ("check_out", "item/check_out", lambda i, _l: {"item_id": i}),
    ("check_in", "item/check_in", lambda i, _l: {"item_id": i}),
    ("add_tags", "item/add_tags", lambda i, _l: {"item_id": i, "tags": ["new"]}),
    ("remove_tags", "item/remove_tags", lambda i, _l: {"item_id": i, "tags": ["seed"]}),
    ("custom_fields", "item/update_custom_fields", lambda i, _l: {"item_id": i, "set": {"k": "v"}}),
    (
        "threshold",
        "item/set_low_stock_threshold",
        lambda i, _l: {"item_id": i, "low_stock_threshold": 2},
    ),
    ("item_move", "item/move", lambda i, loc: {"item_id": i, "location_id": loc}),
    (
        "bulk",
        "items/bulk",
        lambda i, _l: {
            "operations": [
                _op("item_adjust_quantity", item_id=i, delta=1),
                _op("item_set_quantity", item_id=i, quantity=9),
            ]
        },
    ),
    ("location_create", "location/create", lambda _i, _l: {"name": "Shed"}),
    ("rename", "location/update", lambda _i, loc: {"location_id": loc, "name": "Renamed"}),
    ("reparent", "location/update", lambda _i, loc: {"location_id": loc, "new_parent_id": None}),
    ("location_delete", "location/delete", lambda _i, loc: {"location_id": loc}),
    (
        "move_subtree",
        "location/move_subtree",
        lambda _i, loc: {"location_id": loc, "new_parent_id": None},
    ),
]


@pytest.mark.parametrize(
    ("command", "build"), [m[1:] for m in MUTATIONS], ids=[m[0] for m in MUTATIONS]
)
async def test_a_failed_write_is_not_announced(
    setup_entry, ws_connect, fail_next_save, command, build
) -> None:
    """A client is never told about a change that did not reach disk."""

    await setup_entry()
    ws = await ws_connect()
    parent = (await ws.send("haventory/location/create", name="House"))["result"]
    child = (await ws.send("haventory/location/create", name="Garage", parent_id=parent["id"]))[
        "result"
    ]
    item = (await ws.send("haventory/item/create", name="Seeded", quantity=3, tags=["seed"]))[
        "result"
    ]
    for topic in ("items", "locations", "stats"):
        await ws.subscribe(topic)
    ws.event_frames.clear()

    fail_next_save()
    res = await ws.send(f"haventory/{command}", **build(item["id"], child["id"]))

    assert res["error"]["code"] == "storage_error", res
    assert ws.event_frames == []


_UNKNOWN_ID = "6f1c2b9e-3f7a-4c1d-9b2e-8a7d6c5b4a3f"


async def test_a_conflict_names_its_key_and_placeholders_on_the_wire(
    setup_entry, ws_connect
) -> None:
    """The card words a refusal from `translation_key`, filling its placeholders as strings."""

    await setup_entry()
    ws = await ws_connect()
    item = (await ws.send("haventory/item/create", name="Drill"))["result"]

    res = await ws.send(
        "haventory/item/update",
        item_id=item["id"],
        name="Drill 2",
        expected_version=item["version"] + 5,
    )

    error = res["error"]
    assert error["code"] == "conflict", res
    assert error["message"].startswith("version conflict")
    assert error["translation_domain"] == DOMAIN
    assert error["translation_key"] == "version_conflict"
    assert error["translation_placeholders"] == {
        "expected": str(item["version"] + 5),
        "actual": str(item["version"]),
    }


async def test_a_refusal_with_no_key_carries_only_its_message(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/subscribe", topic="nope")

    assert res["error"]["code"] == "validation_error", res
    assert "translation_key" not in res["error"]


async def test_a_refused_bulk_row_names_its_key(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send(
        "haventory/items/bulk",
        operations=[{"op_id": "a", "kind": "item_delete", "payload": {"item_id": _UNKNOWN_ID}}],
    )

    row = res["result"]["results"]["a"]
    assert row["success"] is False, res
    assert row["error"]["translation_key"] == "item_not_found"


async def test_an_invalid_import_names_its_key_and_keys_each_row_it_can(
    setup_entry, ws_connect
) -> None:
    await setup_entry()
    ws = await ws_connect()
    document = (await ws.send("haventory/export"))["result"]
    document["items"] = [{"id": _UNKNOWN_ID, "name": "", "quantity": -1}]

    res = await ws.send("haventory/import/execute", document=document)

    error = res["error"]
    assert error["translation_key"] == "import_document_invalid", res
    rows: list[dict[str, Any]] = error["data"]["errors"]
    assert {"name_required", "quantity_negative"} <= {row.get("translation_key") for row in rows}
    assert all(row["message"] for row in rows)
