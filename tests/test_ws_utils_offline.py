"""Offline tests for haventory WebSocket utility commands.

Scenarios:
- ping returns echo and timestamp
- version reports integration_version and schema_version
- stats returns repository counts
- health returns healthy True for fresh repo and details with counts
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN, INTEGRATION_VERSION
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
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
        "locations_total",
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
