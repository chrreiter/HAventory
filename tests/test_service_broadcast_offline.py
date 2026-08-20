"""Offline tests: a `haventory.*` service mutation reaches WebSocket subscribers.

The service handlers are called directly here rather than through
``hass.services``, because the offline `HomeAssistant` stub has no service
registry — `tests/integration/test_services.py` is where real dispatch is
asserted. What these cover is the fan-out itself:

- every item service delivers its `items` event and one `stats` counts event
- every location service delivers its `locations` event
- the WebSocket command beside each service delivers exactly the same events,
  once, so folding the broadcast into `events.notify_mutation` did not start
  sending two
- a batch sends one counts event, not one per row
- the rate limiter charges the WebSocket half exactly as it did, and charges the
  bus half nothing
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory import events as events_mod
from custom_components.haventory import rate_limit as rate_limit_module
from custom_components.haventory import services as services_mod
from custom_components.haventory.const import DOMAIN, EVENT_ITEM_CHANGED
from custom_components.haventory.rate_limit import RateLimitConfig, RateLimiter
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from ws_helpers import RecordingConn, ws_send

_BULK_ROWS = 3


def _hass(limiter: RateLimiter | None = None) -> HomeAssistant:
    hass = HomeAssistant()
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["repository"] = Repository()
    bucket["store"] = DomainStore(hass)
    if limiter is not None:
        bucket["rate_limiter"] = limiter
    ws_setup(hass)
    events_mod.seed_low_stock_snapshot(hass)
    return hass


async def _subscribed(hass: HomeAssistant, *topics: str) -> RecordingConn:
    conn = RecordingConn()
    for index, topic in enumerate(topics, start=900):
        res = await ws_send(hass, index, "haventory/subscribe", conn=conn, topic=topic)
        assert res["success"] is True, res
    conn.messages.clear()
    return conn


def _actions(conn: RecordingConn, topic: str) -> list[str]:
    return [str(ev.get("action")) for ev in conn.events(topic=topic)]


@pytest.mark.asyncio
async def test_the_item_create_service_reaches_an_open_subscription() -> None:
    """The bug this file exists for: the bus heard it and no subscriber did."""

    hass = _hass()
    conn = await _subscribed(hass, "items", "stats")

    result = await services_mod.service_item_create(hass, {"name": "Torch"})

    items = conn.events(topic="items")
    assert [ev["action"] for ev in items] == ["created"]
    assert items[0]["item"]["id"] == result["item"]["id"]
    assert _actions(conn, "stats") == ["counts"]
    assert conn.events(topic="stats")[0]["counts"]["items_total"] == 1
    # The bus half is untouched by the fan-out gaining a second surface.
    assert [e["action"] for e in hass.bus.events_of(EVENT_ITEM_CHANGED)] == ["created"]


@pytest.mark.asyncio
async def test_every_item_service_delivers_its_own_action() -> None:
    """One vocabulary across both surfaces, service side as well as command side."""

    hass = _hass()
    created = await services_mod.service_item_create(hass, {"name": "Widget", "quantity": 5})
    item_id = created["item"]["id"]
    conn = await _subscribed(hass, "items")

    calls: list[tuple[Any, dict[str, Any], str]] = [
        (services_mod.service_item_update, {"item_id": item_id, "name": "Widget Pro"}, "updated"),
        (services_mod.service_item_move, {"item_id": item_id, "new_location_id": None}, "moved"),
        (
            services_mod.service_item_adjust_quantity,
            {"item_id": item_id, "delta": -1},
            "quantity_changed",
        ),
        (
            services_mod.service_item_set_quantity,
            {"item_id": item_id, "quantity": 7},
            "quantity_changed",
        ),
        (
            services_mod.service_item_check_out,
            {"item_id": item_id, "due_date": "2030-01-01"},
            "checked_out",
        ),
        (services_mod.service_item_check_in, {"item_id": item_id}, "checked_in"),
        (services_mod.service_item_delete, {"item_id": item_id}, "deleted"),
    ]
    for handler, payload, _action in calls:
        await handler(hass, payload)

    assert _actions(conn, "items") == [action for _h, _p, action in calls]
    assert {a for a in _actions(conn, "items")} <= events_mod.ITEM_ACTIONS


@pytest.mark.asyncio
async def test_the_location_services_reach_a_locations_subscription() -> None:
    """The other half of "a `haventory.*` mutation reaches no subscriber"."""

    hass = _hass()
    conn = await _subscribed(hass, "locations")

    created = await services_mod.service_location_create(hass, {"name": "Garage"})
    location_id = created["location"]["id"]
    await services_mod.service_location_update(hass, {"location_id": location_id, "name": "Shed"})
    await services_mod.service_location_delete(hass, {"location_id": location_id})

    assert _actions(conn, "locations") == ["created", "renamed", "deleted"]
    # A location mutation is not an item mutation, on either surface.
    assert hass.bus.events_of(EVENT_ITEM_CHANGED) == []


@pytest.mark.asyncio
async def test_a_re_parent_through_the_service_announces_a_move() -> None:
    """`moved` and `renamed` are decided by what changed, not by the keys sent."""

    hass = _hass()
    garage = await services_mod.service_location_create(hass, {"name": "Garage"})
    shelf = await services_mod.service_location_create(hass, {"name": "Shelf"})
    conn = await _subscribed(hass, "locations")

    await services_mod.service_location_update(
        hass,
        # The name is re-sent unchanged, the way an editor saving every field does.
        {
            "location_id": shelf["location"]["id"],
            "name": "Shelf",
            "new_parent_id": garage["location"]["id"],
        },
    )

    assert _actions(conn, "locations") == ["moved"]


@pytest.mark.asyncio
async def test_the_command_and_the_service_deliver_the_same_events_once() -> None:
    """Folding the broadcast into the notification must not have doubled it."""

    hass = _hass()
    conn = await _subscribed(hass, "items", "stats")

    assert (await ws_send(hass, 1, "haventory/item/create", conn=conn, name="Hammer"))["success"]
    from_command = (_actions(conn, "items"), _actions(conn, "stats"))
    conn.messages.clear()

    await services_mod.service_item_create(hass, {"name": "Chisel"})
    from_service = (_actions(conn, "items"), _actions(conn, "stats"))

    assert from_command == (["created"], ["counts"])
    assert from_service == from_command


@pytest.mark.asyncio
async def test_a_bulk_command_sends_one_counts_event_for_the_batch() -> None:
    """Per-row counts would put a whole counts object on the wire once per row."""

    hass = _hass()
    ids = [
        (await ws_send(hass, index, "haventory/item/create", name=f"Item {index}"))["result"]["id"]
        for index in range(1, _BULK_ROWS + 1)
    ]
    conn = await _subscribed(hass, "items", "stats")

    res = await ws_send(
        hass,
        50,
        "haventory/items/bulk",
        conn=conn,
        operations=[
            {
                "op_id": f"op{n}",
                "kind": "item_set_quantity",
                "payload": {"item_id": iid, "quantity": 4},
            }
            for n, iid in enumerate(ids)
        ],
    )
    assert res["success"] is True, res

    assert _actions(conn, "items") == ["quantity_changed"] * _BULK_ROWS
    assert _actions(conn, "stats") == ["counts"]


@pytest.mark.asyncio
async def test_the_service_half_is_charged_the_same_event_budget(monkeypatch) -> None:
    """The WebSocket half spends a token; the bus half spends nothing.

    A service call was free of the event budget only because it emitted no
    event. Now that it emits one, it costs exactly what the command beside it
    costs — and the `haventory_item_changed` that goes out with it still costs
    nothing, because the limiter budgets subscription traffic.
    """

    monkeypatch.setattr(rate_limit_module, "_monotonic", lambda: 1000.0)
    limiter = RateLimiter(
        RateLimitConfig(
            enabled=True,
            commands_per_second=1.0,
            commands_burst=1000.0,
            global_commands_per_second=1.0,
            global_commands_burst=1000.0,
            events_per_second=1.0,
            # Two tokens: the `items` event and the `stats` event of one mutation.
            events_burst=2.0,
            global_events_per_second=1.0,
            global_events_burst=1000.0,
        )
    )
    hass = _hass(limiter)
    conn = await _subscribed(hass, "items", "stats")

    await services_mod.service_item_create(hass, {"name": "Torch"})
    assert _actions(conn, "items") == ["created"]
    assert _actions(conn, "stats") == ["counts"]
    assert limiter.dropped_events == 0

    # The budget is spent, so the next service call reaches the bus and not the
    # wire — a dropped event, never a failed mutation.
    result = await services_mod.service_item_create(hass, {"name": "Chisel"})
    assert result["item"]["name"] == "Chisel"
    assert _actions(conn, "items") == ["created"]
    dropped_by_a_single_mutation = 2
    assert limiter.dropped_events == dropped_by_a_single_mutation
    fired_on_the_bus = 2
    assert len(hass.bus.events_of(EVENT_ITEM_CHANGED)) == fired_on_the_bus
