"""pytest configuration for the HAventory in-process integration suite.

These tests exercise the integration inside a REAL Home Assistant core provided
by ``pytest-homeassistant-custom-component`` (phacc). Unlike the offline suite
(``tests/*_offline.py``), which fakes Home Assistant, this mode loads the actual
HA APIs so we catch drift the stubs can't see.

Run it with plugin autoload ENABLED (do NOT set ``PYTEST_DISABLE_PLUGIN_AUTOLOAD``)
so phacc auto-registers via its entry point and brings its
pytest-asyncio / pytest-aiohttp / pytest-socket stack. phacc requires
pytest-asyncio's auto mode, so pass ``-o asyncio_mode=auto``:

    pytest -o asyncio_mode=auto tests/integration

or use the wrapper: ``scripts/test_integration.sh``.

The parent ``tests/conftest.py`` detects the real ``homeassistant`` package these
tests import and installs none of the offline stubs, so the two modes never
collide.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from custom_components.haventory.const import DOMAIN
from pytest_homeassistant_custom_component.common import MockConfigEntry

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from homeassistant.core import HomeAssistant

    SetupEntry = Callable[..., Awaitable[MockConfigEntry]]


@pytest.fixture(autouse=True)
def _auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant discover and load ``custom_components/haventory``.

    ``enable_custom_integrations`` is a phacc fixture; wrapping it as autouse
    means every test in this package can set up the integration from a config
    entry without repeating the boilerplate.
    """

    yield


@pytest.fixture
def setup_entry(hass: HomeAssistant) -> SetupEntry:
    """Bring the integration up from a config entry, as Home Assistant does.

    ``hass.config_entries.async_setup`` rather than ``async_setup_entry``: only
    the registry path moves the entry through its states, forwards the
    platforms and lets a later reload or unload address it by ``entry_id``.
    The returned entry is what those tests need afterwards.

    Setting up is a step inside a test, not a precondition of one, so this is a
    factory rather than an autouse fixture — several tests fill `hass_storage`,
    monkeypatch a module or listen on the bus before the entry may load.
    """

    async def _setup(options: dict | None = None) -> MockConfigEntry:
        entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory", options=options or {})
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        return entry

    return _setup
