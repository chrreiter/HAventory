"""Offline tests for the haventory distinct-values WebSocket command.

Scenarios:
- distinct_values returns distinct categories and tags with usage counts
- categories are grouped case-insensitively with a representative display label
- an empty repository yields empty lists
- unknown/extra request fields are rejected by the voluptuous schema
  (vol.PREVENT_EXTRA, matching real Home Assistant command validation)
"""

from __future__ import annotations

import pytest
import voluptuous as vol
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from custom_components.haventory.ws import ws_distinct_values
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


def _fresh_hass() -> HomeAssistant:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


@pytest.mark.asyncio
async def test_distinct_values_returns_categories_and_tags_with_counts() -> None:
    """distinct_values returns distinct categories and tags with usage counts."""

    hass = _fresh_hass()

    await _send(hass, 1, "haventory/item/create", name="Hammer", category="Tools", tags=["red"])
    await _send(
        hass, 2, "haventory/item/create", name="Wrench", category="Tools", tags=["red", "blue"]
    )
    await _send(hass, 3, "haventory/item/create", name="Novel", category="Books", tags=["blue"])
    # An item with neither category nor tags must not contribute to either list.
    await _send(hass, 4, "haventory/item/create", name="Mystery Box")

    res = await _send(hass, 5, "haventory/distinct_values")
    assert res["success"] is True
    result = res["result"]

    categories = {c["value"]: c["count"] for c in result["categories"]}
    tags = {t["value"]: t["count"] for t in result["tags"]}

    assert categories == {"Books": 1, "Tools": 2}
    assert tags == {"blue": 2, "red": 2}

    # Deterministic, case-insensitive alphabetical ordering.
    assert [c["value"] for c in result["categories"]] == ["Books", "Tools"]
    assert [t["value"] for t in result["tags"]] == ["blue", "red"]


@pytest.mark.asyncio
async def test_distinct_values_groups_categories_case_insensitively() -> None:
    """Categories differing only by case collapse into one entry, count summed."""

    hass = _fresh_hass()

    await _send(hass, 1, "haventory/item/create", name="A", category="Books")
    await _send(hass, 2, "haventory/item/create", name="B", category="Books")
    await _send(hass, 3, "haventory/item/create", name="C", category="books")

    res = await _send(hass, 4, "haventory/distinct_values")
    categories = res["result"]["categories"]

    expected_grouped_count = 3
    assert len(categories) == 1
    entry = categories[0]
    assert entry["count"] == expected_grouped_count
    # Representative label is the most frequent original casing ("Books", 2 > 1).
    assert entry["value"] == "Books"


@pytest.mark.asyncio
async def test_distinct_values_empty_repository() -> None:
    """An empty repository yields empty category and tag lists."""

    hass = _fresh_hass()
    res = await _send(hass, 1, "haventory/distinct_values")
    assert res["success"] is True
    assert res["result"] == {"categories": [], "tags": []}


def test_distinct_values_schema_rejects_unknown_field() -> None:
    """Unknown request fields are rejected (vol.PREVENT_EXTRA, as in real HA).

    The offline stub does not apply the command schema, so we reconstruct the
    schema exactly as Home Assistant does (extending a base that requires `id`
    and defaults to PREVENT_EXTRA) and assert an extra field is rejected.
    """

    schema_dict = ws_distinct_values._ws_schema
    assert isinstance(schema_dict, dict)
    full = vol.Schema({vol.Required("id"): int, **schema_dict})

    # Valid request passes.
    full({"id": 1, "type": "haventory/distinct_values"})

    # Unknown field is rejected.
    with pytest.raises(vol.Invalid):
        full({"id": 1, "type": "haventory/distinct_values", "bogus": 1})
