"""Offline tests: once the config entry is removed, the API refuses.

Home Assistant cannot unregister a WebSocket command, so the ``haventory/*``
commands keep listening after the integration is gone. Removal drops the loaded
runtime — store, repository, limiter, subscriptions, any pending write — which
is what turns "still listening" into "refuses", instead of a dashboard left open
going on reading and writing an inventory nothing owns any more.

These tests call ``async_remove_entry`` without ``async_unload_entry`` first.
Real Home Assistant unloads before it removes, but the offline stub's unload
takes our handlers back out of the fake command registry — something real HA has
no API for — so going through it would leave nothing to send and hide the very
behaviour under test. ``tests/integration/test_config_entry.py`` covers the real
ordering against a real core.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
from custom_components.haventory import (
    async_remove_entry,
    async_setup,
    async_setup_entry,
)
from custom_components.haventory import storage as storage_mod
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

WS_LOGGER = "custom_components.haventory.ws"


class _StubConn:
    """Connection stub that keeps every message sent to it."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    def send_message(self, msg: dict) -> None:
        self.messages.append(msg)


async def _send(hass: HomeAssistant, _id: int, type_: str, conn=None, **payload):
    """Dispatch one WS command through the stub registry, as a client would."""

    for handler in hass.data.get("__ws_commands__", []):
        if not callable(handler) or getattr(handler, "_ws_command", None) != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        target = conn if conn is not None else _StubConn()
        res = await handler(hass, target, req)
        return res if res is not None else target.messages[-1]
    raise AssertionError(f"No handler responded for type {type_}")


async def _setup_entry(hass: HomeAssistant) -> ConfigEntry:
    """Set the integration up on a store emptied for this test.

    The offline ``Store`` stub keeps one dict per storage key for the whole
    session, so a test that goes through the real setup path has to start from a
    known payload rather than whatever an earlier test left behind.
    """

    await DomainStore(hass, key=STORAGE_KEY).async_save(
        {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}
    )
    entry = ConfigEntry()
    await async_setup(hass, {})
    assert await async_setup_entry(hass, entry) is True
    return entry


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("command", "payload"),
    [
        ("haventory/item/create", {"name": "After removal"}),
        ("haventory/item/list", {}),
        ("haventory/stats", {}),
        ("haventory/location/create", {"name": "Shed"}),
        ("haventory/subscribe", {"topic": "items"}),
        # Utility commands read no inventory, but the surface has to go quiet as
        # a whole: half an API answering a removed integration is worse than none.
        ("haventory/ping", {}),
        ("haventory/version", {}),
        ("haventory/config", {}),
    ],
)
async def test_command_refuses_after_removal(command: str, payload: dict) -> None:
    """Every command answers storage_error once the entry is gone."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    assert (await _send(hass, 1, command, **payload))["success"] is True

    await async_remove_entry(hass, entry)

    res = await _send(hass, 2, command, **payload)
    assert res["success"] is False, res
    assert res["error"]["code"] == "storage_error"


@pytest.mark.asyncio
async def test_refusal_is_mapped_not_an_unhandled_crash(caplog) -> None:
    """The refusal goes through the guard's error mapping, not its safety net."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    await async_remove_entry(hass, entry)

    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)
    res = await _send(hass, 1, "haventory/item/create", name="Nope")

    assert res["error"]["code"] == "storage_error"
    assert res["error"]["data"]["op"] == "item_create"
    assert res["error"]["message"] != ws_mod.UNEXPECTED_ERROR_MESSAGE
    assert not [r for r in caplog.records if "Unexpected error in WS handler" in r.message]


@pytest.mark.asyncio
async def test_removal_stops_persistence(monkeypatch) -> None:
    """A refused mutation writes nothing: the store is nobody's to touch."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    store = hass.data[DOMAIN]["store"]
    saved: list[dict] = []

    async def _record(payload: dict) -> None:
        saved.append(payload)

    monkeypatch.setattr(store, "async_save", _record)

    await async_remove_entry(hass, entry)
    saved.clear()  # removal's own flush is test_removal_flushes_before_dropping's business

    res = await _send(hass, 1, "haventory/item/create", name="Ghost")

    assert res["success"] is False
    assert saved == []


@pytest.mark.asyncio
async def test_removal_flushes_before_dropping(monkeypatch) -> None:
    """A debounced write pending at removal lands, and then fires no second time."""

    monkeypatch.setattr(storage_mod, "PERSIST_DEBOUNCE_DELAY", 0.05)

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    store = hass.data[DOMAIN]["store"]
    saved: list[dict] = []

    async def _record(payload: dict) -> None:
        saved.append(payload)

    monkeypatch.setattr(store, "async_save", _record)

    hass.data[DOMAIN]["repository"].create_item({"name": "Unsaved"})
    await storage_mod.async_request_persist(hass)
    pending = hass.data[DOMAIN]["persist_task"]

    await async_remove_entry(hass, entry)

    assert len(saved) == 1, "removal writes the pending state out"
    assert [item["name"] for item in saved[0]["items"].values()] == ["Unsaved"]

    await asyncio.sleep(0.2)

    assert pending.cancelled() or pending.done()
    assert len(saved) == 1, "the cancelled debounce never fired against a dropped store"


@pytest.mark.asyncio
async def test_removal_drops_the_loaded_runtime() -> None:
    """Nothing an entry loaded survives it — that is what makes handlers refuse."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    bucket = hass.data[DOMAIN]
    assert bucket["store"] is not None
    assert bucket["repository"] is not None

    await async_remove_entry(hass, entry)

    for key in ("store", "repository", "rate_limiter", "card_title", "persist_task"):
        assert hass.data[DOMAIN].get(key) is None, key


@pytest.mark.asyncio
async def test_removal_keeps_the_static_route_flag() -> None:
    """The one flag that outlives an entry stays: aiohttp cannot drop a route.

    Losing it would make a re-add in the same run register ``/haventory_static``
    a second time.
    """

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    hass.data[DOMAIN]["static_path_registered"] = True

    await async_remove_entry(hass, entry)

    assert hass.data[DOMAIN].get("static_path_registered") is True


@pytest.mark.asyncio
async def test_removal_drops_live_subscriptions() -> None:
    """A subscriber left over from before removal receives nothing more."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    conn = _StubConn()
    assert (await _send(hass, 7, "haventory/subscribe", conn=conn, topic="items"))["success"]

    await async_remove_entry(hass, entry)
    conn.messages.clear()

    ws_mod._broadcast_event(hass, topic="items", action="created", payload={"item": {"id": "x"}})

    assert conn.messages == []
    assert hass.data[DOMAIN].get("subscriptions") in (None, {})


@pytest.mark.asyncio
async def test_re_adding_the_entry_restores_service() -> None:
    """Removal keeps the store file, so a re-add brings the inventory back."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    created = await _send(hass, 1, "haventory/item/create", name="Screwdriver")
    assert created["success"] is True

    await async_remove_entry(hass, entry)
    assert (await _send(hass, 2, "haventory/item/list"))["success"] is False

    assert await async_setup_entry(hass, ConfigEntry()) is True

    listed = await _send(hass, 3, "haventory/item/list")
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]
