"""Config flow for HAventory."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant import config_entries

from .const import DOMAIN

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigFlowResult


class HAventoryConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for HAventory."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Handle the initial step.

        Single-instance setup for now. Create entry immediately.
        """
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        return self.async_create_entry(title="HAventory", data={})
