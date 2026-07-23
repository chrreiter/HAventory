"""Constants for the HAventory integration.

Defines the integration domain, the public integration version, and the
option keys/defaults for WebSocket rate limiting.
"""

# Integration domain used across all modules and entity unique IDs
DOMAIN: str = "haventory"

# Public integration version (kept in sync with manifest.json)
INTEGRATION_VERSION: str = "0.0.1"

# -----------------------------
# WebSocket rate limiting (config-entry options)
# -----------------------------
# Off by default so no development or test workflow is disturbed; enable via
# the integration's options flow (Settings -> Devices & services -> HAventory
# -> Configure). See docs/backend_api_contract.md "Rate limiting".

CONF_RATE_LIMIT_ENABLED: str = "rate_limit_enabled"
CONF_RATE_LIMIT_COMMANDS_PER_SECOND: str = "rate_limit_commands_per_second"
CONF_RATE_LIMIT_COMMANDS_BURST: str = "rate_limit_commands_burst"
CONF_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND: str = "rate_limit_global_commands_per_second"
CONF_RATE_LIMIT_GLOBAL_COMMANDS_BURST: str = "rate_limit_global_commands_burst"
CONF_RATE_LIMIT_EVENTS_PER_SECOND: str = "rate_limit_events_per_second"
CONF_RATE_LIMIT_EVENTS_BURST: str = "rate_limit_events_burst"
CONF_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND: str = "rate_limit_global_events_per_second"
CONF_RATE_LIMIT_GLOBAL_EVENTS_BURST: str = "rate_limit_global_events_burst"

DEFAULT_RATE_LIMIT_ENABLED: bool = False
# Sustained rate (tokens/second) and burst capacity per token bucket. The
# defaults are generous: a Lovelace card refresh is a handful of commands.
DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND: float = 20.0
DEFAULT_RATE_LIMIT_COMMANDS_BURST: float = 60.0
DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND: float = 100.0
DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST: float = 200.0
DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND: float = 50.0
DEFAULT_RATE_LIMIT_EVENTS_BURST: float = 200.0
DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND: float = 500.0
DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST: float = 1000.0
