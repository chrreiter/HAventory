"""`calendar.haventory` — the dates already on items, as all-day events.

A wrapper over `calendar_projection`: this module owns the Home Assistant types
and the two things that move the entity's state, and holds no projection logic
of its own.

Nothing is scheduled. Occurrences are derived whenever something reads them, so
the only time-driven piece is a midnight rewrite that lets "the next event" roll
over on a day nobody touched the inventory.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
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
from .const import CALENDAR_UNIQUE_ID, DOMAIN, INTEGRATION_VERSION, SIGNAL_INVENTORY_CHANGED
from .logs import context_logger
from .models import Item
from .runtime import find_runtime

LOGGER = context_logger(__name__)

# Which section of `strings.json` the summary patterns live in. Home Assistant
# reads any top-level section as a translation category, but hassfest validates
# `strings.json` against a fixed set of them and rejects an invented one, so the
# three patterns sit in `common` under `calendar_`-prefixed keys.
TRANSLATION_CATEGORY = "common"


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
        self._summaries: Mapping[str, str] = SUMMARY_PATTERNS
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

        self._summaries = await _async_summaries(self.hass)
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

        The whole inventory rather than a date-range query: a range would be a
        new repository index that goes stale at midnight with no mutation to
        invalidate it, for a walk already bounded by the few-thousand-item
        ceiling the README states.
        """

        runtime = find_runtime(self.hass)
        if runtime is None:
            return None
        try:
            result = runtime.repository.list_items()
        except Exception:  # pragma: no cover - defensive
            LOGGER.exception(
                "Failed to read items for the calendar",
                extra={"domain": DOMAIN, "op": "calendar_items"},
            )
            return None
        return list(result["items"])


async def _async_summaries(hass: HomeAssistant) -> Mapping[str, str]:
    """The three summary patterns, in the language the server runs in.

    `hass.config.language` rather than the reading user's: an event summary is
    also `calendar.haventory`'s `message` attribute, which an automation
    templates, and an entity's state has one language — the server's, which is
    what Home Assistant names its own entities in.

    Resolved once, on the entity, because `CalendarEntity.event` is a
    synchronous property that cannot await one. Home Assistant loads English
    first and lays the requested language over it, so a key a translation has
    not reached keeps its English pattern with nothing to arrange here.
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
