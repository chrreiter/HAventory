"""Offline tests for haventory WebSocket subscriptions and events.

Scenarios:
- subscribe/unsubscribe lifecycle and echo policy
- item events delivered with correct shape; stats counts emitted on mutations
- location_id + include_subtree filters constrain delivered events, and a
  payload-less items event reaches every subscription regardless, because it is
  a refetch signal rather than a per-item patch
- inspection_overdue_only narrows item events the way item/list narrows a page
- area_id narrows item events to the payload's own effective_area_id, and never
  delivers an item that has no location
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from custom_components.haventory.areas import async_get_area_registry
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import _subs_bucket, broadcast_event
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, runtime_of
from ws_helpers import RecordingConn, ws_send


class _ConnStub(RecordingConn):
    """A connection with close callbacks but no subscription registry.

    Deliberately missing ``subscriptions``, which is what exercises the
    ``on_close`` fallback path.
    """

    def __init__(self) -> None:
        super().__init__()
        self._close_callbacks: list[Callable[[], None]] = []

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


@pytest.mark.asyncio
async def test_subscribe_receives_item_created_and_counts() -> None:
    """Subscribe to items and stats; creating an item emits item+counts events."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Subscribe to items and stats on same connection with different ids
    res = await ws_send(hass, 101, "haventory/subscribe", conn=conn, topic="items")
    assert res["success"] is True
    res = await ws_send(hass, 102, "haventory/subscribe", conn=conn, topic="stats")
    assert res["success"] is True

    # Trigger mutation
    created = await ws_send(hass, 1, "haventory/item/create", conn=conn, name="Hammer", quantity=1)
    assert created["success"] is True

    item_events = conn.events(topic="items")
    stats_events = conn.events(topic="stats")

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
    install_runtime(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Subscribe to items
    res = await ws_send(hass, 201, "haventory/subscribe", conn=conn, topic="items")
    assert res["success"] is True

    # First create triggers an item event
    await ws_send(hass, 1, "haventory/item/create", conn=conn, name="Box")
    assert len(conn.events(topic="items")) >= 1

    # Unsubscribe using the subscription id
    res = await ws_send(hass, 202, "haventory/unsubscribe", conn=conn, subscription=201)
    assert res["success"] is True

    # Clear previous messages
    conn.messages.clear()

    # Further mutations should not deliver to this subscription
    await ws_send(hass, 2, "haventory/item/create", conn=conn, name="Tape")
    assert conn.events(topic="items") == []


@pytest.mark.asyncio
async def test_double_subscribe_and_unsubscribe_edge() -> None:
    """Double subscribing reuses conn bucket; unsubscribe of unknown id is benign."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Two subscriptions for same topic with different ids
    await ws_send(hass, 401, "haventory/subscribe", conn=conn, topic="stats")
    await ws_send(hass, 402, "haventory/subscribe", conn=conn, topic="stats")

    # Unsubscribe unknown id should succeed and not crash
    res = await ws_send(hass, 499, "haventory/unsubscribe", conn=conn, subscription=999)
    assert res["success"] is True

    # Trigger mutation and ensure at least one event delivered
    await ws_send(hass, 1, "haventory/item/create", conn=conn, name="Hammer")
    events = conn.events(topic="stats")
    assert any(ev.get("action") == "counts" for ev in events)


@pytest.mark.asyncio
async def test_subscriptions_cleanup_on_connection_close() -> None:
    """Connection close should remove all subscriptions for that connection."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    conn = _ConnStub()
    await ws_send(hass, 901, "haventory/subscribe", conn=conn, topic="items")

    subs = _subs_bucket(hass)
    assert subs.get(conn)

    conn.close()

    assert conn not in _subs_bucket(hass)


@pytest.mark.asyncio
async def test_location_filters_subtree_and_direct_only() -> None:
    """location_id + include_subtree filters constrain delivered item events."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Create a small location tree: root -> child
    root = await ws_send(hass, 1, "haventory/location/create", conn=conn, name="Root")
    root_id = root["result"]["id"]
    child = await ws_send(
        hass, 2, "haventory/location/create", conn=conn, name="Shelf", parent_id=root_id
    )
    child_id = child["result"]["id"]

    # Two subscriptions:
    # - 301: subtree under root
    # - 302: direct-only for child
    await ws_send(
        hass,
        301,
        "haventory/subscribe",
        conn=conn,
        topic="items",
        location_id=root_id,
        include_subtree=True,
    )
    await ws_send(
        hass,
        302,
        "haventory/subscribe",
        conn=conn,
        topic="items",
        location_id=child_id,
        include_subtree=False,
    )

    # Create in child: both subs should receive (subtree and direct child)
    conn.messages.clear()
    item1 = await ws_send(
        hass, 3, "haventory/item/create", conn=conn, name="Wrench", quantity=1, location_id=child_id
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
    item2 = await ws_send(
        hass,
        4,
        "haventory/item/create",
        conn=conn,
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
    broadcast_event(hass, topic="items", action="updated", payload=None)
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
    install_runtime(hass)
    ws_setup(hass)

    conn = _ConnStub()

    SUB_ID_INSPECTION = 401
    SUB_ID_EVERYTHING = 402
    await ws_send(
        hass,
        SUB_ID_INSPECTION,
        "haventory/subscribe",
        conn=conn,
        topic="items",
        inspection_overdue_only=True,
    )
    await ws_send(hass, SUB_ID_EVERYTHING, "haventory/subscribe", conn=conn, topic="items")

    def item_event_ids() -> set[object]:
        return {
            m.get("id")
            for m in conn.messages
            if m.get("type") == "event" and m.get("event", {}).get("topic") == "items"
        }

    # A missed inspection reaches both subscriptions.
    conn.messages.clear()
    late = await ws_send(
        hass,
        3,
        "haventory/item/create",
        conn=conn,
        name="Ladder",
        inspection_date=_utc_day_offset(-1),
    )
    assert late["success"] is True
    assert item_event_ids() == {SUB_ID_INSPECTION, SUB_ID_EVERYTHING}

    # Due today is not late yet, so the filtered subscription hears nothing —
    # the same strictly-before boundary the filter and the count use.
    conn.messages.clear()
    due_today = await ws_send(
        hass,
        4,
        "haventory/item/create",
        conn=conn,
        name="Harness",
        inspection_date=_utc_day_offset(0),
    )
    assert due_today["success"] is True
    assert item_event_ids() == {SUB_ID_EVERYTHING}

    # And an item with no inspection date at all never matches.
    conn.messages.clear()
    undated = await ws_send(hass, 5, "haventory/item/create", conn=conn, name="Bucket")
    assert undated["success"] is True
    assert item_event_ids() == {SUB_ID_EVERYTHING}


@pytest.mark.asyncio
async def test_area_filter_constrains_delivered_events() -> None:
    """`area_id` narrows item events to the area the item's location tree is anchored to."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Kitchen(area=kitchen) -> Drawer, and a separate Garage(area=garage).
    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    drawer = repo.create_location(name="Drawer", parent_id=kitchen.id)
    garage = repo.create_location(name="Garage", area_id="garage")

    SUB_ID_KITCHEN = 501
    SUB_ID_EVERYTHING = 502
    SUB_ID_NULL_AREA = 503
    await ws_send(
        hass, SUB_ID_KITCHEN, "haventory/subscribe", conn=conn, topic="items", area_id="kitchen"
    )
    await ws_send(hass, SUB_ID_EVERYTHING, "haventory/subscribe", conn=conn, topic="items")
    # An explicit null is "no area filter", not "items with no area".
    await ws_send(
        hass, SUB_ID_NULL_AREA, "haventory/subscribe", conn=conn, topic="items", area_id=None
    )

    def item_event_ids() -> set[object]:
        return {
            m.get("id")
            for m in conn.messages
            if m.get("type") == "event" and m.get("event", {}).get("topic") == "items"
        }

    # An item deep under the kitchen inherits its area and reaches all three.
    conn.messages.clear()
    inside = await ws_send(
        hass, 1, "haventory/item/create", conn=conn, name="Whisk", location_id=str(drawer.id)
    )
    assert inside["success"] is True
    assert item_event_ids() == {SUB_ID_KITCHEN, SUB_ID_EVERYTHING, SUB_ID_NULL_AREA}

    # An item in another area does not.
    conn.messages.clear()
    outside = await ws_send(
        hass, 2, "haventory/item/create", conn=conn, name="Spanner", location_id=str(garage.id)
    )
    assert outside["success"] is True
    assert item_event_ids() == {SUB_ID_EVERYTHING, SUB_ID_NULL_AREA}

    # Neither does an item with no location: its effective_area_id is null, and a
    # null resolves to no area rather than to every area.
    conn.messages.clear()
    orphan = await ws_send(hass, 3, "haventory/item/create", conn=conn, name="Loose screw")
    assert orphan["success"] is True
    assert orphan["result"]["effective_area_id"] is None
    assert item_event_ids() == {SUB_ID_EVERYTHING, SUB_ID_NULL_AREA}


@pytest.mark.asyncio
async def test_area_and_location_filters_are_conjunctive() -> None:
    """`area_id` and `location_id` on one subscription both have to match."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    drawer = repo.create_location(name="Drawer", parent_id=kitchen.id)
    shelf = repo.create_location(name="Shelf", parent_id=kitchen.id)

    SUB_ID_BOTH = 601
    SUB_ID_UNUSED_AREA = 602
    await ws_send(
        hass,
        SUB_ID_BOTH,
        "haventory/subscribe",
        conn=conn,
        topic="items",
        area_id="kitchen",
        location_id=str(drawer.id),
    )
    # An area no item resolves to simply never matches; it is not an error.
    await ws_send(
        hass, SUB_ID_UNUSED_AREA, "haventory/subscribe", conn=conn, topic="items", area_id="attic"
    )

    def item_event_ids() -> set[object]:
        return {
            m.get("id")
            for m in conn.messages
            if m.get("type") == "event" and m.get("event", {}).get("topic") == "items"
        }

    conn.messages.clear()
    await ws_send(
        hass, 1, "haventory/item/create", conn=conn, name="Whisk", location_id=str(drawer.id)
    )
    assert item_event_ids() == {SUB_ID_BOTH}

    # Right area, wrong location.
    conn.messages.clear()
    await ws_send(
        hass, 2, "haventory/item/create", conn=conn, name="Jar", location_id=str(shelf.id)
    )
    assert item_event_ids() == set()


@pytest.mark.asyncio
async def test_location_area_change_emits_no_item_events() -> None:
    """Re-anchoring a subtree rewrites effective_area_id without item events.

    An area-filtered subscription therefore sees no departure when the items it
    was watching leave the area — the same rule `inspection_overdue_only`
    carries: filters are applied to the payload as it stands after a mutation,
    and a client tracking a filtered set re-lists rather than waiting for a
    departure event.
    """

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    garage = repo.create_location(name="Garage", area_id="garage")
    drawer = repo.create_location(name="Drawer", parent_id=kitchen.id)
    await ws_send(
        hass, 1, "haventory/item/create", conn=conn, name="Whisk", location_id=str(drawer.id)
    )

    SUB_ID_KITCHEN = 701
    await ws_send(
        hass, SUB_ID_KITCHEN, "haventory/subscribe", conn=conn, topic="items", area_id="kitchen"
    )
    await ws_send(hass, 702, "haventory/subscribe", conn=conn, topic="locations")

    conn.messages.clear()
    moved = await ws_send(
        hass,
        2,
        "haventory/location/move_subtree",
        conn=conn,
        location_id=str(drawer.id),
        new_parent_id=str(garage.id),
    )
    assert moved["success"] is True

    assert [ev.get("action") for ev in conn.events(topic="locations")] == ["moved"]
    assert conn.events(topic="items") == []

    # The item is genuinely out of the kitchen now, and the next event about it
    # goes only to subscriptions watching where it landed.
    conn.messages.clear()
    listed = await ws_send(hass, 3, "haventory/item/list", conn=conn, filter={"area_id": "garage"})
    assert [it["name"] for it in listed["result"]["items"]] == ["Whisk"]
    assert conn.events(topic="items") == []


@pytest.mark.asyncio
async def test_reassigning_a_locations_own_area_announces_one_moved_event() -> None:
    """A location's own ``area_id`` change is announced like a re-parent.

    It re-anchors the whole subtree — every item under it gets a new
    ``effective_area_id`` — so a second viewer filtered to the area the subtree
    just left has to re-list, and a `locations` event is the only signal that
    tells it to. Still no item events: the items themselves did not change.
    """

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    reg = await async_get_area_registry(hass)
    reg._add("kitchen", "Kitchen")  # type: ignore[attr-defined]
    reg._add("garage", "Garage")  # type: ignore[attr-defined]

    conn = _ConnStub()
    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    drawer = repo.create_location(name="Drawer", parent_id=kitchen.id)
    await ws_send(
        hass, 1, "haventory/item/create", conn=conn, name="Whisk", location_id=str(drawer.id)
    )
    await ws_send(hass, 700, "haventory/subscribe", conn=conn, topic="locations")
    await ws_send(hass, 701, "haventory/subscribe", conn=conn, topic="items", area_id="kitchen")

    conn.messages.clear()
    res = await ws_send(
        hass,
        2,
        "haventory/location/update",
        conn=conn,
        location_id=str(kitchen.id),
        area_id="garage",
    )
    assert res["success"] is True

    assert [ev.get("action") for ev in conn.events(topic="locations")] == ["moved"]
    assert conn.events(topic="items") == []


@pytest.mark.asyncio
async def test_an_area_set_on_a_nested_location_is_announced_too() -> None:
    """The card offers this, and the row it edits is not where the area lands.

    A tree's area is stored on its root, so setting one on a location further
    down leaves that location's own ``area_id`` at None and moves the root's.
    Every item in the tree still gets a new ``effective_area_id``, so a viewer
    filtered to the area the tree just left has to hear about it.
    """

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    reg = await async_get_area_registry(hass)
    reg._add("kitchen", "Kitchen")  # type: ignore[attr-defined]
    reg._add("bedroom", "Bedroom")  # type: ignore[attr-defined]

    conn = _ConnStub()
    root = repo.create_location(name="Home", area_id="kitchen")
    shelf = repo.create_location(name="Shelf", parent_id=root.id)
    created = await ws_send(
        hass, 1, "haventory/item/create", conn=conn, name="Whisk", location_id=str(shelf.id)
    )
    assert created["result"]["effective_area_id"] == "kitchen"
    await ws_send(hass, 700, "haventory/subscribe", conn=conn, topic="locations")

    conn.messages.clear()
    res = await ws_send(
        hass,
        2,
        "haventory/location/update",
        conn=conn,
        location_id=str(shelf.id),
        area_id="bedroom",
    )
    # The edited row keeps no area of its own — the root took it.
    assert res["success"] is True and res["result"]["area_id"] is None
    assert repo.get_location(str(root.id)).area_id == "bedroom"

    assert [ev.get("action") for ev in conn.events(topic="locations")] == ["moved"]
    assert conn.events(topic="items") == []

    listed = await ws_send(hass, 3, "haventory/item/list", conn=conn, filter={"area_id": "bedroom"})
    assert [it["name"] for it in listed["result"]["items"]] == ["Whisk"]


@pytest.mark.asyncio
async def test_an_area_a_nested_location_already_resolves_to_is_silent() -> None:
    """Sending the area that is already in force moves nothing, so it says nothing.

    The repository reports an area change as requested whenever the value differs
    from the edited row's own field, and below a root that field is always None —
    so every such call looks like a change from there. What decides the broadcast
    is whether the tree ended up somewhere else, and here it did not.
    """

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    reg = await async_get_area_registry(hass)
    reg._add("kitchen", "Kitchen")  # type: ignore[attr-defined]

    conn = _ConnStub()
    root = repo.create_location(name="Home", area_id="kitchen")
    shelf = repo.create_location(name="Shelf", parent_id=root.id)
    await ws_send(hass, 700, "haventory/subscribe", conn=conn, topic="locations")

    # Every field on every save, the way the card's location editor submits, with
    # the area the tree already resolves to.
    conn.messages.clear()
    res = await ws_send(
        hass,
        1,
        "haventory/location/update",
        conn=conn,
        location_id=str(shelf.id),
        name="Shelf",
        area_id="kitchen",
    )
    assert res["success"] is True
    assert repo.get_location(str(root.id)).area_id == "kitchen"
    assert conn.events(topic="locations") == []


@pytest.mark.asyncio
async def test_location_update_announces_what_changed_once() -> None:
    """One event per call, keyed on the change rather than on the keys sent.

    The card's location editor submits every field it holds on every save, so a
    request carrying an unchanged ``new_parent_id`` beside a new name is a plain
    rename and must say so. A request that changes two anchors at once is still
    one move, and a request that changes nothing announces nothing.
    """

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    reg = await async_get_area_registry(hass)
    reg._add("garage", "Garage")  # type: ignore[attr-defined]

    conn = _ConnStub()
    root = repo.create_location(name="Root")
    other_root = repo.create_location(name="Other")
    shelf = repo.create_location(name="Shelf", parent_id=root.id)
    await ws_send(hass, 700, "haventory/subscribe", conn=conn, topic="locations")

    conn.messages.clear()
    renamed = await ws_send(
        hass,
        1,
        "haventory/location/update",
        conn=conn,
        location_id=str(shelf.id),
        name="Shelf A",
        new_parent_id=str(root.id),
    )
    assert renamed["success"] is True
    assert [ev.get("action") for ev in conn.events(topic="locations")] == ["renamed"]

    conn.messages.clear()
    moved = await ws_send(
        hass,
        2,
        "haventory/location/update",
        conn=conn,
        location_id=str(shelf.id),
        new_parent_id=str(other_root.id),
        area_id="garage",
    )
    assert moved["success"] is True
    assert [ev.get("action") for ev in conn.events(topic="locations")] == ["moved"]

    conn.messages.clear()
    unchanged = await ws_send(
        hass,
        3,
        "haventory/location/update",
        conn=conn,
        location_id=str(shelf.id),
        name="Shelf A",
        new_parent_id=str(other_root.id),
    )
    assert unchanged["success"] is True
    assert conn.events(topic="locations") == []


@pytest.mark.asyncio
async def test_framework_unsubscribe_events_tears_down_subscription() -> None:
    """Subscriptions register in HA's own registry so core ``unsubscribe_events``
    (the teardown path the frontend's ``subscribeMessage`` uses) can cancel them.

    Before the fix nothing was registered under the message id, so core replied
    ``not_found`` ("Subscription not found.") on every teardown — an unhandled
    rejection in the card.
    """

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    sub_id = 501
    conn = _HAConnStub()
    res = await ws_send(hass, sub_id, "haventory/subscribe", conn=conn, topic="items")
    assert res["success"] is True

    # The zero-arg teardown is registered under the message id — exactly what core's
    # ``unsubscribe_events`` looks up (`if subscription in connection.subscriptions`).
    assert sub_id in conn.subscriptions
    assert callable(conn.subscriptions[sub_id])

    # Events flow while subscribed.
    await ws_send(hass, 1, "haventory/item/create", conn=conn, name="Box")
    assert len(conn.events(topic="items")) >= 1

    # Emulate core ``unsubscribe_events``: the id is found -> success (no not_found).
    assert conn.core_unsubscribe_events(sub_id) is True
    assert sub_id not in conn.subscriptions
    assert conn not in _subs_bucket(hass)  # our bucket was cleaned up too

    # No further deliveries after teardown.
    conn.messages.clear()
    await ws_send(hass, 2, "haventory/item/create", conn=conn, name="Tape")
    assert conn.events(topic="items") == []


@pytest.mark.asyncio
async def test_dedicated_unsubscribe_clears_framework_registry() -> None:
    """``haventory/unsubscribe`` also clears the HA-registry entry, keeping the two
    teardown paths symmetric (no stale callback left in ``connection.subscriptions``)."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    sub_id = 601
    conn = _HAConnStub()
    await ws_send(hass, sub_id, "haventory/subscribe", conn=conn, topic="stats")
    assert sub_id in conn.subscriptions

    res = await ws_send(hass, 602, "haventory/unsubscribe", conn=conn, subscription=sub_id)
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
    install_runtime(hass)
    ws_setup(hass)

    conn = _SlottedHAConn()

    # Two subscribes on the same connection must not raise, must register the per-id
    # framework teardown for each, and must leave exactly one connection-cleanup entry.
    sub_a, sub_b = 701, 702
    r1 = await ws_send(hass, sub_a, "haventory/subscribe", conn=conn, topic="items")
    r2 = await ws_send(hass, sub_b, "haventory/subscribe", conn=conn, topic="stats")
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


@pytest.mark.asyncio
async def test_location_ids_scopes_a_subscription_to_several_locations() -> None:
    """The multi-select filter's own delivery path, unioned like the query's."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    conn = _ConnStub()

    # Kitchen -> Drawer, plus Garage and Cellar as separate roots.
    kitchen = repo.create_location(name="Kitchen")
    drawer = repo.create_location(name="Drawer", parent_id=kitchen.id)
    garage = repo.create_location(name="Garage")
    cellar = repo.create_location(name="Cellar")

    SUB_ID_TWO = 601
    SUB_ID_DIRECT = 602
    SUB_ID_UNION = 603
    await ws_send(
        hass,
        SUB_ID_TWO,
        "haventory/subscribe",
        conn=conn,
        topic="items",
        location_ids=[str(kitchen.id), str(garage.id)],
    )
    # One flag for the whole selection: without the subtree, only the two
    # locations themselves count, not the drawer under the kitchen.
    await ws_send(
        hass,
        SUB_ID_DIRECT,
        "haventory/subscribe",
        conn=conn,
        topic="items",
        location_ids=[str(kitchen.id), str(garage.id)],
        include_subtree=False,
    )
    # The scalar and the list are one selection, not two conditions.
    await ws_send(
        hass,
        SUB_ID_UNION,
        "haventory/subscribe",
        conn=conn,
        topic="items",
        location_id=str(cellar.id),
        location_ids=[str(garage.id)],
    )

    def item_event_ids() -> set[object]:
        return {
            m.get("id")
            for m in conn.messages
            if m.get("type") == "event" and m.get("event", {}).get("topic") == "items"
        }

    conn.messages.clear()
    await ws_send(
        hass, 1, "haventory/item/create", conn=conn, name="Whisk", location_id=str(drawer.id)
    )
    assert item_event_ids() == {SUB_ID_TWO}

    conn.messages.clear()
    await ws_send(
        hass, 2, "haventory/item/create", conn=conn, name="Spanner", location_id=str(garage.id)
    )
    assert item_event_ids() == {SUB_ID_TWO, SUB_ID_DIRECT, SUB_ID_UNION}

    conn.messages.clear()
    await ws_send(
        hass, 3, "haventory/item/create", conn=conn, name="Jam", location_id=str(cellar.id)
    )
    assert item_event_ids() == {SUB_ID_UNION}

    # An item with no location reaches no location-scoped subscription.
    conn.messages.clear()
    await ws_send(hass, 4, "haventory/item/create", conn=conn, name="Loose screw")
    assert item_event_ids() == set()


@pytest.mark.asyncio
async def test_subscribe_refuses_location_ids_that_is_not_a_list() -> None:
    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(
        hass, 1, "haventory/subscribe", conn=_ConnStub(), topic="items", location_ids="not-a-list"
    )
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
