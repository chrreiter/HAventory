"""Integration: which subscriptions an item write reaches, and how they are torn down.

A subscription's filter is applied to an item as it stands after the write, so a client whose
filtered set a write moved out from under it re-lists rather than waiting for a departure event.
Teardown runs through either unsubscribe command or a disconnect.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from custom_components.haventory import subscriptions as subscriptions_module
from custom_components.haventory.subscriptions import open_subscriptions
from homeassistant.util import dt as dt_util

BAD_LOCATION_IDS = ["not-a-list", 5, {"a": 1}, [7], [None]]


def _day(offset: int) -> str:
    """The household's local day, shifted, as an inspection date."""

    return (dt_util.now().date() + timedelta(days=offset)).isoformat()


async def _create_location(ws, **fields: Any) -> str:
    res = await ws.send("haventory/location/create", **fields)
    assert res["success"] is True, res
    return res["result"]["id"]


def _reached(ws, names: dict[int, str]) -> set[str]:
    return {names[f["id"]] for f in ws.event_frames if f["event"].get("topic") == "items"}


async def test_an_item_event_reaches_the_subscriptions_whose_filter_it_meets(
    setup_entry, ws_connect, add_areas
) -> None:
    """Each row is one create; a write with no item row reaches every items subscription."""

    areas = add_areas("kitchen", "garage", "attic")
    await setup_entry()
    ws = await ws_connect()
    kitchen = await _create_location(ws, name="Kitchen", area_id=areas["kitchen"])
    drawer = await _create_location(ws, name="Drawer", parent_id=kitchen)
    garage = await _create_location(ws, name="Garage", area_id=areas["garage"])
    cellar = await _create_location(ws, name="Cellar")
    both = [kitchen, garage]

    filters: dict[str, dict[str, Any]] = {
        "all": {},
        "subtree": {"location_id": kitchen, "include_subtree": True},
        "direct": {"location_id": drawer, "include_subtree": False},
        "two": {"location_ids": both},
        "two_direct": {"location_ids": both, "include_subtree": False},
        "union": {"location_id": cellar, "location_ids": [garage]},
        "overdue": {"inspection_overdue_only": True},
        "area": {"area_id": areas["kitchen"]},
        "no_area_filter": {"area_id": None},
        "unused_area": {"area_id": areas["attic"]},
        "area_and_location": {"area_id": areas["kitchen"], "location_id": drawer},
    }
    names = {}
    for name, extra in filters.items():
        names[await ws.subscribe("items", **extra)] = name

    # The kitchen's area reaches everything under it; an area filter of None is no filter.
    everywhere = {"all", "no_area_filter"}
    rows = [
        (
            {"location_id": drawer},
            everywhere | {"subtree", "direct", "two", "area", "area_and_location"},
        ),
        ({"location_id": kitchen}, everywhere | {"subtree", "two", "two_direct", "area"}),
        ({"location_id": garage}, everywhere | {"two", "two_direct", "union"}),
        ({"location_id": cellar}, everywhere | {"union"}),
        ({}, everywhere),
        ({"inspection_date": _day(-1)}, everywhere | {"overdue"}),
        ({"inspection_date": _day(0)}, everywhere),
    ]
    for payload, expected in rows:
        ws.event_frames.clear()
        res = await ws.send("haventory/item/create", name="Thing", **payload)
        assert res["success"] is True, res
        assert _reached(ws, names) == expected, payload

    # `status/delete` reassigns items without announcing a row, so no filter can apply.
    await ws.send("haventory/status/create", slug="lent_out", label="Lent out")
    await ws.send("haventory/item/create", name="Drill", status="lent_out")
    ws.event_frames.clear()
    res = await ws.send("haventory/status/delete", slug="lent_out", reassign_to="ok")
    assert res["success"] is True, res
    assert _reached(ws, names) == set(filters)
    assert all("item" not in e for e in ws.events("items"))


async def test_a_location_write_is_announced_once_and_never_as_item_events(
    setup_entry, ws_connect, add_areas
) -> None:
    """A tree's area lives on its root, so what is announced follows where the tree ends up."""

    areas = add_areas("kitchen", "garage", "bedroom", "pantry")
    await setup_entry()
    ws = await ws_connect()
    ids = {}
    ids["home"] = await _create_location(ws, name="Home", area_id=areas["kitchen"])
    ids["shelf"] = await _create_location(ws, name="Shelf", parent_id=ids["home"])
    ids["other"] = await _create_location(ws, name="Other", area_id=areas["pantry"])
    await ws.send("haventory/item/create", name="Whisk", location_id=ids["shelf"])
    await ws.subscribe("locations")
    await ws.subscribe("items")

    update, move = "haventory/location/update", "haventory/location/move_subtree"
    # (command, payload, announced actions, the area an item/list must now find the item under)
    steps = [
        # An unchanged `new_parent_id` beside a new name is a plain rename.
        (
            update,
            {"location_id": "shelf", "name": "Shelf A", "new_parent_id": "home"},
            ["renamed"],
            None,
        ),
        (update, {"location_id": "shelf", "name": "Shelf A", "new_parent_id": "home"}, [], None),
        # The card sends every field; the area it names is the one the tree already resolves to.
        (update, {"location_id": "shelf", "name": "Shelf A", "area_id": "kitchen"}, [], "kitchen"),
        (update, {"location_id": "home", "area_id": "garage"}, ["moved"], "garage"),
        (update, {"location_id": "shelf", "area_id": "bedroom"}, ["moved"], "bedroom"),
        (move, {"location_id": "shelf", "new_parent_id": "other"}, ["moved"], "pantry"),
        (
            update,
            {"location_id": "shelf", "new_parent_id": "home", "area_id": "kitchen"},
            ["moved"],
            "kitchen",
        ),
    ]
    for command, payload, actions, area in steps:
        ws.event_frames.clear()
        sent = {k: ids.get(v) or areas.get(v, v) for k, v in payload.items()}
        res = await ws.send(command, **sent)
        assert res["success"] is True, res
        assert [e["action"] for e in ws.events("locations")] == actions, payload
        assert ws.events("items") == [], payload
        if area:
            listed = await ws.send("haventory/item/list", filter={"area_id": areas[area]})
            assert [i["name"] for i in listed["result"]["items"]] == ["Whisk"], area
        if sent.get("area_id") == areas["bedroom"]:
            # The edited row keeps no area of its own; the root took it.
            assert res["result"]["area_id"] is None


async def test_unsubscribe_commands_share_one_registry(setup_entry, ws_connect) -> None:
    """Either command ends a subscription, and the other then finds nothing to end.

    Core's `unsubscribe_events` is what the card's `subscribeMessage` sends; a `not_found`
    there reaches the card as an unhandled rejection.
    """

    await setup_entry()
    ws = await ws_connect()

    async def _delivers() -> bool:
        ws.event_frames.clear()
        await ws.send("haventory/item/create", name="Box")
        return bool(ws.event_frames)

    first = await ws.subscribe("items")
    assert await _delivers() is True
    assert (await ws.send("haventory/unsubscribe", subscription=first))["success"] is True
    assert await _delivers() is False
    refused = await ws.send("unsubscribe_events", subscription=first)
    assert refused["error"]["code"] == "not_found"

    second = await ws.subscribe("items")
    assert (await ws.send("unsubscribe_events", subscription=second))["success"] is True
    assert await _delivers() is False
    assert (await ws.send("haventory/unsubscribe", subscription=second))["success"] is True


@pytest.mark.parametrize(
    ("subscription", "success"), [("abc", False), ({"x": 1}, False), ("42", True), (9999, True)]
)
async def test_unsubscribe_validates_the_id_and_ignores_an_unknown_one(
    setup_entry, ws_connect, subscription: object, success: bool
) -> None:
    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/unsubscribe", subscription=subscription)

    assert res["success"] is success
    if not success:
        assert res["error"]["code"] == "validation_error"


async def test_a_closed_connection_leaves_no_subscription_behind(
    hass, setup_entry, ws_connect
) -> None:
    """Read from the registry: no command shows a leak, which grows with every page load."""

    await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("items")
    kept = set(open_subscriptions(hass))
    ws2 = await ws_connect()
    await ws2.subscribe("items")
    await ws2.subscribe("locations")
    assert len(open_subscriptions(hass)) == len(kept) + 1

    await ws2.socket.close()
    await hass.async_block_till_done()

    assert set(open_subscriptions(hass)) == kept


@pytest.mark.parametrize("bad", BAD_LOCATION_IDS)
async def test_subscribe_refuses_location_ids_that_is_not_a_list_of_strings(
    setup_entry, ws_connect, bad: object
) -> None:
    """A number coerced to a string matches no location, which would be a silent subscription."""

    await setup_entry()
    ws = await ws_connect()

    res = await ws.send("haventory/subscribe", topic="items", location_ids=bad)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert res["error"]["message"] == "location_ids must be a list of strings"
    await ws.send("haventory/item/create", name="Box")
    assert ws.event_frames == []


async def test_a_broadcast_failure_does_not_fail_the_write(
    setup_entry, ws_connect, monkeypatch
) -> None:
    """An error for a saved write would have the user retry it and save a duplicate."""

    await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("items")

    def _boom(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("fan-out down")

    monkeypatch.setattr(subscriptions_module, "_collect_event_deliveries", _boom)

    res = await ws.send("haventory/item/create", name="Widget")

    assert res["success"] is True
    listed = await ws.send("haventory/item/list")
    assert [i["name"] for i in listed["result"]["items"]] == ["Widget"]
