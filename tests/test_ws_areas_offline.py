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

from ws_helpers import ws_send


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

    res = await ws_send(hass, 1, "haventory/areas/list")
    assert res["success"] is True and isinstance(res["result"].get("areas"), list)
    ids = {a["id"] for a in res["result"]["areas"]}
    assert ids == {"a1", "a2"}
