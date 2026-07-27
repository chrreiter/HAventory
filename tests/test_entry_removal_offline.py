"""Offline tests for the config-entry removal contract.

Removing the integration takes back the Lovelace resource it registered and
keeps the persisted inventory, so a re-add restores the data.
"""

from __future__ import annotations

import importlib
import sys
import types
from typing import Any

import pytest
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

CARD_URL = "/local/haventory/haventory-card.js"
LOVELACE_KEY = "lovelace_data_key"


class MockResourceCollection:
    """Storage-mode Lovelace resource collection.

    Mirrors the real collection in the one respect the caller has to get right:
    an unloaded collection reports no items at all.
    """

    def __init__(self, items: list[dict[str, Any]] | None = None, *, loaded: bool = True) -> None:
        self.loaded = loaded
        self._stored: list[dict[str, Any]] = list(items or [])
        self.deleted: list[str] = []

    def async_items(self) -> list[dict[str, Any]]:
        return self._stored if self.loaded else []

    async def async_load(self) -> None:
        self.loaded = True

    async def async_delete_item(self, item_id: str) -> None:
        self.deleted.append(item_id)
        self._stored = [item for item in self._stored if item.get("id") != item_id]


class MockYamlResourceCollection:
    """YAML-mode collection: readable, with no mutation API."""

    def __init__(self, items: list[dict[str, Any]] | None = None) -> None:
        self.loaded = True
        self._stored: list[dict[str, Any]] = list(items or [])

    def async_items(self) -> list[dict[str, Any]]:
        return self._stored

    async def async_load(self) -> None:
        pass


def _import_with_lovelace(monkeypatch):
    """Reimport the integration with a stand-in lovelace component.

    ``LOVELACE_DATA`` is read at import time, so the fake module has to be in
    ``sys.modules`` before the integration package is (re)executed.
    """
    lovelace_module = types.SimpleNamespace(LOVELACE_DATA=LOVELACE_KEY)
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace", lovelace_module)
    if "custom_components.haventory" in sys.modules:
        del sys.modules["custom_components.haventory"]
    return importlib.import_module("custom_components.haventory")


def _hass_with_resources(resources: Any) -> HomeAssistant:
    hass = HomeAssistant()
    hass.data[LOVELACE_KEY] = types.SimpleNamespace(resources=resources)
    return hass


@pytest.mark.asyncio
async def test_remove_entry_deletes_card_resource(monkeypatch) -> None:
    """Removal drops our resource entry and leaves everyone else's alone."""

    hav_init = _import_with_lovelace(monkeypatch)
    resources = MockResourceCollection(
        [
            {"id": "other", "url": "/local/other-card.js", "type": "module"},
            {"id": "haventory", "url": CARD_URL, "type": "module"},
            {"id": "lookalike", "url": "/hacsfiles/elsewhere/haventory-card.js", "type": "module"},
        ]
    )
    hass = _hass_with_resources(resources)

    await hav_init.async_remove_entry(hass, ConfigEntry())

    assert resources.deleted == ["haventory"]
    assert [item["id"] for item in resources.async_items()] == ["other", "lookalike"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "registered_url",
    [
        f"{CARD_URL}?v=38b725595b78",
        f"{CARD_URL}?v=1&foo=bar",
        f"{CARD_URL}#frag",
    ],
)
async def test_remove_entry_deletes_versioned_card_resource(monkeypatch, registered_url) -> None:
    """A cache-busting query does not hide the resource from removal."""

    hav_init = _import_with_lovelace(monkeypatch)
    resources = MockResourceCollection([{"id": "haventory", "url": registered_url}])
    hass = _hass_with_resources(resources)

    await hav_init.async_remove_entry(hass, ConfigEntry())

    assert resources.deleted == ["haventory"]
    assert resources.async_items() == []


@pytest.mark.asyncio
async def test_remove_entry_tolerates_absent_resource(monkeypatch) -> None:
    """Nothing of ours registered (manually removed, or never created) => no-op."""

    hav_init = _import_with_lovelace(monkeypatch)
    resources = MockResourceCollection([{"id": "other", "url": "/local/other-card.js"}])
    hass = _hass_with_resources(resources)

    await hav_init.async_remove_entry(hass, ConfigEntry())

    assert resources.deleted == []
    assert [item["id"] for item in resources.async_items()] == ["other"]


@pytest.mark.asyncio
async def test_remove_entry_in_yaml_mode_does_not_raise(monkeypatch) -> None:
    """YAML-mode resources are the user's to edit; removal must not blow up."""

    hav_init = _import_with_lovelace(monkeypatch)
    resources = MockYamlResourceCollection([{"id": "haventory", "url": CARD_URL}])
    hass = _hass_with_resources(resources)

    await hav_init.async_remove_entry(hass, ConfigEntry())

    assert [item["id"] for item in resources.async_items()] == ["haventory"]


@pytest.mark.asyncio
async def test_remove_entry_loads_resources_before_deleting(monkeypatch) -> None:
    """An unloaded collection reports no items until it is loaded."""

    hav_init = _import_with_lovelace(monkeypatch)
    resources = MockResourceCollection([{"id": "haventory", "url": CARD_URL}], loaded=False)
    hass = _hass_with_resources(resources)

    await hav_init.async_remove_entry(hass, ConfigEntry())

    assert resources.loaded is True
    assert resources.deleted == ["haventory"]


@pytest.mark.asyncio
async def test_remove_entry_without_lovelace_does_not_raise(monkeypatch) -> None:
    """Lovelace not initialized => removal completes silently."""

    hav_init = _import_with_lovelace(monkeypatch)
    hass = HomeAssistant()

    await hav_init.async_remove_entry(hass, ConfigEntry())


@pytest.mark.asyncio
async def test_remove_entry_with_resources_none_does_not_raise(monkeypatch) -> None:
    """Lovelace present but without a resource collection => removal completes."""

    hav_init = _import_with_lovelace(monkeypatch)
    hass = _hass_with_resources(None)

    await hav_init.async_remove_entry(hass, ConfigEntry())


@pytest.mark.asyncio
async def test_remove_entry_keeps_stored_inventory(monkeypatch) -> None:
    """The store survives removal so a re-add restores the inventory."""

    hav_init = _import_with_lovelace(monkeypatch)
    resources = MockResourceCollection([{"id": "haventory", "url": CARD_URL}])
    hass = _hass_with_resources(resources)

    key = "test_store_entry_removal"
    payload = {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": {"item-1": {"id": "item-1", "name": "Screwdriver", "version": 1}},
        "locations": {"loc-1": {"id": "loc-1", "name": "Garage"}},
    }
    store = DomainStore(hass, key=key)
    await store.async_save(payload)
    hass.data[hav_init.DOMAIN] = {"store": store}

    await hav_init.async_remove_entry(hass, ConfigEntry())

    assert resources.deleted == ["haventory"]
    assert await DomainStore(hass, key=key).async_load() == payload
