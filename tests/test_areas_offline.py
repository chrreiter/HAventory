"""Offline tests for area registry helper functions.

Validates read-only access to the area registry using HA stubs.
"""

import pytest
from custom_components.haventory.areas import async_get_area_registry
from homeassistant.core import HomeAssistant


@pytest.mark.asyncio
async def test_async_get_area_registry_reuses_singleton() -> None:
    """Registry returned is stable per hass instance, and reflects mutations."""

    hass = HomeAssistant()

    reg1 = await async_get_area_registry(hass)
    reg1._add("kitchen", "Kitchen")  # type: ignore[attr-defined]

    reg2 = await async_get_area_registry(hass)
    assert reg1 is reg2
    assert reg2.async_get_area("kitchen").name == "Kitchen"  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_registry_lookups_do_not_mutate_registry() -> None:
    """Read-only lookups do not add, remove, or modify areas in the registry."""

    hass = HomeAssistant()
    reg = await async_get_area_registry(hass)
    reg._add("k1", "Kitchen")  # type: ignore[attr-defined]
    reg._add("k2", "Dining")  # type: ignore[attr-defined]

    before = {(a.id, a.name) for a in reg.async_list_areas()}

    assert reg.async_get_area("k1").name == "Kitchen"
    assert reg.async_get_area("missing") is None

    after = {(a.id, a.name) for a in reg.async_list_areas()}
    assert after == before
