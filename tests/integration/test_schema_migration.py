"""Integration: the schema crossing against real Home Assistant.

Seeds HA's storage backend with a store stamped by a build from before the
schema was collapsed, boots the integration, and confirms the on-disk store is
v1 with the fields filled in and ``haventory/health`` reporting healthy. The
second case is the other half of the same decision: a store stamped above the
amnesty stops setup with `ConfigEntryError` and is left exactly as it was —
abort instead of retry is HA's own dispatch, which the offline stub cannot show.
"""

from __future__ import annotations

import uuid
from copy import deepcopy

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.migrations import ADOPTABLE_SCHEMA_VERSIONS
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

ITEM_ID = str(uuid.uuid4())
FLAGGED_ITEM_ID = str(uuid.uuid4())

#: One above everything the amnesty covers: a store no build of this project wrote.
BEYOND_THE_ADOPTABLE_RANGE = max(ADOPTABLE_SCHEMA_VERSIONS) + 1


def _store_data(schema_version: int) -> dict:
    """A store as a build before the collapse wrote it: no status, no statuses."""

    return {
        "schema_version": schema_version,
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


@pytest.mark.parametrize("stored_version", sorted(ADOPTABLE_SCHEMA_VERSIONS))
async def test_a_store_from_before_the_collapse_boots_at_v1(
    hass: HomeAssistant, hass_storage: dict, hass_ws_client, stored_version: int
) -> None:
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": _store_data(stored_version),
    }

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # The adopted payload was persisted back to disk, not just held in memory.
    persisted = hass_storage[STORAGE_KEY]["data"]
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION
    assert persisted["items"][ITEM_ID]["status"] == "ok"
    assert persisted["items"][FLAGGED_ITEM_ID]["status"] == "needs_repair"
    assert sorted(persisted["statuses"]) == ["missing", "needs_repair", "ok"]

    # The running repository serves the items it read.
    repo = find_runtime(hass).repository
    assert repo.get_item(ITEM_ID).status == "ok"
    assert repo.get_item(FLAGGED_ITEM_ID).status == "needs_repair"

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/health"})
    health = await client.receive_json()
    assert health["success"] is True, health
    assert health["result"]["healthy"] is True
    assert health["result"]["issues"] == []
    assert health["result"]["counts"]["items_total"] == len(_store_data(1)["items"])
    assert health["result"]["counts"]["needs_repair_count"] == 1


async def test_a_store_above_the_amnesty_stops_setup_and_is_left_alone(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    stored = _store_data(BEYOND_THE_ADOPTABLE_RANGE)
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": deepcopy(stored)}

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # ConfigEntryError, so HA stops instead of retrying forever, and the message
    # names both numbers in the entry's error state.
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert str(BEYOND_THE_ADOPTABLE_RANGE) in entry.reason
    assert f"({CURRENT_SCHEMA_VERSION})" in entry.reason

    # Refusing means refusing to write: the file is what it was.
    assert hass_storage[STORAGE_KEY]["data"] == stored
