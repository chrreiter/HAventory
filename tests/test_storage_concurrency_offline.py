"""Tests for storage concurrency, locking, and debouncing.

Verifies that the persistence layer correctly handles concurrent operations,
prevents race conditions, and properly debounces rapid changes.
"""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

import pytest
from custom_components.haventory import storage as storage_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.models import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import (
    PERSIST_DEBOUNCE_DELAY,
    DomainStore,
    async_persist_immediate,
    async_persist_repo,
    async_request_persist,
)
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

# Named constants for test assertions
RAPID_MUTATION_COUNT = 3


@pytest.mark.asyncio
async def test_persist_lock_prevents_concurrent_saves():
    """Concurrent persist calls are serialized by lock, preventing race conditions."""
    hass = MagicMock()
    hass.data = {"haventory": {}}

    # Create a mock store with artificial delay to simulate slow I/O
    mock_store = AsyncMock(spec=DomainStore)
    save_order = []

    async def slow_save(data):
        """Simulate slow save operation."""
        save_order.append("start")
        await asyncio.sleep(0.05)  # 50ms delay
        save_order.append("end")

    mock_store.async_save = slow_save

    # Create repository and store
    repo = Repository()
    hass.data["haventory"]["store"] = mock_store
    hass.data["haventory"]["repository"] = repo

    # Launch multiple concurrent persist operations
    tasks = [async_persist_repo(hass) for _ in range(3)]
    await asyncio.gather(*tasks)

    # Verify operations were serialized (each completes before next starts)
    assert save_order == ["start", "end", "start", "end", "start", "end"]


@pytest.mark.asyncio
async def test_debounce_coalesces_rapid_changes():
    """Rapid persist requests are coalesced into a single save operation."""
    hass = MagicMock()
    hass.data = {"haventory": {}}

    # Create mock store that counts save calls
    mock_store = AsyncMock(spec=DomainStore)
    save_count = []

    async def count_save(data):
        save_count.append(1)

    mock_store.async_save = count_save

    # Create repository and store
    repo = Repository()
    hass.data["haventory"]["store"] = mock_store
    hass.data["haventory"]["repository"] = repo

    # Request multiple rapid persists
    for _ in range(10):
        await async_request_persist(hass)
        await asyncio.sleep(0.01)  # 10ms between requests

    # Wait for debounce delay plus buffer
    await asyncio.sleep(PERSIST_DEBOUNCE_DELAY + 0.2)

    # Should have only saved once (all requests coalesced)
    assert len(save_count) == 1


@pytest.mark.asyncio
async def test_debounce_cancels_pending_task():
    """New persist request cancels previous pending task."""
    hass = MagicMock()
    hass.data = {"haventory": {}}

    mock_store = AsyncMock(spec=DomainStore)
    mock_store.async_save = AsyncMock()

    repo = Repository()
    hass.data["haventory"]["store"] = mock_store
    hass.data["haventory"]["repository"] = repo

    # Request first persist
    await async_request_persist(hass)
    first_task = hass.data["haventory"].get("persist_task")
    assert first_task is not None
    assert not first_task.done()

    # Request second persist before first completes
    await asyncio.sleep(0.1)  # Wait a bit but not full delay
    await async_request_persist(hass)
    second_task = hass.data["haventory"].get("persist_task")

    # Give time for cancellation to propagate
    await asyncio.sleep(0.01)

    # First task should be cancelled or done
    assert first_task.cancelled() or first_task.done()
    assert second_task is not first_task


@pytest.mark.asyncio
async def test_immediate_persist_bypasses_debounce():
    """Immediate persist cancels pending debounced task and saves immediately."""
    hass = MagicMock()
    hass.data = {"haventory": {}}

    mock_store = AsyncMock(spec=DomainStore)
    save_times = []

    async def record_save(data):
        save_times.append(asyncio.get_event_loop().time())

    mock_store.async_save = record_save

    repo = Repository()
    hass.data["haventory"]["store"] = mock_store
    hass.data["haventory"]["repository"] = repo

    # Request debounced persist
    start_time = asyncio.get_event_loop().time()
    await async_request_persist(hass)

    # Immediately request immediate persist
    await asyncio.sleep(0.1)
    await async_persist_immediate(hass)

    # Should have saved immediately, not after debounce delay
    elapsed = save_times[0] - start_time
    assert elapsed < PERSIST_DEBOUNCE_DELAY


@pytest.mark.asyncio
async def test_generation_counter_increments_on_modification():
    """Repository generation counter increments on every state modification."""
    repo = Repository()
    initial_gen = repo.generation

    # Create item should increment generation
    item = repo.create_item(ItemCreate(name="Test Item"))
    gen_after_create = repo.generation
    assert gen_after_create > initial_gen

    # Update item should increment generation (updates call _reindex which unindexes + indexes)
    repo.update_item(item.id, ItemUpdate(quantity=5))
    gen_after_update = repo.generation
    assert gen_after_update > gen_after_create

    # Delete item should increment generation
    repo.delete_item(item.id)
    assert repo.generation > gen_after_update


@pytest.mark.asyncio
async def test_generation_persisted_and_restored():
    """Generation counter is persisted and restored across save/load cycles."""
    repo = Repository()

    # Make some modifications
    repo.create_item(ItemCreate(name="Item 1"))
    repo.create_item(ItemCreate(name="Item 2"))
    generation_before = repo.generation

    # Export state
    state = repo.export_state()
    assert state["_generation"] == generation_before

    # Create new repo and load state
    new_repo = Repository.from_state(state)

    # Generation should be restored and incremented during load
    # (load calls _index_item for each item, incrementing generation)
    assert new_repo.generation > generation_before


@pytest.mark.asyncio
async def test_concurrent_operations_with_persistence():
    """Multiple concurrent operations complete successfully with locking."""
    hass = MagicMock()
    hass.data = {"haventory": {}}

    mock_store = AsyncMock(spec=DomainStore)
    mock_store.async_save = AsyncMock()

    repo = Repository()
    hass.data["haventory"]["store"] = mock_store
    hass.data["haventory"]["repository"] = repo

    # Create initial items
    items = [repo.create_item(ItemCreate(name=f"Item {i}")) for i in range(10)]

    async def update_and_persist(item_id, quantity):
        """Update an item and persist."""
        repo.update_item(item_id, ItemUpdate(quantity=quantity))
        await async_persist_repo(hass)

    # Launch concurrent updates
    tasks = [update_and_persist(items[i].id, i * 10) for i in range(10)]
    await asyncio.gather(*tasks)

    # Verify all items were updated correctly
    for i, item in enumerate(items):
        updated = repo.get_item(item.id)
        assert updated.quantity == i * 10

    # Verify persist was called (at least once, possibly more due to concurrency)
    assert mock_store.async_save.call_count >= 1


@pytest.mark.asyncio
async def test_persist_with_timing_logs(caplog):
    """Persistence operations log timing information for debugging."""
    caplog.set_level(logging.DEBUG)

    hass = MagicMock()
    hass.data = {"haventory": {}}

    mock_store = AsyncMock(spec=DomainStore)
    mock_store.async_save = AsyncMock()

    repo = Repository()
    hass.data["haventory"]["store"] = mock_store
    hass.data["haventory"]["repository"] = repo

    await async_persist_repo(hass)

    # Check for timing logs
    assert any("Persisting repository state" in rec.message for rec in caplog.records)
    assert any("Repository persisted successfully" in rec.message for rec in caplog.records)
    # Check that elapsed_ms is in the extra dict of at least one record
    assert any(hasattr(rec, "elapsed_ms") for rec in caplog.records)


@pytest.mark.asyncio
async def test_debounce_request_logs(caplog):
    """Debounced persist requests log appropriately."""
    caplog.set_level(logging.DEBUG)

    hass = MagicMock()
    hass.data = {"haventory": {}}

    mock_store = AsyncMock(spec=DomainStore)
    mock_store.async_save = AsyncMock()

    repo = Repository()
    hass.data["haventory"]["store"] = mock_store
    hass.data["haventory"]["repository"] = repo

    await async_request_persist(hass)

    # Check for debounce logs
    assert any("Persist requested, debouncing" in rec.message for rec in caplog.records)


# -----------------------------------------------------------------------------
# Integration test: verify WS handlers use immediate persistence for error propagation
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ws_mutations_use_immediate_persistence(monkeypatch):
    """WS mutations use immediate persistence to ensure storage errors propagate.

    Verifies that each WS mutation triggers an immediate persist (async_persist_repo),
    not debounced persistence. This ensures @ws_guard can catch and report StorageError.
    """
    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    # Track calls to async_persist_repo (immediate)
    immediate_calls: list[bool] = []

    async def track_immediate(h):
        immediate_calls.append(True)

    monkeypatch.setattr(storage_mod, "async_persist_repo", track_immediate)

    # Helper to send WS commands
    async def _send(_id: int, type_: str, **payload):
        handlers = hass.data.get("__ws_commands__", [])
        for h in handlers:
            schema = getattr(h, "_ws_schema", None)
            if not callable(h) or not isinstance(schema, dict):
                continue
            if schema.get("type") != type_:
                continue
            req = {"id": _id, "type": type_}
            req.update(payload)
            return await h(hass, None, req)
        raise AssertionError("No handler responded for type " + type_)

    # Execute multiple WS mutations
    await _send(1, "haventory/item/create", name="Item 1")
    await _send(2, "haventory/item/create", name="Item 2")
    await _send(3, "haventory/item/create", name="Item 3")

    # Each WS mutation should trigger an immediate persist
    assert len(immediate_calls) == RAPID_MUTATION_COUNT
    assert len(immediate_calls) > 0, "WS must use immediate persistence for error propagation"
