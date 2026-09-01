"""Offline tests for haventory WebSocket areas commands.

Scenarios:
- areas/list returns registry areas (id, name) from HA stubs.
"""

from __future__ import annotations

import pytest
from homeassistant.helpers import area_registry as ar

from runtime_helpers import ws_hass
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_ws_areas_list_returns_registry_entries() -> None:
    """areas/list returns {areas:[{id,name}]} populated from registry."""

    hass = ws_hass()

    # Seed HA's area registry stub
    reg = ar.async_get(hass)
    reg._add("a1", "Garage")  # type: ignore[attr-defined]
    reg._add("a2", "Office")  # type: ignore[attr-defined]

    res = await ws_send(hass, 1, "haventory/areas/list")
    assert res["success"] is True and isinstance(res["result"].get("areas"), list)
    ids = {a["id"] for a in res["result"]["areas"]}
    assert ids == {"a1", "a2"}
