import logging

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
        return await h(hass, None, req)
    raise AssertionError("No handler responded for type " + type_)


@pytest.mark.asyncio
async def test_ws_logs_include_op_on_validation_error(caplog) -> None:
    """Validation failures log with context including 'op'."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    caplog.set_level(logging.WARNING, logger="custom_components.haventory.ws")

    res = await _send(hass, 1, "haventory/item/set_quantity", item_id="any", quantity=-1)
    assert res["success"] is False and res["error"]["code"] == "validation_error"

    # Ensure a log record carried the 'op' attribute
    assert any(getattr(r, "op", None) == "item_set_quantity" for r in caplog.records)


@pytest.mark.asyncio
async def test_ws_logs_include_op_on_not_found_error(caplog) -> None:
    """Not found errors log with context including 'op'."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    caplog.set_level(logging.WARNING, logger="custom_components.haventory.ws")

    res = await _send(hass, 2, "haventory/item/get", item_id="00000000-0000-4000-8000-000000000000")
    assert res["success"] is False and res["error"]["code"] == "not_found"

    assert any(getattr(r, "op", None) == "item_get" for r in caplog.records)


@pytest.mark.asyncio
async def test_ws_logs_include_op_on_conflict_error(caplog) -> None:
    """Conflict errors log with context including 'op'."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)

    caplog.set_level(logging.WARNING, logger="custom_components.haventory.ws")

    created = await _send(hass, 1, "haventory/item/create", name="Widget")
    item_id = created["result"]["id"]

    res = await _send(
        hass,
        3,
        "haventory/item/update",
        item_id=item_id,
        expected_version=999,
        name="X",
    )
    assert res["success"] is False and res["error"]["code"] == "conflict"

    assert any(getattr(r, "op", None) == "item_update" for r in caplog.records)
