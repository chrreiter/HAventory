"""Offline tests for HAventory bootstrap.

Scenarios:
- async_setup initializes hass.data[DOMAIN] without side effects
- async_setup_entry creates a Store in runtime_of(hass).store
"""

import pytest
from custom_components.haventory import async_setup
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from runtime_helpers import repo_of, runtime_of, setup_entry
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_async_setup_initializes_domain_bucket() -> None:
    """async_setup initializes hass.data[DOMAIN]."""

    # Arrange
    hass = HomeAssistant()

    # Act
    result = await async_setup(hass, {})

    # Assert
    assert result is True
    assert DOMAIN in hass.data
    assert isinstance(hass.data[DOMAIN], dict)


@pytest.mark.asyncio
async def test_async_setup_entry_puts_the_runtime_on_the_entry() -> None:
    """Setup builds the runtime and hands it to Home Assistant, not to a dict."""

    hass = HomeAssistant()

    class _DummyEntry(ConfigEntry):
        pass

    entry = await setup_entry(hass, _DummyEntry())

    assert isinstance(entry.runtime_data.store, DomainStore)
    assert isinstance(entry.runtime_data.repository, Repository)
    assert runtime_of(hass) is entry.runtime_data


@pytest.mark.asyncio
async def test_async_setup_entry_loads_repository_from_store_and_ws_reads() -> None:
    """async_setup_entry loads repo from DomainStore and WS reads succeed."""

    hass = HomeAssistant()
    # Pre-populate store with a small dataset via Repository.export_state
    seed_repo = Repository()
    loc = seed_repo.create_location(name="SeedRoot")
    item = seed_repo.create_item({"name": "SeedItem", "location_id": loc.id})
    seed_store = DomainStore(hass)
    await seed_store.async_save(seed_repo.export_state())

    class _DummyEntry(ConfigEntry):
        pass

    await setup_entry(hass, _DummyEntry())

    # Repository is hydrated
    repo = repo_of(hass)
    assert repo.get_item(item.id).name == "SeedItem"

    # And WS commands are registered and can read the same item
    res = await ws_send(hass, 1, "haventory/item/get", item_id=item.id)
    assert res["success"] is True and res["result"]["id"] == str(item.id)
