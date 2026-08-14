"""Offline tests for the haventory distinct-values WebSocket command.

Scenarios:
- distinct_values returns distinct categories and tags with usage counts
- categories are grouped case-insensitively with a representative display label
- an empty repository yields empty lists
- a filtered request prices both facets without shrinking either list
- an unfiltered request carries no matching_count key at all
- unknown filter keys are refused by name; unknown/extra request fields are
  refused before the handler runs, as real Home Assistant refuses them
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from custom_components.haventory.ws import ws_distinct_values
from homeassistant.core import HomeAssistant

from ws_helpers import ws_send


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

    await ws_send(hass, 1, "haventory/item/create", name="Hammer", category="Tools", tags=["red"])
    await ws_send(
        hass, 2, "haventory/item/create", name="Wrench", category="Tools", tags=["red", "blue"]
    )
    await ws_send(hass, 3, "haventory/item/create", name="Novel", category="Books", tags=["blue"])
    # An item with neither category nor tags must not contribute to either list.
    await ws_send(hass, 4, "haventory/item/create", name="Mystery Box")

    res = await ws_send(hass, 5, "haventory/distinct_values")
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

    await ws_send(hass, 1, "haventory/item/create", name="A", category="Books")
    await ws_send(hass, 2, "haventory/item/create", name="B", category="Books")
    await ws_send(hass, 3, "haventory/item/create", name="C", category="books")

    res = await ws_send(hass, 4, "haventory/distinct_values")
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
    res = await ws_send(hass, 1, "haventory/distinct_values")
    assert res["success"] is True
    assert res["result"] == {"categories": [], "tags": [], "custom_field_keys": []}


@pytest.mark.asyncio
async def test_distinct_values_returns_custom_field_keys() -> None:
    """Distinct custom-field keys across all items are returned, sorted."""

    hass = _fresh_hass()
    await ws_send(
        hass,
        1,
        "haventory/item/create",
        name="Drill",
        custom_fields={"Voltage": 18, "warranty_until": "2027-01-01"},
    )
    await ws_send(
        hass,
        2,
        "haventory/item/create",
        name="Saw",
        custom_fields={"Voltage": 20, "serial": "abc"},
    )

    res = await ws_send(hass, 3, "haventory/distinct_values")
    # Distinct keys, sorted case-insensitively; "Voltage" appears once.
    assert res["result"]["custom_field_keys"] == ["serial", "Voltage", "warranty_until"]


@pytest.mark.asyncio
async def test_distinct_values_rejects_unknown_field() -> None:
    """Unknown request fields are refused before the handler runs.

    ``haventory/distinct_values`` declares ``type`` and an optional ``filter``,
    and Home Assistant's default ``PREVENT_EXTRA`` refuses everything else.
    """

    hass = _fresh_hass()
    assert set(ws_distinct_values._ws_schema.schema) == {"id", "type", "filter"}

    assert (await ws_send(hass, 1, "haventory/distinct_values"))["success"] is True
    assert (await ws_send(hass, 2, "haventory/distinct_values", filter={}))["success"] is True

    res = await ws_send(hass, 3, "haventory/distinct_values", bogus=1)
    assert res["success"] is False
    assert res["error"]["code"] == "invalid_format"


async def _seed_facets(hass: HomeAssistant) -> None:
    """Two categories and three tags across four items, two of them low on stock."""

    await ws_send(
        hass,
        1,
        "haventory/item/create",
        name="Hammer",
        category="Tools",
        tags=["red"],
        quantity=0,
        low_stock_threshold=1,
    )
    await ws_send(hass, 2, "haventory/item/create", name="Wrench", category="Tools", tags=["blue"])
    await ws_send(
        hass,
        3,
        "haventory/item/create",
        name="Novel",
        category="Books",
        tags=["blue", "paper"],
        quantity=0,
        low_stock_threshold=1,
    )
    await ws_send(hass, 4, "haventory/item/create", name="Atlas", category="Books", tags=["paper"])


@pytest.mark.asyncio
async def test_distinct_values_prices_both_facets_against_a_filter() -> None:
    """A filtered request adds matching_count and leaves count whole-inventory."""

    hass = _fresh_hass()
    await _seed_facets(hass)

    res = await ws_send(hass, 5, "haventory/distinct_values", filter={"low_stock_only": True})
    assert res["success"] is True
    result = res["result"]

    categories = {c["value"]: (c["count"], c["matching_count"]) for c in result["categories"]}
    tags = {t["value"]: (t["count"], t["matching_count"]) for t in result["tags"]}

    # Hammer (Tools/red) and Novel (Books/blue+paper) are the low-stock two.
    assert categories == {"Books": (2, 1), "Tools": (2, 1)}
    assert tags == {"blue": (2, 1), "paper": (2, 1), "red": (1, 1)}
    # A key picker rather than a tally: unfiltered under either request shape.
    assert result["custom_field_keys"] == []


@pytest.mark.asyncio
async def test_distinct_values_without_a_filter_carries_no_matching_count() -> None:
    """The unfiltered shape is exactly what a card written before this sees."""

    hass = _fresh_hass()
    await _seed_facets(hass)

    result = (await ws_send(hass, 5, "haventory/distinct_values"))["result"]
    for entry in [*result["categories"], *result["tags"]]:
        assert "matching_count" not in entry

    # An explicit null reads as "no filter", the way location/tree reads it.
    null_result = (await ws_send(hass, 6, "haventory/distinct_values", filter=None))["result"]
    for entry in [*null_result["categories"], *null_result["tags"]]:
        assert "matching_count" not in entry


@pytest.mark.asyncio
async def test_distinct_values_keeps_every_row_when_nothing_matches() -> None:
    """A filter matching nothing zeroes the tallies; it must not empty the list.

    The same payload feeds autocomplete and the organize dialog, so a list that
    shrank with the filter would leave both with nothing to offer.
    """

    hass = _fresh_hass()
    await _seed_facets(hass)

    result = (await ws_send(hass, 5, "haventory/distinct_values", filter={"q": "nothing here"}))[
        "result"
    ]

    expected_categories = 2
    expected_tags = 3
    assert len(result["categories"]) == expected_categories
    assert len(result["tags"]) == expected_tags
    assert all(c["matching_count"] == 0 for c in result["categories"])
    assert all(t["matching_count"] == 0 for t in result["tags"])
    # Totals are untouched by a filter that keeps nothing.
    assert all(c["count"] > 0 for c in result["categories"])


@pytest.mark.asyncio
async def test_distinct_values_rejects_an_unknown_filter_key() -> None:
    """The new argument goes through validate_item_filter like every other one."""

    hass = _fresh_hass()

    res = await ws_send(hass, 1, "haventory/distinct_values", filter={"categorie": "Tools"})
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "categorie" in res["error"]["message"]

    # And a filter that is not an object at all is a validation error rather
    # than a schema rejection carrying the client's payload.
    res = await ws_send(hass, 2, "haventory/distinct_values", filter="low_stock_only")
    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
