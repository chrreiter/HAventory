"""Offline tests for haventory WebSocket areas commands.

Scenarios:
- areas/list returns registry areas (id, name) from HA stubs.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.areas import async_get_area_registry
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        schema = getattr(h, "_ws_schema", None)
        if not callable(h) or not isinstance(schema, dict):
            continue
        if schema.get("type") != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        resp = await h(hass, None, req)
        return resp
    raise AssertionError("No handler responded for type " + type_)


@pytest.mark.asyncio
async def test_ws_areas_list_returns_registry_entries() -> None:
    """areas/list returns {areas:[{id,name}]} populated from registry."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Seed HA's area registry stub
    reg = await async_get_area_registry(hass)
    reg._add("a1", "Garage")  # type: ignore[attr-defined]
    reg._add("a2", "Office")  # type: ignore[attr-defined]

    res = await _send(hass, 1, "haventory/areas/list")
    assert res["success"] is True and isinstance(res["result"].get("areas"), list)
    ids = {a["id"] for a in res["result"]["areas"]}
    assert ids == {"a1", "a2"}
