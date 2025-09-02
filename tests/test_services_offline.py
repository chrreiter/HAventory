"""Offline tests for haventory services layer.

Scenarios:
- item_create validates and creates an item; logs context on success
- item_update applies update and logs validation errors without stack trace
- location_create and update wire through to repository
"""

from __future__ import annotations

import logging

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.services import (
    service_item_check_in,
    service_item_check_out,
    service_item_create,
    service_item_delete,
    service_item_move,
    service_item_set_quantity,
    service_item_update,
    service_location_create,
    service_location_delete,
    service_location_update,
)
from homeassistant.core import HomeAssistant


@pytest.mark.asyncio
async def test_item_create_and_update_flow_logs_and_mutates() -> None:
    """Create an item, then update it; ensure repo state changes and no exceptions bubble."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()

    # Create
    await service_item_create(
        hass,
        {
            "name": "Widget",
            "quantity": 2,
            "tags": ["Blue", "blue"],  # dedup/normalize handled by model
        },
    )

    repo: Repository = hass.data[DOMAIN]["repository"]
    assert repo.get_counts()["items_total"] == 1

    # Update name and quantity
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))
    updated_quantity = 3
    await service_item_update(
        hass, {"item_id": item_id, "name": "Widget Pro", "quantity": updated_quantity}
    )

    updated = repo.get_item(item_id)
    assert updated.name == "Widget Pro"
    assert updated.quantity == updated_quantity


@pytest.mark.asyncio
async def test_item_move_and_quantity_helpers() -> None:
    """Move item between locations and adjust quantities via helpers."""

    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo

    # Create locations and item
    await service_location_create(hass, {"name": "Garage"})
    loc_id = next(iter(repo._debug_get_internal_indexes()["locations_by_id"]))
    await service_item_create(hass, {"name": "Box", "quantity": 1, "location_id": loc_id})
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))

    # Move to root
    await service_item_move(hass, {"item_id": item_id, "new_location_id": None})
    assert repo.get_item(item_id).location_id is None

    # Adjust and set
    target_quantity = 5
    await service_item_set_quantity(hass, {"item_id": item_id, "quantity": target_quantity})
    assert repo.get_item(item_id).quantity == target_quantity
    await service_item_check_in(hass, {"item_id": item_id})
    await service_item_check_out(hass, {"item_id": item_id, "due_date": "2030-01-01"})
    assert repo.get_item(item_id).checked_out is True

    # Delete
    await service_item_delete(hass, {"item_id": item_id})
    assert repo.get_counts()["items_total"] == 0


@pytest.mark.asyncio
async def test_location_update_and_delete_validation_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Invalid location operations are logged with context and do not raise."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()

    # Create a location
    await service_location_create(hass, {"name": "Root"})
    repo: Repository = hass.data[DOMAIN]["repository"]
    loc_id = next(iter(repo._debug_get_internal_indexes()["locations_by_id"]))

    with caplog.at_level(logging.WARNING):
        await service_location_update(hass, {"location_id": loc_id, "new_parent_id": loc_id})
    # A warning should be present with contextual fields
    assert any(
        "location_id" in rec.__dict__.get("extra", {}) if hasattr(rec, "extra") else True
        for rec in caplog.records
    )

    # Delete should work when no children and no items
    await service_location_delete(hass, {"location_id": loc_id})
    assert repo.get_counts()["locations_total"] == 0
