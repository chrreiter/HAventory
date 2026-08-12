"""Offline tests for the shared WebSocket send helper.

Every offline WS test dispatches through ``tests/ws_helpers.py``, so what it
returns and how it treats ``conn`` decide what those tests are able to assert.
The three properties pinned here are the ones the rest of the suite leans on:
the **full envelope** comes back (success and failure alike), a caller-supplied
connection is the one the handler writes to, and a command nobody registered
fails loudly rather than returning nothing.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from ws_helpers import RecordingConn, ws_call, ws_handler, ws_send

# One frame id, reused: what matters is that the envelope echoes the one sent.
FRAME_ID = 7


def _make_hass() -> HomeAssistant:
    hass = HomeAssistant()
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["repository"] = Repository()
    bucket["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


@pytest.mark.asyncio
async def test_send_returns_the_whole_result_envelope() -> None:
    """Not just ``result``: the id, the type and the success flag come back too."""

    hass = _make_hass()

    res = await ws_send(hass, FRAME_ID, "haventory/item/create", name="Hammer")

    assert res["id"] == FRAME_ID
    assert res["type"] == "result"
    assert res["success"] is True
    assert res["result"]["name"] == "Hammer"


@pytest.mark.asyncio
async def test_a_refused_command_is_returned_not_raised() -> None:
    """The error envelope is a return value, so a test can read its code and data."""

    hass = _make_hass()

    res = await ws_send(hass, FRAME_ID, "haventory/item/get", item_id="not-a-uuid")

    assert res["id"] == FRAME_ID
    assert res["success"] is False
    assert res["error"]["code"] == "not_found"


@pytest.mark.asyncio
async def test_conn_is_optional_and_receives_what_the_handler_pushes() -> None:
    """Passing a connection is what lets a test read events off the wire."""

    hass = _make_hass()
    conn = RecordingConn()

    assert (await ws_send(hass, 1, "haventory/subscribe", conn=conn, topic="items"))["success"]
    await ws_send(hass, 2, "haventory/item/create", name="Chisel")

    events = conn.events(topic="items")
    assert [ev["action"] for ev in events] == ["created"]
    assert events[0]["item"]["name"] == "Chisel"
    # A different topic is filtered out, and the unfiltered read sees the same one.
    assert conn.events(topic="locations") == []
    assert conn.events() == events


@pytest.mark.asyncio
async def test_omitting_conn_still_answers() -> None:
    """The 11-of-22 case: no connection to hand over, and the envelope still returns."""

    hass = _make_hass()

    res = await ws_send(hass, 1, "haventory/stats")

    assert res["success"] is True
    assert res["result"]["items_total"] == 0


@pytest.mark.asyncio
async def test_a_captured_handler_can_be_called_after_the_lookup() -> None:
    """``ws_handler`` + ``ws_call`` split the lookup from the send.

    The unload tests need exactly this: real Home Assistant cannot unregister a
    WebSocket command, so they hold the handler across teardown and call it the
    way a client on a still-registered command does.
    """

    hass = _make_hass()
    handler = ws_handler(hass, "haventory/item/list")

    res = await ws_call(handler, hass, FRAME_ID, "haventory/item/list")

    assert res["id"] == FRAME_ID
    assert res["result"]["items"] == []


def test_an_unregistered_command_fails_loudly() -> None:
    """A typo in a command name must not read as an empty answer."""

    hass = _make_hass()

    with pytest.raises(AssertionError, match="haventory/nope"):
        ws_handler(hass, "haventory/nope")
