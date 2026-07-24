"""Config flow (and options flow) for HAventory."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant import config_entries

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

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry, ConfigFlowResult

# (option key, default) pairs for the numeric rate-limit tunables.
_RATE_LIMIT_NUMBER_OPTIONS: tuple[tuple[str, float], ...] = (
    (CONF_RATE_LIMIT_COMMANDS_PER_SECOND, DEFAULT_RATE_LIMIT_COMMANDS_PER_SECOND),
    (CONF_RATE_LIMIT_COMMANDS_BURST, DEFAULT_RATE_LIMIT_COMMANDS_BURST),
    (CONF_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND, DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_PER_SECOND),
    (CONF_RATE_LIMIT_GLOBAL_COMMANDS_BURST, DEFAULT_RATE_LIMIT_GLOBAL_COMMANDS_BURST),
    (CONF_RATE_LIMIT_EVENTS_PER_SECOND, DEFAULT_RATE_LIMIT_EVENTS_PER_SECOND),
    (CONF_RATE_LIMIT_EVENTS_BURST, DEFAULT_RATE_LIMIT_EVENTS_BURST),
    (CONF_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND, DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_PER_SECOND),
    (CONF_RATE_LIMIT_GLOBAL_EVENTS_BURST, DEFAULT_RATE_LIMIT_GLOBAL_EVENTS_BURST),
)


def _options_schema(current: dict[str, Any]) -> vol.Schema:
    """Build the options-flow schema, defaulting to the stored options."""
    fields: dict[Any, Any] = {
        vol.Required(
            CONF_RATE_LIMIT_ENABLED,
            default=bool(current.get(CONF_RATE_LIMIT_ENABLED, DEFAULT_RATE_LIMIT_ENABLED)),
        ): bool
    }
    for key, default in _RATE_LIMIT_NUMBER_OPTIONS:
        # Bucket capacities below one token would block ALL traffic (a bucket
        # never holding a whole token can never grant one) — require >= 1.
        minimum = 1.0 if key.endswith("_burst") else 0.1
        fields[vol.Required(key, default=float(current.get(key, default)))] = vol.All(
            vol.Coerce(float), vol.Range(min=minimum)
        )
    return vol.Schema(fields)


class HAventoryOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle HAventory options (WebSocket rate limiting)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = dict(getattr(self.config_entry, "options", None) or {})
        return self.async_show_form(step_id="init", data_schema=_options_schema(current))


class HAventoryConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):  # type: ignore[call-arg]  # HA ConfigFlow domain= kwarg; HA is not installed for mypy
    """Handle a config flow for HAventory."""

    VERSION = 1

    @staticmethod
    def async_get_options_flow(config_entry: ConfigEntry) -> HAventoryOptionsFlowHandler:
        """Create the options flow."""
        return HAventoryOptionsFlowHandler()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Handle the initial step.

        Single-instance setup for now. Create entry immediately.
        """
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        return self.async_create_entry(title="HAventory", data={})
