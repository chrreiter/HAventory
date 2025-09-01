"""Offline tests for HAventory bootstrap.

Scenarios:
- async_setup initializes hass.data[DOMAIN] without side effects
- async_setup_entry creates a Store in hass.data[DOMAIN]["store"]
"""

import pytest
from custom_components.haventory import async_setup, async_setup_entry
from custom_components.haventory.const import DOMAIN
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
