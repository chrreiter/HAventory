"""Offline tests for the haventory distinct-values WebSocket command.

Scenarios:
- distinct_values returns distinct categories and tags with usage counts
- categories are grouped case-insensitively with a representative display label
- an empty repository yields empty lists
- unknown/extra request fields are refused before the handler runs, as real
  Home Assistant refuses them
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from custom_components.haventory.ws import ws_distinct_values
from homeassistant.core import HomeAssistant


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        if not callable(h) or getattr(h, "_ws_command", None) != type_:
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
    # No custom fields on any item yet.
    assert result["custom_field_keys"] == []


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
    """An empty repository yields empty category, tag, and custom-field lists."""

    hass = _fresh_hass()
    res = await _send(hass, 1, "haventory/distinct_values")
    assert res["success"] is True
    assert res["result"] == {"categories": [], "tags": [], "custom_field_keys": []}


@pytest.mark.asyncio
async def test_distinct_values_returns_custom_field_keys() -> None:
    """Distinct custom-field keys across all items are returned, sorted."""

    hass = _fresh_hass()
    await _send(
        hass,
        1,
        "haventory/item/create",
        name="Drill",
        custom_fields={"Voltage": 18, "warranty_until": "2027-01-01"},
    )
    await _send(
        hass,
        2,
        "haventory/item/create",
        name="Saw",
        custom_fields={"Voltage": 20, "serial": "abc"},
    )

    res = await _send(hass, 3, "haventory/distinct_values")
    # Distinct keys, sorted case-insensitively; "Voltage" appears once.
    assert res["result"]["custom_field_keys"] == ["serial", "Voltage", "warranty_until"]


@pytest.mark.asyncio
async def test_distinct_values_rejects_unknown_field() -> None:
    """Unknown request fields are refused before the handler runs.

    ``haventory/distinct_values`` declares nothing but its type, which Home
    Assistant compiles to the ``False`` schema: `id` and `type` are the only
    keys such a frame may carry.
    """

    hass = _fresh_hass()
    assert ws_distinct_values._ws_schema is False

    assert (await _send(hass, 1, "haventory/distinct_values"))["success"] is True

    res = await _send(hass, 2, "haventory/distinct_values", bogus=1)
    assert res["success"] is False
    assert res["error"]["code"] == "invalid_format"
