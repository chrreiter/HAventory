"""Offline tests for WebSocket rate limiting (WP4 item 2).

Covers:
- TokenBucket refill semantics with a fake monotonic clock
- limiting is off by default (no limiter / disabled config -> unlimited)
- per-connection and global command budgets -> rate_limited envelopes
- per-connection and global event budgets -> dropped broadcasts
- options flow produces the option keys; the update listener rebuilds the
  limiter; ws_health exposes drop counters
- connection close cleanup registers via conn.subscriptions (real-HA path)
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

import pytest
from custom_components.haventory import _async_options_updated
from custom_components.haventory import rate_limit as rate_limit_module
from custom_components.haventory import ws as ws_module
from custom_components.haventory.config_flow import HAventoryOptionsFlowHandler
from custom_components.haventory.const import (
    CONF_RATE_LIMIT_COMMANDS_BURST,
    CONF_RATE_LIMIT_COMMANDS_PER_SECOND,
    CONF_RATE_LIMIT_ENABLED,
    DOMAIN,
)
from custom_components.haventory.rate_limit import (
    RateLimitConfig,
    RateLimiter,
    TokenBucket,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import RATE_LIMITED_MESSAGE
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant


class _FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch) -> _FakeClock:
    fake = _FakeClock()
    monkeypatch.setattr(rate_limit_module, "_monotonic", fake)
    return fake


def _get_handler(
    hass: HomeAssistant, type_: str
) -> Callable[[HomeAssistant, object, dict], Coroutine[Any, Any, dict]]:
    handlers = hass.data.get("__ws_commands__", [])
    for h in handlers:
        schema = getattr(h, "_ws_schema", None)
        if not callable(h) or not isinstance(schema, dict):
            continue
        if schema.get("type") == type_:
            return h
    raise AssertionError("No handler found for type " + type_)


async def _send(hass: HomeAssistant, conn: object, _id: int, type_: str, **payload: Any) -> dict:
    handler = _get_handler(hass, type_)
    return await handler(hass, conn, {"id": _id, "type": type_, **payload})


class _ConnStub:
    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    def send_message(self, msg: dict[str, Any]) -> None:
        self.messages.append(msg)

    def events(self) -> list[dict[str, Any]]:
        return [m for m in self.messages if m.get("type") == "event"]


def _make_hass(limiter: RateLimiter | None = None) -> HomeAssistant:
    hass = HomeAssistant()
    bucket = hass.data.setdefault(DOMAIN, {})
    bucket["repository"] = Repository()
    bucket["store"] = DomainStore(hass)
    if limiter is not None:
        bucket["rate_limiter"] = limiter
    ws_setup(hass)
    return hass


def _config(**overrides: Any) -> RateLimitConfig:
    base: dict[str, Any] = {
        "enabled": True,
        "commands_per_second": 1.0,
        "commands_burst": 1000.0,
        "global_commands_per_second": 1.0,
        "global_commands_burst": 1000.0,
        "events_per_second": 1.0,
        "events_burst": 1000.0,
        "global_events_per_second": 1.0,
        "global_events_burst": 1000.0,
    }
    base.update(overrides)
    return RateLimitConfig(**base)


# -----------------------------
# TokenBucket unit behavior
# -----------------------------


def test_token_bucket_consumes_burst_then_refills(clock: _FakeClock) -> None:
    bucket = TokenBucket(rate=2.0, burst=3.0)
    assert [bucket.try_consume() for _ in range(3)] == [True, True, True]
    assert bucket.try_consume() is False
    clock.advance(0.5)  # refills one token at 2 tokens/sec
    assert bucket.try_consume() is True
    assert bucket.try_consume() is False
    clock.advance(10.0)  # refill caps at burst
    assert [bucket.try_consume() for _ in range(3)] == [True, True, True]
    assert bucket.try_consume() is False


def test_token_bucket_rejects_non_positive_parameters() -> None:
    with pytest.raises(ValueError, match="positive"):
        TokenBucket(rate=0, burst=5)
    with pytest.raises(ValueError, match="positive"):
        TokenBucket(rate=1, burst=0)


# -----------------------------
# Off by default
# -----------------------------


@pytest.mark.asyncio
async def test_no_limiter_means_unlimited() -> None:
    hass = _make_hass(limiter=None)
    conn = _ConnStub()
    for i in range(50):
        res = await _send(hass, conn, i + 1, "haventory/ping")
        assert res["success"] is True


@pytest.mark.asyncio
async def test_disabled_limiter_means_unlimited(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(enabled=False, commands_burst=1.0))
    hass = _make_hass(limiter)
    conn = _ConnStub()
    for i in range(50):
        res = await _send(hass, conn, i + 1, "haventory/ping")
        assert res["success"] is True
    assert limiter.dropped_commands == 0


def test_default_config_is_disabled() -> None:
    assert RateLimitConfig.from_options(None).enabled is False
    assert RateLimitConfig.from_options({}).enabled is False


# -----------------------------
# Command limiting
# -----------------------------


@pytest.mark.asyncio
async def test_per_connection_command_limit(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(commands_per_second=1.0, commands_burst=2.0))
    hass = _make_hass(limiter)
    conn_a = _ConnStub()
    conn_b = _ConnStub()

    assert (await _send(hass, conn_a, 1, "haventory/ping"))["success"] is True
    assert (await _send(hass, conn_a, 2, "haventory/ping"))["success"] is True
    res = await _send(hass, conn_a, 3, "haventory/ping")
    assert res["success"] is False
    assert res["error"]["code"] == "rate_limited"
    assert res["error"]["message"] == RATE_LIMITED_MESSAGE
    assert res["error"].get("data", {}).get("op") == "ping"
    # The envelope was also sent on the connection.
    assert conn_a.messages[-1] == res

    # Another connection has its own budget.
    assert (await _send(hass, conn_b, 4, "haventory/ping"))["success"] is True

    # Refill re-allows the first connection.
    clock.advance(1.0)
    assert (await _send(hass, conn_a, 5, "haventory/ping"))["success"] is True
    assert limiter.dropped_commands == 1


@pytest.mark.asyncio
async def test_global_command_limit(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(global_commands_per_second=1.0, global_commands_burst=3.0))
    hass = _make_hass(limiter)

    conns = [_ConnStub() for _ in range(4)]
    outcomes = []
    for i, conn in enumerate(conns):
        res = await _send(hass, conn, i + 1, "haventory/ping")
        outcomes.append(res["success"])
    # Fresh per-connection budgets, but the global bucket allows only 3.
    assert outcomes == [True, True, True, False]
    assert limiter.dropped_commands == 1


@pytest.mark.asyncio
async def test_rate_limited_command_does_not_execute(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(commands_burst=1.0))
    hass = _make_hass(limiter)
    conn = _ConnStub()

    res = await _send(hass, conn, 1, "haventory/item/create", name="First")
    assert res["success"] is True
    res = await _send(hass, conn, 2, "haventory/item/create", name="Second")
    assert res["success"] is False
    assert res["error"]["code"] == "rate_limited"
    repo = hass.data[DOMAIN]["repository"]
    assert repo.get_counts()["items_total"] == 1


# -----------------------------
# Broadcast limiting
# -----------------------------


@pytest.mark.asyncio
async def test_per_connection_event_limit(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(events_per_second=1.0, events_burst=1.0))
    hass = _make_hass(limiter)
    subscriber = _ConnStub()
    sub = await _send(hass, subscriber, 100, "haventory/subscribe", topic="items")
    assert sub["success"] is True

    ws_module._broadcast_event(hass, topic="items", action="created", payload=None)
    ws_module._broadcast_event(hass, topic="items", action="created", payload=None)
    assert len(subscriber.events()) == 1
    assert limiter.dropped_events == 1

    clock.advance(1.0)
    ws_module._broadcast_event(hass, topic="items", action="created", payload=None)
    delivered_after_refill = 2
    assert len(subscriber.events()) == delivered_after_refill


@pytest.mark.asyncio
async def test_global_event_limit_drops_for_all_subscribers(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(global_events_per_second=1.0, global_events_burst=1.0))
    hass = _make_hass(limiter)
    sub_a = _ConnStub()
    sub_b = _ConnStub()
    assert (await _send(hass, sub_a, 100, "haventory/subscribe", topic="items"))["success"]
    assert (await _send(hass, sub_b, 101, "haventory/subscribe", topic="items"))["success"]

    ws_module._broadcast_event(hass, topic="items", action="created", payload=None)
    ws_module._broadcast_event(hass, topic="items", action="created", payload=None)
    # First event reached both; second was dropped globally.
    assert len(sub_a.events()) == 1
    assert len(sub_b.events()) == 1
    assert limiter.dropped_events == 1


@pytest.mark.asyncio
async def test_event_drop_does_not_fail_the_command(clock: _FakeClock) -> None:
    limiter = RateLimiter(
        _config(global_events_per_second=1.0, global_events_burst=1.0, commands_burst=1000.0)
    )
    hass = _make_hass(limiter)
    subscriber = _ConnStub()
    actor = _ConnStub()
    assert (await _send(hass, subscriber, 100, "haventory/subscribe", topic="items"))["success"]

    # One create emits an item event + a counts event; the budget of one means
    # something gets dropped, but the command itself must succeed.
    res = await _send(hass, actor, 1, "haventory/item/create", name="Widget")
    assert res["success"] is True
    assert limiter.dropped_events >= 1


# -----------------------------
# Health surface
# -----------------------------


@pytest.mark.asyncio
async def test_health_exposes_rate_limit_counters(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(commands_burst=1.0))
    hass = _make_hass(limiter)
    conn = _ConnStub()
    assert (await _send(hass, conn, 1, "haventory/ping"))["success"] is True
    assert (await _send(hass, conn, 2, "haventory/ping"))["success"] is False

    clock.advance(10.0)
    res = await _send(hass, conn, 3, "haventory/health")
    assert res["success"] is True
    rl = res["result"]["rate_limit"]
    assert rl == {"enabled": True, "dropped_commands": 1, "dropped_events": 0}


@pytest.mark.asyncio
async def test_health_reports_disabled_without_limiter() -> None:
    hass = _make_hass(limiter=None)
    res = await _send(hass, _ConnStub(), 1, "haventory/health")
    assert res["success"] is True
    assert res["result"]["rate_limit"] == {
        "enabled": False,
        "dropped_commands": 0,
        "dropped_events": 0,
    }


# -----------------------------
# Options flow + update listener wiring
# -----------------------------


@pytest.mark.asyncio
async def test_options_flow_shows_form_and_creates_entry() -> None:
    entry = ConfigEntry(options={CONF_RATE_LIMIT_ENABLED: True})
    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = entry

    form = await flow.async_step_init(None)
    assert form["type"] == "form"
    assert form["step_id"] == "init"

    submitted = {
        CONF_RATE_LIMIT_ENABLED: True,
        CONF_RATE_LIMIT_COMMANDS_PER_SECOND: 5.0,
        CONF_RATE_LIMIT_COMMANDS_BURST: 10.0,
    }
    result = await flow.async_step_init(submitted)
    assert result["type"] == "create_entry"
    assert result["data"] == submitted


@pytest.mark.asyncio
async def test_options_update_listener_rebuilds_limiter() -> None:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})
    configured_rate = 5.0
    configured_burst = 7.0
    entry = ConfigEntry(
        options={
            CONF_RATE_LIMIT_ENABLED: True,
            CONF_RATE_LIMIT_COMMANDS_PER_SECOND: configured_rate,
            CONF_RATE_LIMIT_COMMANDS_BURST: configured_burst,
        }
    )

    await _async_options_updated(hass, entry)
    limiter = hass.data[DOMAIN]["rate_limiter"]
    assert isinstance(limiter, RateLimiter)
    assert limiter.enabled is True
    assert limiter.config.commands_per_second == configured_rate
    assert limiter.config.commands_burst == configured_burst

    entry.options[CONF_RATE_LIMIT_ENABLED] = False
    await _async_options_updated(hass, entry)
    assert hass.data[DOMAIN]["rate_limiter"].enabled is False


def test_from_options_ignores_invalid_values() -> None:
    config = RateLimitConfig.from_options(
        {
            CONF_RATE_LIMIT_ENABLED: True,
            CONF_RATE_LIMIT_COMMANDS_PER_SECOND: "not-a-number",
            CONF_RATE_LIMIT_COMMANDS_BURST: -5,
        }
    )
    assert config.enabled is True
    # Invalid/non-positive values fall back to defaults.
    assert config.commands_per_second > 0
    assert config.commands_burst > 0


# -----------------------------
# Close cleanup via conn.subscriptions (real-HA path)
# -----------------------------


class _ConnWithSubscriptions(_ConnStub):
    def __init__(self) -> None:
        super().__init__()
        self.subscriptions: dict[Any, Any] = {}


@pytest.mark.asyncio
async def test_close_cleanup_registers_in_conn_subscriptions() -> None:
    hass = _make_hass()
    conn = _ConnWithSubscriptions()
    res = await _send(hass, conn, 200, "haventory/subscribe", topic="items")
    assert res["success"] is True

    # The cleanup callable is registered where real HA invokes it on close.
    cleanup = conn.subscriptions.get("haventory/cleanup")
    assert callable(cleanup)
    assert conn in hass.data[DOMAIN]["subscriptions"]

    cleanup()
    assert conn not in hass.data[DOMAIN]["subscriptions"]
