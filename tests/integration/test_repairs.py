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
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.components.repairs import repairs_flow_manager
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import issue_registry as ir
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

READABLE_ITEM_ID = str(uuid.uuid4())
NAMELESS_ITEM_ID = str(uuid.uuid4())


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
    repo = find_runtime(hass).repository
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


async def test_the_repair_survives_a_restart_with_no_mutation_in_between(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """A household that repairs and then restarts must not land back at the refusal.

    The lossy load leaves the unreadable rows on disk unless something writes the
    store, and nothing does until the next edit — so a repair that visibly worked
    came undone at the next start-up, with the backup file the only sign it ran.
    """

    assert await async_setup_component(hass, "repairs", {})
    hass_storage[STORAGE_KEY] = _stored(_corrupt_store_data())

    entry = await _added_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id) is False
    await hass.async_block_till_done()

    flow_manager = repairs_flow_manager(hass)
    assert flow_manager is not None
    result = await flow_manager.async_init(DOMAIN, data={"issue_id": ISSUE_CORRUPT_STORE})
    result = await flow_manager.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY

    # The file now holds what was loaded, and the row it lost is in the copy.
    assert set(hass_storage[STORAGE_KEY]["data"]["items"]) == {READABLE_ITEM_ID}
    assert "not-a-uuid" in hass_storage[CORRUPT_BACKUP_STORAGE_KEY]["data"]["items"]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_setup(entry.entry_id) is True
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CORRUPT_STORE) is None
    assert find_runtime(hass).repository.get_counts()["items_total"] == 1


async def test_a_clean_load_spends_an_opt_in_left_on_the_entry(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """Where the waiver lingers is where it is most dangerous.

    A backup restored by hand before the button is pressed, or a boot after the
    flow's own reload failed, both land on a store that reads fine — and an
    opt-in left armed there is spent by the *next* corruption, which then loads
    with no copy taken and no card raised.
    """

    hass_storage[STORAGE_KEY] = _stored(
        {
            "schema_version": CURRENT_SCHEMA_VERSION,
            "items": {READABLE_ITEM_ID: {"id": READABLE_ITEM_ID, "name": "Hammer"}},
            "locations": {},
        }
    )

    entry = MockConfigEntry(
        domain=DOMAIN, data={}, title="HAventory", options={CONF_ALLOW_LOSSY_LOAD: True}
    )
    entry.add_to_hass(hass)

    assert await hass.config_entries.async_setup(entry.entry_id) is True
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert CONF_ALLOW_LOSSY_LOAD not in entry.options


async def test_a_row_with_no_name_reaches_the_repairs_card_and_its_fix(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """A stored ``"name": null`` is corruption, and behaves like every other kind.

    It used to load: ``str(None)`` produced an item literally called ``"None"``,
    which no write path could have created and which the next edit would have
    made permanent. Now it is refused — and the point of asserting that here
    rather than offline is that nothing about the *consequences* is visible
    offline: whether an issue is actually registered, whether the fix flow runs,
    and whether the entry comes back up with the readable remainder.
    """

    assert await async_setup_component(hass, "repairs", {})
    hass_storage[STORAGE_KEY] = _stored(
        {
            "schema_version": CURRENT_SCHEMA_VERSION,
            "items": {
                READABLE_ITEM_ID: {"id": READABLE_ITEM_ID, "name": "Hammer", "quantity": 2},
                NAMELESS_ITEM_ID: {"id": NAMELESS_ITEM_ID, "name": None, "quantity": 1},
            },
            "locations": {},
        }
    )

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
    result = await flow_manager.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY

    assert entry.state is ConfigEntryState.LOADED
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CORRUPT_STORE) is None

    repo = find_runtime(hass).repository
    assert repo.get_counts()["items_total"] == 1
    assert repo.get_item(READABLE_ITEM_ID).name == "Hammer"
    # The dropped row survives in the copy, with its name still null — a backup
    # that had "repaired" it to something would be worth nothing.
    backup = hass_storage[CORRUPT_BACKUP_STORAGE_KEY]["data"]
    assert backup["items"][NAMELESS_ITEM_ID]["name"] is None


async def test_a_stored_name_over_the_cap_is_not_corruption(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """The refusal blocks setup, so what it refuses has to be exactly right.

    The load path checks non-emptiness and not the 120-character cap. An
    over-cap name predates the cap and is data this integration itself wrote;
    refusing it would put a household's whole instance behind a Repairs card
    for a name that is merely long.
    """

    hass_storage[STORAGE_KEY] = _stored(
        {
            "schema_version": CURRENT_SCHEMA_VERSION,
            "items": {READABLE_ITEM_ID: {"id": READABLE_ITEM_ID, "name": "L" * 400}},
            "locations": {},
        }
    )

    entry = await _added_entry(hass)
    assert await hass.config_entries.async_setup(entry.entry_id) is True
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert ir.async_get(hass).async_get_issue(DOMAIN, ISSUE_CORRUPT_STORE) is None
    assert find_runtime(hass).repository.get_item(READABLE_ITEM_ID).name == "L" * 400
