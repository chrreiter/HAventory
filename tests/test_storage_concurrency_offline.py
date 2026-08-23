"""Tests for storage concurrency and locking.

Verifies that the persistence layer serializes writes to the one store file and
survives concurrent mutations.
"""

import asyncio
import logging
from unittest.mock import AsyncMock

import pytest
from custom_components.haventory.models import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore, async_persist_repo
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime


@pytest.mark.asyncio
async def test_persist_lock_prevents_concurrent_saves():
    """Concurrent persist calls are serialized by lock, preventing race conditions."""
    hass = HomeAssistant()

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
    install_runtime(hass, repository=repo, store=mock_store)

    # Launch multiple concurrent persist operations
    tasks = [async_persist_repo(hass) for _ in range(3)]
    await asyncio.gather(*tasks)

    # Verify operations were serialized (each completes before next starts)
    assert save_order == ["start", "end", "start", "end", "start", "end"]


@pytest.mark.asyncio
async def test_concurrent_operations_with_persistence():
    """Multiple concurrent operations complete successfully with locking."""
    hass = HomeAssistant()

    mock_store = AsyncMock(spec=DomainStore)
    mock_store.async_save = AsyncMock()

    repo = Repository()
    install_runtime(hass, repository=repo, store=mock_store)

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

    hass = HomeAssistant()

    mock_store = AsyncMock(spec=DomainStore)
    mock_store.async_save = AsyncMock()

    repo = Repository()
    install_runtime(hass, repository=repo, store=mock_store)

    await async_persist_repo(hass)

    # Check for timing logs
    assert any("Persisting repository state" in rec.message for rec in caplog.records)
    assert any("Repository persisted successfully" in rec.message for rec in caplog.records)
    # Check that elapsed_ms is in the extra dict of at least one record
    assert any(hasattr(rec, "elapsed_ms") for rec in caplog.records)
