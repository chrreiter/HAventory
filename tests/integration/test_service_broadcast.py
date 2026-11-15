"""Integration: a service call dispatched by Home Assistant reaches a subscriber.

The call goes through `hass.services.async_call` and the events come back down a
real WebSocket — which is the shape the bug was reported in: an automation runs,
the sensors move, and the card left open on another tab keeps showing the old
list.
"""

from __future__ import annotations

from custom_components.haventory.const import EVENT_ITEM_CHANGED
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import async_capture_events


async def test_item_create_service_delivers_items_and_counts(
    setup_entry, ws_connect, call_service
) -> None:
    """A service create and a command create announce the same, each exactly once."""

    await setup_entry()
    ws = await ws_connect()
    items_sub = await ws.subscribe("items")
    stats_sub = await ws.subscribe("stats")

    await call_service("item_create", name="Torch")
    await ws.drain()
    assert [f["id"] for f in ws.event_frames if f["event"]["topic"] == "items"] == [items_sub]
    assert [f["id"] for f in ws.event_frames if f["event"]["topic"] == "stats"] == [stats_sub]
    assert [e["action"] for e in ws.events("items")] == ["created"]
    assert ws.events("items")[0]["item"]["name"] == "Torch"
    assert [e["action"] for e in ws.events("stats")] == ["counts"]
    assert ws.events("stats")[0]["counts"]["items_total"] == 1
    from_service = [e["action"] for e in ws.events()]

    ws.event_frames.clear()
    await ws.send("haventory/item/create", name="Lamp")
    assert [e["action"] for e in ws.events()] == from_service


async def test_every_item_service_delivers_one_event_with_its_action(
    hass: HomeAssistant, setup_entry, ws_connect, call_service
) -> None:
    """Every write path, not just the one the issue happened to name."""

    await setup_entry()
    garage = (await call_service("location_create", name="Garage"))["location"]
    item_id = (await call_service("item_create", name="Widget"))["item"]["id"]

    ws = await ws_connect()
    await ws.subscribe("items")
    on_bus = async_capture_events(hass, EVENT_ITEM_CHANGED)

    calls: list[tuple[str, dict, str]] = [
        ("item_update", {"item_id": item_id, "name": "Widget Pro"}, "updated"),
        ("item_update", {"item_id": item_id, "location_id": garage["id"]}, "moved"),
        ("item_move", {"item_id": item_id, "new_location_id": None}, "moved"),
        ("item_adjust_quantity", {"item_id": item_id, "delta": 2}, "quantity_changed"),
        ("item_set_quantity", {"item_id": item_id, "quantity": 7}, "quantity_changed"),
        ("item_check_out", {"item_id": item_id, "due_date": "2030-01-01"}, "checked_out"),
        ("item_check_in", {"item_id": item_id}, "checked_in"),
        (
            "item_update",
            {
                "item_id": item_id,
                "reminder_date": "2030-01-01",
                "reminder_interval": {"unit": "days", "count": 7},
            },
            "updated",
        ),
        ("reminder_bump", {"item_id": item_id}, "updated"),
        ("item_delete", {"item_id": item_id}, "deleted"),
    ]
    for service, payload, _action in calls:
        await call_service(service, **payload)
    await ws.drain()

    expected = [action for _s, _p, action in calls]
    assert [e["action"] for e in ws.events("items")] == expected
    assert [e.data["action"] for e in on_bus] == expected
    assert {e.data["item_id"] for e in on_bus} == {item_id}


async def test_location_services_deliver_locations_events(
    hass: HomeAssistant, setup_entry, ws_connect, call_service
) -> None:
    """The other half of "a `haventory.*` mutation reaches no subscriber"."""

    await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("locations")
    on_bus = async_capture_events(hass, EVENT_ITEM_CHANGED)

    created = await call_service("location_create", name="Garage")
    location_id = created["location"]["id"]
    await call_service("location_update", location_id=location_id, name="Shed")
    await call_service("location_delete", location_id=location_id)
    await ws.drain()

    events = ws.events("locations")
    assert [e["action"] for e in events] == ["created", "renamed", "deleted"]
    assert events[0]["location"]["name"] == "Garage"
    # No item changed, so nothing goes on the bus.
    assert on_bus == []
