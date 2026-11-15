"""Integration: the item, bulk and query commands over a real WebSocket connection.

What a card writes and reads back, what each refusal answers and leaves alone,
and where Home Assistant's own schema refuses a frame before the integration sees it.
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory.validation import DESCRIPTION_MAX_LENGTH
from homeassistant.core import HomeAssistant


async def test_ws_item_create_get_list(hass: HomeAssistant, hass_ws_client, setup_entry) -> None:
    """Create an item, then fetch it by id and see it in the list."""

    await setup_entry()
    client = await hass_ws_client(hass)

    create_id, get_id, list_id = 1, 2, 3
    quantity = 3

    # create
    await client.send_json(
        {
            "id": create_id,
            "type": "haventory/item/create",
            "name": "Screwdriver",
            "quantity": quantity,
        }
    )
    created = await client.receive_json()
    assert created["id"] == create_id
    assert created["success"] is True, created
    item = created["result"]
    item_id = item["id"]
    assert item["name"] == "Screwdriver"
    assert item["quantity"] == quantity
    assert item["version"] == 1

    # get by id
    await client.send_json({"id": get_id, "type": "haventory/item/get", "item_id": item_id})
    fetched = await client.receive_json()
    assert fetched["id"] == get_id
    assert fetched["success"] is True, fetched
    assert fetched["result"]["id"] == item_id
    assert fetched["result"]["name"] == "Screwdriver"

    # list
    await client.send_json({"id": list_id, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["id"] == list_id
    assert listed["success"] is True, listed
    names = [it["name"] for it in listed["result"]["items"]]
    assert "Screwdriver" in names


async def test_ws_rename_keeps_item_versions_valid(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """A location rename must not spend the client's optimistic-concurrency token.

    The rename rewrites the item's derived ``location_path``; a client holding
    the pre-rename ``version`` for an unrelated field must still be able to
    update.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/location/create", "name": "Garage"})
    created_loc = await client.receive_json()
    assert created_loc["success"] is True, created_loc
    location_id = created_loc["result"]["id"]

    await client.send_json(
        {
            "id": 2,
            "type": "haventory/item/create",
            "name": "Hammer",
            "quantity": 1,
            "location_id": location_id,
        }
    )
    created = await client.receive_json()
    assert created["success"] is True, created
    item_id = created["result"]["id"]
    held_version = created["result"]["version"]

    await client.send_json(
        {
            "id": 3,
            "type": "haventory/location/update",
            "location_id": location_id,
            "name": "Workshop",
        }
    )
    renamed = await client.receive_json()
    assert renamed["success"] is True, renamed

    await client.send_json({"id": 4, "type": "haventory/item/get", "item_id": item_id})
    fetched = await client.receive_json()
    assert fetched["success"] is True, fetched
    assert fetched["result"]["location_path"]["display_path"] == "Workshop"
    assert fetched["result"]["version"] == held_version

    await client.send_json(
        {
            "id": 5,
            "type": "haventory/item/update",
            "item_id": item_id,
            "expected_version": held_version,
            "name": "Sledgehammer",
        }
    )
    updated = await client.receive_json()
    assert updated["success"] is True, updated
    assert updated["result"]["name"] == "Sledgehammer"
    assert updated["result"]["version"] == held_version + 1


async def test_ws_subscribe_accepts_area_id_and_refuses_unknown_keys(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Real HA applies the subscribe schema.

    The two halves of the schema change — ``area_id`` accepted, including as an
    explicit null, and anything else still refused — are asserted against a real
    connection.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json(
        {"id": 1, "type": "haventory/subscribe", "topic": "items", "area_id": "kitchen"}
    )
    accepted = await client.receive_json()
    assert accepted["success"] is True, accepted

    await client.send_json(
        {"id": 2, "type": "haventory/subscribe", "topic": "items", "area_id": None}
    )
    cleared = await client.receive_json()
    assert cleared["success"] is True, cleared

    await client.send_json(
        {"id": 3, "type": "haventory/subscribe", "topic": "items", "area": "kitchen"}
    )
    refused = await client.receive_json()
    assert refused["success"] is False, refused


async def test_ws_item_get_unknown_returns_error(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Fetching a missing item surfaces a structured error, not a crash."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/get", "item_id": "does-not-exist"})
    resp = await client.receive_json()
    assert resp["success"] is False, resp
    assert "error" in resp


async def test_widened_frames_answer_validation_error(setup_entry, ws_connect) -> None:
    """The fields typed ``object`` reach the handler and answer through the guard.

    Home Assistant refuses a schema mismatch before ``ws_guard`` runs, so a
    frame the schema rejects can only ever answer ``invalid_format``. This is
    the mode that applies the real voluptuous schemas, so it is the one that can
    tell the two answers apart.
    """

    await setup_entry()
    ws = await ws_connect()

    frames = [
        ("item/create", {"name": "Hammer", "quantity": 1.5}),
        ("item/create", {"name": 42}),
        ("items/bulk", {"operations": "oops"}),
        # The collections a caller writes whole: the schema types them loosely,
        # so a bare string reaches the model and is refused there.
        ("item/create", {"name": "Hammer", "tags": "chisel"}),
        ("item/create", {"name": "Hammer", "custom_fields": ["length"]}),
        ("item/create", {"name": "Hammer", "quantity": "many"}),
        ("item/create", {"name": "Hammer", "tags": [7]}),
        ("status/reorder", {"slugs": "ok"}),
        ("item/create", {"name": "Hammer", "category": ["oops"]}),
        ("item/create", {"name": "Hammer", "description": "d" * (DESCRIPTION_MAX_LENGTH + 1)}),
        ("item/create", {"name": "Hammer", "custom_fields": "oops"}),
    ]
    for command, payload in frames:
        resp = await ws.send(f"haventory/{command}", **payload)
        assert resp["success"] is False, resp
        assert resp["error"]["code"] == "validation_error", resp

    # Nothing was created along the way.
    listed = await ws.send("haventory/item/list")
    assert listed["result"]["items"] == []


async def test_item_list_input_hardening_over_the_real_schema(setup_entry, ws_connect) -> None:
    """Unknown filter keys, unknown sort fields, bad limits and cursors are refused."""

    await setup_entry()
    ws = await ws_connect()
    await ws.send("haventory/item/create", name="Hammer")

    refused = [
        {"filter": {"query": "Hammer"}},
        {"sort": {"field": "colour", "order": "asc"}},
        {"limit": "two"},
        {"filter": {"tags_any": "kitchen"}},
        {"filter": {"tags_all": "kitchen"}},
        {"limit": 1, "cursor": ""},
        {"limit": 1, "cursor": "garbage"},
    ]
    for frame in refused:
        resp = await ws.send("haventory/item/list", **frame)
        assert resp["success"] is False, resp
        assert resp["error"]["code"] == "validation_error", resp
        flt = frame.get("filter", {})
        if "query" in flt:
            assert "query" in resp["error"]["message"]
        for key in ("tags_any", "tags_all"):
            if key in flt:
                assert resp["error"]["message"] == f"{key} must be a list of strings"

    # A known filter and a real cursor still page.
    listed = await ws.send(
        "haventory/item/list",
        filter={"q": "Hammer"},
        sort={"field": "name", "order": "asc"},
        limit=1,
    )
    assert listed["success"] is True, listed
    assert [i["name"] for i in listed["result"]["items"]] == ["Hammer"]


TAGS_MESSAGE = "tags must be a list of strings"
DATE_MESSAGE = "inspection_date must be a valid calendar date (YYYY-MM-DD)"

# (command, payload, (code, what the message says)). The tag and date messages are exact; the
# rest only name the offending key. Item commands run against an item that carries tags and an
# inspection date, which a refusal must leave as it was.
EXACT_MESSAGES = {TAGS_MESSAGE, DATE_MESSAGE}
V = "validation_error"
EDIT_REFUSALS = [
    pytest.param(
        "item/update",
        {"tags": ["Li-Ion", None, " spare "]},
        (V, TAGS_MESSAGE),
        id="update_null_tag",
    ),
    pytest.param("item/add_tags", {"tags": ["x", None]}, (V, TAGS_MESSAGE), id="add_null_tag"),
    pytest.param(
        "item/remove_tags", {"tags": ["x", None]}, (V, TAGS_MESSAGE), id="remove_null_tag"
    ),
    pytest.param("item/update", {"tags": "kitchen"}, (V, TAGS_MESSAGE), id="string_tags"),
    # A bare string would iterate into one-letter members, so each collection field refuses it.
    pytest.param(
        "item/update", {"custom_fields_set": "oops"}, (V, "custom_fields_set must be"), id="set_str"
    ),
    pytest.param(
        "item/update",
        {"custom_fields_unset": "oops"},
        (V, "custom_fields_unset must be"),
        id="unset_str",
    ),
    pytest.param("item/add_tags", {"tags": "oops"}, (V, "tags must be"), id="add_tags_str"),
    pytest.param("item/remove_tags", {"tags": "oops"}, (V, "tags must be"), id="remove_tags_str"),
    pytest.param(
        "item/update_custom_fields", {"set": "oops"}, (V, "set must be"), id="fields_set_str"
    ),
    pytest.param(
        "item/update_custom_fields", {"unset": "oops"}, (V, "unset must be"), id="fields_unset_str"
    ),
    pytest.param(
        "item/attachment/reorder",
        {"attachment_ids": "oops", "kind": "picture"},
        (V, "attachment_ids must be"),
        id="reorder_str",
    ),
    pytest.param("item/set_quantity", {"quantity": True}, (V, "quantity"), id="quantity_bool"),
    pytest.param("item/adjust_quantity", {"delta": True}, (V, "delta"), id="delta_bool"),
    pytest.param(
        "item/update",
        {"inspection_date": "2026-13-01"},
        (V, DATE_MESSAGE),
        id="bad_inspection_date",
    ),
    pytest.param(
        "item/update_custom_fields", {"set": {"bad": [1, 2, 3]}}, (V, ""), id="non_scalar_field"
    ),
    pytest.param(
        "distinct_values", {"filter": {"categorie": "Tools"}}, (V, "categorie"), id="distinct_key"
    ),
    pytest.param("distinct_values", {"filter": "low_stock_only"}, (V, ""), id="distinct_string"),
    # Home Assistant's own schema refusal, not the guard's.
    pytest.param("distinct_values", {"bogus": 1}, ("invalid_format", ""), id="distinct_bogus"),
]


@pytest.mark.parametrize(("command", "payload", "refusal"), EDIT_REFUSALS)
async def test_a_refused_command_leaves_the_item_unchanged(
    setup_entry, ws_connect, command: str, payload: dict[str, Any], refusal: tuple[str, str]
) -> None:
    code, says = refusal
    await setup_entry()
    ws = await ws_connect()
    made = await ws.send(
        "haventory/item/create", name="Torch", tags=["spare"], inspection_date="2026-01-01"
    )
    item = made["result"]
    if command.startswith("item/"):
        payload = {"item_id": item["id"], "expected_version": item["version"], **payload}

    res = await ws.send(f"haventory/{command}", **payload)

    assert res["success"] is False, res
    assert res["error"]["code"] == code, res
    message = res["error"]["message"]
    assert message == says if says in EXACT_MESSAGES else says in message
    after = await ws.send("haventory/item/get", item_id=item["id"])
    assert after["result"] == item


async def test_fields_the_card_writes_round_trip(setup_entry, ws_connect) -> None:
    """Inspection date, cleared tags, optional due date, check in and delete read back."""

    await setup_entry()
    ws = await ws_connect()

    created = await ws.send(
        "haventory/item/create", name="Drill", tags=["power"], inspection_date="2024-03-15"
    )
    item_id = created["result"]["id"]
    assert created["result"]["inspection_date"] == "2024-03-15"
    got = await ws.send("haventory/item/get", item_id=item_id)
    assert got["result"]["inspection_date"] == "2024-03-15"

    changed = await ws.send("haventory/item/update", item_id=item_id, inspection_date="2024-09-30")
    assert changed["result"]["inspection_date"] == "2024-09-30"
    cleared = await ws.send("haventory/item/update", item_id=item_id, inspection_date=None)
    assert cleared["result"]["inspection_date"] is None
    untagged = await ws.send("haventory/item/update", item_id=item_id, tags=None)
    assert untagged["result"]["tags"] == []

    for due in ({}, {"due_date": None}):
        out = await ws.send("haventory/item/check_out", item_id=item_id, **due)
        assert out["result"]["checked_out"] is True, out
        assert out["result"]["due_date"] is None
        back = await ws.send("haventory/item/check_in", item_id=item_id)
        assert back["result"]["checked_out"] is False
    dated = await ws.send("haventory/item/check_out", item_id=item_id, due_date="2030-01-01")
    assert dated["result"]["due_date"] == "2030-01-01"

    deleted = await ws.send("haventory/item/delete", item_id=item_id)
    assert deleted["success"] is True
    assert deleted["result"] is None
    gone = await ws.send("haventory/item/get", item_id=item_id)
    assert gone["error"]["code"] == "not_found"


async def test_item_list_total_counts_every_match_on_every_page(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    for name, category in (("Hammer", "tools"), ("Wrench", "tools"), ("Glue", "misc")):
        await ws.send("haventory/item/create", name=name, category=category)
    seeded, tools = 3, 2

    page1 = await ws.send("haventory/item/list", limit=1)
    page2 = await ws.send("haventory/item/list", limit=1, cursor=page1["result"]["next_cursor"])
    filtered = await ws.send("haventory/item/list", filter={"category": "tools"}, limit=1)
    empty = await ws.send("haventory/item/list", filter={"q": "zzz-not-there"})

    assert [r["result"]["total"] for r in (page1, page2)] == [seeded, seeded]
    assert len(page1["result"]["items"]) == 1
    assert filtered["result"]["total"] == tools
    assert len(filtered["result"]["items"]) == 1
    assert empty["result"]["total"] == 0
    assert empty["result"]["items"] == []


def _set_qty(op_id: Any, item_id: str, quantity: int) -> dict[str, Any]:
    payload = {"item_id": item_id, "quantity": quantity}
    return {"op_id": op_id, "kind": "item_set_quantity", "payload": payload}


@pytest.mark.parametrize(
    ("shape", "success", "names"),
    [
        pytest.param("duplicate", False, "dup", id="duplicate_op_id"),
        pytest.param("numeric", False, "", id="one_id_as_int_and_str"),
        pytest.param("not_objects", False, "", id="entries_not_objects"),
        pytest.param("empty", True, "", id="empty"),
    ],
)
async def test_bulk_whole_batch_outcomes(
    setup_entry, ws_connect, shape: str, success: bool, names: str
) -> None:
    """Results are keyed by op_id, so a repeat fails the whole command and nothing runs."""

    await setup_entry()
    ws = await ws_connect()
    created = await ws.send("haventory/item/create", name="Hammer")
    item_id = created["result"]["id"]
    operations = {
        "duplicate": [_set_qty("dup", item_id, 2), _set_qty("dup", item_id, 3)],
        "numeric": [_set_qty(1, item_id, 2), _set_qty("1", item_id, 3)],
        "not_objects": ["oops"],
        "empty": [],
    }[shape]

    resp = await ws.send("haventory/items/bulk", operations=operations)

    assert resp["success"] is success, resp
    if success:
        assert resp["result"]["results"] == {}
    else:
        assert resp["error"]["code"] == "validation_error", resp
        assert names in resp["error"]["message"]
    got = await ws.send("haventory/item/get", item_id=item_id)
    assert got["result"]["quantity"] == created["result"]["quantity"]


async def test_card_write_commands_over_the_real_schemas(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Every write the card sends passes its real schema and takes effect.

    The refusals a user can hit answer ``validation_error`` and ``conflict``
    rather than ``invalid_format``, which is what a schema mismatch would give.
    """

    await setup_entry()
    client = await hass_ws_client(hass)
    last_id = 0
    set_to, adjusted_to = 4, 3

    async def call(frame: dict) -> dict:
        nonlocal last_id
        last_id += 1
        await client.send_json({"id": last_id, **frame})
        return await client.receive_json()

    async def ok(frame: dict) -> dict:
        resp = await call(frame)
        assert resp["success"] is True, resp
        return resp["result"]

    async def refused(frame: dict, code: str) -> None:
        resp = await call(frame)
        assert resp["success"] is False, resp
        assert resp["error"]["code"] == code, resp

    garage = (await ok({"type": "haventory/location/create", "name": "Garage"}))["id"]
    shelf = (await ok({"type": "haventory/location/create", "name": "Shelf", "parent_id": garage}))[
        "id"
    ]
    basement = (await ok({"type": "haventory/location/create", "name": "Basement"}))["id"]

    item = await ok({"type": "haventory/item/create", "name": "Hammer"})
    item_id = item["id"]

    async def write(command: str, **fields) -> dict:
        nonlocal item
        item = await ok(
            {
                "type": f"haventory/item/{command}",
                "item_id": item_id,
                "expected_version": item["version"],
                **fields,
            }
        )
        return item

    moved = await write("move", location_id=basement)
    assert moved["location_id"] == basement
    assert moved["location_path"]["display_path"] == "Basement"
    assert (await write("set_quantity", quantity=set_to))["quantity"] == set_to
    assert (await write("adjust_quantity", delta=-1))["quantity"] == adjusted_to
    assert (await write("add_tags", tags=["Tool", "TOOL", "garage"]))["tags"] == ["tool", "garage"]
    assert (await write("remove_tags", tags=["TOOL"]))["tags"] == ["garage"]
    assert (await write("update_custom_fields", set={"color": "red", "weight": 1.2}, unset=[]))[
        "custom_fields"
    ] == {"color": "red", "weight": 1.2}
    assert (await write("update_custom_fields", set={}, unset=["weight"]))["custom_fields"] == {
        "color": "red"
    }

    assert (await ok({"type": "haventory/stats"}))["low_stock_count"] == 0
    await write("set_low_stock_threshold", low_stock_threshold=5)
    assert (await ok({"type": "haventory/stats"}))["low_stock_count"] == 1

    await refused(
        {
            "type": "haventory/item/set_quantity",
            "item_id": item_id,
            "expected_version": item["version"],
            "quantity": -1,
        },
        "validation_error",
    )
    stale = {
        "type": "haventory/item/update",
        "item_id": item_id,
        "expected_version": item["version"] - 1,
        "name": "Mallet",
    }
    await refused(stale, "conflict")

    await ok(
        {
            "type": "haventory/location/move_subtree",
            "location_id": garage,
            "new_parent_id": basement,
        }
    )
    tree = await ok({"type": "haventory/location/tree"})
    basement_node = next(node for node in tree if node["id"] == basement)
    assert [child["id"] for child in basement_node["children"]] == [garage]
    for parent in (garage, shelf):
        await refused(
            {
                "type": "haventory/location/move_subtree",
                "location_id": garage,
                "new_parent_id": parent,
            },
            "validation_error",
        )

    await ok({"type": "haventory/location/delete", "location_id": shelf})
    await refused({"type": "haventory/location/get", "location_id": shelf}, "not_found")


def _op(op_id: str, kind: str, **payload: Any) -> dict[str, Any]:
    return {"op_id": op_id, "kind": kind, "payload": payload}


async def test_bulk_batch_answers_each_row_on_its_own(setup_entry, ws_connect) -> None:
    """Rows that cannot apply fail alone with their code; the rows around them land."""

    await setup_entry()
    ws = await ws_connect()
    kept = (await ws.send("haventory/item/create", name="Hammer", tags=["tools"]))["result"]
    other = (await ws.send("haventory/item/create", name="Saw"))["result"]
    iid = kept["id"]
    base = kept["quantity"]
    delta = 2

    bad_rows = {
        "unknown_kind": ("totally_unknown", {}),
        "negative": ("item_set_quantity", {"item_id": iid, "quantity": -1}),
        "set_not_object": ("item_update_custom_fields", {"item_id": iid, "set": "not-an-object"}),
        "unset_not_list": ("item_update_custom_fields", {"item_id": iid, "unset": 123}),
        "no_item_id": ("item_update", {"name": "X"}),
        "empty_item_id": ("item_delete", {"item_id": ""}),
        "string_delta": ("item_adjust_quantity", {"item_id": iid, "delta": "5"}),
        "bool_quantity": ("item_set_quantity", {"item_id": iid, "quantity": True}),
        "update_string_tags": ("item_update", {"item_id": iid, "tags": "kitchen"}),
        "add_string_tags": ("item_add_tags", {"item_id": iid, "tags": "kitchen"}),
        "remove_string_tags": ("item_remove_tags", {"item_id": iid, "tags": "tools"}),
        "stale_delete": ("item_delete", {"item_id": other["id"], "expected_version": 99}),
    }
    operations = [_op(op_id, kind, **payload) for op_id, (kind, payload) in bad_rows.items()]
    operations += [
        _op("good_adjust", "item_adjust_quantity", item_id=iid, delta=delta),
        _op("good_fields", "item_update_custom_fields", item_id=iid, set={"color": "red"}),
    ]

    resp = await ws.send("haventory/items/bulk", operations=operations)

    assert resp["success"] is True, resp
    results = resp["result"]["results"]
    for op_id in bad_rows:
        assert results[op_id]["success"] is False, op_id
        expected = "conflict" if op_id == "stale_delete" else "validation_error"
        assert results[op_id]["error"]["code"] == expected, op_id
    for op_id in ("update_string_tags", "add_string_tags", "remove_string_tags"):
        assert results[op_id]["error"]["message"] == TAGS_MESSAGE
    assert results["good_adjust"]["success"] is True
    assert results["good_fields"]["success"] is True

    after = (await ws.send("haventory/item/get", item_id=iid))["result"]
    assert after["quantity"] == base + delta
    assert after["custom_fields"] == {"color": "red"}
    assert after["tags"] == ["tools"]
    assert after["name"] == "Hammer"
    assert (await ws.send("haventory/item/get", item_id=other["id"]))["success"] is True


@pytest.mark.parametrize(
    ("command", "payload", "kind"),
    [
        pytest.param(
            "item/set_quantity",
            {"item_id": "00000000-0000-4000-8000-000000000000", "quantity": -1},
            "item_set_quantity",
            id="quantity_checked_before_the_lookup",
        ),
        pytest.param(
            "item/update", {"item_id": 7, "name": "X"}, "item_update", id="item_id_of_wrong_type"
        ),
    ],
)
async def test_a_refusal_answers_alike_from_the_command_and_from_bulk(
    setup_entry, ws_connect, command: str, payload: dict[str, Any], kind: str
) -> None:
    """A caller that batches its edits gets the answer it gets sending them singly."""

    await setup_entry()
    ws = await ws_connect()

    single = await ws.send(f"haventory/{command}", **payload)
    batch = await ws.send("haventory/items/bulk", operations=[_op("a", kind, **payload)])

    assert single["success"] is False
    assert single["error"]["code"] == "validation_error"
    row = batch["result"]["results"]["a"]
    assert row["success"] is False
    assert row["error"]["code"] == single["error"]["code"]
    assert row["error"]["message"] == single["error"]["message"]


async def test_distinct_values_answers_over_the_wire(setup_entry, ws_connect) -> None:
    """Counts, ordering, the filtered tally and the key picker as a card reads them."""

    await setup_entry()
    ws = await ws_connect()
    items = [
        {"name": "Hammer", "category": "Tools", "tags": ["red"], "quantity": 0},
        {"name": "Wrench", "category": "Tools", "tags": ["blue"], "custom_fields": {"zeta": 1}},
        {"name": "Novel", "category": "Books", "tags": ["blue", "paper"], "quantity": 0},
        {"name": "Atlas", "category": "Books", "tags": ["paper"], "custom_fields": {"Alpha": 2}},
    ]
    for item in items:
        threshold = {"low_stock_threshold": 1} if item.get("quantity") == 0 else {}
        res = await ws.send("haventory/item/create", **item, **threshold)
        assert res["success"] is True, res

    plain = (await ws.send("haventory/distinct_values"))["result"]
    nulled = (await ws.send("haventory/distinct_values", filter=None))["result"]
    low = (await ws.send("haventory/distinct_values", filter={"low_stock_only": True}))["result"]
    none = (await ws.send("haventory/distinct_values", filter={"q": "nothing here"}))["result"]

    def counts(result: dict[str, Any], facet: str, key: str = "count") -> dict[str, int]:
        return {e["value"]: e[key] for e in result[facet]}

    assert [c["value"] for c in plain["categories"]] == ["Books", "Tools"]
    assert [t["value"] for t in plain["tags"]] == ["blue", "paper", "red"]
    assert counts(plain, "categories") == {"Books": 2, "Tools": 2}
    assert counts(plain, "tags") == {"blue": 2, "paper": 2, "red": 1}
    assert plain["custom_field_keys"] == ["Alpha", "zeta"]
    assert nulled == plain
    assert all("matching_count" not in e for e in [*plain["categories"], *plain["tags"]])

    # Hammer (Tools/red) and Novel (Books/blue+paper) are the low-stock two.
    assert counts(low, "categories") == counts(plain, "categories")
    assert counts(low, "categories", "matching_count") == {"Books": 1, "Tools": 1}
    assert counts(low, "tags", "matching_count") == {"blue": 1, "paper": 1, "red": 1}
    assert low["custom_field_keys"] == plain["custom_field_keys"]

    assert [c["value"] for c in none["categories"]] == ["Books", "Tools"]
    assert len(none["tags"]) == len(plain["tags"])
    assert all(e["matching_count"] == 0 for e in [*none["categories"], *none["tags"]])


async def test_location_tree_counts_items(setup_entry, ws_connect) -> None:
    """Nodes carry direct and subtree counts, and a filter adds the matching pair."""

    await setup_entry()
    ws = await ws_connect()
    garage = (await ws.send("haventory/location/create", name="Garage"))["result"]["id"]
    shelf = (await ws.send("haventory/location/create", name="Shelf", parent_id=garage))["result"][
        "id"
    ]
    listed = await ws.send("haventory/location/list")
    assert {loc["id"] for loc in listed["result"]} == {garage, shelf}
    got = await ws.send("haventory/location/get", location_id=shelf)
    assert (got["result"]["name"], got["result"]["parent_id"]) == ("Shelf", garage)

    create = "haventory/item/create"
    await ws.send(create, name="Car", location_id=garage, category="Auto")
    wrench = (await ws.send(create, name="Wrench", location_id=shelf, category="Tools"))["result"]
    await ws.send(create, name="Orphan")

    async def nodes(**payload: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        res = await ws.send("haventory/location/tree", **payload)
        assert res["success"] is True, res
        root = res["result"][0]
        return root, root["children"][0]

    root, child = await nodes()
    assert (root["direct_item_count"], root["subtree_item_count"]) == (1, 2)
    assert (child["direct_item_count"], child["subtree_item_count"]) == (1, 1)
    assert "matching_subtree_count" not in root

    filtered_root, filtered_child = await nodes(filter={"category": "Tools"})
    assert filtered_root["subtree_item_count"] == root["subtree_item_count"]
    assert filtered_root["matching_direct_count"] == 0
    assert filtered_root["matching_subtree_count"] == 1
    assert filtered_child["matching_subtree_count"] == 1

    moved = await ws.send("haventory/item/move", item_id=wrench["id"], location_id=None)
    assert moved["success"] is True, moved
    root, child = await nodes()
    assert (root["direct_item_count"], root["subtree_item_count"]) == (1, 1)
    assert (child["direct_item_count"], child["subtree_item_count"]) == (0, 0)

    bad = await ws.send("haventory/location/tree", filter={"updated_after": "2024/01/01"})
    assert bad["error"]["code"] == "validation_error"
