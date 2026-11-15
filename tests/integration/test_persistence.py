"""Integration: persistence round-trips through the real HA Store.

What a save writes, and the unload flush and the reload after it, which only a
real core sequences around an entry's teardown. What a failed save leaves
behind is in ``test_failed_save_undo.py``.
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    STORE_COLLECTIONS,
)
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def test_store_write_and_reload_roundtrip(
    hass: HomeAssistant, hass_storage: dict, setup_entry, ws_connect
) -> None:
    """A save writes every stored collection whole, and nothing beyond them and the stamp.

    A load keeps whatever the file holds, but a save writes only what the
    repository emits, so a collection the repository forgot to emit survives a
    restart and is erased by the first save after it, with nothing logged.
    """

    source = Repository()
    garage = source.create_location(name="Garage")
    source.create_item({"name": "Drill", "location_id": str(garage.id)})
    source.create_status({"slug": "lent_out", "label": "Lent out"})
    seeded = source.export_state()
    assert all(seeded[name] for name in STORE_COLLECTIONS), "seed every stored collection"

    entry = await setup_entry(stored=source)
    ws = await ws_connect()
    assert (await ws.send("haventory/item/create", name="Saw"))["success"] is True

    saved = hass_storage[STORAGE_KEY]["data"]
    assert set(saved) == {"schema_version", *STORE_COLLECTIONS}
    assert saved["schema_version"] == CURRENT_SCHEMA_VERSION
    for name in STORE_COLLECTIONS:
        assert set(saved[name]) >= set(seeded[name]), name

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    items = (await ws.send("haventory/item/list"))["result"]["items"]
    assert sorted(i["name"] for i in items) == ["Drill", "Saw"]
    statuses = (await ws.send("haventory/status/list"))["result"]
    assert "lent_out" in {s["slug"] for s in statuses}


async def test_the_unload_flush_reaches_the_store_it_is_giving_up(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """The last write lands, through the state transition that could have eaten it.

    Home Assistant marks the entry `UNLOAD_IN_PROGRESS` before calling
    `async_unload_entry` and deletes `runtime_data` only after it returns, so the
    teardown flush runs against an entry that is no longer `LOADED`. Only a real
    core sequences it that way.
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
