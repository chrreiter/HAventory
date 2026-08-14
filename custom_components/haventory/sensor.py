"""Four inventory counts as sensor entities on one HAventory device.

Push only — no coordinator and no polling. Two things move a state: a mutation,
through the dispatcher signal `events.notify_mutation` sends, and UTC midnight,
for the two counts that are derived from the calendar and so change with no
mutation at all.
"""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_utc_time_change

from .const import (
    DOMAIN,
    INTEGRATION_VERSION,
    SENSOR_DESCRIPTIONS,
    SIGNAL_COUNTS_UPDATED,
    HaventorySensorDescription,
)

LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """Add one sensor per count in the catalog."""

    async_add_entities(
        HaventoryCountSensor(hass, entry, description) for description in SENSOR_DESCRIPTIONS
    )


class HaventoryCountSensor(SensorEntity):
    """One count from `Repository.get_counts()`."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, description: HaventorySensorDescription
    ) -> None:
        self._hass = hass
        self._description = description
        self._attr_translation_key = description.translation_key
        self._attr_icon = description.icon
        # entry_id, not a domain-global string: removing and re-adding the entry
        # is a fresh install, and must not resurrect the removed entry's
        # entity_ids.
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="HAventory",
            manufacturer="HAventory",
            model="Inventory",
            sw_version=INTEGRATION_VERSION,
            entry_type="service",
        )

    async def async_added_to_hass(self) -> None:
        """Subscribe to the two things that move this count."""

        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_COUNTS_UPDATED, self._handle_update)
        )
        if self._description.date_derived:
            # `overdue_count` and `inspection_overdue_count` are derived from
            # today's date against stored dates, so they move at midnight with
            # nothing having been mutated. UTC, because the counts themselves
            # compare against a UTC date.
            self.async_on_remove(
                async_track_utc_time_change(
                    self.hass, self._handle_time_change, hour=0, minute=0, second=0
                )
            )

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()

    @callback
    def _handle_time_change(self, _now: Any) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Unavailable while no config entry is loaded to read counts from."""

        return self._counts() is not None

    @property
    def native_value(self) -> int | None:
        counts = self._counts()
        if counts is None:
            return None
        value = counts.get(self._description.key)
        return int(value) if value is not None else None

    def _counts(self) -> dict[str, Any] | None:
        repo = (self.hass.data.get(DOMAIN) or {}).get("repository")
        if repo is None:
            return None
        try:
            return dict(repo.get_counts())
        except Exception:  # pragma: no cover - defensive
            LOGGER.exception(
                "Failed to read counts for a sensor",
                extra={"domain": DOMAIN, "op": "sensor_counts", "key": self._description.key},
            )
            return None
