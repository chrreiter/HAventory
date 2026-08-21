"""Offline tests for effective_area_id in WS item serialization.

Scenarios:
- effective_area_id reflects first ancestor with area_id
- effective_area_id is null when no ancestor has area_id
- area-only changes update effective_area_id without bumping item.version
- the subscription matcher and item/list agree on which area an item is in
"""

from __future__ import annotations

import pytest
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import _item_matches_filter
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, runtime_of
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_effective_area_id_present_from_ancestor() -> None:
    """Item serialization includes effective_area_id from ancestor location."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    # Tree: Garage(area='wohnzimmer') -> Shelf A -> Bin 1
    garage = repo.create_location(name="Garage", area_id="wohnzimmer")
    shelf = repo.create_location(name="Shelf A", parent_id=garage.id)
    bin1 = repo.create_location(name="Bin 1", parent_id=shelf.id)

    created = await ws_send(
        hass,
        1,
        "haventory/item/create",
        name="Test",
        location_id=str(bin1.id),
        tags=["t"],
        category="tools",
    )
    iid = created["result"]["id"]

    got = await ws_send(hass, 2, "haventory/item/get", item_id=iid)
    assert got["success"] is True
    assert got["result"].get("effective_area_id") == "wohnzimmer"

    listed = await ws_send(hass, 3, "haventory/item/list")
    assert any(
        it.get("id") == iid and it.get("effective_area_id") == "wohnzimmer"
        for it in listed["result"]["items"]
    )


@pytest.mark.asyncio
async def test_effective_area_id_none_when_no_area() -> None:
    """effective_area_id is null when no ancestor defines area_id."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    root = repo.create_location(name="Root")  # no area
    child = repo.create_location(name="Child", parent_id=root.id)  # no area

    created = await ws_send(
        hass, 1, "haventory/item/create", name="NoArea", location_id=str(child.id)
    )
    iid = created["result"]["id"]
    got = await ws_send(hass, 2, "haventory/item/get", item_id=iid)
    assert got["success"] is True
    assert got["result"].get("effective_area_id") in (None,)


@pytest.mark.asyncio
async def test_effective_area_id_updates_on_area_change_without_version_bump() -> None:
    """Changing a location's area updates effective_area_id but does not bump item.version."""

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    # Root without area -> effective_area_id None
    root = repo.create_location(name="Root")
    leaf = repo.create_location(name="Leaf", parent_id=root.id)
    created = await ws_send(hass, 1, "haventory/item/create", name="A", location_id=str(leaf.id))
    iid = created["result"]["id"]

    before = await ws_send(hass, 2, "haventory/item/get", item_id=iid)
    ver_before = before["result"]["version"]
    assert before["result"].get("effective_area_id") is None

    # Assign area to ancestor; effective_area_id should change, version should not
    repo.update_location(root.id, area_id="kitchen")

    after = await ws_send(hass, 3, "haventory/item/get", item_id=iid)
    ver_after = after["result"]["version"]
    assert after["result"].get("effective_area_id") == "kitchen"
    assert ver_after == ver_before


@pytest.mark.asyncio
async def test_subscription_matcher_agrees_with_item_list_on_area() -> None:
    """The area a subscriber sees an item in is the one `item/list` filters by.

    Both read the same `effective_area_id`, so a subscriber's view of an area
    cannot drift from the page `item/list` returns for it.
    """

    hass = HomeAssistant()
    repo = Repository()
    install_runtime(hass, repository=repo)
    runtime_of(hass).store = DomainStore(hass)
    ws_setup(hass)

    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    drawer = repo.create_location(name="Drawer", parent_id=kitchen.id)
    garage = repo.create_location(name="Garage", area_id="garage")

    for name, loc in (("Whisk", drawer), ("Spanner", garage), ("Loose screw", None)):
        await ws_send(
            hass,
            1,
            "haventory/item/create",
            name=name,
            location_id=str(loc.id) if loc is not None else None,
        )

    listed = await ws_send(hass, 2, "haventory/item/list", filter={"area_id": "kitchen"})
    by_list = {it["name"] for it in listed["result"]["items"]}

    everything = await ws_send(hass, 3, "haventory/item/list")
    by_matcher = {
        it["name"]
        for it in everything["result"]["items"]
        if _item_matches_filter(it, {"topic": "items", "area_id": "kitchen"})
    }

    assert by_list == {"Whisk"}
    assert by_matcher == by_list
