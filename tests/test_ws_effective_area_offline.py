"""Offline tests for `effective_area_id` on a serialized item.

The field is derived from the location tree's nearest area-bearing ancestor, so
re-anchoring a subtree rewrites it on every item beneath — without touching an
item's `version`, because a location edit is not an item edit. The subscription
matcher and `item/list` answer the same question and are held to each other.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.repository import Repository
from custom_components.haventory.subscriptions import _item_matches_filter
from homeassistant.core import HomeAssistant

from runtime_helpers import ws_hass
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_effective_area_id_present_from_ancestor() -> None:
    """Item serialization includes effective_area_id from ancestor location."""

    repo = Repository()
    hass = ws_hass(repository=repo)

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

    repo = Repository()
    hass = ws_hass(repository=repo)

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

    repo = Repository()
    hass = ws_hass(repository=repo)

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

    repo = Repository()
    hass = ws_hass(repository=repo)

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


async def _hass_with_two_areas() -> tuple[HomeAssistant, Repository]:
    """A kitchen and a garage, one item each, both matching the same `q`."""

    repo = Repository()
    hass = ws_hass(repository=repo)

    kitchen = repo.create_location(name="Kitchen", area_id="kitchen")
    garage = repo.create_location(name="Garage", area_id="garage")
    await ws_send(
        hass, 1, "haventory/item/create", name="Kitchen widget", location_id=str(kitchen.id)
    )
    await ws_send(
        hass, 2, "haventory/item/create", name="Garage widget", location_id=str(garage.id)
    )
    return hass, repo


#: Values an `area_id` cannot resolve to an area. A blank string reaches the
#: area index as no bucket at all, which is the same nothing an omitted key is,
#: and an area is applied nowhere else in the query path.
DEGENERATE_AREAS: tuple[object, ...] = ("", " ", "\t\n", 5, [], {}, True)


@pytest.mark.parametrize("degenerate", DEGENERATE_AREAS)
@pytest.mark.asyncio
async def test_item_list_refuses_an_area_that_names_no_area(degenerate: object) -> None:
    """`item/list` answers validation_error rather than the unfiltered inventory."""

    hass, _repo = await _hass_with_two_areas()

    res = await ws_send(hass, 3, "haventory/item/list", filter={"area_id": degenerate})

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "area_id" in res["error"]["message"]


@pytest.mark.parametrize("degenerate", DEGENERATE_AREAS)
@pytest.mark.asyncio
async def test_subscribe_refuses_an_area_that_names_no_area(degenerate: object) -> None:
    """The opener refuses it too, rather than opening a topic that delivers nothing."""

    hass, _repo = await _hass_with_two_areas()

    res = await ws_send(hass, 3, "haventory/subscribe", topic="items", area_id=degenerate)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "area_id" in res["error"]["message"]


@pytest.mark.asyncio
async def test_a_null_area_means_no_area_filter_on_both_doors() -> None:
    """`null` is how a caller says "no area filter", on the filter and on the opener."""

    hass, _repo = await _hass_with_two_areas()

    listed = await ws_send(hass, 3, "haventory/item/list", filter={"area_id": None})
    assert listed["success"] is True
    assert {it["name"] for it in listed["result"]["items"]} == {"Kitchen widget", "Garage widget"}

    opened = await ws_send(hass, 4, "haventory/subscribe", topic="items", area_id=None)
    assert opened["success"] is True


@pytest.mark.asyncio
async def test_an_area_nothing_is_in_answers_with_no_items() -> None:
    """A real area holding nothing is the empty page — not a refusal, and not everything."""

    hass, repo = await _hass_with_two_areas()
    repo.create_location(name="Attic", area_id="attic")

    listed = await ws_send(hass, 3, "haventory/item/list", filter={"area_id": "attic"})

    assert listed["success"] is True
    assert listed["result"]["items"] == []
    assert listed["result"]["total"] == 0


@pytest.mark.asyncio
async def test_an_area_holds_when_the_filter_also_carries_q() -> None:
    """The text search runs over the area's items, never over the whole inventory.

    `q` is answered by the scan, and the scan carries no area predicate — so an
    area that stopped narrowing the candidates would widen this answer to both.
    """

    hass, _repo = await _hass_with_two_areas()

    listed = await ws_send(
        hass, 3, "haventory/item/list", filter={"area_id": "kitchen", "q": "widget"}
    )

    assert listed["success"] is True
    assert [it["name"] for it in listed["result"]["items"]] == ["Kitchen widget"]
