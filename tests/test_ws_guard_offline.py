"""Offline tests for `ws_guard`.

The guard answers whatever the connection does: a `send_message` that raises,
or a connection that has none, still leaves the caller with an error envelope
rather than an exception crossing the WebSocket layer.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

import pytest
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant

from runtime_helpers import ws_hass
from ws_helpers import ws_send


def _get_handler(
    hass: HomeAssistant, type_: str
) -> Callable[[HomeAssistant, object, dict], Coroutine[Any, Any, dict]]:
    handler = hass.data.get("__ws_commands__", {}).get(type_)
    if handler is None:
        raise AssertionError("No handler found for type " + type_)
    return handler


class _ConnCollect:
    def __init__(self) -> None:
        self.last: dict[str, Any] | None = None

    def send_message(self, msg: dict[str, Any]) -> None:
        self.last = msg


class _ConnRaise:
    def send_message(self, _msg: dict[str, Any]) -> None:
        raise RuntimeError("boom")


class _ConnNoSend:
    pass


@pytest.mark.asyncio
async def test_returns_and_sends_error_when_validation_fails() -> None:
    """Handlers should send AND return the error envelope."""

    hass = ws_hass()

    handler = _get_handler(hass, "haventory/item/set_quantity")
    conn = _ConnCollect()
    req = {"id": 10, "type": "haventory/item/set_quantity", "item_id": "x", "quantity": -1}

    res = await handler(hass, conn, req)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    # Envelope should have been sent as well
    assert conn.last == res
    # Context data should include op and relevant fields
    data = res["error"].get("data", {})
    assert data.get("op") == "item_set_quantity"
    assert data.get("quantity") == -1


@pytest.mark.asyncio
async def test_returns_error_when_send_message_raises() -> None:
    """Even if send fails, the error envelope must be returned to caller."""

    hass = ws_hass()

    handler = _get_handler(hass, "haventory/item/set_quantity")
    conn = _ConnRaise()
    req = {"id": 11, "type": "haventory/item/set_quantity", "item_id": "x", "quantity": -1}

    res = await handler(hass, conn, req)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_returns_error_when_no_send_message_attribute() -> None:
    """If the connection lacks send_message, the error is still returned."""

    hass = ws_hass()

    handler = _get_handler(hass, "haventory/item/set_quantity")
    conn = _ConnNoSend()
    req = {"id": 12, "type": "haventory/item/set_quantity", "item_id": "x", "quantity": -1}

    res = await handler(hass, conn, req)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["haventory/item/list", "haventory/ping"])
async def test_a_command_answers_while_the_entry_is_loaded(command: str) -> None:
    """The happy path of the state check that replaced the emptied bucket."""

    hass = ws_hass()

    res = await ws_send(hass, 1, command)

    assert res["success"] is True, res


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["haventory/item/list", "haventory/ping"])
async def test_a_command_refuses_when_no_entry_exists(command: str) -> None:
    """Nothing to resolve a runtime through is the removed-integration case."""

    hass = HomeAssistant()
    ws_setup(hass)

    res = await ws_send(hass, 1, command)

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["haventory/item/list", "haventory/ping"])
async def test_a_command_refuses_while_the_entry_is_not_loaded(command: str) -> None:
    """An entry that exists but is unloaded or disabled serves nothing.

    The behavior `_require_loaded` used to get from an emptied bucket, restated
    against the source of truth that replaced it. The runtime is deliberately
    left attached: what refuses here is the *state*, not a missing object, which
    is exactly the disabled-entry case.
    """

    hass = ws_hass(state=ConfigEntryState.NOT_LOADED)

    res = await ws_send(hass, 1, command)

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
