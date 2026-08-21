"""Integration: persistence round-trips through the real HA Store.

Confirms a mutation is written through Home Assistant's ``Store`` backend and can
be read back by a fresh store instance — the real serialize/deserialize path,
not the offline in-memory stub.

The debounced write is here for a sharper reason. ``async_request_persist``
schedules through ``hass.async_create_background_task`` precisely so Home
Assistant holds the task and cancels it at shutdown; the offline stub forwards
that call to a plain ``asyncio`` task, which nothing tracks, so the property the
scheduling exists for is the one offline tests cannot see.
"""

from __future__ import annotations

import asyncio
import logging

from custom_components.haventory import storage as storage_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_persist_immediate,
    async_request_persist,
)
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

# Short enough that a test can wait it out, long enough that the assertion
# taken before it elapses is not a race. The debounce rides ``asyncio.sleep``
# rather than Home Assistant's clock helpers, so ``async_fire_time_changed``
# would not move it — a real, shortened delay is the honest way to drive it.
SHORT_DEBOUNCE = 0.05

# Longer than any of these tests take, so a debounce scheduled with it can only
# end by being cancelled — never by firing on its own.
UNREACHABLE_DEBOUNCE = 300.0


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


async def test_a_debounced_persist_lands_in_the_store_only_after_its_window(
    hass: HomeAssistant, hass_storage: dict, monkeypatch
) -> None:
    """The window is a window: nothing is written until it elapses, then it is.

    A debounce that wrote immediately would pass every "the data is on disk"
    assertion while coalescing nothing, so both halves are asserted here.
    """

    monkeypatch.setattr(storage_mod, "PERSIST_DEBOUNCE_DELAY", SHORT_DEBOUNCE)

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # Straight onto the repository, so only the debounce can carry it to disk.
    find_runtime(hass).repository.create_item({"name": "Debounced"})
    await async_request_persist(hass)

    pending = find_runtime(hass).persist_task
    assert pending is not None
    # Home Assistant is holding it. That is what makes shutdown cancel and await
    # the task instead of destroying it while pending, and it is exactly what
    # the offline stub's untracked `asyncio.create_task` cannot show.
    assert pending in hass._background_tasks

    assert STORAGE_KEY not in hass_storage

    await asyncio.sleep(SHORT_DEBOUNCE * 4)

    assert pending.done()
    stored = hass_storage[STORAGE_KEY]["data"]
    assert [item["name"] for item in stored["items"].values()] == ["Debounced"]


async def test_the_unload_flush_beats_a_debounce_that_has_not_fired(
    hass: HomeAssistant, hass_storage: dict, monkeypatch, caplog
) -> None:
    """Teardown writes the mutation and leaves no task behind to write it again.

    With a debounce this long the only way the item reaches the store is the
    teardown flush, and the only way the task can be finished afterwards is
    cancellation — so a green run says both happened, in that order.
    """

    monkeypatch.setattr(storage_mod, "PERSIST_DEBOUNCE_DELAY", UNREACHABLE_DEBOUNCE)
    caplog.set_level(logging.DEBUG, logger="custom_components.haventory.storage")

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    find_runtime(hass).repository.create_item({"name": "Flushed past the debounce"})
    await async_request_persist(hass)
    pending = find_runtime(hass).persist_task
    assert pending is not None

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    # Finished, without having reached the end of a five-minute sleep. The task
    # swallows its own cancellation and returns normally, so the log line is
    # what names the way it ended.
    assert pending.done()
    assert pending.exception() is None
    assert any("op=persist_immediate_cancel" in record.getMessage() for record in caplog.records)

    stored = hass_storage[STORAGE_KEY]["data"]
    assert [item["name"] for item in stored["items"].values()] == ["Flushed past the debounce"]
