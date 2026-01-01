"""Tests for frontend auto-registration of the HAventory card asset."""

from __future__ import annotations

import importlib
import os
import sys
import types
from typing import Any

import pytest


class MockResourceCollection:
    """Mock Lovelace resource collection."""

    def __init__(self):
        self.loaded = True
        self._items: list[dict[str, Any]] = []
        self.created: list[dict[str, Any]] = []

    def async_items(self) -> list[dict[str, Any]]:
        return self._items

    async def async_load(self):
        pass

    async def async_create_item(self, data: dict[str, Any]) -> dict[str, Any]:
        self.created.append(data)
        return {"id": "test_id", **data}


class MockLovelaceData:
    """Mock Lovelace data container."""

    def __init__(self):
        self.resources = MockResourceCollection()


class HassStub:
    """Minimal Home Assistant stub."""

    def __init__(self, base_path: str) -> None:
        self.data: dict[str, Any] = {}
        self._base_path = base_path

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
async def test_registers_lovelace_resource_when_present(tmp_path, monkeypatch):
    """Asset present, resource collection in storage mode => creates resource."""
    # Reload the module to pick up any changes
    if "custom_components.haventory" in sys.modules:
        del sys.modules["custom_components.haventory"]
    hav_init = importlib.import_module("custom_components.haventory")

    # Arrange: create fake asset
    asset_dir = tmp_path / "www" / "haventory"
    asset_dir.mkdir(parents=True)
    asset_file = asset_dir / "haventory-card.js"
    asset_file.write_text("// test asset")

    hass = HassStub(str(tmp_path))
    hass.config = HassStub._Config(str(tmp_path))

    # Mock LOVELACE_DATA constant
    lovelace_data = MockLovelaceData()

    # Create mock lovelace module with LOVELACE_DATA key
    mock_lovelace_key = "lovelace_data_key"
    lovelace_module = types.SimpleNamespace(LOVELACE_DATA=mock_lovelace_key)
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace", lovelace_module)

    # Set up hass.data with the mock lovelace data
    hass.data[mock_lovelace_key] = lovelace_data

    # Act
    await hav_init._register_frontend_module(hass)

    # Assert: resource was created
    assert len(lovelace_data.resources.created) == 1
    created = lovelace_data.resources.created[0]
    assert created["url"] == "/local/haventory/haventory-card.js"
    assert created["res_type"] == "module"


@pytest.mark.asyncio
async def test_skips_when_asset_missing(tmp_path, monkeypatch):
    """Asset not present => does not create resource."""
    if "custom_components.haventory" in sys.modules:
        del sys.modules["custom_components.haventory"]
    hav_init = importlib.import_module("custom_components.haventory")

    hass = HassStub(str(tmp_path))
    hass.config = HassStub._Config(str(tmp_path))

    # Mock LOVELACE_DATA
    lovelace_data = MockLovelaceData()
    mock_lovelace_key = "lovelace_data_key"
    lovelace_module = types.SimpleNamespace(LOVELACE_DATA=mock_lovelace_key)
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace", lovelace_module)
    hass.data[mock_lovelace_key] = lovelace_data

    # Act (no asset file created)
    await hav_init._register_frontend_module(hass)

    # Assert: no resource created
    assert len(lovelace_data.resources.created) == 0


@pytest.mark.asyncio
async def test_skips_when_resource_already_exists(tmp_path, monkeypatch):
    """Resource already registered => does not create duplicate."""
    if "custom_components.haventory" in sys.modules:
        del sys.modules["custom_components.haventory"]
    hav_init = importlib.import_module("custom_components.haventory")

    # Arrange: create fake asset
    asset_dir = tmp_path / "www" / "haventory"
    asset_dir.mkdir(parents=True)
    asset_file = asset_dir / "haventory-card.js"
    asset_file.write_text("// test asset")

    hass = HassStub(str(tmp_path))
    hass.config = HassStub._Config(str(tmp_path))

    # Mock LOVELACE_DATA with existing resource
    lovelace_data = MockLovelaceData()
    lovelace_data.resources._items = [
        {"id": "existing", "url": "/local/haventory/haventory-card.js", "type": "module"}
    ]
    mock_lovelace_key = "lovelace_data_key"
    lovelace_module = types.SimpleNamespace(LOVELACE_DATA=mock_lovelace_key)
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace", lovelace_module)
    hass.data[mock_lovelace_key] = lovelace_data

    # Act
    await hav_init._register_frontend_module(hass)

    # Assert: no new resource created
    assert len(lovelace_data.resources.created) == 0


@pytest.mark.asyncio
async def test_skips_when_lovelace_not_initialized(tmp_path, monkeypatch):
    """Lovelace not initialized => skips gracefully."""
    if "custom_components.haventory" in sys.modules:
        del sys.modules["custom_components.haventory"]
    hav_init = importlib.import_module("custom_components.haventory")

    # Arrange: create fake asset
    asset_dir = tmp_path / "www" / "haventory"
    asset_dir.mkdir(parents=True)
    asset_file = asset_dir / "haventory-card.js"
    asset_file.write_text("// test asset")

    hass = HassStub(str(tmp_path))
    hass.config = HassStub._Config(str(tmp_path))

    # Mock LOVELACE_DATA but don't set it in hass.data
    mock_lovelace_key = "lovelace_data_key"
    lovelace_module = types.SimpleNamespace(LOVELACE_DATA=mock_lovelace_key)
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace", lovelace_module)
    # hass.data[mock_lovelace_key] is NOT set

    # Act - should not raise
    await hav_init._register_frontend_module(hass)

    # Assert: no error, function completed gracefully
    assert True
