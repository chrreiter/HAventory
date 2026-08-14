"""`calendar.haventory` — the dates already on items, as all-day events.

A wrapper over `calendar_projection`: this module owns the Home Assistant types
and the two things that move the entity's state, and holds no projection logic
of its own.

Nothing is scheduled. Occurrences are derived whenever something reads them, so
the only time-driven piece is a midnight rewrite that lets "the next event" roll
over on a day nobody touched the inventory.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .calendar_projection import ProjectedEvent, build_events, next_event, window_dates
from .const import CALENDAR_UNIQUE_ID, DOMAIN, INTEGRATION_VERSION, SIGNAL_INVENTORY_CHANGED
from .models import Item

LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """Add the one calendar this integration has."""

    async_add_entities([HaventoryCalendar(entry)])


class HaventoryCalendar(CalendarEntity):
    """Due and inspection dates across the inventory, projected on read."""

    _attr_has_entity_name = True
    # No name of its own. With `has_entity_name` that marks the entity as the
    # device's own feature, which is what makes the entity_id the reserved
    # `calendar.haventory` rather than the device name plus a suffix.
    _attr_name = None
    _attr_should_poll = False
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, entry: ConfigEntry) -> None:
        # A constant, where the sensors scope theirs to the entry: the manifest
        # declares `single_config_entry`, so there is never a second one to tell
        # this apart from, and the reserved entity_id is pinned to this string.
        self._attr_unique_id = CALENDAR_UNIQUE_ID
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="HAventory",
            manufacturer="HAventory",
            model="Inventory",
            sw_version=INTEGRATION_VERSION,
            entry_type="service",
        )

    async def async_added_to_hass(self) -> None:
        """Subscribe to the two things that move the reported event."""

        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_INVENTORY_CHANGED, self._handle_update)
        )
        # Local midnight, not UTC: the stored dates are calendar days as the
        # household wrote them, and rolling over at UTC midnight would move the
        # state mid-afternoon for anyone far enough east or west.
        self.async_on_remove(
            async_track_time_change(self.hass, self._handle_time_change, hour=0, minute=0, second=0)
        )

    @callback
    def _handle_update(self) -> None:
        self.async_write_ha_state()

    @callback
    def _handle_time_change(self, _now: datetime) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Unavailable while no config entry is loaded to read items from."""

        return self._items() is not None

    @property
    def event(self) -> CalendarEvent | None:
        """The occurrence happening now or next, across the whole inventory."""

        items = self._items()
        if items is None:
            return None
        upcoming = next_event(items, dt_util.now().date())
        return _as_calendar_event(upcoming) if upcoming is not None else None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Every occurrence the requested range touches."""

        items = self._items()
        if items is None:
            return []
        start, end = window_dates(dt_util.as_local(start_date), dt_util.as_local(end_date))
        return [_as_calendar_event(event) for event in build_events(items, start, end)]

    def _items(self) -> list[Item] | None:
        """Every item, or none while the entry is unloaded.

        The whole inventory rather than a date-range query: a range would be a
        new repository index that goes stale at midnight with no mutation to
        invalidate it, for a walk already bounded by the few-thousand-item
        ceiling the README states.
        """

        repo = (self.hass.data.get(DOMAIN) or {}).get("repository")
        if repo is None:
            return None
        try:
            result: dict[str, Any] = repo.list_items()
        except Exception:  # pragma: no cover - defensive
            LOGGER.exception(
                "Failed to read items for the calendar",
                extra={"domain": DOMAIN, "op": "calendar_items"},
            )
            return None
        return list(result["items"])


def _as_calendar_event(event: ProjectedEvent) -> CalendarEvent:
    """Wrap a projected occurrence in Home Assistant's own event type.

    Both bounds stay `date` rather than `datetime`: that is what Home Assistant
    reads as all-day, and a datetime would pin the occurrence to a time of day
    the household never gave.
    """

    return CalendarEvent(
        start=event.start,
        end=event.end,
        summary=event.summary,
        description=event.description or None,
        uid=event.uid,
    )
