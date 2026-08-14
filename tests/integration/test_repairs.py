"""Integration: the repairs issues and the guarded lossy load, against real Home Assistant.

None of this is observable offline. The offline harness has no issue registry to
read back, no repairs flow manager to run a fix through, and no config-entry
machinery to reload — so the whole point of the feature (a card appears, the
button works, the entry comes up) is asserted here or nowhere.
"""

from __future__ import annotations

import uuid

from custom_components.haventory.const import (
    CONF_ALLOW_LOSSY_LOAD,
    CORRUPT_BACKUP_STORAGE_KEY,
    DOMAIN,
    ISSUE_CORRUPT_STORE,
    ISSUE_SCHEMA_DOWNGRADE,
)
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.components.repairs import repairs_flow_manager
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

READABLE_ITEM_ID = str(uuid.uuid4())


def _stored(data: dict) -> dict:
    return {"version": 1, "key": STORAGE_KEY, "data": data}


def _corrupt_store_data() -> dict:
    """One item this build can read, one whose id is not a uuid and cannot be."""

    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": {
            READABLE_ITEM_ID: {"id": READABLE_ITEM_ID, "name": "Hammer", "quantity": 2},
            "not-a-uuid": {"id": "not-a-uuid", "name": "Broken"},
        },
        "locations": {},
    }


async def _added_entry(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    return entry


async def test_a_newer_store_leaves_a_non_fixable_issue(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """The refusal reaches Settings → Repairs, and the file it refuses is untouched."""

    stored = _stored({"schema_version": CURRENT_SCHEMA_VERSION + 1, "items": {}, "locations": {}})
    hass_storage[STORAGE_KEY] = stored
    before = dict(stored["data"])

    entry = await _added_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id) is False
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.SETUP_ERROR
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_SCHEMA_DOWNGRADE)
    assert issue is not None
    assert issue.is_fixable is False
    assert issue.severity is ir.IssueSeverity.ERROR
    assert hass_storage[STORAGE_KEY]["data"] == before


async def test_a_corrupt_row_offers_a_fix_that_backs_up_reloads_and_clears(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """The whole flow: refuse, offer, copy aside, opt in, reload, clear the card."""

    assert await async_setup_component(hass, "repairs", {})
    hass_storage[STORAGE_KEY] = _stored(_corrupt_store_data())

    entry = await _added_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id) is False
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.SETUP_ERROR
    issue = ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CORRUPT_STORE)
    assert issue is not None
    assert issue.is_fixable is True
    assert issue.translation_placeholders["items"] == "1"

    flow_manager = repairs_flow_manager(hass)
    assert flow_manager is not None
    result = await flow_manager.async_init(DOMAIN, data={"issue_id": ISSUE_CORRUPT_STORE})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "confirm"

    result = await flow_manager.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY

    # The copy is what makes the load reversible, and it holds the row the load
    # dropped — a cleaned-up copy would be worth nothing.
    backup = hass_storage[CORRUPT_BACKUP_STORAGE_KEY]["data"]
    assert backup["items"]["not-a-uuid"]["name"] == "Broken"

    assert entry.state is ConfigEntryState.LOADED
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CORRUPT_STORE) is None

    # Loaded with the readable remainder, and the opt-in spent rather than kept.
    repo = hass.data[DOMAIN]["repository"]
    assert repo.get_counts()["items_total"] == 1
    assert repo.get_item(READABLE_ITEM_ID).name == "Hammer"
    assert CONF_ALLOW_LOSSY_LOAD not in entry.options


async def test_a_clean_store_leaves_no_issue_behind(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """The control: nothing to refuse means nothing in Repairs."""

    hass_storage[STORAGE_KEY] = _stored(
        {
            "schema_version": CURRENT_SCHEMA_VERSION,
            "items": {READABLE_ITEM_ID: {"id": READABLE_ITEM_ID, "name": "Hammer"}},
            "locations": {},
        }
    )

    entry = await _added_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    registry = ir.async_get(hass)
    assert registry.async_get_issue(DOMAIN, ISSUE_SCHEMA_DOWNGRADE) is None
    assert registry.async_get_issue(DOMAIN, ISSUE_CORRUPT_STORE) is None
