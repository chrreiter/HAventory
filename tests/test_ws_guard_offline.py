"""Offline tests for ws_guard error handling behavior.

Scenarios:
- handlers return the error envelope while also attempting to send it
- send_message raising does not prevent returning the error envelope
- missing send_message still returns the error envelope
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


def _get_handler(
    hass: HomeAssistant, type_: str
) -> Callable[[HomeAssistant, object, dict], Coroutine[Any, Any, dict]]:
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        schema = getattr(h, "_ws_schema", None)
        if not callable(h) or not isinstance(schema, dict):
            continue
        if schema.get("type") == type_:
            return h
    raise AssertionError("No handler found for type " + type_)


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

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

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

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    handler = _get_handler(hass, "haventory/item/set_quantity")
    conn = _ConnRaise()
    req = {"id": 11, "type": "haventory/item/set_quantity", "item_id": "x", "quantity": -1}

    res = await handler(hass, conn, req)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_returns_error_when_no_send_message_attribute() -> None:
    """If the connection lacks send_message, the error is still returned."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    handler = _get_handler(hass, "haventory/item/set_quantity")
    conn = _ConnNoSend()
    req = {"id": 12, "type": "haventory/item/set_quantity", "item_id": "x", "quantity": -1}

    res = await handler(hass, conn, req)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
