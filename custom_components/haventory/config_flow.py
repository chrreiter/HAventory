"""Config flow for HAventory."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult


DOMAIN = "haventory"


class HAventoryConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for HAventory."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step.

        Single-instance setup for now. Create entry immediately.
        """
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        return self.async_create_entry(title="HAventory", data={})
