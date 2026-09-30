"""Offline tests for `ws_guard`: the error envelope and the loaded-entry refusal."""

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
    assert conn.last == res
    data = res["error"].get("data", {})
    assert data.get("op") == "item_set_quantity"
    assert data.get("quantity") == -1


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

    The runtime is deliberately left attached: what refuses here is the entry
    *state*, not a missing object, which is exactly the disabled-entry case.
    """

    hass = ws_hass(state=ConfigEntryState.NOT_LOADED)

    res = await ws_send(hass, 1, command)

    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
