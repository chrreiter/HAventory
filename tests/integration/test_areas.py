"""Integration: haventory/areas/list reads the real HA area registry.

The offline suite fakes the area registry; this proves the integration reads the
genuine ``homeassistant.helpers.area_registry`` and returns its entries over the
WebSocket API.
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def test_areas_list_reads_real_registry(hass: HomeAssistant, hass_ws_client) -> None:
    """An area created in the real registry appears in haventory/areas/list."""

    area_reg = ar.async_get(hass)
    created = area_reg.async_create("Garage")

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/areas/list"})
    resp = await client.receive_json()

    assert resp["success"] is True, resp
    areas = resp["result"]["areas"]
    by_id = {a["id"]: a["name"] for a in areas}
    assert by_id.get(created.id) == "Garage"
