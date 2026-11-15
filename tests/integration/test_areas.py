"""Integration: areas on a real core.

Areas are Home Assistant's. A location tree is anchored to one, every item under it carries
the derived `effective_area_id`, and the area filter on `item/list` and on `subscribe` reads
that same field.
"""

from __future__ import annotations

from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from pytest_homeassistant_custom_component.common import MockConfigEntry

# Values that name no area; a blank string would otherwise read as no filter at all.
NO_AREA = ["", " ", "\t\n", 5, [], {}, True]


async def test_areas_list_reads_real_registry(hass: HomeAssistant, hass_ws_client) -> None:
    """An area created in the real registry appears in haventory/areas/list."""

    area_reg = ar.async_get(hass)
    created = area_reg.async_create("Garage")

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/areas/list"})
    resp = await client.receive_json()

    assert resp["success"] is True, resp
    areas = resp["result"]["areas"]
    by_id = {a["id"]: a["name"] for a in areas}
    assert by_id.get(created.id) == "Garage"


async def _create(ws: Any, type_: str, **payload: Any) -> dict[str, Any]:
    res = await ws.send(type_, **payload)
    assert res["success"] is True, res
    return res["result"]


async def test_location_area_must_be_a_real_registry_area(
    setup_entry, ws_connect, add_areas
) -> None:
    """Home Assistant's registry decides which area a location may name."""

    await setup_entry()
    ws = await ws_connect()
    garage = add_areas("Garage")["Garage"]
    loc = await _create(ws, "haventory/location/create", name="Shed")

    refused = [
        await ws.send("haventory/location/create", name="Bad", area_id="missing"),
        await ws.send("haventory/location/update", location_id=loc["id"], area_id="missing"),
        await ws.send("haventory/location/create", name=""),
    ]
    assert [r["error"]["code"] for r in refused] == ["validation_error"] * len(refused)

    created = await _create(ws, "haventory/location/create", name="Bench", area_id=garage)
    updated = await _create(ws, "haventory/location/update", location_id=loc["id"], area_id=garage)
    assert created["area_id"] == updated["area_id"] == garage


async def test_effective_area_follows_the_tree_without_a_version_bump(
    setup_entry, ws_connect, add_areas
) -> None:
    """The nearest area above an item is its `effective_area_id`, on get and on list."""

    await setup_entry()
    ws = await ws_connect()
    garage_area = add_areas("Garage")["Garage"]
    garage = await _create(ws, "haventory/location/create", name="Garage", area_id=garage_area)
    shelf = await _create(ws, "haventory/location/create", name="Shelf", parent_id=garage["id"])
    bin_ = await _create(ws, "haventory/location/create", name="Bin", parent_id=shelf["id"])
    root = await _create(ws, "haventory/location/create", name="Root")
    child = await _create(ws, "haventory/location/create", name="Child", parent_id=root["id"])
    binned = await _create(ws, "haventory/item/create", name="Bolt", location_id=bin_["id"])
    bare = await _create(ws, "haventory/item/create", name="Nut", location_id=child["id"])

    got = await _create(ws, "haventory/item/get", item_id=binned["id"])
    listed = await _create(ws, "haventory/item/list")
    by_id = {it["id"]: it for it in listed["items"]}
    assert got["effective_area_id"] == by_id[binned["id"]]["effective_area_id"] == garage_area
    assert by_id[bare["id"]]["effective_area_id"] is None

    await _create(ws, "haventory/location/update", location_id=root["id"], area_id=garage_area)

    after = await _create(ws, "haventory/item/get", item_id=bare["id"])
    assert after["effective_area_id"] == garage_area
    assert after["version"] == bare["version"]


async def test_area_filter_agrees_on_item_list_and_subscribe(
    setup_entry, ws_connect, add_areas
) -> None:
    """`item/list` and an `items` subscription narrow to the same area's items."""

    await setup_entry()
    ws = await ws_connect()
    areas = add_areas("Kitchen", "Garage", "Attic")
    kitchen = await _create(
        ws, "haventory/location/create", name="Kitchen", area_id=areas["Kitchen"]
    )
    drawer = await _create(ws, "haventory/location/create", name="Drawer", parent_id=kitchen["id"])
    garage = await _create(ws, "haventory/location/create", name="Garage", area_id=areas["Garage"])
    await _create(ws, "haventory/location/create", name="Attic", area_id=areas["Attic"])

    sub = await ws.subscribe("items", area_id=areas["Kitchen"])
    assert await ws.subscribe("items", area_id=None)

    for name, loc in (
        ("Kitchen widget", drawer),
        ("Garage widget", garage),
        ("Loose item", None),
    ):
        await _create(
            ws, "haventory/item/create", name=name, location_id=loc["id"] if loc else None
        )

    async def names(filter_: dict[str, Any]) -> list[str]:
        page = await _create(ws, "haventory/item/list", filter=filter_)
        return sorted(it["name"] for it in page["items"])

    assert await names({"area_id": areas["Kitchen"]}) == ["Kitchen widget"]
    assert await names({"area_id": None}) == ["Garage widget", "Kitchen widget", "Loose item"]
    assert await names({"area_id": areas["Kitchen"], "q": "widget"}) == ["Kitchen widget"]
    empty = await _create(ws, "haventory/item/list", filter={"area_id": areas["Attic"]})
    assert empty["items"] == []
    assert empty["total"] == 0

    listed_ids = {
        it["id"]
        for it in (await _create(ws, "haventory/item/list", filter={"area_id": areas["Kitchen"]}))[
            "items"
        ]
    }
    streamed_ids = {f["event"]["item"]["id"] for f in ws.event_frames if f["id"] == sub}
    assert streamed_ids == listed_ids
    assert len(listed_ids) == 1


@pytest.mark.parametrize("value", NO_AREA, ids=repr)
async def test_a_degenerate_area_is_refused_on_both_doors(setup_entry, ws_connect, value) -> None:
    """An `area_id` that names no area is a validation error, not an empty or full page."""

    await setup_entry()
    ws = await ws_connect()

    listed = await ws.send("haventory/item/list", filter={"area_id": value})
    opened = await ws.send("haventory/subscribe", topic="items", area_id=value)

    for res in (listed, opened):
        assert res["success"] is False, res
        assert res["error"]["code"] == "validation_error"
        assert "area_id" in res["error"]["message"]
