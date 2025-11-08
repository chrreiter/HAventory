"""Offline tests for effective_area_id in WS item serialization.

Scenarios:
- effective_area_id reflects first ancestor with area_id
- effective_area_id is null when no ancestor has area_id
- area-only changes update effective_area_id without bumping item.version
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        schema = getattr(h, "_ws_schema", None)
        if not callable(h) or not isinstance(schema, dict):
            continue
        if schema.get("type") != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        resp = await h(hass, None, req)
        return resp
    raise AssertionError("No handler responded for type " + type_)


@pytest.mark.asyncio
async def test_effective_area_id_present_from_ancestor() -> None:
    """Item serialization includes effective_area_id from ancestor location."""

    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Tree: Garage(area='wohnzimmer') -> Shelf A -> Bin 1
    garage = repo.create_location(name="Garage", area_id="wohnzimmer")
    shelf = repo.create_location(name="Shelf A", parent_id=garage.id)
    bin1 = repo.create_location(name="Bin 1", parent_id=shelf.id)

    created = await _send(
        hass,
        1,
        "haventory/item/create",
        name="Test",
        location_id=str(bin1.id),
        tags=["t"],
        category="tools",
    )
    iid = created["result"]["id"]

    got = await _send(hass, 2, "haventory/item/get", item_id=iid)
    assert got["success"] is True
    assert got["result"].get("effective_area_id") == "wohnzimmer"

    listed = await _send(hass, 3, "haventory/item/list")
    assert any(
        it.get("id") == iid and it.get("effective_area_id") == "wohnzimmer"
        for it in listed["result"]["items"]
    )


@pytest.mark.asyncio
async def test_effective_area_id_none_when_no_area() -> None:
    """effective_area_id is null when no ancestor defines area_id."""

    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    root = repo.create_location(name="Root")  # no area
    child = repo.create_location(name="Child", parent_id=root.id)  # no area

    created = await _send(
        hass, 1, "haventory/item/create", name="NoArea", location_id=str(child.id)
    )
    iid = created["result"]["id"]
    got = await _send(hass, 2, "haventory/item/get", item_id=iid)
    assert got["success"] is True
    assert got["result"].get("effective_area_id") in (None,)


@pytest.mark.asyncio
async def test_effective_area_id_updates_on_area_change_without_version_bump() -> None:
    """Changing a location's area updates effective_area_id but does not bump item.version."""

    hass = HomeAssistant()
    repo = Repository()
    hass.data.setdefault(DOMAIN, {})["repository"] = repo
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Root without area -> effective_area_id None
    root = repo.create_location(name="Root")
    leaf = repo.create_location(name="Leaf", parent_id=root.id)
    created = await _send(hass, 1, "haventory/item/create", name="A", location_id=str(leaf.id))
    iid = created["result"]["id"]

    before = await _send(hass, 2, "haventory/item/get", item_id=iid)
    ver_before = before["result"]["version"]
    assert before["result"].get("effective_area_id") is None

    # Assign area to ancestor; effective_area_id should change, version should not
    repo.update_location(root.id, area_id="kitchen")

    after = await _send(hass, 3, "haventory/item/get", item_id=iid)
    ver_after = after["result"]["version"]
    assert after["result"].get("effective_area_id") == "kitchen"
    assert ver_after == ver_before
