"""Offline tests for HAventory bootstrap.

Scenarios:
- async_setup initializes hass.data[DOMAIN] without side effects
- async_setup_entry creates a Store in hass.data[DOMAIN]["store"]
"""

import pytest
from custom_components.haventory import async_setup, async_setup_entry
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant


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
async def test_async_setup_entry_exposes_store_on_domain_bucket() -> None:
    """async_setup_entry populates hass.data[DOMAIN]["store"]."""

    # Arrange
    hass = HomeAssistant()

    class _DummyEntry(ConfigEntry):
        pass

    entry = _DummyEntry()

    # Act
    result = await async_setup_entry(hass, entry)

    # Assert
    assert result is True
    assert DOMAIN in hass.data
    assert isinstance(hass.data[DOMAIN], dict)
    assert "store" in hass.data[DOMAIN]


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

    entry = _DummyEntry()
    ok = await async_setup_entry(hass, entry)
    assert ok is True

    # Repository is hydrated
    repo = hass.data[DOMAIN]["repository"]
    assert repo.get_item(item.id).name == "SeedItem"

    # And WS commands are registered and can read the same item
    handlers = hass.data.get("__ws_commands__", [])

    async def _send(_id: int, type_: str, **payload):
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

    res = await _send(1, "haventory/item/get", item_id=item.id)
    assert res["success"] is True and res["result"]["id"] == item.id
