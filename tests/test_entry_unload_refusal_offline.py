"""Offline tests: an unloaded config entry refuses exactly like a removed one.

Unload is one lifecycle step ahead of removal and Home Assistant still cannot
unregister a WebSocket command, so an entry that is merely *disabled* — or
halfway through a reload — would go on answering from a store and repository it
no longer owns. Teardown drops that runtime, which turns "still listening" into
"refuses", and tells every open subscription its topic has stopped so a card
left open can re-open it once setup runs again.

The offline stub's unload takes our handlers back out of its fake command
registry, something real Home Assistant has no API for, so these tests capture
the handler *before* unloading and call it afterwards — which is what a client
sending on a still-registered command does.
``tests/integration/test_config_entry.py`` covers the real ordering, over a real
WebSocket, against a real core.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
from custom_components.haventory import (
    async_setup,
    async_setup_entry,
    async_unload_entry,
)
from custom_components.haventory import services as services_mod
from custom_components.haventory import storage as storage_mod
from custom_components.haventory import ws as ws_mod
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import NotLoadedError
from custom_components.haventory.rate_limit import RateLimitConfig, RateLimiter
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant


class _StubConn:
    """Connection stub that keeps every message sent to it."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    def send_message(self, msg: dict) -> None:
        self.messages.append(msg)


def _handler(hass: HomeAssistant, type_: str):
    """The registered handler for one command type, as HA would dispatch to it."""

    for handler in hass.data.get("__ws_commands__", []):
        schema = getattr(handler, "_ws_schema", None)
        if callable(handler) and isinstance(schema, dict) and schema.get("type") == type_:
            return handler
    raise AssertionError(f"No handler registered for type {type_}")


async def _call(handler, hass: HomeAssistant, _id: int, type_: str, conn=None, **payload):
    """Send one command straight to a handler, bypassing the stub registry."""

    req = {"id": _id, "type": type_}
    req.update(payload)
    target = conn if conn is not None else _StubConn()
    res = await handler(hass, target, req)
    return res if res is not None else target.messages[-1]


async def _send(hass: HomeAssistant, _id: int, type_: str, conn=None, **payload):
    return await _call(_handler(hass, type_), hass, _id, type_, conn=conn, **payload)


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
        ("haventory/item/create", {"name": "While unloaded"}),
        ("haventory/item/list", {}),
        ("haventory/stats", {}),
        ("haventory/location/create", {"name": "Shed"}),
        ("haventory/subscribe", {"topic": "items"}),
        # Utility commands read no inventory, but the surface has to go quiet as
        # a whole: half an API answering for an entry that owns nothing is worse
        # than none.
        ("haventory/ping", {}),
        ("haventory/version", {}),
        ("haventory/config", {}),
    ],
)
async def test_command_refuses_while_unloaded(command: str, payload: dict) -> None:
    """Every command answers storage_error for as long as no entry is loaded."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    handler = _handler(hass, command)
    assert (await _call(handler, hass, 1, command, **payload))["success"] is True

    await async_unload_entry(hass, entry)

    res = await _call(handler, hass, 2, command, **payload)
    assert res["success"] is False, res
    assert res["error"]["code"] == "storage_error"


@pytest.mark.asyncio
async def test_unload_drops_the_loaded_runtime() -> None:
    """Nothing an entry loaded survives it — that is what makes handlers refuse."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    bucket = hass.data[DOMAIN]
    assert bucket["store"] is not None
    assert bucket["repository"] is not None

    await async_unload_entry(hass, entry)

    for key in ("store", "repository", "rate_limiter", "card_title", "persist_task"):
        assert hass.data[DOMAIN].get(key) is None, key


@pytest.mark.asyncio
async def test_unload_keeps_the_static_route_flag() -> None:
    """The one flag that outlives an entry stays: aiohttp cannot drop a route.

    Losing it would make the reload's setup register ``/haventory_static`` a
    second time.
    """

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    hass.data[DOMAIN]["static_path_registered"] = True

    await async_unload_entry(hass, entry)

    assert hass.data[DOMAIN].get("static_path_registered") is True


@pytest.mark.asyncio
async def test_unload_flushes_before_dropping(monkeypatch) -> None:
    """A debounced write pending at unload lands, and then fires no second time."""

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

    await async_unload_entry(hass, entry)

    assert len(saved) == 1, "unload writes the pending state out"
    assert [item["name"] for item in saved[0]["items"].values()] == ["Unsaved"]

    await asyncio.sleep(0.2)

    assert pending.cancelled() or pending.done()
    assert len(saved) == 1, "the cancelled debounce never fired against a dropped store"


@pytest.mark.asyncio
async def test_unloaded_service_refuses() -> None:
    """The service surface refuses off the same lookup as the WebSocket one."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    await services_mod.service_item_create(hass, {"name": "Before"})

    await async_unload_entry(hass, entry)

    with pytest.raises(NotLoadedError):
        await services_mod.service_item_create(hass, {"name": "After"})


# -----------------------------
# Telling open subscribers the topics stopped
# -----------------------------


@pytest.mark.asyncio
async def test_unload_tells_open_subscribers_their_topic_stopped() -> None:
    """Every open subscription is told, on its own id and its own topic.

    Nothing else on the wire marks the end: the connection outlives the entry, so
    a client that is not told simply stops receiving events and cannot tell that
    from an inventory nobody is editing.
    """

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    conn = _StubConn()
    for sub_id, topic in ((11, "items"), (12, "locations"), (13, "stats")):
        assert (await _send(hass, sub_id, "haventory/subscribe", conn=conn, topic=topic))["success"]
    conn.messages.clear()

    await async_unload_entry(hass, entry)

    assert [(m["id"], m["event"]["topic"], m["event"]["action"]) for m in conn.messages] == [
        (11, "items", "unavailable"),
        (12, "locations", "unavailable"),
        (13, "stats", "unavailable"),
    ]
    assert all(m["type"] == "event" for m in conn.messages)
    assert all(m["event"]["domain"] == DOMAIN for m in conn.messages)


@pytest.mark.asyncio
async def test_unload_drops_live_subscriptions() -> None:
    """Having been told, the subscription is gone: nothing more is delivered."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    conn = _StubConn()
    assert (await _send(hass, 7, "haventory/subscribe", conn=conn, topic="items"))["success"]

    await async_unload_entry(hass, entry)
    conn.messages.clear()

    ws_mod._broadcast_event(hass, topic="items", action="created", payload={"item": {"id": "x"}})

    assert conn.messages == []
    assert hass.data[DOMAIN].get("subscriptions") in (None, {})


@pytest.mark.asyncio
async def test_teardown_signal_outranks_the_event_budget() -> None:
    """A spent event budget must not be what keeps a client believing it is live.

    The limiter exists to throttle inventory chatter; this is the one event whose
    loss cannot be recovered by re-listing, because the client would never know
    to.
    """

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    limiter = RateLimiter(
        RateLimitConfig(
            enabled=True,
            events_per_second=1.0,
            events_burst=1.0,
            global_events_per_second=1.0,
            global_events_burst=1.0,
        )
    )
    hass.data[DOMAIN]["rate_limiter"] = limiter
    conn = _StubConn()
    assert (await _send(hass, 5, "haventory/subscribe", conn=conn, topic="items"))["success"]

    # Drain the global budget, then prove an ordinary broadcast is now dropped.
    assert limiter.allow_event_broadcast() is True
    conn.messages.clear()
    ws_mod._broadcast_event(hass, topic="items", action="created", payload={"item": {"id": "x"}})
    assert conn.messages == []

    await async_unload_entry(hass, entry)

    assert [m["event"]["action"] for m in conn.messages] == ["unavailable"]


# -----------------------------
# Coming back
# -----------------------------


@pytest.mark.asyncio
async def test_setup_after_unload_serves_again() -> None:
    """A reload is unload plus setup, and the second half restores the API."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    created = await _send(hass, 1, "haventory/item/create", name="Screwdriver")
    assert created["success"] is True
    handler = _handler(hass, "haventory/item/list")

    await async_unload_entry(hass, entry)
    assert (await _call(handler, hass, 2, "haventory/item/list"))["success"] is False

    assert await async_setup_entry(hass, ConfigEntry()) is True

    listed = await _call(handler, hass, 3, "haventory/item/list")
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]


@pytest.mark.asyncio
async def test_a_reload_writes_nothing_while_it_is_refusing(monkeypatch) -> None:
    """A mutation refused mid-reload is refused before it reaches the repository."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    store = hass.data[DOMAIN]["store"]
    saved: list[dict] = []

    async def _record(payload: dict) -> None:
        saved.append(payload)

    monkeypatch.setattr(store, "async_save", _record)
    handler = _handler(hass, "haventory/item/create")

    await async_unload_entry(hass, entry)
    saved.clear()  # unload's own flush is test_unload_flushes_before_dropping's business

    res = await _call(handler, hass, 1, "haventory/item/create", name="Ghost")

    assert res["success"] is False
    assert saved == []

    assert await async_setup_entry(hass, ConfigEntry()) is True
    listed = await _send(hass, 2, "haventory/item/list")
    assert [item["name"] for item in listed["result"]["items"]] == []


@pytest.mark.asyncio
async def test_refusal_is_mapped_not_an_unhandled_crash(caplog) -> None:
    """The refusal goes through the guard's error mapping, not its safety net."""

    hass = HomeAssistant()
    entry = await _setup_entry(hass)
    handler = _handler(hass, "haventory/item/create")
    await async_unload_entry(hass, entry)

    caplog.set_level(logging.DEBUG, logger="custom_components.haventory.ws")
    res = await _call(handler, hass, 1, "haventory/item/create", name="Nope")

    assert res["error"]["code"] == "storage_error"
    assert res["error"]["data"]["op"] == "item_create"
    assert res["error"]["message"] != ws_mod.UNEXPECTED_ERROR_MESSAGE
    assert not [r for r in caplog.records if "Unexpected error in WS handler" in r.message]
