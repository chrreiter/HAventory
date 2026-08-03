"""Integration: a v4 store migrates to v5 on boot against real Home Assistant.

Seeds HA's storage backend with a payload written before the per-item ``status``
field existed, boots the integration, and confirms the on-disk store is v5 with
the field backfilled and ``haventory/health`` reporting healthy.
"""

from __future__ import annotations

import uuid

from custom_components.haventory.const import DOMAIN
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

ITEM_ID = str(uuid.uuid4())
FLAGGED_ITEM_ID = str(uuid.uuid4())


def _v4_store_data() -> dict:
    return {
        "schema_version": 4,
        "items": {
            ITEM_ID: {"id": ITEM_ID, "name": "Hammer", "quantity": 2},
            FLAGGED_ITEM_ID: {
                "id": FLAGGED_ITEM_ID,
                "name": "Drill",
                "quantity": 1,
                "status": "needs_repair",
            },
        },
        "locations": {},
    }


async def test_v4_store_boots_to_v5_with_status_backfilled(
    hass: HomeAssistant, hass_storage: dict, hass_ws_client
) -> None:
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": _v4_store_data()}

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # The migrated payload was persisted back to disk, not just held in memory.
    persisted = hass_storage[STORAGE_KEY]["data"]
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION
    assert persisted["items"][ITEM_ID]["status"] == "ok"
    assert persisted["items"][FLAGGED_ITEM_ID]["status"] == "needs_repair"

    # The running repository serves the backfilled items.
    repo = hass.data[DOMAIN]["repository"]
    assert repo.get_item(ITEM_ID).status == "ok"
    assert repo.get_item(FLAGGED_ITEM_ID).status == "needs_repair"

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/health"})
    health = await client.receive_json()
    assert health["success"] is True, health
    assert health["result"]["healthy"] is True
    assert health["result"]["issues"] == []
    assert health["result"]["counts"]["items_total"] == len(_v4_store_data()["items"])
    assert health["result"]["counts"]["needs_repair_count"] == 1
