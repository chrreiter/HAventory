"""Integration: `calendar.haventory` on the HAventory device.

The entity itself is only real here — offline there is no entity platform, no
device registry and no `hass.config_entries`, so the reserved entity_id, the
`unique_id` and the state transitions cannot be observed there. The projection
the entity wraps is covered offline (`tests/test_calendar_offline.py`).
"""

from __future__ import annotations

from datetime import timedelta

from custom_components.haventory.const import CALENDAR_UNIQUE_ID, DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

ENTITY_ID = "calendar.haventory"


async def _create(hass: HomeAssistant, **payload) -> dict:
    result = await hass.services.async_call(
        DOMAIN, "item_create", payload, blocking=True, return_response=True
    )
    await hass.async_block_till_done()
    return result["item"]


async def test_the_calendar_takes_the_reserved_entity_id_and_a_constant_unique_id(
    hass: HomeAssistant,
    setup_entry,
) -> None:
    """`calendar.haventory` is the name the repository reserved for this entity."""

    entry = await setup_entry()

    registry = er.async_get(hass)
    entity = registry.async_get(ENTITY_ID)
    assert entity is not None
    assert entity.unique_id == CALENDAR_UNIQUE_ID
    assert entity.config_entry_id == entry.entry_id

    # The friendly name comes from the device, which is what `_attr_name = None`
    # under `has_entity_name` buys — and is why the entity_id carries no suffix.
    state = hass.states.get(ENTITY_ID)
    assert state is not None
    assert state.attributes["friendly_name"] == "HAventory"


async def test_it_joins_the_same_device_as_the_sensors(hass: HomeAssistant, setup_entry) -> None:
    entry = await setup_entry()

    device_registry = dr.async_get(hass)
    device = device_registry.async_get_device(identifiers={(DOMAIN, entry.entry_id)})
    assert device is not None

    registry = er.async_get(hass)
    entity = registry.async_get(ENTITY_ID)
    assert entity.device_id == device.id


async def test_an_empty_inventory_reports_no_event(hass: HomeAssistant, setup_entry) -> None:
    await setup_entry()

    assert hass.states.get(ENTITY_ID).state == "off"


async def test_async_get_events_projects_both_dated_fields(
    hass: HomeAssistant, setup_entry
) -> None:
    """The range read a calendar dashboard performs."""

    await setup_entry()
    today = dt_util.now().date()
    due = today + timedelta(days=3)
    inspection = today + timedelta(days=5)

    await _create(hass, name="Ladder", checked_out=True, due_date=due.isoformat())
    await _create(hass, name="Extinguisher", inspection_date=inspection.isoformat())

    window_end = dt_util.start_of_local_day() + timedelta(days=30)
    events = await hass.services.async_call(
        "calendar",
        "get_events",
        {"entity_id": ENTITY_ID, "end_date_time": window_end},
        blocking=True,
        return_response=True,
    )

    projected = events[ENTITY_ID]["events"]
    assert [e["summary"] for e in projected] == ["Ladder due back", "Extinguisher inspection"]
    # All-day: HA renders `start`/`end` as bare dates, exclusive end.
    assert projected[0]["start"] == due.isoformat()
    assert projected[0]["end"] == (due + timedelta(days=1)).isoformat()


async def test_the_summaries_are_written_in_the_servers_language(
    hass: HomeAssistant, setup_entry
) -> None:
    """Both surfaces the text reaches, in German: the event a calendar card
    lists and the `message` attribute a notification automation templates.

    Only real here — the patterns come from `translations/de.json` through Home
    Assistant's own loader, which the offline suite has no counterpart for.
    """

    hass.config.language = "de"
    await setup_entry()

    today = dt_util.now().date()
    await _create(hass, name="Leiter", checked_out=True, due_date=today.isoformat())
    await _create(
        hass, name="Feuerlöscher", inspection_date=(today + timedelta(days=5)).isoformat()
    )

    assert hass.states.get(ENTITY_ID).attributes["message"] == "Rückgabe: Leiter"

    window_end = dt_util.start_of_local_day() + timedelta(days=30)
    events = await hass.services.async_call(
        "calendar",
        "get_events",
        {"entity_id": ENTITY_ID, "end_date_time": window_end},
        blocking=True,
        return_response=True,
    )
    assert [e["summary"] for e in events[ENTITY_ID]["events"]] == [
        "Rückgabe: Leiter",
        "Prüfung: Feuerlöscher",
    ]


async def test_checking_an_item_out_due_today_turns_the_calendar_on(
    hass: HomeAssistant, setup_entry
) -> None:
    """A mutation repaints the entity with no polling and no time travel.

    `on` means an event is running now, which for an all-day occurrence means
    today's — `test_an_upcoming_date_is_announced_while_the_state_stays_off`
    covers the other half.
    """

    await setup_entry()
    assert hass.states.get(ENTITY_ID).state == "off"

    item = await _create(hass, name="Ladder")
    today = dt_util.now().date()

    await hass.services.async_call(
        DOMAIN,
        "item_check_out",
        {"item_id": item["id"], "due_date": today.isoformat()},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get(ENTITY_ID)
    assert state.state == "on"
    assert state.attributes["message"] == "Ladder due back"
    assert state.attributes["all_day"] is True
    assert state.attributes["start_time"].startswith(today.isoformat())


async def test_an_upcoming_date_is_announced_while_the_state_stays_off(
    hass: HomeAssistant,
    setup_entry,
) -> None:
    """Home Assistant's `on` is "happening now", so a future date announces itself
    through the attributes an automation's template reads."""

    await setup_entry()
    due = dt_util.now().date() + timedelta(days=2)

    item = await _create(hass, name="Ladder")
    await hass.services.async_call(
        DOMAIN,
        "item_check_out",
        {"item_id": item["id"], "due_date": due.isoformat()},
        blocking=True,
    )
    await hass.async_block_till_done()

    state = hass.states.get(ENTITY_ID)
    assert state.state == "off"
    assert state.attributes["message"] == "Ladder due back"
    assert state.attributes["start_time"].startswith(due.isoformat())


async def test_the_reported_event_is_the_nearest_one(hass: HomeAssistant, setup_entry) -> None:
    await setup_entry()
    today = dt_util.now().date()

    await _create(hass, name="Boiler", inspection_date=(today + timedelta(days=90)).isoformat())
    await _create(hass, name="Smoke alarm", inspection_date=(today + timedelta(days=7)).isoformat())

    assert hass.states.get(ENTITY_ID).attributes["message"] == "Smoke alarm inspection"


async def test_a_past_date_is_not_reported_as_upcoming(hass: HomeAssistant, setup_entry) -> None:
    """Overdue is a count, not a calendar state: the day is gone."""

    await setup_entry()
    yesterday = dt_util.now().date() - timedelta(days=1)

    await _create(hass, name="Extinguisher", inspection_date=yesterday.isoformat())

    state = hass.states.get(ENTITY_ID)
    assert state.state == "off"
    # No event at all, rather than a past one that merely is not running: the
    # state alone cannot tell those apart.
    assert "message" not in state.attributes


async def test_unload_removes_the_entity(hass: HomeAssistant, setup_entry) -> None:
    entry = await setup_entry()
    assert hass.states.get(ENTITY_ID) is not None

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    state = hass.states.get(ENTITY_ID)
    assert state is None or state.state == "unavailable"


async def test_a_location_rename_reaches_the_calendar_at_once(
    hass: HomeAssistant, setup_entry
) -> None:
    """The event description is the item's stored path, held in a cached state.

    Nothing invalidated that state on a rename, so `calendar.haventory` kept
    announcing the old path until local midnight or until some item happened to
    be edited — and the README's own automation example templates exactly this
    attribute to say where the item is.
    """

    await setup_entry()
    garage = (
        await hass.services.async_call(
            DOMAIN, "location_create", {"name": "Garage"}, blocking=True, return_response=True
        )
    )["location"]
    await _create(
        hass,
        name="Extinguisher",
        location_id=garage["id"],
        inspection_date=(dt_util.now().date() + timedelta(days=7)).isoformat(),
    )

    assert hass.states.get(ENTITY_ID).attributes["description"] == "Garage"

    await hass.services.async_call(
        DOMAIN,
        "location_update",
        {"location_id": garage["id"], "name": "Workshop"},
        blocking=True,
        return_response=True,
    )
    await hass.async_block_till_done()

    assert hass.states.get(ENTITY_ID).attributes["description"] == "Workshop"
