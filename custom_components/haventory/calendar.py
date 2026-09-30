"""`calendar.haventory` — the dates already on items, as all-day events.

A wrapper over `calendar_projection`. Occurrences are derived on read, so the
only time-driven piece is a midnight rewrite that rolls "the next event" over.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.translation import async_get_translations
from homeassistant.util import dt as dt_util

from .calendar_projection import (
    SUMMARY_PATTERNS,
    ProjectedEvent,
    build_events,
    next_event,
    window_dates,
)
from .const import CALENDAR_UNIQUE_ID, DOMAIN, SIGNAL_INVENTORY_CHANGED
from .models import Item
from .runtime import find_runtime
from .sensor import device_info

# hassfest rejects an invented top-level section in `strings.json`, so the
# summary patterns sit in `common` under `calendar_`-prefixed keys.
TRANSLATION_CATEGORY = "common"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """Add the one calendar this integration has."""

    async_add_entities([HaventoryCalendar(entry)])


class HaventoryCalendar(CalendarEntity):
    """Due and inspection dates across the inventory, projected on read."""

    _attr_has_entity_name = True
    # No name of its own, which makes the entity_id `calendar.haventory`.
    _attr_name = None
    _attr_should_poll = False
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, entry: ConfigEntry) -> None:
        self._attr_unique_id = CALENDAR_UNIQUE_ID
        self._summaries: Mapping[str, str] = SUMMARY_PATTERNS
        self._attr_device_info = device_info(entry)

    async def async_added_to_hass(self) -> None:
        """Subscribe to the two things that move the reported event."""

        self._summaries = await _async_summaries(self.hass)
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_INVENTORY_CHANGED, self._handle_update)
        )
        # Local midnight, not UTC: the stored dates are the household's days.
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
        upcoming = next_event(items, dt_util.now().date(), summaries=self._summaries)
        return _as_calendar_event(upcoming) if upcoming is not None else None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Every occurrence the requested range touches."""

        items = self._items()
        if items is None:
            return []
        start, end = window_dates(dt_util.as_local(start_date), dt_util.as_local(end_date))
        return [
            _as_calendar_event(event)
            for event in build_events(items, start, end, summaries=self._summaries)
        ]

    def _items(self) -> list[Item] | None:
        """Every item, or none while the entry is unloaded.

        The whole inventory rather than a date index, which would go stale at
        midnight with no mutation to invalidate it.
        """

        runtime = find_runtime(self.hass)
        return None if runtime is None else list(runtime.repository.list_items()["items"])


async def _async_summaries(hass: HomeAssistant) -> Mapping[str, str]:
    """The three summary patterns, in the language the server runs in.

    The server's language, because a summary is also the entity's `message`
    attribute. Resolved once, because `CalendarEntity.event` is a synchronous
    property.
    """

    resources = await async_get_translations(
        hass, hass.config.language, TRANSLATION_CATEGORY, integrations=[DOMAIN]
    )
    prefix = f"component.{DOMAIN}.{TRANSLATION_CATEGORY}."
    return {
        kind: resources.get(f"{prefix}calendar_{kind}", default)
        for kind, default in SUMMARY_PATTERNS.items()
    }


def _as_calendar_event(event: ProjectedEvent) -> CalendarEvent:
    """Wrap a projected occurrence in Home Assistant's event type; `date` bounds mean all-day."""

    return CalendarEvent(
        start=event.start,
        end=event.end,
        summary=event.summary,
        description=event.description or None,
        uid=event.uid,
    )
