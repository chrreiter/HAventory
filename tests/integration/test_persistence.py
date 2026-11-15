"""Integration: persistence round-trips through the real HA Store.

Confirms a mutation is written through Home Assistant's ``Store`` backend and can
be read back by a fresh store instance — the real serialize/deserialize path,
not the offline in-memory stub. The unload flush and the reload after it are
here because only a real core sequences an entry's teardown around them.
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_persist_immediate,
)
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def test_store_write_and_reload_roundtrip(hass: HomeAssistant, hass_storage: dict) -> None:
    """An item survives a write to Store and a reload by a new store instance."""

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    quantity = 7
    repo = find_runtime(hass).repository
    created = repo.create_item({"name": "Flashlight", "quantity": quantity})

    # Persist synchronously through the real HA Store backend.
    await async_persist_immediate(hass)

    # The write landed in HA's storage backend (mocked by hass_storage).
    assert STORAGE_KEY in hass_storage
    persisted = hass_storage[STORAGE_KEY]["data"]
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION
    assert any(i["name"] == "Flashlight" for i in persisted["items"].values())

    # A brand-new store instance reads the same payload back off the backend.
    reloaded = await DomainStore(hass, key=STORAGE_KEY, version=CURRENT_SCHEMA_VERSION).async_load()
    assert reloaded["schema_version"] == CURRENT_SCHEMA_VERSION
    reloaded_item = reloaded["items"][str(created.id)]
    assert reloaded_item["name"] == "Flashlight"
    assert reloaded_item["quantity"] == quantity


async def test_the_unload_flush_reaches_the_store_it_is_giving_up(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """The last write lands, through the state transition that could have eaten it.

    Home Assistant marks the entry `UNLOAD_IN_PROGRESS` before calling
    `async_unload_entry` and deletes `runtime_data` only after it returns, so the
    teardown flush runs against an entry that is no longer `LOADED`. Only a real
    core sequences it that way; the offline suite can stage the state but not
    order it around HA's own call.
    """

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # Mutate the repository directly, so nothing has persisted it yet.
    find_runtime(hass).repository.create_item({"name": "Written on the way out"})

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert not hasattr(entry, "runtime_data")
    stored = hass_storage[STORAGE_KEY]["data"]
    assert [item["name"] for item in stored["items"].values()] == ["Written on the way out"]


async def test_setup_after_unload_reads_back_what_the_flush_wrote(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """The reload loop end to end: a fresh runtime holds the same inventory."""

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    first_runtime = find_runtime(hass)
    first_runtime.repository.create_item({"name": "Across the reload"})

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    second_runtime = find_runtime(hass)
    assert second_runtime is not first_runtime
    names = [item.name for item in second_runtime.repository.list_items()["items"]]
    assert names == ["Across the reload"]
