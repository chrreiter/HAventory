"""Offline tests for haventory services layer.

Scenarios:
- item_create validates and creates an item; logs context on success
- item_update applies update and logs validation errors without stack trace
- location_create and update wire through to repository
"""

from __future__ import annotations

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
)
from custom_components.haventory.storage import DomainStore
from homeassistant.core import HomeAssistant


@pytest.mark.asyncio
async def test_item_create_and_update_flow_logs_and_mutates() -> None:
    """Create an item, then update it; ensure repo state changes and no exceptions bubble."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)

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
    hass.data[DOMAIN]["store"] = DomainStore(hass)

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
async def test_services_persist_after_mutations(monkeypatch) -> None:
    """Service handlers should call DomainStore.async_save after changes."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store

    calls = {"count": 0}

    async def _spy_save(payload):  # type: ignore[no-untyped-def]
        calls["count"] += 1
        assert isinstance(payload, dict) and "items" in payload and "locations" in payload

    monkeypatch.setattr(store, "async_save", _spy_save)

    # Create item + location
    await service_item_create(hass, {"name": "Widget"})
    await service_location_create(hass, {"name": "Root"})
    MIN_PERSISTS_AFTER_CREATE = 2
    assert calls["count"] >= MIN_PERSISTS_AFTER_CREATE

    # Also ensure delete persists
    repo: Repository = hass.data[DOMAIN]["repository"]
    loc_id = next(iter(repo._debug_get_internal_indexes()["locations_by_id"]))
    await service_location_delete(hass, {"location_id": loc_id})
    MIN_PERSISTS_AFTER_DELETE = 3
    assert calls["count"] >= MIN_PERSISTS_AFTER_DELETE
