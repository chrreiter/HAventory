"""Integration: what a real client actually receives when a command fails.

The contract's error frame carries a `data` object that Home Assistant's own
`websocket_api.error_message` has no parameter for, so `ws.py` builds the
envelope by hand. Offline, both sides of that distinction are our own code —
the stub sends what the guard returns — and nothing proves the extra key
survives a real connection's serialization out to a real client.

The refusals Home Assistant makes on its own behalf are here for the same
reason. They happen inside `ActiveConnection`, before any handler runs: an id
that does not increase and a command this build does not have are both refused
by state the offline helpers keep no equivalent of, so what a client sees in
either case is asserted here or nowhere.
"""

from __future__ import annotations

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
    """Real connections track `last_id`; the offline helpers dispatch each frame alone.

    So an offline test can reuse an id — or send ids out of order — in a way no
    real client gets away with, and a card that did it would find out here.
    """

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
    """What a newer card meets on an older backend: an answer it can branch on.

    Offline the helpers raise `AssertionError("No handler responded")`, which is
    a fine test failure and no description at all of what a client receives.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/teleport"})
    resp = await client.receive_json()

    assert resp["success"] is False, resp
    assert resp["error"]["code"] == "unknown_command", resp
