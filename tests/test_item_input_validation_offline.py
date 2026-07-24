"""Offline tests for item field-type validation at the model/repository boundary.

Regression coverage for the PR #91 review:
- non-scalar category/description are rejected before indexing, so a bad value
  can never leave a durable partially-indexed phantom item;
- boolean quantity/delta/low_stock_threshold are rejected consistently on the
  single-command paths (matching the bulk validator), never stored as a bool.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import ItemCreate, ItemUpdate
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

# -----------------------------
# Repository / model boundary
# -----------------------------


@pytest.mark.parametrize("bad", [["oops"], {"a": 1}, 5, 1.5])
def test_create_rejects_non_text_category(bad: object) -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=1, category=bad))
    # No phantom left behind.
    assert repo.get_counts()["items_total"] == 0
    assert repo._items_by_id == {}


@pytest.mark.parametrize("bad", [["oops"], {"a": 1}, 5])
def test_create_rejects_non_text_description(bad: object) -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=1, description=bad))
    assert repo.get_counts()["items_total"] == 0
    assert repo._items_by_id == {}


def test_update_rejects_non_text_category_without_corrupting_item() -> None:
    repo = Repository()
    item = repo.create_item(ItemCreate(name="Widget", quantity=1, category="tools"))
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(category=["oops"]))
    # The original item is untouched and still consistent.
    reloaded = repo.get_item(item.id)
    assert reloaded.category == "tools"
    assert reloaded.version == item.version
    res = repo.list_items(flt={"category": "tools"})
    assert [i.id for i in res["items"]] == [item.id]


@pytest.mark.parametrize("bad", [True, False])
def test_quantity_rejects_bool_on_create_and_update(bad: bool) -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=bad))
    assert repo.get_counts()["items_total"] == 0

    item = repo.create_item(ItemCreate(name="Widget", quantity=1))
    with pytest.raises(ValidationError):
        repo.set_quantity(item.id, bad)
    with pytest.raises(ValidationError):
        repo.adjust_quantity(item.id, bad)
    # quantity is unchanged and a real int.
    got = repo.get_item(item.id).quantity
    assert got == 1
    assert type(got) is int


def test_low_stock_threshold_rejects_bool() -> None:
    repo = Repository()
    with pytest.raises(ValidationError):
        repo.create_item(ItemCreate(name="Widget", quantity=1, low_stock_threshold=True))
    item = repo.create_item(ItemCreate(name="Widget", quantity=1))
    with pytest.raises(ValidationError):
        repo.update_item(item.id, ItemUpdate(low_stock_threshold=True))


# -----------------------------
# WS surface (phantom-free, validation_error)
# -----------------------------


def _get_handler(
    hass: HomeAssistant, type_: str
) -> Callable[[HomeAssistant, object, dict], Coroutine[Any, Any, dict]]:
    for h in hass.data.get("__ws_commands__", []):
        schema = getattr(h, "_ws_schema", None)
        if callable(h) and isinstance(schema, dict) and schema.get("type") == type_:
            return h
    raise AssertionError("No handler for " + type_)


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload: Any) -> dict:
    return await _get_handler(hass, type_)(hass, None, {"id": _id, "type": type_, **payload})


def _make_hass() -> HomeAssistant:
    hass = HomeAssistant()
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["repository"] = Repository()
    bucket["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


@pytest.mark.asyncio
async def test_ws_create_non_text_category_is_validation_error_no_phantom() -> None:
    hass = _make_hass()
    res = await _send(hass, 1, "haventory/item/create", name="Widget", category=["oops"])
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    # Nothing was indexed or counted.
    stats = await _send(hass, 2, "haventory/stats")
    assert stats["result"]["items_total"] == 0
    listed = await _send(hass, 3, "haventory/item/list")
    assert listed["result"]["items"] == []


@pytest.mark.asyncio
async def test_ws_set_quantity_bool_is_validation_error() -> None:
    hass = _make_hass()
    created = await _send(hass, 1, "haventory/item/create", name="Widget", quantity=1)
    item_id = created["result"]["id"]

    res = await _send(hass, 2, "haventory/item/set_quantity", item_id=item_id, quantity=True)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    res = await _send(hass, 3, "haventory/item/adjust_quantity", item_id=item_id, delta=True)
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"

    # Quantity is still the int we created with.
    got = await _send(hass, 4, "haventory/item/get", item_id=item_id)
    assert got["result"]["quantity"] == 1
    assert got["result"]["quantity"] is not True
