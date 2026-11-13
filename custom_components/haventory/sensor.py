"""The promoted inventory counts as sensor entities on one HAventory device.

Push only — no coordinator and no polling. Two things move a state: a mutation,
through the dispatcher signal `events.py` sends, and the instance's local
midnight, for the counts that are derived from the calendar and so change with
no mutation at all. `const.SENSOR_DESCRIPTIONS` is the catalog; nothing here is
per-count.

The signal carries the counts computed once for the write, and each entity
keeps the value it last read. Every sensor reading `Repository.get_counts()`
itself would walk the inventory once per entity per write. The value cannot go
stale, because the two triggers above are the only things that move a count.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_change

from .const import (
    DOMAIN,
    INTEGRATION_VERSION,
    SENSOR_DESCRIPTIONS,
    SIGNAL_INVENTORY_CHANGED,
    HaventorySensorDescription,
)
from .runtime import find_runtime


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """Add one sensor per count in the catalog."""

    async_add_entities(HaventoryCountSensor(entry, d) for d in SENSOR_DESCRIPTIONS)


def device_info(entry: ConfigEntry) -> DeviceInfo:
    """The one HAventory device every entity this integration owns sits on."""

    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="HAventory",
        manufacturer="HAventory",
        model="Inventory",
        sw_version=INTEGRATION_VERSION,
        entry_type=DeviceEntryType.SERVICE,
    )


class HaventoryCountSensor(SensorEntity):
    """One count from `Repository.get_counts()`."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, entry: ConfigEntry, description: HaventorySensorDescription) -> None:
        self._description = description
        self._attr_translation_key = description.translation_key
        self._attr_icon = description.icon
        # Entry-scoped, so re-adding the entry does not resurrect the old entity_ids.
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = device_info(entry)

    async def async_added_to_hass(self) -> None:
        """Read the count once, then subscribe to the two things that move it."""

        self._read(self._current_counts())
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_INVENTORY_CHANGED, self._handle_mutation)
        )
        if self._description.date_derived:
            # The instance's local midnight, not UTC's: the counts compare
            # against the local day.
            self.async_on_remove(
                async_track_time_change(
                    self.hass, self._handle_midnight, hour=0, minute=0, second=0
                )
            )

    @callback
    def _handle_mutation(self, counts: Mapping[str, Any] | None = None) -> None:
        self._read(counts if counts is not None else self._current_counts())
        self.async_write_ha_state()

    @callback
    def _handle_midnight(self, _now: datetime) -> None:
        self._read(self._current_counts())
        self.async_write_ha_state()

    def _read(self, counts: Mapping[str, Any] | None) -> None:
        """Unavailable while no config entry is loaded to read counts from."""

        self._attr_available = counts is not None
        value = None if counts is None else counts.get(self._description.key)
        self._attr_native_value = int(value) if value is not None else None

    def _current_counts(self) -> dict[str, Any] | None:
        runtime = find_runtime(self.hass)
        return None if runtime is None else runtime.repository.get_counts()
