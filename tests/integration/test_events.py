"""Integration: HAventory events on the real Home Assistant bus, and at midnight.

The offline stub records what `events.py` asked the bus to fire; only a real bus
shows that a listener — and so an automation trigger — actually receives it. The
same goes for the day rollover: offline a test invokes the tracked action itself,
and only a real clock and a real socket show that the instance's own midnight
reaches a subscriber.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN, EVENT_ITEM_CHANGED, EVENT_LOW_STOCK
from custom_components.haventory.runtime import find_runtime
from homeassistant.core import Event, HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    CLIENT_ID,
    async_capture_events,
    async_fire_time_changed,
)

LOW_THRESHOLD = 3
CREATED_QUANTITY = 2


def _data(events: list[Event]) -> list[dict[str, Any]]:
    return [dict(e.data) for e in events]


async def test_a_service_call_reaches_a_bus_listener(hass: HomeAssistant, setup_entry) -> None:
    """A bus listener sees `haventory_item_changed` from a service, with its documented keys."""

    await setup_entry()
    captured = async_capture_events(hass, EVENT_ITEM_CHANGED)
    garage = (
        await hass.services.async_call(
            DOMAIN, "location_create", {"name": "Garage"}, blocking=True, return_response=True
        )
    )["location"]

    await hass.services.async_call(
        DOMAIN,
        "item_create",
        {
            "name": "Torch",
            "quantity": CREATED_QUANTITY,
            "location_id": garage["id"],
            "description": "Bright",
            "custom_fields": {"colour": "red"},
        },
        blocking=True,
    )
    await hass.async_block_till_done()

    assert len(captured) == 1
    payload = _data(captured)[0]
    assert set(payload) == {
        "action", "item_id", "name", "quantity", "location_id", "location_path",
        "effective_area_id", "version", "ts",
    }  # fmt: skip
    assert payload["location_id"] == garage["id"]
    assert payload["location_path"] == "Garage"
    assert payload["action"] == "created"
    assert payload["name"] == "Torch"
    assert payload["quantity"] == CREATED_QUANTITY
    assert payload["version"] == 1
    assert payload["ts"].endswith("Z")


async def test_a_websocket_mutation_reaches_a_bus_listener(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    await setup_entry()
    captured = async_capture_events(hass, EVENT_ITEM_CHANGED)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Torch"})
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()

    assert [p["action"] for p in _data(captured)] == ["created"]


async def test_low_stock_fires_entered_and_cleared(hass: HomeAssistant, setup_entry) -> None:
    """The transition an automation triggers on, both ways, from a service call."""

    await setup_entry()
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

    # A further drop is still low stock: the set did not change, so nothing fires.
    await hass.services.async_call(
        DOMAIN, "item_set_quantity", {"item_id": item_id, "quantity": 0}, blocking=True
    )
    await hass.async_block_till_done()
    assert [p["action"] for p in _data(captured)] == ["entered"]

    await hass.services.async_call(
        DOMAIN, "item_set_quantity", {"item_id": item_id, "quantity": 10}, blocking=True
    )
    await hass.async_block_till_done()
    assert [p["action"] for p in _data(captured)] == ["entered", "cleared"]

    # A deleted item is gone from the store; the event still names it.
    for call, data in (
        ("item_set_quantity", {"item_id": item_id, "quantity": 1}),
        ("item_delete", {"item_id": item_id}),
    ):
        await hass.services.async_call(DOMAIN, call, data, blocking=True)
    await hass.async_block_till_done()
    assert [p["action"] for p in _data(captured)] == ["entered", "cleared", "entered", "cleared"]
    assert _data(captured)[-1]["name"] == "Batteries"


async def test_a_real_automation_triggers_on_low_stock(hass: HomeAssistant, setup_entry) -> None:
    """The story #218 promises, through HA's automation engine rather than a listener.

    An event trigger with an `action: entered` filter, and a template that reads
    the payload — which is what pins the event's field names as a public API and
    not just as a dict this integration happens to fire.
    """

    await setup_entry()
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


async def test_a_restart_re_announces_nothing(
    hass: HomeAssistant, hass_storage, setup_entry
) -> None:
    """Setting up against a store that already holds low items fires no event."""

    entry = await setup_entry()
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

    # Nothing diffs until the next write, so an unrelated one is what shows the
    # setup-time snapshot held the item that was already low.
    await hass.services.async_call(DOMAIN, "item_create", {"name": "Tape"}, blocking=True)
    await hass.async_block_till_done()
    assert captured == []


async def test_a_status_reassignment_reaches_the_bus_once_per_item(
    hass: HomeAssistant, setup_entry, ws_connect
) -> None:
    """A bulk rewrite is still a set of item edits, and each one is announced.

    `status/delete` with `reassign_to` gives every affected item a new version
    and a new `updated_at`, but announced only the vocabulary change — so an
    automation triggered on `haventory_item_changed` saw nothing while a whole
    set moved underneath it.
    """

    await setup_entry()
    ws = await ws_connect()

    await ws.send("haventory/status/create", slug="lent_out", label="Lent out")
    moved = [
        (await ws.send("haventory/item/create", name=name, status="lent_out"))["result"]["id"]
        for name in ("Drill", "Ladder", "Torch")
    ]
    await ws.send("haventory/item/create", name="Untouched")

    captured = async_capture_events(hass, EVENT_ITEM_CHANGED)
    result = await ws.send("haventory/status/delete", slug="lent_out", reassign_to="ok")
    assert result["success"], result
    assert result["result"]["reassigned"] == len(moved)
    await hass.async_block_till_done()

    payloads = _data(captured)
    assert {p["item_id"] for p in payloads} == set(moved)
    assert {p["action"] for p in payloads} == {"updated"}
    # The version the reassignment wrote, not the one before it.
    assert {p["version"] for p in payloads} == {2}
    assert len(payloads) == len(moved)


async def test_a_bulk_batch_announces_each_row_and_settles_once(
    hass: HomeAssistant, setup_entry, ws_connect
) -> None:
    """Each row keeps its `items` event and its low-stock crossing; the batch counts once."""

    await setup_entry()
    ws = await ws_connect()
    ids = {
        name: (
            await ws.send(
                "haventory/item/create",
                name=name,
                quantity=10,
                low_stock_threshold=LOW_THRESHOLD,
            )
        )["result"]["id"]
        for name in ("Batteries", "Bulbs", "Candles", "Dowels")
    }
    await ws.subscribe("items")
    await ws.subscribe("stats")
    low_stock = async_capture_events(hass, EVENT_LOW_STOCK)
    ws.event_frames.clear()

    def batch(kind: str, rows: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"op_id": name, "kind": kind, "payload": {"item_id": ids[name], **payload}}
            for name, payload in rows.items()
        ]

    result = await ws.send(
        "haventory/items/bulk",
        operations=batch(
            "item_set_quantity",
            {"Batteries": {"quantity": 1}, "Bulbs": {"quantity": 1}, "Candles": {"quantity": 5}},
        ),
    )
    assert result["success"] is True, result
    # One diff after every row's own events; each crossing carries its own name.
    assert len(ws.events("items")) == 3  # noqa: PLR2004
    assert [e["action"] for e in ws.events("stats")] == ["counts"]
    await hass.async_block_till_done()
    assert sorted((p["action"], p["name"]) for p in _data(low_stock)) == [
        ("entered", "Batteries"),
        ("entered", "Bulbs"),
    ]

    # A deleted item is gone from the store; its row names it.
    ws.event_frames.clear()
    low_stock.clear()
    await ws.send(
        "haventory/items/bulk", operations=batch("item_delete", {"Batteries": {}, "Dowels": {}})
    )
    await hass.async_block_till_done()
    assert [
        (p["action"], p["item_id"], p["name"], p["quantity"], p["low_stock_threshold"])
        for p in _data(low_stock)
    ] == [("cleared", ids["Batteries"], "Batteries", 1, LOW_THRESHOLD)]

    # A batch whose only row fails announces nothing at all.
    ws.event_frames.clear()
    low_stock.clear()
    failed = await ws.send(
        "haventory/items/bulk",
        operations=[{"op_id": "a", "kind": "item_set_quantity", "payload": {"item_id": "nope"}}],
    )
    assert failed["result"]["results"]["a"]["success"] is False
    await hass.async_block_till_done()
    assert ws.event_frames == []
    assert low_stock == []


async def test_an_import_announces_the_low_stock_crossings_it_makes(
    hass: HomeAssistant, setup_entry, ws_connect
) -> None:
    """An import announces no row of its own, so each crossing is named from the store.

    A restock done by importing an edited export is still a restock.
    """

    await setup_entry()
    ws = await ws_connect()
    ids = {
        name: (
            await ws.send(
                "haventory/item/create",
                name=name,
                quantity=quantity,
                low_stock_threshold=LOW_THRESHOLD,
            )
        )["result"]["id"]
        for name, quantity in (("Batteries", 10), ("Bulbs", 1))
    }
    document = (await ws.send("haventory/export"))["result"]
    rows = {row["id"]: row for row in document["items"]}
    rows[ids["Batteries"]]["quantity"] = 1
    rows[ids["Bulbs"]]["quantity"] = 10
    document["items"] = list(rows.values())
    low_stock = async_capture_events(hass, EVENT_LOW_STOCK)

    result = await ws.send("haventory/import/execute", document=document, policy="replace")
    assert result["success"] is True, result
    await hass.async_block_till_done()

    announced = {p["item_id"]: (p["action"], p["name"]) for p in _data(low_stock)}
    assert announced == {
        ids["Batteries"]: ("entered", "Batteries"),
        ids["Bulbs"]: ("cleared", "Bulbs"),
    }


@pytest.mark.parametrize("bulk", [False, True], ids=["single_write", "bulk_mutation"])
async def test_a_failing_announcement_does_not_fail_the_write(
    setup_entry,
    ws_connect,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    bulk: bool,
) -> None:
    """The write is on disk before it is announced, so a failed announcement only logs."""

    message = "Failed to notify a bulk mutation" if bulk else "Failed to notify a mutation"
    await setup_entry()
    ws = await ws_connect()
    await ws.send("haventory/status/create", slug="lent_out", label="Lent out")
    seeded = (await ws.send("haventory/item/create", name="Drill", status="lent_out"))["result"]

    def _boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("dispatcher down")

    monkeypatch.setattr("custom_components.haventory.events.async_dispatcher_send", _boom)

    with caplog.at_level("ERROR", logger="custom_components.haventory.events"):
        if bulk:
            result = await ws.send("haventory/status/delete", slug="lent_out", reassign_to="ok")
            assert result["success"] is True, result
            item_id = seeded["id"]
        else:
            result = await ws.send("haventory/item/create", name="Ladder")
            assert result["success"] is True, result
            item_id = result["result"]["id"]

    listed = await ws.send("haventory/item/list")
    stored = {row["id"]: row for row in listed["result"]["items"]}
    assert item_id in stored
    if bulk:
        assert stored[item_id]["status"] == "ok"
    assert any(
        r.levelname == "ERROR"
        and r.name == "custom_components.haventory.events"
        and message in r.getMessage()
        for r in caplog.records
    )


# 11:00 UTC on 22 August is 23:00 the same day in New Zealand, and 12:00:30 UTC
# is half a minute past that household's midnight — while UTC is still on the
# 22nd. A tick scheduled for UTC's midnight would not have fired at that
# instant, which is what makes this the household's rollover and not the clock.
NZ_ZONE = "Pacific/Auckland"
NZ_LATE_EVENING = datetime(2026, 8, 22, 11, 0, tzinfo=UTC)
NZ_JUST_PAST_MIDNIGHT = datetime(2026, 8, 22, 12, 0, 30, tzinfo=UTC)
NZ_TOMORROW = "2026-08-23"

STATS_SUB = 21


async def _frozen_clock_client(hass: HomeAssistant, hass_ws_client: Any, user: Any) -> Any:
    """A socket authenticated under the clock the test froze.

    The harness's own token is minted before the freeze, and a jump of years is
    what these cases are made of — so the token is re-minted here, where "now"
    is the frozen instant, and the socket is opened after the entry so the entry
    can still register its views on a router the test client has not started.
    """

    refresh_token = await hass.auth.async_create_refresh_token(user, CLIENT_ID)
    return await hass_ws_client(hass, hass.auth.async_create_access_token(refresh_token))


async def _subscribe_stats(client: Any) -> None:
    await client.send_json({"id": STATS_SUB, "type": "haventory/subscribe", "topic": "stats"})
    result = await client.receive_json()
    assert result["success"] is True, result


async def _events_before_a_ping(client: Any, ping_id: int) -> list[dict[str, Any]]:
    """Every event frame already queued, drained behind a fresh command's reply.

    An ordering barrier rather than a read with a timeout, because these cases
    freeze the clock and `asyncio.timeout` is measured on a monotonic clock
    freezegun stops as well — a bounded read never returns at all. Frames are
    delivered in order, so anything broadcast before the ping was sent arrives
    before its reply, and "no event at all" reads back as an empty list instead
    of hanging the run.
    """

    await client.send_json({"id": ping_id, "type": "haventory/ping"})
    events: list[dict[str, Any]] = []
    while True:
        frame = await client.receive_json()
        if frame["type"] == "result" and frame["id"] == ping_id:
            return events
        if frame["type"] == "event":
            events.append(frame)


async def test_the_counts_roll_over_at_the_instances_midnight(
    hass: HomeAssistant, hass_ws_client: Any, hass_admin_user: Any, freezer: Any, setup_entry
) -> None:
    """#584: an open subscription hears the day turn, with nothing mutated.

    The date-derived counts move on the day boundary, and until this tick the
    only thing that told a subscriber was the next mutation — so a card left
    open across midnight disagreed with the sensors beside it on the same
    dashboard, once a day.
    """

    await hass.config.async_set_time_zone(NZ_ZONE)
    freezer.move_to(NZ_LATE_EVENING)

    await setup_entry()
    client = await _frozen_clock_client(hass, hass_ws_client, hass_admin_user)
    await _subscribe_stats(client)

    await hass.services.async_call(
        DOMAIN, "item_create", {"name": "Harness", "inspection_date": NZ_TOMORROW}, blocking=True
    )
    await hass.async_block_till_done()

    created = await _events_before_a_ping(client, 90)
    assert [f["event"]["action"] for f in created] == ["counts"]
    assert created[0]["event"]["counts"]["inspection_due_count"] == 0

    # Still 23:00 on the 22nd in the household: a timer sweep here announces
    # nothing, which is what tells the household's midnight from any other.
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()
    assert await _events_before_a_ping(client, 91) == []

    freezer.move_to(NZ_JUST_PAST_MIDNIGHT)
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()

    rolled = await _events_before_a_ping(client, 92)
    assert len(rolled) == 1, rolled
    assert rolled[0]["id"] == STATS_SUB
    assert rolled[0]["event"]["topic"] == "stats"
    assert rolled[0]["event"]["action"] == "counts"
    assert rolled[0]["event"]["counts"]["inspection_due_count"] == 1


async def test_an_unloaded_entry_announces_no_rollover(
    hass: HomeAssistant, hass_ws_client: Any, hass_admin_user: Any, freezer: Any, setup_entry
) -> None:
    """The tracker goes with the entry, or it broadcasts counts nothing owns."""

    await hass.config.async_set_time_zone(NZ_ZONE)
    freezer.move_to(NZ_LATE_EVENING)

    entry = await setup_entry()
    client = await _frozen_clock_client(hass, hass_ws_client, hass_admin_user)
    await _subscribe_stats(client)

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    # The teardown tells every open subscription it has stopped; that frame is
    # the entry leaving, not the rollover.
    gone = await _events_before_a_ping(client, 93)
    assert [f["event"]["action"] for f in gone] == ["unavailable"]

    freezer.move_to(NZ_JUST_PAST_MIDNIGHT)
    async_fire_time_changed(hass, dt_util.utcnow())
    await hass.async_block_till_done()

    assert await _events_before_a_ping(client, 94) == []
