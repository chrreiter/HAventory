"""Offline harness tests for HA stubs.

Covers:
- In-memory Store load/save round-trip
- WebSocket envelope helpers shape
- Area registry async_get lifecycle
"""

from __future__ import annotations

import asyncio

from homeassistant.components.websocket_api import error_message, result_message
from homeassistant.core import HomeAssistant
from homeassistant.helpers.area_registry import async_get
from homeassistant.helpers.storage import Store


def test_store_round_trip() -> None:
    """Store should persist values in-memory by key."""

    hass = HomeAssistant()
    store = Store(hass, 1, "haventory")

    async def _run():
        assert await store.async_load() is None
        await store.async_save({"a": 1})
        assert await store.async_load() == {"a": 1}

    asyncio.run(_run())


def test_websocket_envelope_helpers() -> None:
    """result_message and error_message match roadmap envelope."""

    ok = result_message(7, {"ok": True})
    assert ok == {"id": 7, "type": "result", "success": True, "result": {"ok": True}}

    err = error_message(9, "validation_error", "bad input", {"field": "name"})
    assert err == {
        "id": 9,
        "type": "result",
        "success": False,
        "error": {"code": "validation_error", "message": "bad input", "data": {"field": "name"}},
    }


def test_area_registry_lifecycle() -> None:
    """async_get returns a stable in-memory registry stored on hass.data."""

    async def _run():
        hass = HomeAssistant()
        reg1 = await async_get(hass)
        reg1._add("kitchen", "Kitchen")  # type: ignore[attr-defined]

        reg2 = await async_get(hass)
        assert reg2.async_get_area("kitchen").name == "Kitchen"  # type: ignore[union-attr]

    asyncio.run(_run())
