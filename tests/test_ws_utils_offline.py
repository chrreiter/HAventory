"""Offline tests for haventory WebSocket utility commands.

Scenarios:
- ping returns echo and timestamp
- version reports integration_version and schema_version
- config reports the configured card title, and the default when unset
- stats returns repository counts
- health returns healthy True for fresh repo and details with counts
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DEFAULT_CARD_TITLE, DOMAIN, INTEGRATION_VERSION
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant


class _StubConn:
    def __init__(self) -> None:
        self.last = None

    def send_message(self, msg):
        self.last = msg


async def _send(hass: HomeAssistant, _id: int, type_: str, **payload):
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        if not callable(h) or getattr(h, "_ws_command", None) != type_:
            continue
        req = {"id": _id, "type": type_}
        req.update(payload)
        conn = _StubConn()
        res = await h(hass, conn, req)
        return res if res is not None else conn.last
    raise AssertionError("No handler responded for type " + type_)


@pytest.mark.asyncio
async def test_ping_echo_and_ts() -> None:
    """haventory/ping echoes input and includes ts."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    res = await _send(hass, 1, "haventory/ping", echo={"hello": "world"})
    assert res["success"] is True
    assert res["result"]["echo"] == {"hello": "world"}
    assert isinstance(res["result"]["ts"], str) and len(res["result"]["ts"]) > 0


@pytest.mark.asyncio
async def test_version_reports_integration_and_schema() -> None:
    """haventory/version reports integration_version and schema_version."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    res = await _send(hass, 2, "haventory/version")
    assert res["success"] is True
    assert res["result"]["integration_version"] == INTEGRATION_VERSION
    # In offline tests, store may not exist; default to CURRENT_SCHEMA_VERSION
    assert int(res["result"]["schema_version"]) == int(CURRENT_SCHEMA_VERSION)


@pytest.mark.asyncio
async def test_config_reports_configured_card_title() -> None:
    """haventory/config hands the card the title set in the options flow."""

    hass = HomeAssistant()
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["repository"] = Repository()
    bucket["card_title"] = "Pantry"
    ws_setup(hass)

    res = await _send(hass, 5, "haventory/config")
    assert res["success"] is True
    assert res["result"] == {"card_title": "Pantry"}


@pytest.mark.asyncio
async def test_config_falls_back_to_default_card_title() -> None:
    """An entry predating the option has no stored title; the default stands in."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    res = await _send(hass, 6, "haventory/config")
    assert res["success"] is True
    assert res["result"] == {"card_title": DEFAULT_CARD_TITLE}


@pytest.mark.asyncio
async def test_stats_returns_counts() -> None:
    """haventory/stats returns repository counts."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    res = await _send(hass, 3, "haventory/stats")
    assert res["success"] is True
    counts = res["result"]
    assert set(counts.keys()) == {
        "items_total",
        "low_stock_count",
        "checked_out_count",
        "overdue_count",
        "inspection_overdue_count",
        "missing_count",
        "needs_repair_count",
        "locations_total",
        "no_location_count",
    }


@pytest.mark.asyncio
async def test_health_is_healthy_for_fresh_repo() -> None:
    """haventory/health returns healthy True and includes counts and issues list."""

    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    ws_setup(hass)

    res = await _send(hass, 4, "haventory/health")
    assert res["success"] is True
    body = res["result"]
    assert isinstance(body, dict)
    assert body.get("healthy") is True
    assert isinstance(body.get("counts"), dict)
    assert isinstance(body.get("issues"), list)
