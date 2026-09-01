"""Tests for storage concurrency and locking.

Verifies that the persistence layer serializes writes to the one store file and
survives concurrent mutations.
"""

import asyncio
import logging
from unittest.mock import AsyncMock

import pytest
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

    repo = Repository()
    install_runtime(hass, repository=repo, store=mock_store)

    tasks = [async_persist_repo(hass) for _ in range(3)]
    await asyncio.gather(*tasks)

    # Verify operations were serialized (each completes before next starts)
    assert save_order == ["start", "end", "start", "end", "start", "end"]


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

    assert any("Persisting repository state" in rec.message for rec in caplog.records)
    assert any("Repository persisted successfully" in rec.message for rec in caplog.records)
    assert any(hasattr(rec, "elapsed_ms") for rec in caplog.records)
