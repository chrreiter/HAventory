"""The fix flow behind HAventory's one fixable repairs issue.

Home Assistant loads this module on demand when the user presses **Fix** on a
repairs card, which is why nothing in the package imports it.

Only the corrupt-store refusal is fixable. Setup stops rather than load a store
whose rows it cannot all read, because every mutation persists immediately: a
partial load rewrites the file without those rows on the first edit and makes
the loss permanent. This flow is the way past that, and the copy it takes first
is what makes going past it reversible — the load itself destroys nothing.
"""

from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.components.repairs import ConfirmRepairFlow, RepairsFlow, RepairsFlowResult
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .const import CONF_ALLOW_LOSSY_LOAD, DOMAIN, ISSUE_CORRUPT_STORE
from .storage import async_backup_store

LOGGER = logging.getLogger(__name__)


class LossyLoadRepairFlow(RepairsFlow):
    """Back the store up, opt the next boot in to the lossy load, and reload."""

    async def async_step_init(self, user_input: dict[str, str] | None = None) -> RepairsFlowResult:
        """Start at the confirmation; there is nothing to ask before it."""

        return await self.async_step_confirm()

    async def async_step_confirm(
        self, user_input: dict[str, str] | None = None
    ) -> RepairsFlowResult:
        """Show what will be lost, and on confirmation do the three steps in order."""

        if user_input is None:
            return self.async_show_form(
                step_id="confirm",
                data_schema=vol.Schema({}),
                description_placeholders=self._issue_placeholders(),
            )

        # `single_config_entry` in the manifest means there is exactly one entry
        # to reload, so the flow does not have to carry an id that could go stale
        # between the refusal and the press of the button.
        entries = self.hass.config_entries.async_entries(DOMAIN)
        if not entries:
            return self.async_abort(reason="no_config_entry")
        entry = entries[0]

        try:
            copied = await async_backup_store(self.hass)
        except Exception:  # pragma: no cover - defensive
            LOGGER.error(
                "Failed to copy the HAventory store aside; not loading it lossily",
                extra={"domain": DOMAIN, "op": "repair_lossy_load"},
                exc_info=True,
            )
            copied = False
        if not copied:
            # Without the copy there is no way back from the first mutation
            # after the load, so the offer is withdrawn rather than honoured.
            return self.async_abort(reason="backup_failed")

        self.hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_ALLOW_LOSSY_LOAD: True}
        )
        await self.hass.config_entries.async_reload(entry.entry_id)

        if entry.state is not ConfigEntryState.LOADED:
            # Aborting is what keeps the card up: Home Assistant deletes the
            # issue when a fix flow finishes any other way, and a card that
            # disappears while the integration is still down is a lie.
            return self.async_abort(reason="reload_failed")
        return self.async_create_entry(data={})

    def _issue_placeholders(self) -> dict[str, str] | None:
        """Reuse the counts the issue was created with, so the form can quote them."""

        issue = ir.async_get(self.hass).async_get_issue(DOMAIN, self.issue_id)
        return issue.translation_placeholders if issue is not None else None


async def async_create_fix_flow(
    hass: HomeAssistant, issue_id: str, data: dict[str, str | int | float | None] | None
) -> RepairsFlow:
    """Return the flow that fixes ``issue_id``.

    The three arguments are the repairs platform's contract, not this module's
    choice; HAventory's issues carry no ``data``, and the flow reads what it
    needs off the issue registry when it runs.
    """

    if issue_id == ISSUE_CORRUPT_STORE:
        return LossyLoadRepairFlow()
    # Every other issue this integration raises is informational, so nothing is
    # left to do but acknowledge it — which is what Home Assistant's own flow is.
    return ConfirmRepairFlow()
