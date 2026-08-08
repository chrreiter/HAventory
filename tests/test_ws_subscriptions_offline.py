"""Offline tests for haventory WebSocket subscriptions and events.

Scenarios:
- subscribe/unsubscribe lifecycle and echo policy
- item events delivered with correct shape; stats counts emitted on mutations
- location_id + include_subtree filters constrain delivered events, and a
  payload-less items event reaches every subscription regardless, because it is
  a refetch signal rather than a per-item patch
- inspection_overdue_only narrows item events the way item/list narrows a page
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import _broadcast_event, _subs_bucket
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


class _ConnStub:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []
        self._close_callbacks: list[Callable[[], None]] = []

    def send_message(self, msg: dict[str, Any]) -> None:
        self.messages.append(msg)

    def on_close(self, callback: Callable[[], None]) -> None:
        self._close_callbacks.append(callback)

    def close(self) -> None:
        for cb in list(self._close_callbacks):
            cb()


class _HAConnStub(_ConnStub):
    """Connection stub that mirrors HA's ``ActiveConnection`` subscription registry.

    Real ``ActiveConnection`` exposes a ``subscriptions`` dict (message id -> zero-arg
    unsub callback) that both the framework's ``unsubscribe_events`` command and the
    disconnect path drive. The plain ``_ConnStub`` deliberately omits it (exercising the
    ``on_close`` fallback); this subclass restores it so we can drive the framework
    teardown path the frontend actually uses.
    """

    def __init__(self) -> None:
        super().__init__()
        self.subscriptions: dict[Any, Callable[[], None]] = {}

    def core_unsubscribe_events(self, subscription: int) -> bool:
        """Emulate HA core's ``unsubscribe_events``: pop-and-call, or report missing."""
        if subscription in self.subscriptions:
            self.subscriptions.pop(subscription)()
            return True
        return False

    def close(self) -> None:
        # HA calls every registered unsub on disconnect, then any close callbacks.
        for unsub in list(self.subscriptions.values()):
            unsub()
        self.subscriptions.clear()
        super().close()


class _SlottedHAConn:
    """Faithful stand-in for HA's ``__slots__``-based ``ActiveConnection``.

    Crucially it has **no** ``__dict__``: setting an arbitrary attribute on the
    connection (as an old ``_haventory_close_registered`` marker did) raises
    ``AttributeError`` here exactly as it does on real HA — the ``__dict__``-carrying
    stubs above silently tolerate it and hide the bug. A custom ``__setattr__``
    *records* every rejected attempt so a test can prove production code never tries.
    Mirrors only the surface the subscribe path touches: a ``subscriptions`` registry
    and ``send_message``, with a disconnect ``close()`` that invokes every unsub.
    """

    __slots__ = ("messages", "stray_set_attempts", "subscriptions")

    def __init__(self) -> None:
        object.__setattr__(self, "messages", [])
        object.__setattr__(self, "subscriptions", {})
        object.__setattr__(self, "stray_set_attempts", [])

    def __setattr__(self, name: str, value: Any) -> None:
        if name in self.__slots__:
            object.__setattr__(self, name, value)
            return
        # Real HA rejects arbitrary attrs (no __dict__); record the attempt first so
        # tests can assert production code never stamps a marker on the connection.
        self.stray_set_attempts.append(name)
        raise AttributeError(
            f"'_SlottedHAConn' object has no attribute {name!r} "
            "and no __dict__ for setting new attributes"
        )

    def send_message(self, msg: dict[str, Any]) -> None:
        self.messages.append(msg)

    def close(self) -> None:
        for unsub in list(self.subscriptions.values()):
            unsub()
        self.subscriptions.clear()


def _get_handler(
    hass: HomeAssistant, type_: str
) -> Callable[[HomeAssistant, object, dict], Coroutine[Any, Any, dict]]:
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        if callable(h) and getattr(h, "_ws_command", None) == type_:
            return h
    raise AssertionError("No handler found for type " + type_)


async def _send(hass: HomeAssistant, conn: object, _id: int, type_: str, **payload):
    handler = _get_handler(hass, type_)
    req = {"id": _id, "type": type_}
    req.update(payload)
    return await handler(hass, conn, req)


def _extract_events(conn: _ConnStub, *, topic: str | None = None) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for m in conn.messages:
        if m.get("type") != "event":
            continue
        ev = m.get("event") or {}
        if topic is not None and ev.get("topic") != topic:
            continue
        events.append(ev)
    return events


@pytest.mark.asyncio
async def test_subscribe_receives_item_created_and_counts() -> None:
    """Subscribe to items and stats; creating an item emits item+counts events."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Subscribe to items and stats on same connection with different ids
    res = await _send(hass, conn, 101, "haventory/subscribe", topic="items")
    assert res["success"] is True
    res = await _send(hass, conn, 102, "haventory/subscribe", topic="stats")
    assert res["success"] is True

    # Trigger mutation
    created = await _send(hass, conn, 1, "haventory/item/create", name="Hammer", quantity=1)
    assert created["success"] is True

    item_events = _extract_events(conn, topic="items")
    stats_events = _extract_events(conn, topic="stats")

    assert any(
        ev.get("action") == "created" and isinstance(ev.get("item"), dict) for ev in item_events
    )
    assert any(
        ev.get("action") == "counts" and isinstance(ev.get("counts"), dict) for ev in stats_events
    )


@pytest.mark.asyncio
async def test_unsubscribe_stops_events() -> None:
    """Unsubscribe removes further deliveries for the subscription id."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Subscribe to items
    res = await _send(hass, conn, 201, "haventory/subscribe", topic="items")
    assert res["success"] is True

    # First create triggers an item event
    await _send(hass, conn, 1, "haventory/item/create", name="Box")
    assert len(_extract_events(conn, topic="items")) >= 1

    # Unsubscribe using the subscription id
    res = await _send(hass, conn, 202, "haventory/unsubscribe", subscription=201)
    assert res["success"] is True

    # Clear previous messages
    conn.messages.clear()

    # Further mutations should not deliver to this subscription
    await _send(hass, conn, 2, "haventory/item/create", name="Tape")
    assert _extract_events(conn, topic="items") == []


@pytest.mark.asyncio
async def test_double_subscribe_and_unsubscribe_edge() -> None:
    """Double subscribing reuses conn bucket; unsubscribe of unknown id is benign."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Two subscriptions for same topic with different ids
    await _send(hass, conn, 401, "haventory/subscribe", topic="stats")
    await _send(hass, conn, 402, "haventory/subscribe", topic="stats")

    # Unsubscribe unknown id should succeed and not crash
    res = await _send(hass, conn, 499, "haventory/unsubscribe", subscription=999)
    assert res["success"] is True

    # Trigger mutation and ensure at least one event delivered
    await _send(hass, conn, 1, "haventory/item/create", name="Hammer")
    events = _extract_events(conn, topic="stats")
    assert any(ev.get("action") == "counts" for ev in events)


@pytest.mark.asyncio
async def test_subscriptions_cleanup_on_connection_close() -> None:
    """Connection close should remove all subscriptions for that connection."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()
    await _send(hass, conn, 901, "haventory/subscribe", topic="items")

    subs = _subs_bucket(hass)
    assert subs.get(conn)

    conn.close()

    assert conn not in _subs_bucket(hass)


@pytest.mark.asyncio
async def test_location_filters_subtree_and_direct_only() -> None:
    """location_id + include_subtree filters constrain delivered item events."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Create a small location tree: root -> child
    root = await _send(hass, conn, 1, "haventory/location/create", name="Root")
    root_id = root["result"]["id"]
    child = await _send(hass, conn, 2, "haventory/location/create", name="Shelf", parent_id=root_id)
    child_id = child["result"]["id"]

    # Two subscriptions:
    # - 301: subtree under root
    # - 302: direct-only for child
    await _send(
        hass,
        conn,
        301,
        "haventory/subscribe",
        topic="items",
        location_id=root_id,
        include_subtree=True,
    )
    await _send(
        hass,
        conn,
        302,
        "haventory/subscribe",
        topic="items",
        location_id=child_id,
        include_subtree=False,
    )

    # Create in child: both subs should receive (subtree and direct child)
    conn.messages.clear()
    item1 = await _send(
        hass,
        conn,
        3,
        "haventory/item/create",
        name="Wrench",
        quantity=1,
        location_id=child_id,
    )
    assert item1["success"] is True
    # Expect 2 events with different ids (subscription ids)
    EXPECTED_EVENTS_MIN = 2
    SUB_ID_SUBTREE = 301
    SUB_ID_DIRECT = 302
    assert len([m for m in conn.messages if m.get("type") == "event"]) >= EXPECTED_EVENTS_MIN
    ids = {m.get("id") for m in conn.messages if m.get("type") == "event"}
    assert SUB_ID_SUBTREE in ids and SUB_ID_DIRECT in ids

    # Create in root: only subtree subscription (301) should receive
    conn.messages.clear()
    item2 = await _send(
        hass,
        conn,
        4,
        "haventory/item/create",
        name="Screwdriver",
        quantity=1,
        location_id=root_id,
    )
    assert item2["success"] is True
    ids = {
        m.get("id")
        for m in conn.messages
        if m.get("type") == "event" and m.get("event", {}).get("topic") == "items"
    }
    assert ids == {SUB_ID_SUBTREE}

    # A payload-less items event has no item to match a filter against, so it
    # reaches every open items subscription whatever its location. That is the
    # right behaviour, not an oversight of the filter: the event says the
    # dataset moved wholesale and the client must re-list, and a subscription
    # watching one shelf has just as much reason to re-list as any other.
    conn.messages.clear()
    _broadcast_event(hass, topic="items", action="updated", payload=None)
    ids = {
        m.get("id")
        for m in conn.messages
        if m.get("type") == "event" and m.get("event", {}).get("topic") == "items"
    }
    assert ids == {SUB_ID_SUBTREE, SUB_ID_DIRECT}
    delivered = next(m for m in conn.messages if m.get("type") == "event")["event"]
    assert "item" not in delivered


def _utc_day_offset(days: int) -> str:
    """A UTC calendar date `days` from today, as YYYY-MM-DD."""

    return (datetime.now(UTC).date() + timedelta(days=days)).isoformat()


@pytest.mark.asyncio
async def test_inspection_overdue_filter_constrains_delivered_events() -> None:
    """`inspection_overdue_only` narrows item events the same way `item/list` does."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    SUB_ID_INSPECTION = 401
    SUB_ID_EVERYTHING = 402
    await _send(
        hass,
        conn,
        SUB_ID_INSPECTION,
        "haventory/subscribe",
        topic="items",
        inspection_overdue_only=True,
    )
    await _send(hass, conn, SUB_ID_EVERYTHING, "haventory/subscribe", topic="items")

    def item_event_ids() -> set[object]:
        return {
            m.get("id")
            for m in conn.messages
            if m.get("type") == "event" and m.get("event", {}).get("topic") == "items"
        }

    # A missed inspection reaches both subscriptions.
    conn.messages.clear()
    late = await _send(
        hass,
        conn,
        3,
        "haventory/item/create",
        name="Ladder",
        inspection_date=_utc_day_offset(-1),
    )
    assert late["success"] is True
    assert item_event_ids() == {SUB_ID_INSPECTION, SUB_ID_EVERYTHING}

    # Due today is not late yet, so the filtered subscription hears nothing —
    # the same strictly-before boundary the filter and the count use.
    conn.messages.clear()
    due_today = await _send(
        hass,
        conn,
        4,
        "haventory/item/create",
        name="Harness",
        inspection_date=_utc_day_offset(0),
    )
    assert due_today["success"] is True
    assert item_event_ids() == {SUB_ID_EVERYTHING}

    # And an item with no inspection date at all never matches.
    conn.messages.clear()
    undated = await _send(hass, conn, 5, "haventory/item/create", name="Bucket")
    assert undated["success"] is True
    assert item_event_ids() == {SUB_ID_EVERYTHING}


@pytest.mark.asyncio
async def test_framework_unsubscribe_events_tears_down_subscription() -> None:
    """Subscriptions register in HA's own registry so core ``unsubscribe_events``
    (the teardown path the frontend's ``subscribeMessage`` uses) can cancel them.

    Before the fix nothing was registered under the message id, so core replied
    ``not_found`` ("Subscription not found.") on every teardown — an unhandled
    rejection in the card.
    """

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    sub_id = 501
    conn = _HAConnStub()
    res = await _send(hass, conn, sub_id, "haventory/subscribe", topic="items")
    assert res["success"] is True

    # The zero-arg teardown is registered under the message id — exactly what core's
    # ``unsubscribe_events`` looks up (`if subscription in connection.subscriptions`).
    assert sub_id in conn.subscriptions
    assert callable(conn.subscriptions[sub_id])

    # Events flow while subscribed.
    await _send(hass, conn, 1, "haventory/item/create", name="Box")
    assert len(_extract_events(conn, topic="items")) >= 1

    # Emulate core ``unsubscribe_events``: the id is found -> success (no not_found).
    assert conn.core_unsubscribe_events(sub_id) is True
    assert sub_id not in conn.subscriptions
    assert conn not in _subs_bucket(hass)  # our bucket was cleaned up too

    # No further deliveries after teardown.
    conn.messages.clear()
    await _send(hass, conn, 2, "haventory/item/create", name="Tape")
    assert _extract_events(conn, topic="items") == []


@pytest.mark.asyncio
async def test_dedicated_unsubscribe_clears_framework_registry() -> None:
    """``haventory/unsubscribe`` also clears the HA-registry entry, keeping the two
    teardown paths symmetric (no stale callback left in ``connection.subscriptions``)."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    sub_id = 601
    conn = _HAConnStub()
    await _send(hass, conn, sub_id, "haventory/subscribe", topic="stats")
    assert sub_id in conn.subscriptions

    res = await _send(hass, conn, 602, "haventory/unsubscribe", subscription=sub_id)
    assert res["success"] is True
    assert sub_id not in conn.subscriptions
    assert conn not in _subs_bucket(hass)


@pytest.mark.asyncio
async def test_subscribe_on_slotted_connection_never_stamps_attribute() -> None:
    """Subscribe must not stamp a marker attribute on a ``__slots__`` connection.

    Regression for the WP4 stress re-run finding: ``_register_close_listener`` used to
    set ``conn._haventory_close_registered = True`` for "register once" behaviour. Real
    HA's ``ActiveConnection`` is slotted (no ``__dict__``), so that assignment raised
    ``AttributeError`` on **every** subscribe (caught, but logged as a traceback under
    debug logging). The ``__dict__``-carrying stubs never surfaced it. Idempotency now
    derives from the ``"haventory/cleanup"`` key already present in ``subscriptions``.
    """

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    conn = _SlottedHAConn()

    # Two subscribes on the same connection must not raise, must register the per-id
    # framework teardown for each, and must leave exactly one connection-cleanup entry.
    sub_a, sub_b = 701, 702
    r1 = await _send(hass, conn, sub_a, "haventory/subscribe", topic="items")
    r2 = await _send(hass, conn, sub_b, "haventory/subscribe", topic="stats")
    assert r1["success"] is True
    assert r2["success"] is True
    assert sub_a in conn.subscriptions
    assert sub_b in conn.subscriptions
    assert list(conn.subscriptions).count("haventory/cleanup") == 1  # idempotent

    # The core assertion: production code never attempted to stamp a marker attribute
    # on the slotted connection (the old ``_haventory_close_registered = True``).
    assert conn.stray_set_attempts == []
    assert not hasattr(conn, "_haventory_close_registered")

    # Both subscriptions are live in our bucket, and the disconnect path
    # (subscriptions.values()) tears them all down without drift.
    assert _subs_bucket(hass).get(conn)
    conn.close()
    assert conn not in _subs_bucket(hass)

    # Sanity: the stub really is slotted like real HA (rejects arbitrary attrs).
    with pytest.raises(AttributeError):
        conn.some_unexpected_attr = 1  # type: ignore[attr-defined]
