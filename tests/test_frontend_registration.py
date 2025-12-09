"""Tests for frontend auto-registration of the HAventory card asset."""

from __future__ import annotations

import importlib
import os
import sys
import types
from typing import Any

import pytest


class HassStub:
    """Minimal Home Assistant stub."""

    def __init__(self, base_path: str) -> None:
        self.data: dict[str, Any] = {}
        self._base_path = base_path
        self.added: list[str] = []

    class _Config:
        def __init__(self, base_path: str) -> None:
            self._base_path = base_path

        def path(self, *parts: str) -> str:
            return os.path.join(self._base_path, *parts)

    @property
    def config(self):
        return self._config

    @config.setter
    def config(self, value):
        self._config = value


@pytest.mark.asyncio
async def test_registers_frontend_asset_when_present(tmp_path, monkeypatch):
    hav_init = importlib.import_module("custom_components.haventory.__init__")

    # Arrange: create fake asset
    asset_dir = tmp_path / "www" / "haventory"
    asset_dir.mkdir(parents=True)
    asset_file = asset_dir / "haventory-card.js"
    asset_file.write_text("// test asset")

    hass = HassStub(str(tmp_path))
    hass.config = HassStub._Config(str(tmp_path))

    # Fake frontend.add_extra_module_url
    frontend = types.SimpleNamespace()

    def fake_add_extra_module_url(hass_obj, url: str):
        hass_obj.added.append(url)

    frontend.add_extra_module_url = fake_add_extra_module_url
    monkeypatch.setitem(sys.modules, "homeassistant.components.frontend", frontend)
    # Override module-level import cache
    old_frontend = getattr(hav_init, "hass_frontend", None)
    hav_init.hass_frontend = frontend

    # Act
    await hav_init._register_frontend_module(hass)

    # Assert
    assert "/local/haventory/haventory-card.js" in hass.added
    hav_init.hass_frontend = old_frontend


@pytest.mark.asyncio
async def test_skips_frontend_asset_when_missing(tmp_path, monkeypatch):
    hav_init = importlib.import_module("custom_components.haventory.__init__")

    hass = HassStub(str(tmp_path))
    hass.config = HassStub._Config(str(tmp_path))

    # Fake frontend.add_extra_module_url (should not be called)
    called = False

    def fake_add_extra_module_url(_hass_obj, _url: str):
        nonlocal called
        called = True

    frontend = types.SimpleNamespace(add_extra_module_url=fake_add_extra_module_url)
    monkeypatch.setitem(sys.modules, "homeassistant.components.frontend", frontend)
    old_frontend = getattr(hav_init, "hass_frontend", None)
    hav_init.hass_frontend = frontend

    # Act
    await hav_init._register_frontend_module(hass)

    # Assert
    assert called is False
    hav_init.hass_frontend = old_frontend
