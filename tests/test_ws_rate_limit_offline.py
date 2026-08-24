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

from typing import Any

import custom_components.haventory as haven_init
import pytest
import voluptuous as vol
from custom_components.haventory import _async_options_updated
from custom_components.haventory import rate_limit as rate_limit_module
from custom_components.haventory import subscriptions as subs_mod
from custom_components.haventory.config_flow import (
    SECTION_RATE_LIMIT,
    SECTION_TODO,
    HAventoryOptionsFlowHandler,
    _options_schema,
)
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_RATE_LIMIT_COMMANDS_BURST,
    CONF_RATE_LIMIT_COMMANDS_PER_SECOND,
    CONF_RATE_LIMIT_ENABLED,
    CONF_TODO_ENTITY_ID,
    DEFAULT_RATE_LIMIT_COMMANDS_BURST,
    DEFAULT_TODO_ENTITY_ID,
    DOMAIN,
)
from custom_components.haventory.rate_limit import (
    RateLimitConfig,
    RateLimiter,
    TokenBucket,
)
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from custom_components.haventory.ws import RATE_LIMITED_MESSAGE
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, repo_of, runtime_of, setup_entry, ws_hass
from ws_helpers import RecordingConn, ws_send


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
    hass = ws_hass()
    conn = RecordingConn()
    for i in range(50):
        res = await ws_send(hass, i + 1, "haventory/ping", conn=conn)
        assert res["success"] is True


@pytest.mark.asyncio
async def test_disabled_limiter_means_unlimited(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(enabled=False, commands_burst=1.0))
    hass = ws_hass(rate_limiter=limiter)
    conn = RecordingConn()
    for i in range(50):
        res = await ws_send(hass, i + 1, "haventory/ping", conn=conn)
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
    hass = ws_hass(rate_limiter=limiter)
    conn_a = RecordingConn()
    conn_b = RecordingConn()

    assert (await ws_send(hass, 1, "haventory/ping", conn=conn_a))["success"] is True
    assert (await ws_send(hass, 2, "haventory/ping", conn=conn_a))["success"] is True
    res = await ws_send(hass, 3, "haventory/ping", conn=conn_a)
    assert res["success"] is False
    assert res["error"]["code"] == "rate_limited"
    assert res["error"]["message"] == RATE_LIMITED_MESSAGE
    assert res["error"].get("data", {}).get("op") == "ping"
    # The envelope was also sent on the connection.
    assert conn_a.messages[-1] == res

    # Another connection has its own budget.
    assert (await ws_send(hass, 4, "haventory/ping", conn=conn_b))["success"] is True

    # Refill re-allows the first connection.
    clock.advance(1.0)
    assert (await ws_send(hass, 5, "haventory/ping", conn=conn_a))["success"] is True
    assert limiter.dropped_commands == 1


@pytest.mark.asyncio
async def test_global_command_limit(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(global_commands_per_second=1.0, global_commands_burst=3.0))
    hass = ws_hass(rate_limiter=limiter)

    conns = [RecordingConn() for _ in range(4)]
    outcomes = []
    for i, conn in enumerate(conns):
        res = await ws_send(hass, i + 1, "haventory/ping", conn=conn)
        outcomes.append(res["success"])
    # Fresh per-connection budgets, but the global bucket allows only 3.
    assert outcomes == [True, True, True, False]
    assert limiter.dropped_commands == 1


@pytest.mark.asyncio
async def test_rate_limited_command_does_not_execute(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(commands_burst=1.0))
    hass = ws_hass(rate_limiter=limiter)
    conn = RecordingConn()

    res = await ws_send(hass, 1, "haventory/item/create", conn=conn, name="First")
    assert res["success"] is True
    res = await ws_send(hass, 2, "haventory/item/create", conn=conn, name="Second")
    assert res["success"] is False
    assert res["error"]["code"] == "rate_limited"
    repo = repo_of(hass)
    assert repo.get_counts()["items_total"] == 1


# -----------------------------
# Broadcast limiting
# -----------------------------


@pytest.mark.asyncio
async def test_per_connection_event_limit(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(events_per_second=1.0, events_burst=1.0))
    hass = ws_hass(rate_limiter=limiter)
    subscriber = RecordingConn()
    sub = await ws_send(hass, 100, "haventory/subscribe", conn=subscriber, topic="items")
    assert sub["success"] is True

    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    assert len(subscriber.events()) == 1
    assert limiter.dropped_events == 1

    clock.advance(1.0)
    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    delivered_after_refill = 2
    assert len(subscriber.events()) == delivered_after_refill


@pytest.mark.asyncio
async def test_no_budget_consumed_without_matching_subscribers(clock: _FakeClock) -> None:
    """Events nobody would receive must not consume the global event budget."""

    limiter = RateLimiter(_config(global_events_per_second=1.0, global_events_burst=1.0))
    hass = ws_hass(rate_limiter=limiter)

    # No subscribers at all: nothing is consumed or counted.
    for _ in range(3):
        subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    assert limiter.dropped_events == 0

    # A subscriber on another topic does not consume the budget either.
    other = RecordingConn()
    assert (await ws_send(hass, 99, "haventory/subscribe", conn=other, topic="locations"))[
        "success"
    ]
    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    assert limiter.dropped_events == 0

    # The budget is still intact for the first real delivery.
    subscriber = RecordingConn()
    assert (await ws_send(hass, 100, "haventory/subscribe", conn=subscriber, topic="items"))[
        "success"
    ]
    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    assert len(subscriber.events()) == 1


@pytest.mark.asyncio
async def test_one_event_consumes_one_token_across_multiple_subscriptions(
    clock: _FakeClock,
) -> None:
    """Two matching subscriptions on one connection share a single event token."""

    limiter = RateLimiter(_config(events_per_second=1.0, events_burst=1.0))
    hass = ws_hass(rate_limiter=limiter)
    conn = RecordingConn()
    assert (await ws_send(hass, 301, "haventory/subscribe", conn=conn, topic="items"))["success"]
    assert (await ws_send(hass, 302, "haventory/subscribe", conn=conn, topic="items"))["success"]

    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    # Both subscriptions receive the event; only one token was spent.
    assert {m["id"] for m in conn.messages if m["type"] == "event"} == {301, 302}

    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    delivered_before_drop = 2  # both subscriptions got the FIRST event only
    assert len(conn.events()) == delivered_before_drop
    assert limiter.dropped_events == 1


@pytest.mark.asyncio
async def test_global_event_limit_drops_for_all_subscribers(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(global_events_per_second=1.0, global_events_burst=1.0))
    hass = ws_hass(rate_limiter=limiter)
    sub_a = RecordingConn()
    sub_b = RecordingConn()
    assert (await ws_send(hass, 100, "haventory/subscribe", conn=sub_a, topic="items"))["success"]
    assert (await ws_send(hass, 101, "haventory/subscribe", conn=sub_b, topic="items"))["success"]

    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    subs_mod.broadcast_event(hass, topic="items", action="created", payload=None)
    # First event reached both; second was dropped globally.
    assert len(sub_a.events()) == 1
    assert len(sub_b.events()) == 1
    assert limiter.dropped_events == 1


@pytest.mark.asyncio
async def test_event_drop_does_not_fail_the_command(clock: _FakeClock) -> None:
    limiter = RateLimiter(
        _config(global_events_per_second=1.0, global_events_burst=1.0, commands_burst=1000.0)
    )
    hass = ws_hass(rate_limiter=limiter)
    subscriber = RecordingConn()
    actor = RecordingConn()
    assert (await ws_send(hass, 100, "haventory/subscribe", conn=subscriber, topic="items"))[
        "success"
    ]
    assert (await ws_send(hass, 101, "haventory/subscribe", conn=subscriber, topic="stats"))[
        "success"
    ]

    # One create emits an item event + a counts event to this subscriber; the
    # budget of one means something gets dropped, but the command must succeed.
    res = await ws_send(hass, 1, "haventory/item/create", conn=actor, name="Widget")
    assert res["success"] is True
    assert limiter.dropped_events >= 1


# -----------------------------
# Health surface
# -----------------------------


@pytest.mark.asyncio
async def test_health_exposes_rate_limit_counters(clock: _FakeClock) -> None:
    limiter = RateLimiter(_config(commands_burst=1.0))
    hass = ws_hass(rate_limiter=limiter)
    conn = RecordingConn()
    assert (await ws_send(hass, 1, "haventory/ping", conn=conn))["success"] is True
    assert (await ws_send(hass, 2, "haventory/ping", conn=conn))["success"] is False

    clock.advance(10.0)
    res = await ws_send(hass, 3, "haventory/health", conn=conn)
    assert res["success"] is True
    rl = res["result"]["rate_limit"]
    assert rl == {"enabled": True, "dropped_commands": 1, "dropped_events": 0}


@pytest.mark.asyncio
async def test_health_reports_disabled_without_limiter() -> None:
    hass = ws_hass()
    res = await ws_send(hass, 1, "haventory/health", conn=RecordingConn())
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

    # The form nests the rate-limit fields under a section; the stored options
    # must come back flat, because that is what RateLimitConfig reads.
    result = await flow.async_step_init(
        {
            CONF_CARD_TITLE: "Pantry",
            SECTION_RATE_LIMIT: {
                CONF_RATE_LIMIT_ENABLED: True,
                CONF_RATE_LIMIT_COMMANDS_PER_SECOND: 5.0,
                CONF_RATE_LIMIT_COMMANDS_BURST: 10.0,
            },
        }
    )
    assert result["type"] == "create_entry"
    assert result["data"] == {
        CONF_CARD_TITLE: "Pantry",
        CONF_TODO_ENTITY_ID: DEFAULT_TODO_ENTITY_ID,
        CONF_RATE_LIMIT_ENABLED: True,
        CONF_RATE_LIMIT_COMMANDS_PER_SECOND: 5.0,
        CONF_RATE_LIMIT_COMMANDS_BURST: 10.0,
    }


@pytest.mark.asyncio
async def test_options_flow_survives_a_missing_rate_limit_section() -> None:
    """A submission without the section keeps the card title and adds nothing nested."""

    flow = HAventoryOptionsFlowHandler()
    flow.config_entry = ConfigEntry(options={})

    result = await flow.async_step_init({CONF_CARD_TITLE: "Pantry"})
    # The shopping list is stored either way: a submission without the section
    # is a cleared selector, which is what turns the bridge off.
    assert result["data"] == {
        CONF_CARD_TITLE: "Pantry",
        CONF_TODO_ENTITY_ID: DEFAULT_TODO_ENTITY_ID,
    }


def test_options_schema_collapses_only_while_untouched() -> None:
    """A customized limiter opens expanded instead of hiding its values."""

    def _section(current: dict[str, Any]):  # type: ignore[no-untyped-def]
        return _options_schema(current).schema[SECTION_RATE_LIMIT]

    assert _section({}).options == {"collapsed": True}
    assert _section({CONF_CARD_TITLE: "Pantry"}).options == {"collapsed": True}
    assert _section({CONF_RATE_LIMIT_ENABLED: True}).options == {"collapsed": False}
    assert _section({CONF_RATE_LIMIT_COMMANDS_PER_SECOND: 1.0}).options == {"collapsed": False}


def test_options_schema_defaults_to_the_stored_options() -> None:
    """Re-opening the form shows what is stored, section fields included."""

    stored_rate = 3.0
    schema = _options_schema(
        {CONF_CARD_TITLE: "Pantry", CONF_RATE_LIMIT_COMMANDS_PER_SECOND: stored_rate}
    )
    filled = schema({SECTION_TODO: {}, SECTION_RATE_LIMIT: {}})
    assert filled[CONF_CARD_TITLE] == "Pantry"
    assert filled[SECTION_RATE_LIMIT][CONF_RATE_LIMIT_COMMANDS_PER_SECOND] == stored_rate
    assert (
        filled[SECTION_RATE_LIMIT][CONF_RATE_LIMIT_COMMANDS_BURST]
        == DEFAULT_RATE_LIMIT_COMMANDS_BURST
    )


@pytest.mark.asyncio
async def test_options_update_listener_rebuilds_limiter() -> None:
    hass = HomeAssistant()
    configured_rate = 5.0
    configured_burst = 7.0
    entry = ConfigEntry(
        options={
            CONF_RATE_LIMIT_ENABLED: True,
            CONF_RATE_LIMIT_COMMANDS_PER_SECOND: configured_rate,
            CONF_RATE_LIMIT_COMMANDS_BURST: configured_burst,
        }
    )
    # The listener rewrites a live runtime; an entry that never loaded has none.
    install_runtime(hass, entry=entry)

    await _async_options_updated(hass, entry)
    limiter = runtime_of(hass).rate_limiter
    assert isinstance(limiter, RateLimiter)
    assert limiter.enabled is True
    assert limiter.config.commands_per_second == configured_rate
    assert limiter.config.commands_burst == configured_burst

    entry.options[CONF_RATE_LIMIT_ENABLED] = False
    await _async_options_updated(hass, entry)
    assert runtime_of(hass).rate_limiter.enabled is False


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


def test_from_options_rejects_sub_token_bursts() -> None:
    """A burst below one token would block ALL traffic — fall back to default."""

    config = RateLimitConfig.from_options(
        {CONF_RATE_LIMIT_ENABLED: True, CONF_RATE_LIMIT_COMMANDS_BURST: 0.5}
    )
    assert config.commands_burst == DEFAULT_RATE_LIMIT_COMMANDS_BURST


def test_options_schema_enforces_burst_minimum() -> None:
    """The options-flow schema must reject burst < 1 and rate <= 0."""

    BURST = CONF_RATE_LIMIT_COMMANDS_BURST
    RATE = CONF_RATE_LIMIT_COMMANDS_PER_SECOND

    schema = _options_schema({})

    def _submit(**section_fields: float) -> dict[str, Any]:
        return schema(
            {
                SECTION_TODO: {},
                SECTION_RATE_LIMIT: {CONF_RATE_LIMIT_ENABLED: True, **section_fields},
            }
        )

    base = _submit()  # defaults fill the rest
    assert base[SECTION_RATE_LIMIT][BURST] >= 1

    with pytest.raises(vol.Invalid):
        _submit(**{BURST: 0.5})
    with pytest.raises(vol.Invalid):
        _submit(**{RATE: 0})
    # A fractional sustained rate remains valid.
    fractional_rate = 0.5
    ok = _submit(**{RATE: fractional_rate})
    assert ok[SECTION_RATE_LIMIT][RATE] == fractional_rate


@pytest.mark.asyncio
async def test_setup_entry_wires_rate_limiter_from_entry_options(monkeypatch) -> None:
    """async_setup_entry builds the limiter from entry.options and wires updates."""

    hass = HomeAssistant()
    configured_rate = 3.0
    entry = ConfigEntry(
        options={
            CONF_RATE_LIMIT_ENABLED: True,
            CONF_RATE_LIMIT_COMMANDS_PER_SECOND: configured_rate,
        }
    )

    payload = {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return payload

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    await setup_entry(hass, entry)
    limiter = runtime_of(hass).rate_limiter
    assert isinstance(limiter, RateLimiter)
    assert limiter.enabled is True
    assert limiter.config.commands_per_second == configured_rate
    assert entry._update_listeners, "expected an options update listener"

    # An options change rebuilds the limiter through the registered listener.
    entry.options[CONF_RATE_LIMIT_ENABLED] = False
    await entry._update_listeners[0](hass, entry)
    assert runtime_of(hass).rate_limiter.enabled is False

    # Unload drops the limiter with the other ephemeral state.
    assert await haven_init.async_unload_entry(hass, entry) is True
    assert "rate_limiter" not in hass.data[DOMAIN]


# -----------------------------
# Close cleanup via conn.subscriptions (real-HA path)
# -----------------------------


class _ConnWithSubscriptions(RecordingConn):
    def __init__(self) -> None:
        super().__init__()
        self.subscriptions: dict[Any, Any] = {}


@pytest.mark.asyncio
async def test_close_cleanup_registers_in_conn_subscriptions() -> None:
    hass = ws_hass()
    conn = _ConnWithSubscriptions()
    res = await ws_send(hass, 200, "haventory/subscribe", conn=conn, topic="items")
    assert res["success"] is True

    # The cleanup callable is registered where real HA invokes it on close.
    cleanup = conn.subscriptions.get("haventory/cleanup")
    assert callable(cleanup)
    assert conn in runtime_of(hass).subscriptions

    cleanup()
    assert conn not in runtime_of(hass).subscriptions


@pytest.mark.asyncio
async def test_rate_limit_state_cleanup_via_conn_subscriptions(clock: _FakeClock) -> None:
    """Per-connection bucket state is dropped when real HA closes the conn."""

    limiter = RateLimiter(_config())
    hass = ws_hass(rate_limiter=limiter)
    conn = _ConnWithSubscriptions()
    assert (await ws_send(hass, 1, "haventory/ping", conn=conn))["success"] is True
    assert conn in limiter._conn_states

    cleanup = conn.subscriptions.get("haventory/rate_limit_cleanup")
    assert callable(cleanup)
    cleanup()
    assert conn not in limiter._conn_states
