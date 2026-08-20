"""Integration: a service call dispatched by Home Assistant reaches a subscriber.

The offline suite awaits the service handler itself, which cannot see how Home
Assistant dispatches it, and drives a stub connection rather than a socket. Here
the call goes through `hass.services.async_call` and the events come back down a
real WebSocket — which is the shape the bug was reported in: an automation runs,
the sensors move, and the card left open on another tab keeps showing the old
list.
"""

from __future__ import annotations

import asyncio

from custom_components.haventory.const import DOMAIN
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

EVENT_WAIT_SECONDS = 5

# Subscription ids, so an assertion can say which topic a frame arrived on.
ITEMS_SUB = 10
STATS_SUB = 11


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _subscribe(client, sub_id: int, topic: str) -> None:
    await client.send_json({"id": sub_id, "type": "haventory/subscribe", "topic": topic})
    result = await client.receive_json()
    assert result["success"] is True, result


async def _drain_events(client, count: int) -> list[dict]:
    """The next `count` event frames, in arrival order.

    Bounded, because the regression this file guards against is events that
    never arrive: an unbounded read would hang the run instead of failing it.
    """

    frames: list[dict] = []
    try:
        async with asyncio.timeout(EVENT_WAIT_SECONDS):
            while len(frames) < count:
                frame = await client.receive_json()
                if frame["type"] == "event":
                    frames.append(frame)
    except TimeoutError:
        raise AssertionError(
            f"expected {count} event frames, {len(frames)} arrived: {frames}"
        ) from None
    return frames


async def test_item_create_service_delivers_items_and_counts(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """#450's acceptance, through the registry that actually dispatches."""

    await _setup(hass)
    client = await hass_ws_client(hass)
    await _subscribe(client, ITEMS_SUB, "items")
    await _subscribe(client, STATS_SUB, "stats")

    await hass.services.async_call(DOMAIN, "item_create", {"name": "Torch"}, blocking=True)
    await hass.async_block_till_done()

    frames = await _drain_events(client, 2)
    items = next(f for f in frames if f["event"]["topic"] == "items")
    stats = next(f for f in frames if f["event"]["topic"] == "stats")

    assert items["id"] == ITEMS_SUB
    assert items["event"]["action"] == "created"
    assert items["event"]["item"]["name"] == "Torch"
    assert stats["id"] == STATS_SUB
    assert stats["event"]["action"] == "counts"
    assert stats["event"]["counts"]["items_total"] == 1


async def test_every_item_service_delivers_one_event_with_its_action(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """Every write path, not just the one the issue happened to name."""

    await _setup(hass)
    created = await hass.services.async_call(
        DOMAIN, "item_create", {"name": "Widget"}, blocking=True, return_response=True
    )
    item_id = created["item"]["id"]

    client = await hass_ws_client(hass)
    await _subscribe(client, 20, "items")

    calls: list[tuple[str, dict, str]] = [
        ("item_update", {"item_id": item_id, "name": "Widget Pro"}, "updated"),
        ("item_move", {"item_id": item_id, "new_location_id": None}, "moved"),
        ("item_adjust_quantity", {"item_id": item_id, "delta": 2}, "quantity_changed"),
        ("item_set_quantity", {"item_id": item_id, "quantity": 7}, "quantity_changed"),
        ("item_check_out", {"item_id": item_id, "due_date": "2030-01-01"}, "checked_out"),
        ("item_check_in", {"item_id": item_id}, "checked_in"),
        ("item_delete", {"item_id": item_id}, "deleted"),
    ]
    for service, payload, _action in calls:
        await hass.services.async_call(DOMAIN, service, payload, blocking=True)
        await hass.async_block_till_done()

    frames = await _drain_events(client, len(calls))
    assert [f["event"]["action"] for f in frames] == [action for _s, _p, action in calls]


async def test_location_services_deliver_locations_events(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """The other half of "a `haventory.*` mutation reaches no subscriber"."""

    await _setup(hass)
    client = await hass_ws_client(hass)
    await _subscribe(client, 30, "locations")

    created = await hass.services.async_call(
        DOMAIN, "location_create", {"name": "Garage"}, blocking=True, return_response=True
    )
    location_id = created["location"]["id"]
    await hass.services.async_call(
        DOMAIN, "location_update", {"location_id": location_id, "name": "Shed"}, blocking=True
    )
    await hass.services.async_call(
        DOMAIN, "location_delete", {"location_id": location_id}, blocking=True
    )
    await hass.async_block_till_done()

    frames = await _drain_events(client, 3)
    assert [f["event"]["action"] for f in frames] == ["created", "renamed", "deleted"]
    assert frames[0]["event"]["location"]["name"] == "Garage"
