"""Offline tests for haventory services layer.

Scenarios:
- item_create validates and creates an item; logs context on success
- item_update applies update and logs validation errors without stack trace
- location_create and update wire through to repository
"""

from __future__ import annotations

import pytest
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from homeassistant.core import HomeAssistant


@pytest.mark.asyncio
async def test_item_create_and_update_flow_logs_and_mutates() -> None:
    """Create an item, then update it; ensure repo state changes and no exceptions bubble."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    # Create
    await services_mod.service_item_create(
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
    await services_mod.service_item_update(
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
    await services_mod.service_location_create(hass, {"name": "Garage"})
    loc_id = next(iter(repo._debug_get_internal_indexes()["locations_by_id"]))
    # Update location name via service
    await services_mod.service_location_update(hass, {"location_id": loc_id, "name": "Garage2"})
    assert repo.get_location(loc_id).name == "Garage2"
    await services_mod.service_item_create(
        hass, {"name": "Box", "quantity": 1, "location_id": loc_id}
    )
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))

    # Move to root
    await services_mod.service_item_move(hass, {"item_id": item_id, "new_location_id": None})
    assert repo.get_item(item_id).location_id is None

    # Adjust and set
    target_quantity = 5
    await services_mod.service_item_set_quantity(
        hass, {"item_id": item_id, "quantity": target_quantity}
    )
    assert repo.get_item(item_id).quantity == target_quantity
    await services_mod.service_item_check_in(hass, {"item_id": item_id})
    await services_mod.service_item_check_out(hass, {"item_id": item_id, "due_date": "2030-01-01"})
    assert repo.get_item(item_id).checked_out is True

    # Delete
    await services_mod.service_item_delete(hass, {"item_id": item_id})
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
    await services_mod.service_item_create(hass, {"name": "Widget"})
    await services_mod.service_location_create(hass, {"name": "Root"})
    MIN_PERSISTS_AFTER_CREATE = 2
    assert calls["count"] >= MIN_PERSISTS_AFTER_CREATE

    # Also ensure delete persists
    repo: Repository = hass.data[DOMAIN]["repository"]
    loc_id = next(iter(repo._debug_get_internal_indexes()["locations_by_id"]))
    await services_mod.service_location_delete(hass, {"location_id": loc_id})
    MIN_PERSISTS_AFTER_DELETE = 3
    assert calls["count"] >= MIN_PERSISTS_AFTER_DELETE


@pytest.mark.asyncio
async def test_service_registration_and_schema_errors(monkeypatch, caplog) -> None:
    """Services register and schema errors are logged without raising."""

    hass = HomeAssistant()

    # Provide a minimal services registry stub with async_register behavior
    class _Services:
        def __init__(self) -> None:
            self._registered: list[tuple[str, str, object, object]] = []

        def async_register(self, domain, name, handler, schema=None):  # type: ignore[no-untyped-def]
            self._registered.append((domain, name, handler, schema))

    hass.services = _Services()  # type: ignore[attr-defined]

    # Wire repository and store
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    services_mod.setup(hass)
    # Ensure all expected services are registered
    names = {n for (_d, n, _h, _s) in hass.services._registered}
    assert {
        "item_create",
        "item_update",
        "item_delete",
        "item_move",
        "item_adjust_quantity",
        "item_set_quantity",
        "item_check_out",
        "item_check_in",
        "location_create",
        "location_update",
        "location_delete",
    }.issubset(names)

    # Grab a handler and feed invalid payload to trigger vol.Invalid
    caplog.clear()
    caplog.set_level("WARNING")
    # Find item_update handler
    _domain, _name, handler, _schema = next(
        r for r in hass.services._registered if r[1] == "item_update"
    )

    class _Call:
        def __init__(self, data):
            self.data = data

    # Missing required item_id should fail schema
    await handler(_Call({}))
    # Assert an error log from our boundary with op context
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)


@pytest.mark.asyncio
async def test_repository_exceptions_are_logged(monkeypatch, caplog) -> None:
    """Repository exceptions surface as logs with context and do not crash."""

    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    hass.data[DOMAIN]["store"] = DomainStore(hass)

    # Create one item to operate on
    await services_mod.service_item_create(hass, {"name": "Widget"})
    item_id = next(iter(repo._debug_get_internal_indexes()["items_by_id"]))

    # Force NotFoundError: delete then try update
    await services_mod.service_item_delete(hass, {"item_id": item_id})
    caplog.clear()
    caplog.set_level("WARNING")
    await services_mod.service_item_update(hass, {"item_id": item_id, "name": "Nope"})
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)

    # Force ConflictError via expected_version mismatch
    await services_mod.service_item_create(hass, {"name": "Widget2"})
    item_id2 = next(reversed(repo._debug_get_internal_indexes()["items_by_id"]))
    caplog.clear()
    await services_mod.service_item_update(
        hass, {"item_id": item_id2, "expected_version": 999, "name": "Boom"}
    )
    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)

    # Simulate storage failure during persist
    caplog.clear()

    async def _raise(_payload):  # type: ignore[no-untyped-def]
        raise RuntimeError("save failed")

    monkeypatch.setattr(DomainStore(hass), "async_save", _raise)

    # Monkeypatch helper to raise StorageError at boundary
    async def _persist(_hass):  # type: ignore[no-untyped-def]
        raise StorageError("persist failed")

    monkeypatch.setattr(services_mod, "async_persist_repo", _persist)
    await services_mod.service_location_create(hass, {"name": "Root"})
    assert any(getattr(r, "op", None) == "location_create" for r in caplog.records)
