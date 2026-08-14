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

from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_add_remove_tags_success_and_normalization() -> None:
    """add/remove tags should normalize case/whitespace and preserve order on union/subtract."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await ws_send(hass, 1, "haventory/item/create", name="Thing")
    item_id = created["result"]["id"]

    # Add tags with mixed case/whitespace and duplicates
    res = await ws_send(
        hass,
        2,
        "haventory/item/add_tags",
        item_id=item_id,
        tags=["  Alpha ", "beta", "ALPHA", "Beta"],
    )
    assert res["success"] is True
    # normalized unique order: ["alpha", "beta"]
    assert res["result"]["tags"] == ["alpha", "beta"]

    # Remove tags (normalize) and ensure subtraction
    res = await ws_send(
        hass,
        3,
        "haventory/item/remove_tags",
        item_id=item_id,
        tags=["  BETA ", "gamma"],
    )
    assert res["success"] is True
    assert res["result"]["tags"] == ["alpha"]

    # A non-string tag is refused by the command's `[str]` schema, so the
    # handler never runs and the item keeps the tags it had.
    res = await ws_send(hass, 4, "haventory/item/add_tags", item_id=item_id, tags=["gamma", None])
    assert res["success"] is False and res["error"]["code"] == "invalid_format"
    res = await ws_send(hass, 5, "haventory/item/get", item_id=item_id)
    assert res["result"]["tags"] == ["alpha"]


@pytest.mark.asyncio
async def test_update_custom_fields_set_unset_and_validation_error() -> None:
    """update_custom_fields sets/unsets and rejects non-scalar values."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await ws_send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    # Set two fields
    res = await ws_send(
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
    res = await ws_send(
        hass,
        3,
        "haventory/item/update_custom_fields",
        item_id=item_id,
        unset=["size"],
    )
    assert res["success"] is True
    assert "size" not in res["result"]["custom_fields"]

    # Invalid set payload: list value is not a scalar
    res = await ws_send(
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

    created = await ws_send(hass, 1, "haventory/item/create", name="Nails", quantity=1)
    item_id = created["result"]["id"]

    # Initially, with no threshold, low_stock_count should be 0
    stats = await ws_send(hass, 2, "haventory/stats")
    assert stats["success"] is True and stats["result"]["low_stock_count"] == 0

    # Set threshold to 2 -> item is low stock (1 <= 2)
    LOW_STOCK_THRESHOLD = 2
    res = await ws_send(
        hass,
        3,
        "haventory/item/set_low_stock_threshold",
        item_id=item_id,
        low_stock_threshold=LOW_STOCK_THRESHOLD,
    )
    assert res["success"] is True
    assert res["result"]["low_stock_threshold"] == LOW_STOCK_THRESHOLD

    stats2 = await ws_send(hass, 4, "haventory/stats")
    assert stats2["result"]["low_stock_count"] == 1


@pytest.mark.asyncio
async def test_item_move_updates_location() -> None:
    """item/move should set location_id and return updated item."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    created = await ws_send(hass, 1, "haventory/item/create", name="Box")
    item_id = created["result"]["id"]

    loc = await ws_send(hass, 2, "haventory/location/create", name="Shelf A")
    loc_id = loc["result"]["id"]

    res = await ws_send(hass, 3, "haventory/item/move", item_id=item_id, location_id=loc_id)
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
        await ws_send(hass, 99, "haventory/does_not_exist")

    # Type errors inside payload for wrappers that validate
    created = await ws_send(hass, 1, "haventory/item/create", name="Thing")
    iid = created["result"]["id"]
    res = await ws_send(
        hass,
        2,
        "haventory/item/set_quantity",
        item_id=iid,
        quantity=-5,  # invalid
    )
    assert res["success"] is False and res["error"]["code"] == "validation_error"
