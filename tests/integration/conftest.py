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

import pytest


@pytest.fixture(autouse=True)
def _auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant discover and load ``custom_components/haventory``.

    ``enable_custom_integrations`` is a phacc fixture; wrapping it as autouse
    means every test in this package can set up the integration from a config
    entry without repeating the boilerplate.
    """

    yield
