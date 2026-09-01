"""Integration: the two schema refusals against real Home Assistant.

Seeds HA's storage backend with a store this build will not read — one stamped
before the schema was collapsed, one stamped above every number this project
ever used — and confirms each stops setup with `ConfigEntryError`, carrying the
wording that names its own way out, with the file left exactly as it was. Abort
instead of retry is HA's own dispatch, which the offline stub cannot show.
"""

from __future__ import annotations

import uuid
from copy import deepcopy

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.migrations import PRE_COLLAPSE_SCHEMA_VERSIONS
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

ITEM_ID = str(uuid.uuid4())
FLAGGED_ITEM_ID = str(uuid.uuid4())

#: One above every stamp this project used before the collapse: a store only a
#: genuinely newer build could have written.
FROM_A_NEWER_BUILD = max(PRE_COLLAPSE_SCHEMA_VERSIONS) + 1


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


@pytest.mark.parametrize("stored_version", sorted(PRE_COLLAPSE_SCHEMA_VERSIONS))
async def test_a_store_from_before_the_collapse_stops_setup_and_is_left_alone(
    hass: HomeAssistant, hass_storage: dict, stored_version: int
) -> None:
    stored = _store_data(stored_version)
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": deepcopy(stored)}

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # The entry's error state is where a user reads it, and what it names is the
    # build that can still open this file rather than one that never will.
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert str(stored_version) in entry.reason
    assert "0.8" in entry.reason
    assert "Upgrade HAventory" not in entry.reason

    assert hass_storage[STORAGE_KEY]["data"] == stored


async def test_a_store_from_a_newer_build_stops_setup_and_is_left_alone(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    stored = _store_data(FROM_A_NEWER_BUILD)
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": deepcopy(stored)}

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # ConfigEntryError, so HA stops instead of retrying forever, and the message
    # names both numbers in the entry's error state.
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert str(FROM_A_NEWER_BUILD) in entry.reason
    assert f"({CURRENT_SCHEMA_VERSION})" in entry.reason

    # Refusing means refusing to write: the file is what it was.
    assert hass_storage[STORAGE_KEY]["data"] == stored
