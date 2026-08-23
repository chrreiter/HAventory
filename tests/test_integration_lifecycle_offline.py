"""Offline tests for the HAventory integration lifecycle.

Scenarios:
- a second setup leaves one handler per WebSocket command and one service per name
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.ws import HANDLERS
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from runtime_helpers import runtime_of, setup_entry


@pytest.mark.asyncio
async def test_a_second_setup_leaves_one_handler_per_command() -> None:
    """Setting the entry up again registers over the top, as a reload does.

    Home Assistant can unregister neither a WebSocket command nor a service, and
    keys both registries by name — so a second registration replaces the first,
    and nothing has to be counted or taken back on unload.
    """

    hass = HomeAssistant()

    class _Entry(ConfigEntry):
        pass

    entry = await setup_entry(hass, _Entry())
    assert runtime_of(hass).store is not None
    assert runtime_of(hass).repository is not None

    commands = set(hass.data["__ws_commands__"])
    assert {handler._ws_command for handler in HANDLERS} <= commands
    service_names = [name for _domain, name, *_rest in hass.services.registered]
    assert hass.services.has_service(DOMAIN, "item_create")

    await setup_entry(hass, entry)

    assert set(hass.data["__ws_commands__"]) == commands
    assert [name for _domain, name, *_rest in hass.services.registered] == service_names
