"""Integration: HAventory events on the real Home Assistant bus.

The offline stub records what `events.py` asked the bus to fire; only a real bus
shows that a listener — and so an automation trigger — actually receives it.
"""

from __future__ import annotations

from typing import Any

from custom_components.haventory.const import DOMAIN, EVENT_ITEM_CHANGED, EVENT_LOW_STOCK
from custom_components.haventory.runtime import find_runtime
from homeassistant.core import Event, HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events

LOW_THRESHOLD = 3
CREATED_QUANTITY = 2


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def _data(events: list[Event]) -> list[dict[str, Any]]:
    return [dict(e.data) for e in events]


async def test_a_service_call_reaches_a_bus_listener(hass: HomeAssistant) -> None:
    """`hass.bus.async_listen` sees `haventory_item_changed` from a service."""

    await _setup(hass)
    captured = async_capture_events(hass, EVENT_ITEM_CHANGED)

    await hass.services.async_call(
        DOMAIN, "item_create", {"name": "Torch", "quantity": CREATED_QUANTITY}, blocking=True
    )
    await hass.async_block_till_done()

    assert len(captured) == 1
    payload = _data(captured)[0]
    assert payload["action"] == "created"
    assert payload["name"] == "Torch"
    assert payload["quantity"] == CREATED_QUANTITY
    assert payload["version"] == 1
    assert payload["ts"].endswith("Z")


async def test_a_websocket_mutation_reaches_a_bus_listener(
    hass: HomeAssistant, hass_ws_client
) -> None:
    await _setup(hass)
    captured = async_capture_events(hass, EVENT_ITEM_CHANGED)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Torch"})
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()

    assert [p["action"] for p in _data(captured)] == ["created"]


async def test_low_stock_fires_entered_and_cleared(hass: HomeAssistant) -> None:
    """The transition an automation triggers on, both ways, from a service call."""

    await _setup(hass)
    captured = async_capture_events(hass, EVENT_LOW_STOCK)

    created = await hass.services.async_call(
        DOMAIN,
        "item_create",
        {"name": "Batteries", "quantity": 10, "low_stock_threshold": LOW_THRESHOLD},
        blocking=True,
        return_response=True,
    )
    await hass.async_block_till_done()
    assert captured == []

    item_id = created["item"]["id"]
    await hass.services.async_call(
        DOMAIN, "item_set_quantity", {"item_id": item_id, "quantity": 1}, blocking=True
    )
    await hass.async_block_till_done()
    assert [p["action"] for p in _data(captured)] == ["entered"]
    assert _data(captured)[0]["item_id"] == item_id
    assert _data(captured)[0]["low_stock_threshold"] == LOW_THRESHOLD

    await hass.services.async_call(
        DOMAIN, "item_set_quantity", {"item_id": item_id, "quantity": 10}, blocking=True
    )
    await hass.async_block_till_done()
    assert [p["action"] for p in _data(captured)] == ["entered", "cleared"]


async def test_a_real_automation_triggers_on_low_stock(hass: HomeAssistant) -> None:
    """The story #218 promises, through HA's automation engine rather than a listener.

    An event trigger with an `action: entered` filter, and a template that reads
    the payload — which is what pins the event's field names as a public API and
    not just as a dict this integration happens to fire.
    """

    await _setup(hass)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": {
                "alias": "notify on low stock",
                "trigger": {
                    "platform": "event",
                    "event_type": EVENT_LOW_STOCK,
                    "event_data": {"action": "entered"},
                },
                "action": {
                    "event": "haventory_test_automation_ran",
                    "event_data": {
                        "item": "{{ trigger.event.data.name }}",
                        "quantity": "{{ trigger.event.data.quantity }}",
                    },
                },
            }
        },
    )
    await hass.async_block_till_done()

    fired = async_capture_events(hass, "haventory_test_automation_ran")

    created = await hass.services.async_call(
        DOMAIN,
        "item_create",
        {"name": "Batteries", "quantity": 10, "low_stock_threshold": LOW_THRESHOLD},
        blocking=True,
        return_response=True,
    )
    await hass.async_block_till_done()
    # Above the threshold: the trigger's `entered` filter has nothing to match.
    assert fired == []

    await hass.services.async_call(
        DOMAIN,
        "item_set_quantity",
        {"item_id": created["item"]["id"], "quantity": 1},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert [dict(e.data) for e in fired] == [{"item": "Batteries", "quantity": 1}]


async def test_a_restart_re_announces_nothing(hass: HomeAssistant, hass_storage) -> None:
    """Setting up against a store that already holds low items fires no event."""

    entry = await _setup(hass)
    await hass.services.async_call(
        DOMAIN,
        "item_create",
        {"name": "Batteries", "quantity": 1, "low_stock_threshold": LOW_THRESHOLD},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    captured = async_capture_events(hass, EVENT_LOW_STOCK)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert captured == []
    assert find_runtime(hass).repository.low_stock_item_ids


async def test_a_status_reassignment_reaches_the_bus_once_per_item(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """A bulk rewrite is still a set of item edits, and each one is announced.

    `status/delete` with `reassign_to` gives every affected item a new version
    and a new `updated_at`, but announced only the vocabulary change — so an
    automation triggered on `haventory_item_changed` saw nothing while a whole
    set moved underneath it.
    """

    await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json(
        {"id": 1, "type": "haventory/status/create", "slug": "lent_out", "label": "Lent out"}
    )
    assert (await client.receive_json())["success"]
    moved = []
    for index, name in enumerate(("Drill", "Ladder", "Torch"), start=2):
        await client.send_json(
            {"id": index, "type": "haventory/item/create", "name": name, "status": "lent_out"}
        )
        moved.append((await client.receive_json())["result"]["id"])
    await client.send_json({"id": 10, "type": "haventory/item/create", "name": "Untouched"})
    assert (await client.receive_json())["success"]

    captured = async_capture_events(hass, EVENT_ITEM_CHANGED)
    await client.send_json(
        {"id": 11, "type": "haventory/status/delete", "slug": "lent_out", "reassign_to": "ok"}
    )
    result = await client.receive_json()
    assert result["success"], result
    assert result["result"]["reassigned"] == len(moved)
    await hass.async_block_till_done()

    payloads = _data(captured)
    assert {p["item_id"] for p in payloads} == set(moved)
    assert {p["action"] for p in payloads} == {"updated"}
