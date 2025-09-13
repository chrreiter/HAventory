"""Offline tests for service ingress schemas (voluptuous).

These tests verify required fields, defaults, and basic typing at the
Home Assistant services boundary, avoiding duplication of domain rules
which are covered by model/repository tests.
"""

from __future__ import annotations

import pytest
import voluptuous as vol
from custom_components.haventory.services import (
    SCHEMA_ITEM_ADJUST_QTY,
    SCHEMA_ITEM_CHECK_IN,
    SCHEMA_ITEM_CHECK_OUT,
    SCHEMA_ITEM_CREATE,
    SCHEMA_ITEM_DELETE,
    SCHEMA_ITEM_MOVE,
    SCHEMA_ITEM_SET_QTY,
    SCHEMA_ITEM_UPDATE,
    SCHEMA_LOCATION_CREATE,
    SCHEMA_LOCATION_DELETE,
    SCHEMA_LOCATION_UPDATE,
)


@pytest.mark.asyncio
async def test_item_create_schema_defaults_and_required() -> None:
    """item_create requires name and sets sane defaults."""

    # Defaults applied
    out = SCHEMA_ITEM_CREATE({"name": "Hammer"})
    assert out["quantity"] == 1
    assert out["checked_out"] is False
    assert out["tags"] == []
    assert out["custom_fields"] == {}

    # Missing required name fails with vol.Invalid
    with pytest.raises(vol.Invalid):
        SCHEMA_ITEM_CREATE({})


@pytest.mark.asyncio
async def test_negative_schema_cases() -> None:
    """Negative cases: wrong types and missing required fields are rejected."""

    # item_update missing item_id
    with pytest.raises(vol.Invalid):
        SCHEMA_ITEM_UPDATE({})

    # item_set_quantity wrong type
    with pytest.raises(vol.Invalid):
        SCHEMA_ITEM_SET_QTY({"item_id": "i", "quantity": "not-int"})

    # item_adjust_quantity wrong type
    with pytest.raises(vol.Invalid):
        SCHEMA_ITEM_ADJUST_QTY({"item_id": "i", "delta": "x"})

    # item_check_out missing due_date
    with pytest.raises(vol.Invalid):
        SCHEMA_ITEM_CHECK_OUT({"item_id": "i"})

    # item_move missing item_id
    with pytest.raises(vol.Invalid):
        SCHEMA_ITEM_MOVE({})

    # location_update missing location_id
    with pytest.raises(vol.Invalid):
        SCHEMA_LOCATION_UPDATE({})

    # location_delete missing location_id
    with pytest.raises(vol.Invalid):
        SCHEMA_LOCATION_DELETE({})


@pytest.mark.asyncio
async def test_item_update_schema_shapes() -> None:
    """item_update requires item_id and accepts optional fields."""

    out = SCHEMA_ITEM_UPDATE({"item_id": "00000000-0000-4000-8000-000000000000"})
    assert out["item_id"].startswith("0000")

    # Optional None values permitted for nullable fields
    out2 = SCHEMA_ITEM_UPDATE(
        {"item_id": "00000000-0000-4000-8000-000000000000", "description": None}
    )
    assert "description" in out2 and out2["description"] is None


@pytest.mark.asyncio
async def test_item_helper_schemas_types() -> None:
    """Helper schemas enforce basic typing and required fields."""

    # adjust quantity
    DELTA = 1
    aj = SCHEMA_ITEM_ADJUST_QTY({"item_id": "i", "delta": DELTA})
    assert aj["delta"] == DELTA

    # set quantity
    TARGET_QTY = 5
    sq = SCHEMA_ITEM_SET_QTY({"item_id": "i", "quantity": TARGET_QTY})
    assert sq["quantity"] == TARGET_QTY

    # check in/out
    co = SCHEMA_ITEM_CHECK_OUT({"item_id": "i", "due_date": "2025-01-01"})
    assert co["due_date"] == "2025-01-01"
    ci = SCHEMA_ITEM_CHECK_IN({"item_id": "i"})
    assert ci["item_id"] == "i"

    # move item
    mv = SCHEMA_ITEM_MOVE({"item_id": "i", "new_location_id": None})
    assert mv["new_location_id"] is None

    # delete item
    dl = SCHEMA_ITEM_DELETE({"item_id": "i"})
    assert dl["item_id"] == "i"


@pytest.mark.asyncio
async def test_location_schemas_required_and_optional() -> None:
    """Location create/update/delete schemas basic behavior."""

    lc = SCHEMA_LOCATION_CREATE({"name": "Garage"})
    assert lc["name"] == "Garage"

    # Optional parent
    lc2 = SCHEMA_LOCATION_CREATE({"name": "Shelf", "parent_id": None})
    assert lc2["parent_id"] is None

    # Update requires id; name and new_parent_id optional
    lu = SCHEMA_LOCATION_UPDATE({"location_id": "loc"})
    assert lu["location_id"] == "loc"

    # Delete requires id
    ld = SCHEMA_LOCATION_DELETE({"location_id": "loc"})
    assert ld["location_id"] == "loc"
