"""Offline tests: once the config entry is removed, the API refuses.

Home Assistant cannot unregister a WebSocket command, so the ``haventory/*``
commands keep listening after the integration is gone. Removal writes out what is
unsaved and then drops the loaded runtime — store, repository, limiter,
subscriptions — which turns "still listening" into "refuses", instead of a dashboard left open
going on reading and writing an inventory nothing owns any more.

These tests call ``async_remove_entry`` without ``async_unload_entry`` first.
Real Home Assistant unloads before it removes, but the offline stub's unload
takes our handlers back out of the fake command registry — something real HA has
no API for — so going through it would leave nothing to send and hide the very
behaviour under test. ``tests/integration/test_config_entry.py`` covers the real
ordering against a real core.
"""

from __future__ import annotations

import logging

import pytest
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from runtime_helpers import remove_entry, repo_of, runtime_of, setup_entry
from ws_helpers import RecordingConn, ws_send

WS_LOGGER = "custom_components.haventory.ws"


async def _setup_entry(hass: HomeAssistant) -> ConfigEntry:
    """Set the integration up on a store emptied for this test.

    The offline ``Store`` stub keeps one dict per storage key for the whole
    session, so a test that goes through the real setup path has to start from a
    known payload rather than whatever an earlier test left behind.
    """

    await DomainStore(hass, key=STORAGE_KEY).async_save(
        {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}
    )
    return await setup_entry(hass)


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
    assert (await ws_send(hass, 1, command, **payload))["success"] is True

    await remove_entry(hass, entry)

    res = await ws_send(hass, 2, command, **payload)
    assert res["success"] is False, res
    assert res["error"]["code"] == "storage_error"


@pytest.mark.asyncio
async def test_refusal_is_mapped_not_an_unhandled_crash(caplog) -> None:
    """The refusal goes through the guard's error mapping, not its safety net."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    await remove_entry(hass, entry)

    caplog.set_level(logging.DEBUG, logger=WS_LOGGER)
    res = await ws_send(hass, 1, "haventory/item/create", name="Nope")

    assert res["error"]["code"] == "storage_error"
    assert res["error"]["data"]["op"] == "item_create"
    assert res["error"]["message"] != ws_mod.UNEXPECTED_ERROR_MESSAGE
    assert not [r for r in caplog.records if "Unexpected error in WS handler" in r.message]


@pytest.mark.asyncio
async def test_removal_stops_persistence(monkeypatch) -> None:
    """A refused mutation writes nothing: the store is nobody's to touch."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    store = runtime_of(hass).store
    saved: list[dict] = []

    async def _record(payload: dict) -> None:
        saved.append(payload)

    monkeypatch.setattr(store, "async_save", _record)

    await remove_entry(hass, entry)
    saved.clear()  # removal's own flush is test_removal_flushes_before_dropping's business

    res = await ws_send(hass, 1, "haventory/item/create", name="Ghost")

    assert res["success"] is False
    assert saved == []


@pytest.mark.asyncio
async def test_removal_flushes_before_dropping(monkeypatch) -> None:
    """What the repository holds and the store does not is written out at removal."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    store = runtime_of(hass).store
    saved: list[dict] = []

    async def _record(payload: dict) -> None:
        saved.append(payload)

    monkeypatch.setattr(store, "async_save", _record)

    repo_of(hass).create_item({"name": "Unsaved"})

    await remove_entry(hass, entry)

    assert len(saved) == 1, "removal writes the unsaved state out"
    assert [item["name"] for item in saved[0]["items"].values()] == ["Unsaved"]


@pytest.mark.asyncio
async def test_removal_drops_the_loaded_runtime() -> None:
    """Nothing an entry loaded survives it — that is what makes handlers refuse."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    runtime = runtime_of(hass)
    assert runtime.store is not None
    assert runtime.repository is not None

    await remove_entry(hass, entry)

    # Home Assistant deletes the attribute rather than emptying it, so nothing
    # the entry owned is reachable at all.
    assert not hasattr(entry, "runtime_data")
    assert find_runtime(hass) is None


@pytest.mark.asyncio
async def test_removal_keeps_the_static_route_flag() -> None:
    """The one flag that outlives an entry stays: aiohttp cannot drop a route.

    Losing it would make a re-add in the same run register ``/haventory_static``
    a second time.
    """

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    hass.data[DOMAIN]["static_path_registered"] = True

    await remove_entry(hass, entry)

    assert hass.data[DOMAIN].get("static_path_registered") is True


@pytest.mark.asyncio
async def test_removal_drops_live_subscriptions() -> None:
    """A subscriber left over from before removal receives nothing more."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    conn = RecordingConn()
    assert (await ws_send(hass, 7, "haventory/subscribe", conn=conn, topic="items"))["success"]

    await remove_entry(hass, entry)
    conn.messages.clear()

    ws_mod.broadcast_event(hass, topic="items", action="created", payload={"item": {"id": "x"}})

    assert conn.messages == []
    assert hass.data[DOMAIN].get("subscriptions") in (None, {})


@pytest.mark.asyncio
async def test_re_adding_the_entry_restores_service() -> None:
    """Removal keeps the store file, so a re-add brings the inventory back."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    created = await ws_send(hass, 1, "haventory/item/create", name="Screwdriver")
    assert created["success"] is True

    await remove_entry(hass, entry)
    assert (await ws_send(hass, 2, "haventory/item/list"))["success"] is False

    await setup_entry(hass)

    listed = await ws_send(hass, 3, "haventory/item/list")
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]
