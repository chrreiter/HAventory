"""Token-bucket rate limiting for the HAventory WebSocket API.

Disabled by default. When enabled (via the integration's options flow), two
kinds of budgets apply, each with a per-connection and a global bucket:

- command handling: excess commands receive a ``rate_limited`` error envelope
  instead of being executed;
- subscription broadcasts: excess events are dropped (delivery is best-effort
  by contract) and counted, never turned into command errors.

Buckets refill lazily from a monotonic clock, so no background tasks or event
loop access is needed. Tests monkeypatch ``_monotonic`` for determinism.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .const import (
    CONF_RATE_LIMIT_COMMANDS_BURST,
    CONF_RATE_LIMIT_COMMANDS_PER_SECOND,
    CONF_RATE_LIMIT_ENABLED,
    CONF_RATE_LIMIT_EVENTS_BURST,
    CONF_RATE_LIMIT_EVENTS_PER_SECOND,
    CONF_RATE_LIMIT_GLOBAL_COMMANDS_BURST,
    CONF_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND,
    CONF_RATE_LIMIT_GLOBAL_EVENTS_BURST,
    CONF_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND,
    DEFAULT_RATE_LIMIT_COMMANDS_BURST,
    DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND,
    DEFAULT_RATE_LIMIT_ENABLED,
    DEFAULT_RATE_LIMIT_EVENTS_BURST,
    DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND,
    DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST,
    DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND,
    DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST,
    DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND,
    DOMAIN,
)

LOGGER = logging.getLogger(__name__)

# Module-level clock indirection so tests can monkeypatch time deterministically.
_monotonic = time.monotonic

# Attribute stamped onto connection objects to hold their bucket pair. The
# state dies with the connection, so no registry/cleanup is needed.
_CONN_STATE_ATTR = "_haventory_rate_buckets"

# Warn at most once per this many seconds per drop kind to keep an abusive
# client from flooding the log.
_WARN_INTERVAL_SECONDS = 30.0


class TokenBucket:
    """A lazily-refilled token bucket.

    ``rate`` is tokens added per second; ``burst`` is the bucket capacity.
    """

    __slots__ = ("_last_refill", "_tokens", "burst", "rate")

    def __init__(self, rate: float, burst: float) -> None:
        if rate <= 0 or burst <= 0:
            raise ValueError("rate and burst must be positive")
        self.rate = float(rate)
        self.burst = float(burst)
        self._tokens = float(burst)
        self._last_refill = _monotonic()

    def try_consume(self) -> bool:
        """Take one token; return False when the bucket is empty."""
        now = _monotonic()
        elapsed = now - self._last_refill
        if elapsed > 0:
            self._tokens = min(self.burst, self._tokens + elapsed * self.rate)
            self._last_refill = now
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False


@dataclass(frozen=True, slots=True)
class RateLimitConfig:
    """Effective rate-limit settings (defaults merged with entry options)."""

    enabled: bool = DEFAULT_RATE_LIMIT_ENABLED
    commands_per_second: float = DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND
    commands_burst: float = DEFAULT_RATE_LIMIT_COMMANDS_BURST
    global_commands_per_second: float = DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND
    global_commands_burst: float = DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST
    events_per_second: float = DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND
    events_burst: float = DEFAULT_RATE_LIMIT_EVENTS_BURST
    global_events_per_second: float = DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND
    global_events_burst: float = DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST

    @classmethod
    def from_options(cls, options: Mapping[str, Any] | None) -> RateLimitConfig:
        opts: Mapping[str, Any] = options or {}

        def _flag(key: str, default: bool) -> bool:
            return bool(opts.get(key, default))

        def _num(key: str, default: float) -> float:
            try:
                value = float(opts.get(key, default))
            except TypeError, ValueError:
                return default
            return value if value > 0 else default

        return cls(
            enabled=_flag(CONF_RATE_LIMIT_ENABLED, DEFAULT_RATE_LIMIT_ENABLED),
            commands_per_second=_num(
                CONF_RATE_LIMIT_COMMANDS_PER_SECOND, DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND
            ),
            commands_burst=_num(CONF_RATE_LIMIT_COMMANDS_BURST, DEFAULT_RATE_LIMIT_COMMANDS_BURST),
            global_commands_per_second=_num(
                CONF_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND,
                DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND,
            ),
            global_commands_burst=_num(
                CONF_RATE_LIMIT_GLOBAL_COMMANDS_BURST, DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST
            ),
            events_per_second=_num(
                CONF_RATE_LIMIT_EVENTS_PER_SECOND, DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND
            ),
            events_burst=_num(CONF_RATE_LIMIT_EVENTS_BURST, DEFAULT_RATE_LIMIT_EVENTS_BURST),
            global_events_per_second=_num(
                CONF_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND,
                DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND,
            ),
            global_events_burst=_num(
                CONF_RATE_LIMIT_GLOBAL_EVENTS_BURST, DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST
            ),
        )


class _ConnBuckets:
    """Per-connection bucket pair, stamped onto the connection object."""

    __slots__ = ("commands", "events")

    def __init__(self, config: RateLimitConfig) -> None:
        self.commands = TokenBucket(config.commands_per_second, config.commands_burst)
        self.events = TokenBucket(config.events_per_second, config.events_burst)


class RateLimiter:
    """Per-connection + global rate limiting for commands and broadcasts."""

    def __init__(self, config: RateLimitConfig) -> None:
        self.config = config
        self.dropped_commands = 0
        self.dropped_events = 0
        self._global_commands = TokenBucket(
            config.global_commands_per_second, config.global_commands_burst
        )
        self._global_events = TokenBucket(
            config.global_events_per_second, config.global_events_burst
        )
        self._last_warn: dict[str, float] = {}

    @property
    def enabled(self) -> bool:
        return self.config.enabled

    def _conn_buckets(self, conn: object) -> _ConnBuckets | None:
        state = getattr(conn, _CONN_STATE_ATTR, None)
        if isinstance(state, _ConnBuckets):
            return state
        state = _ConnBuckets(self.config)
        try:
            setattr(conn, _CONN_STATE_ATTR, state)
        except Exception:  # pragma: no cover - exotic connection objects
            # Without per-connection state only the global buckets protect us.
            return None
        return state

    def _warn(self, kind: str, detail: str) -> None:
        now = _monotonic()
        last = self._last_warn.get(kind)
        if last is not None and (now - last) < _WARN_INTERVAL_SECONDS:
            return
        self._last_warn[kind] = now
        LOGGER.warning(
            "HAventory WS rate limit exceeded (%s); dropping until tokens refill",
            detail,
            extra={"domain": DOMAIN, "op": "rate_limit", "kind": kind},
        )

    def allow_command(self, conn: object) -> bool:
        """Budget check for one incoming command on ``conn``."""
        if not self.config.enabled:
            return True
        buckets = self._conn_buckets(conn)
        if buckets is not None and not buckets.commands.try_consume():
            self.dropped_commands += 1
            self._warn("commands_per_connection", "per-connection command budget")
            return False
        if not self._global_commands.try_consume():
            self.dropped_commands += 1
            self._warn("commands_global", "global command budget")
            return False
        return True

    def allow_event_broadcast(self) -> bool:
        """Global budget check for one broadcast event (all subscribers)."""
        if not self.config.enabled:
            return True
        if not self._global_events.try_consume():
            self.dropped_events += 1
            self._warn("events_global", "global event budget")
            return False
        return True

    def allow_event_send(self, conn: object) -> bool:
        """Per-connection budget check for one event delivery to ``conn``."""
        if not self.config.enabled:
            return True
        buckets = self._conn_buckets(conn)
        if buckets is None:
            return True
        if not buckets.events.try_consume():
            self.dropped_events += 1
            self._warn("events_per_connection", "per-connection event budget")
            return False
        return True
