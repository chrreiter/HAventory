"""Offline tests for the item commands that edit one field at a time.

Tags, custom fields, the low-stock threshold and the location each have their
own command beside `item/update`, and each answers the same envelope and the
same refusals as the general edit does.
"""

from __future__ import annotations

import pytest

from runtime_helpers import ws_hass
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_add_remove_tags_success_and_normalization() -> None:
    """add/remove tags should normalize case/whitespace and preserve order on union/subtract."""

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Thing")
    item_id = created["result"]["id"]

    res = await ws_send(
        hass,
        2,
        "haventory/item/add_tags",
        item_id=item_id,
        tags=["  Alpha ", "beta", "ALPHA", "Beta"],
    )
    assert res["success"] is True
    assert res["result"]["tags"] == ["alpha", "beta"]

    res = await ws_send(
        hass,
        3,
        "haventory/item/remove_tags",
        item_id=item_id,
        tags=["  BETA ", "gamma"],
    )
    assert res["success"] is True
    assert res["result"]["tags"] == ["alpha"]

    # A non-string tag is refused by the model, so the item keeps the tags it had.
    res = await ws_send(hass, 4, "haventory/item/add_tags", item_id=item_id, tags=["gamma", None])
    assert res["success"] is False and res["error"]["code"] == "validation_error"
    res = await ws_send(hass, 5, "haventory/item/get", item_id=item_id)
    assert res["result"]["tags"] == ["alpha"]


@pytest.mark.asyncio
async def test_update_custom_fields_set_unset_and_validation_error() -> None:
    """update_custom_fields sets/unsets and rejects non-scalar values."""

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

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

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Nails", quantity=1)
    item_id = created["result"]["id"]

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

    hass = ws_hass()

    created = await ws_send(hass, 1, "haventory/item/create", name="Box")
    item_id = created["result"]["id"]

    loc = await ws_send(hass, 2, "haventory/location/create", name="Shelf A")
    loc_id = loc["result"]["id"]

    res = await ws_send(hass, 3, "haventory/item/move", item_id=item_id, location_id=loc_id)
    assert res["success"] is True and res["result"]["location_id"] == loc_id


@pytest.mark.asyncio
async def test_unknown_command_and_type_errors() -> None:
    """Unknown command type and bad payloads produce validation_error envelopes."""

    hass = ws_hass()

    with pytest.raises(AssertionError):
        await ws_send(hass, 99, "haventory/does_not_exist")

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
