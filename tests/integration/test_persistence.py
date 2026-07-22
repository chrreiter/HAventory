"""Integration: persistence round-trips through the real HA Store.

Confirms a mutation is written through Home Assistant's ``Store`` backend and can
be read back by a fresh store instance — the real serialize/deserialize path,
not the offline in-memory stub.
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from custom_components.haventory.storage import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEY,
    DomainStore,
    async_persist_immediate,
)
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def test_store_write_and_reload_roundtrip(hass: HomeAssistant, hass_storage: dict) -> None:
    """An item survives a write to Store and a reload by a new store instance."""

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    quantity = 7
    repo = hass.data[DOMAIN]["repository"]
    created = repo.create_item({"name": "Flashlight", "quantity": quantity})

    # Persist synchronously through the real HA Store backend.
    await async_persist_immediate(hass)

    # The write landed in HA's storage backend (mocked by hass_storage).
    assert STORAGE_KEY in hass_storage
    persisted = hass_storage[STORAGE_KEY]["data"]
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION
    assert any(i["name"] == "Flashlight" for i in persisted["items"].values())

    # A brand-new store instance reads the same payload back off the backend.
    reloaded = await DomainStore(hass, key=STORAGE_KEY, version=CURRENT_SCHEMA_VERSION).async_load()
    assert reloaded["schema_version"] == CURRENT_SCHEMA_VERSION
    reloaded_item = reloaded["items"][str(created.id)]
    assert reloaded_item["name"] == "Flashlight"
    assert reloaded_item["quantity"] == quantity
