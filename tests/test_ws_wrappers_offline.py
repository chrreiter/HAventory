"""Offline tests for new HAventory WebSocket item wrapper commands.

Scenarios:
- add/remove tags normalize and preserve order; error mapping on invalid tags
- update_custom_fields set/unset; validation errors for non-scalar values
- set_low_stock_threshold updates item and affects low_stock_count
- item/move updates location_id and returns updated item
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
async def test_add_remove_tags_success_and_normalization() -> None:
    """add/remove tags should normalize case/whitespace and preserve order on union/subtract."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Thing")
    item_id = created["result"]["id"]

    # Add tags with mixed case/whitespace and duplicates
    res = await _send(
        hass,
        2,
        "haventory/item/add_tags",
        item_id=item_id,
        tags=["  Alpha ", "beta", "ALPHA", "Beta", None],
    )
    assert res["success"] is True
    # normalized unique order: ["alpha", "beta"]
    assert res["result"]["tags"] == ["alpha", "beta"]

    # Remove tags (normalize) and ensure subtraction
    res = await _send(
        hass,
        3,
        "haventory/item/remove_tags",
        item_id=item_id,
        tags=["  BETA ", "gamma"],
    )
    assert res["success"] is True
    assert res["result"]["tags"] == ["alpha"]


@pytest.mark.asyncio
async def test_update_custom_fields_set_unset_and_validation_error() -> None:
    """update_custom_fields sets/unsets and rejects non-scalar values."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    # Set two fields
    res = await _send(
        hass,
        2,
        "haventory/item/update_custom_fields",
        item_id=item_id,
        set={"color": "red", "size": 42},
    )
    assert res["success"] is True
    assert res["result"]["custom_fields"]["color"] == "red"
    SIZE_VALUE = 42
    assert res["result"]["custom_fields"]["size"] == SIZE_VALUE

    # Unset one field
    res = await _send(
        hass,
        3,
        "haventory/item/update_custom_fields",
        item_id=item_id,
        unset=["size"],
    )
    assert res["success"] is True
    assert "size" not in res["result"]["custom_fields"]

    # Invalid set payload: list value is not a scalar
    res = await _send(
        hass,
        4,
        "haventory/item/update_custom_fields",
        item_id=item_id,
        set={"bad": [1, 2, 3]},
    )
    assert res["success"] is False and res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_set_low_stock_threshold_affects_counts() -> None:
    """Setting low_stock_threshold should update low_stock_count via stats."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Nails", quantity=1)
    item_id = created["result"]["id"]

    # Initially, with no threshold, low_stock_count should be 0
    stats = await _send(hass, 2, "haventory/stats")
    assert stats["success"] is True and stats["result"]["low_stock_count"] == 0

    # Set threshold to 2 -> item is low stock (1 <= 2)
    LOW_STOCK_THRESHOLD = 2
    res = await _send(
        hass,
        3,
        "haventory/item/set_low_stock_threshold",
        item_id=item_id,
        low_stock_threshold=LOW_STOCK_THRESHOLD,
    )
    assert res["success"] is True
    assert res["result"]["low_stock_threshold"] == LOW_STOCK_THRESHOLD

    stats2 = await _send(hass, 4, "haventory/stats")
    assert stats2["result"]["low_stock_count"] == 1


@pytest.mark.asyncio
async def test_item_move_updates_location() -> None:
    """item/move should set location_id and return updated item."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await _send(hass, 1, "haventory/item/create", name="Box")
    item_id = created["result"]["id"]

    loc = await _send(hass, 2, "haventory/location/create", name="Shelf A")
    loc_id = loc["result"]["id"]

    res = await _send(hass, 3, "haventory/item/move", item_id=item_id, location_id=loc_id)
    assert res["success"] is True and res["result"]["location_id"] == loc_id


@pytest.mark.asyncio
async def test_unknown_command_and_type_errors() -> None:
    """Unknown command type and bad payloads produce validation_error envelopes."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    # Unknown command type: ensure no handler responds
    with pytest.raises(AssertionError):
        await _send(hass, 99, "haventory/does_not_exist")

    # Type errors inside payload for wrappers that validate
    created = await _send(hass, 1, "haventory/item/create", name="Thing")
    iid = created["result"]["id"]
    res = await _send(
        hass,
        2,
        "haventory/item/set_quantity",
        item_id=iid,
        quantity=-5,  # invalid
    )
    assert res["success"] is False and res["error"]["code"] == "validation_error"
