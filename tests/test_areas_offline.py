"""Offline tests for area registry helper functions.

Validates read-only resolution of area names and ids using HA stubs.
"""

import pytest
from custom_components.haventory.areas import (
    async_get_area_registry,
    resolve_area_id_by_name,
    resolve_area_name,
)
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
async def test_resolve_area_name_returns_name_or_none() -> None:
    """resolve_area_name returns area name for known id; None otherwise."""

    hass = HomeAssistant()
    reg = await async_get_area_registry(hass)
    reg._add("living", "Living Room")  # type: ignore[attr-defined]

    assert await resolve_area_name(hass, "living") == "Living Room"
    assert await resolve_area_name(hass, "missing") is None
    assert await resolve_area_name(hass, None) is None
    assert await resolve_area_name(hass, "") is None


@pytest.mark.asyncio
async def test_resolve_area_id_by_name_exact_and_casefold() -> None:
    """resolve_area_id_by_name matches exact and case-insensitive names; None if unknown."""

    hass = HomeAssistant()
    reg = await async_get_area_registry(hass)
    reg._add("garage", "Garage")  # type: ignore[attr-defined]
    reg._add("office", "Home Office")  # type: ignore[attr-defined]

    # Exact
    assert await resolve_area_id_by_name(hass, "Garage") == "garage"
    # Case-insensitive via fallback scan
    assert await resolve_area_id_by_name(hass, "gArAgE") == "garage"
    assert await resolve_area_id_by_name(hass, "HOME OFFICE") == "office"
    # Unknown / empty
    assert await resolve_area_id_by_name(hass, "Basement") is None
    assert await resolve_area_id_by_name(hass, None) is None
    assert await resolve_area_id_by_name(hass, "") is None


@pytest.mark.asyncio
async def test_helpers_do_not_mutate_registry() -> None:
    """Helper lookups do not add, remove, or modify areas in the registry."""

    hass = HomeAssistant()
    reg = await async_get_area_registry(hass)
    reg._add("k1", "Kitchen")  # type: ignore[attr-defined]
    reg._add("k2", "Dining")  # type: ignore[attr-defined]

    before = {(a.id, a.name) for a in reg.async_list_areas()}

    # Perform various lookups
    assert await resolve_area_name(hass, "k1") == "Kitchen"
    assert await resolve_area_name(hass, "missing") is None
    assert await resolve_area_id_by_name(hass, "Dining") == "k2"
    assert await resolve_area_id_by_name(hass, "dining") == "k2"  # case-insensitive
    assert await resolve_area_id_by_name(hass, "unknown") is None

    after = {(a.id, a.name) for a in reg.async_list_areas()}
    assert after == before
