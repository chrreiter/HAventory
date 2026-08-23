"""Offline tests for haventory WebSocket utility commands.

Scenarios:
- ping returns echo and timestamp
- version reports integration_version and schema_version
- config reports the configured card title, and the default when unset
- config carries the status vocabulary and the attachment caps
- stats returns repository counts, including the per-slug map
- health answers the four fields it is documented to, with an empty issue list
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import (
    ATTACHMENT_MANUAL_MIME_TYPES,
    ATTACHMENT_PICTURE_MIME_TYPES,
    DEFAULT_CARD_TITLE,
    INTEGRATION_VERSION,
    MAX_ATTACHMENT_BYTES,
    MAX_MANUALS_PER_ITEM,
    MAX_PICTURES_PER_ITEM,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime
from ws_helpers import ws_send


@pytest.mark.asyncio
async def test_ping_echo_and_ts() -> None:
    """haventory/ping echoes input and includes ts."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 1, "haventory/ping", echo={"hello": "world"})
    assert res["success"] is True
    assert res["result"]["echo"] == {"hello": "world"}
    assert isinstance(res["result"]["ts"], str) and len(res["result"]["ts"]) > 0


@pytest.mark.asyncio
async def test_version_reports_integration_and_schema() -> None:
    """haventory/version reports integration_version and schema_version."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 2, "haventory/version")
    assert res["success"] is True
    assert res["result"]["integration_version"] == INTEGRATION_VERSION
    # In offline tests, store may not exist; default to CURRENT_SCHEMA_VERSION
    assert int(res["result"]["schema_version"]) == int(CURRENT_SCHEMA_VERSION)


@pytest.mark.asyncio
async def test_config_reports_configured_card_title() -> None:
    """haventory/config hands the card the title set in the options flow."""

    hass = HomeAssistant()
    install_runtime(hass, card_title="Pantry")
    ws_setup(hass)

    res = await ws_send(hass, 5, "haventory/config")
    assert res["success"] is True
    assert res["result"]["card_title"] == "Pantry"


@pytest.mark.asyncio
async def test_config_falls_back_to_default_card_title() -> None:
    """An entry predating the option has no stored title; the default stands in."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 6, "haventory/config")
    assert res["success"] is True
    assert res["result"]["card_title"] == DEFAULT_CARD_TITLE


@pytest.mark.asyncio
async def test_config_reports_the_configured_quick_filter_pills() -> None:
    """haventory/config hands the card the pill choice made in the options flow."""

    hass = HomeAssistant()
    install_runtime(hass, quick_filters=["total", "low_stock"])
    ws_setup(hass)

    res = await ws_send(hass, 7, "haventory/config")
    assert res["success"] is True
    assert res["result"]["quick_filters"] == ["total", "low_stock"]


@pytest.mark.asyncio
async def test_config_reports_an_empty_pill_choice_as_empty() -> None:
    """No pills is a choice, and has to arrive as one rather than as "unset"."""

    hass = HomeAssistant()
    install_runtime(hass, quick_filters=[])
    ws_setup(hass)

    res = await ws_send(hass, 8, "haventory/config")
    assert res["success"] is True
    assert res["result"]["quick_filters"] == []


@pytest.mark.asyncio
async def test_config_reports_no_pill_choice_as_null() -> None:
    """An entry that never chose leaves the decision to the dashboard."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 9, "haventory/config")
    assert res["success"] is True
    assert res["result"]["quick_filters"] is None


@pytest.mark.asyncio
async def test_config_reports_the_status_vocabulary() -> None:
    """The card labels a stored slug from here, not from a constant of its own."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 7, "haventory/config")

    assert res["result"]["statuses"] == [
        {"slug": "ok", "label": "OK", "order": 0, "color": "green", "icon": "check"},
        {"slug": "missing", "label": "Missing", "order": 1, "color": "amber", "icon": "alert"},
        {
            "slug": "needs_repair",
            "label": "Needs repair",
            "order": 2,
            "color": "amber",
            "icon": "wrench",
        },
    ]


@pytest.mark.asyncio
async def test_config_reports_the_attachment_caps_and_accepted_types() -> None:
    """Reported so the picker can refuse early — never so the backend can trust it."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 8, "haventory/config")

    media = res["result"]["media"]
    assert media["picture_mime_types"] == list(ATTACHMENT_PICTURE_MIME_TYPES)
    assert media["max_pictures_per_item"] == MAX_PICTURES_PER_ITEM
    assert media["max_attachment_bytes"] == MAX_ATTACHMENT_BYTES
    # SVG carries script and the view serves from the HA origin, so it is not
    # merely unlisted here — it must never appear.
    assert "image/svg+xml" not in media["picture_mime_types"]
    # The manual kind has its own allow-list and its own cap, and the card
    # cannot derive either.
    assert media["manual_mime_types"] == list(ATTACHMENT_MANUAL_MIME_TYPES)
    assert media["max_manuals_per_item"] == MAX_MANUALS_PER_ITEM


@pytest.mark.asyncio
async def test_stats_returns_counts() -> None:
    """haventory/stats returns repository counts."""

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 3, "haventory/stats")
    assert res["success"] is True
    counts = res["result"]
    assert set(counts.keys()) == {
        "items_total",
        "low_stock_count",
        "checked_out_count",
        "overdue_count",
        "checked_out_due_count",
        "inspection_overdue_count",
        "inspection_due_count",
        "reminder_due_count",
        "missing_count",
        "needs_repair_count",
        "status_counts",
        "locations_total",
        "no_location_count",
    }


@pytest.mark.asyncio
async def test_stats_carries_status_counts_beside_the_legacy_keys() -> None:
    """Per-slug counts are additive: the two legacy keys keep their meaning."""

    repo = Repository()
    repo.create_item({"name": "Hammer", "status": "missing"})
    repo.create_item({"name": "Saw"})
    hass = HomeAssistant()
    install_runtime(hass, repository=repo)
    ws_setup(hass)

    res = await ws_send(hass, 31, "haventory/stats")

    counts = res["result"]
    # "ok" is counted even though the index deliberately does not bucket it.
    assert counts["status_counts"] == {"ok": 1, "missing": 1, "needs_repair": 0}
    assert counts["missing_count"] == 1
    assert counts["needs_repair_count"] == 0


@pytest.mark.asyncio
async def test_health_answers_the_documented_shape() -> None:
    """The four fields the contract lists, and nothing beside them.

    The index checks that once filled `issues` moved into the test suite, so the
    pair a client reads is constant; the shape is what has to hold, because a
    field appearing or leaving here is a contract change.
    """

    hass = HomeAssistant()
    install_runtime(hass)
    ws_setup(hass)

    res = await ws_send(hass, 4, "haventory/health")
    assert res["success"] is True
    body = res["result"]
    assert set(body) == {"healthy", "issues", "counts", "rate_limit"}
    assert body["healthy"] is True
    assert body["issues"] == []
    assert isinstance(body["counts"], dict)
