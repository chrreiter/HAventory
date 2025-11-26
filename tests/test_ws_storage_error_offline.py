"""Offline tests: storage save failure maps to storage_error at WS boundary.

Scenarios:
- Simulate that persisting the repository raises StorageError
- Invoke a WS command that persists (e.g., item/create)
- Expect WS error with code 'storage_error' and an ERROR-level log

Edge case documentation:
- When persist fails, mutation is already applied in memory
- Broadcasts are sent before persist, so subscribers see the change
- On restart, changes are lost (not persisted to disk)
- This is a known limitation; rollback would add complexity for a rare edge case
"""

from __future__ import annotations

import logging

import pytest
from custom_components.haventory import ws as ws_module
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import StorageError
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
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


@pytest.mark.asyncio
async def test_ws_maps_storage_error_and_logs(caplog, monkeypatch, immediate_persist) -> None:
    """WS should return storage_error when persist fails and log at ERROR level."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Force persist to raise StorageError via async_save on underlying store
    async def _raise(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise StorageError("failed to persist repository")

    # Monkeypatch DomainStore.async_save through the instance stored in hass
    store = hass.data[DOMAIN]["store"]
    monkeypatch.setattr(store, "async_save", _raise)

    caplog.set_level(logging.ERROR, logger="custom_components.haventory.ws")

    res = await _send(hass, 1, "haventory/item/create", name="X")
    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"

    # Exactly one ERROR boundary log for this op
    logs = [r for r in caplog.records if r.name == "custom_components.haventory.ws"]
    assert len(logs) == 1 and logs[0].levelno == logging.ERROR
    assert getattr(logs[0], "op", None) == "item_create"


# -----------------------------------------------------------------------------
# Edge case tests: document behavior when persist fails after mutation
# -----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_storage_error_leaves_item_in_memory_but_not_persisted(
    caplog, monkeypatch, immediate_persist
) -> None:
    """When persist fails, item exists in memory but won't survive restart.

    This documents expected edge-case behavior: the mutation succeeds in memory,
    but the client receives storage_error. On HA restart, the item is lost.
    Requires immediate_persist fixture to observe storage errors synchronously.
    """
    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    # Force persist to fail
    persist_called = []

    async def _fail_persist(*_args, **_kwargs):
        persist_called.append(True)
        raise StorageError("disk full")

    monkeypatch.setattr(store, "async_save", _fail_persist)

    caplog.set_level(logging.ERROR)

    # Create item - mutation succeeds but persist fails
    res = await _send(hass, 1, "haventory/item/create", name="Fragile Item")

    # Client receives error
    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"
    assert persist_called, "Persist should have been attempted"

    # But item exists in memory (edge case: mutation already applied)
    result = repo.list_items()
    items = result["items"]
    assert len(items) == 1
    assert items[0].name == "Fragile Item"

    # Simulate restart: load fresh repo from what would be on disk (empty)
    fresh_repo = Repository.from_state({"items": {}, "locations": {}})
    fresh_result = fresh_repo.list_items()
    assert len(fresh_result["items"]) == 0, "Item lost on restart as expected"


@pytest.mark.asyncio
async def test_storage_error_broadcast_already_sent(caplog, monkeypatch, immediate_persist) -> None:
    """When persist fails, broadcast has already been sent to subscribers.

    This documents that subscribers receive the 'created' event even though
    the client gets storage_error. This is a known limitation - rolling back
    would add complexity for a rare edge case.
    Requires immediate_persist fixture to observe storage errors synchronously.
    """
    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    # Track broadcasts
    broadcast_events: list[dict] = []

    def tracking_broadcast(hass, topic, action, payload):
        broadcast_events.append({"topic": topic, "action": action, "payload": payload})
        # Don't actually broadcast in tests (no real subscriptions)

    monkeypatch.setattr(ws_module, "_broadcast_event", tracking_broadcast)

    # Force persist to fail
    async def _fail_persist(*_args, **_kwargs):
        raise StorageError("permission denied")

    monkeypatch.setattr(store, "async_save", _fail_persist)

    caplog.set_level(logging.ERROR)

    # Create item
    res = await _send(hass, 1, "haventory/item/create", name="Broadcast Test")

    # Client receives error
    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"

    # But broadcast was already sent (before persist attempted)
    assert len(broadcast_events) == 1
    assert broadcast_events[0]["topic"] == "items"
    assert broadcast_events[0]["action"] == "created"
    assert broadcast_events[0]["payload"]["item"]["name"] == "Broadcast Test"


@pytest.mark.asyncio
async def test_storage_error_on_delete_item_removed_from_memory(
    caplog, monkeypatch, immediate_persist
) -> None:
    """When persist fails on delete, item is already removed from memory.

    For delete operations, if persist fails, the item was already removed
    from memory. On restart it would reappear (since delete wasn't persisted).
    Requires immediate_persist fixture to observe storage errors synchronously.
    """
    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    # Create an item first (with working persistence - mock it to succeed)
    item = repo.create_item({"name": "To Delete"})
    item_id = item.id

    # Now make persist fail
    async def _fail_persist(*_args, **_kwargs):
        raise StorageError("io error")

    monkeypatch.setattr(store, "async_save", _fail_persist)

    caplog.set_level(logging.ERROR)

    # Delete item - mutation succeeds but persist fails
    res = await _send(hass, 1, "haventory/item/delete", item_id=str(item_id))

    # Client receives error
    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"

    # Item is deleted from memory (mutation already applied)
    result = repo.list_items()
    items = result["items"]
    assert len(items) == 0, "Item was deleted from memory"

    # On restart, the item would reappear (since delete wasn't persisted)
    # This is the inverse edge case - data appears "restored" unexpectedly


@pytest.mark.asyncio
async def test_storage_error_on_update_change_in_memory_only(
    caplog, monkeypatch, immediate_persist
) -> None:
    """When persist fails on update, change exists in memory but not on disk.

    Documents that partial updates are applied in-memory even when persist fails.
    Requires immediate_persist fixture to observe storage errors synchronously.
    """
    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    store = DomainStore(hass)
    hass.data[DOMAIN]["store"] = store
    ws_setup(hass)

    # Create item with initial quantity
    INITIAL_QTY = 10
    item = repo.create_item({"name": "Quantity Test", "quantity": INITIAL_QTY})
    item_id = item.id

    # Now make persist fail
    async def _fail_persist(*_args, **_kwargs):
        raise StorageError("readonly filesystem")

    monkeypatch.setattr(store, "async_save", _fail_persist)

    caplog.set_level(logging.ERROR)

    # Update quantity
    NEW_QTY = 25
    res = await _send(
        hass,
        1,
        "haventory/item/update",
        item_id=str(item_id),
        quantity=NEW_QTY,
    )

    # Client receives error
    assert res["success"] is False
    assert res["error"]["code"] == "storage_error"

    # But change is in memory
    updated = repo.get_item(item_id)
    assert updated.quantity == NEW_QTY, "Update applied in memory despite persist failure"

    # On restart, would revert to INITIAL_QTY (the last persisted value)
