"""Offline test: storage save failure maps to storage_error at WS boundary.

Scenario:
- Simulate that persisting the repository raises StorageError
- Invoke a WS command that persists (e.g., item/create)
- Expect WS error with code 'storage_error' and an ERROR-level log
"""

from __future__ import annotations

import logging

import pytest
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
async def test_ws_maps_storage_error_and_logs(caplog, monkeypatch) -> None:
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

    # Ensure an ERROR log was emitted for this op
    assert any(
        r.levelno == logging.ERROR and getattr(r, "op", None) == "item_create"
        for r in caplog.records
    )
