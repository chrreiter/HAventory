"""Integration: reminders end to end, and the v7 store that boots into v8.

The offline suite covers the projection, the validation and the command
handlers. What only exists here is the round trip through a real `Store` — a
v7 payload migrating on boot and being written back — and the reminders reaching
`calendar.haventory` as events a calendar dashboard would draw.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

CALENDAR = "calendar.haventory"
PLAIN_ITEM_ID = str(uuid.uuid4())
REMINDER_ITEM_ID = str(uuid.uuid4())

_HAMMER_QUANTITY = 2
_EVERY_THREE_MONTHS = 3
_OCCURRENCES_IN_A_YEAR = 4


def _store_without_the_reminder_fields() -> dict:
    """A production-shaped payload from before either reminder field existed."""

    return {
        "schema_version": 7,
        "items": {
            PLAIN_ITEM_ID: {
                "id": PLAIN_ITEM_ID,
                "name": "Hammer",
                "quantity": 2,
                "status": "ok",
                "attachments": [],
            },
            REMINDER_ITEM_ID: {
                "id": REMINDER_ITEM_ID,
                "name": "HVAC filter",
                "quantity": 1,
                "status": "ok",
                "inspection_date": "2027-01-01",
                "attachments": [],
            },
        },
        "locations": {},
        "statuses": {},
    }


async def test_a_store_without_the_reminder_fields_boots_with_them_filled_in(
    hass: HomeAssistant, hass_storage: dict, setup_entry
) -> None:
    """The upgrade an existing install takes, against a real `Store`."""

    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": _store_without_the_reminder_fields(),
    }

    await setup_entry()

    persisted = hass_storage[STORAGE_KEY]["data"]
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION
    for item_id in (PLAIN_ITEM_ID, REMINDER_ITEM_ID):
        assert persisted["items"][item_id]["reminder_date"] is None
        assert persisted["items"][item_id]["reminder_anchor"] is None
        assert persisted["items"][item_id]["reminder_interval"] is None

    # Nothing else moved: the upgrade adds nulls and takes nothing away.
    repo = find_runtime(hass).repository
    assert repo.get_item(PLAIN_ITEM_ID).name == "Hammer"
    assert repo.get_item(PLAIN_ITEM_ID).quantity == _HAMMER_QUANTITY
    assert repo.get_item(REMINDER_ITEM_ID).inspection_date == "2027-01-01"
    assert repo.get_item(REMINDER_ITEM_ID).reminder_date is None


async def test_a_reminder_set_over_websocket_survives_a_reload(
    hass: HomeAssistant, hass_storage: dict, hass_ws_client, setup_entry
) -> None:
    """Stored state, not runtime state: it has to come back off disk."""

    entry = await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "HVAC filter"})
    item_id = (await client.receive_json())["result"]["id"]

    await client.send_json(
        {
            "id": 2,
            "type": "haventory/reminder/set",
            "item_id": item_id,
            "reminder_date": "2027-03-01",
            "reminder_interval": {"unit": "months", "count": 3},
        }
    )
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    reloaded = find_runtime(hass).repository.get_item(item_id)
    assert reloaded.reminder_date == "2027-03-01"
    assert reloaded.reminder_interval.unit == "months"
    assert reloaded.reminder_interval.count == _EVERY_THREE_MONTHS


async def test_a_recurring_reminder_draws_its_next_occurrences_on_the_calendar(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """The story the issue tells, read back through the calendar's own service."""

    await setup_entry()
    client = await hass_ws_client(hass)
    anchor = dt_util.now().date() + timedelta(days=1)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "HVAC filter"})
    item_id = (await client.receive_json())["result"]["id"]
    await client.send_json(
        {
            "id": 2,
            "type": "haventory/reminder/set",
            "item_id": item_id,
            "reminder_date": anchor.isoformat(),
            "reminder_interval": {"unit": "months", "count": 3},
        }
    )
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()

    events = await hass.services.async_call(
        "calendar",
        "get_events",
        {
            "entity_id": CALENDAR,
            "end_date_time": dt_util.start_of_local_day() + timedelta(days=365),
        },
        blocking=True,
        return_response=True,
    )

    projected = [e for e in events[CALENDAR]["events"] if e["summary"] == "HVAC filter reminder"]
    # A year holds four occurrences of a three-month series.
    assert len(projected) == _OCCURRENCES_IN_A_YEAR
    assert projected[0]["start"] == anchor.isoformat()


async def test_bumping_moves_the_series_and_the_calendar_with_it(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    await setup_entry()
    client = await hass_ws_client(hass)
    anchor = dt_util.now().date()

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "HVAC filter"})
    item_id = (await client.receive_json())["result"]["id"]
    await client.send_json(
        {
            "id": 2,
            "type": "haventory/reminder/set",
            "item_id": item_id,
            "reminder_date": anchor.isoformat(),
            "reminder_interval": {"unit": "days", "count": 30},
        }
    )
    assert (await client.receive_json())["success"] is True
    await hass.async_block_till_done()
    # Today's occurrence is running, so the calendar is on.
    assert hass.states.get(CALENDAR).state == "on"

    await client.send_json({"id": 3, "type": "haventory/reminder/bump", "item_id": item_id})
    bumped = await client.receive_json()
    await hass.async_block_till_done()

    assert bumped["success"] is True
    assert bumped["result"]["reminder_date"] == (anchor + timedelta(days=30)).isoformat()
    # Nothing is happening today any more, and the entity repainted with no poll.
    assert hass.states.get(CALENDAR).state == "off"
    assert hass.states.get(CALENDAR).attributes["message"] == "HVAC filter reminder"


async def test_an_interval_with_no_anchor_is_refused_by_the_real_dispatch(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """The offline stub cannot see HA's own schema validation ahead of the handler."""

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "HVAC filter"})
    item_id = (await client.receive_json())["result"]["id"]

    await client.send_json(
        {
            "id": 2,
            "type": "haventory/item/update",
            "item_id": item_id,
            "reminder_interval": {"unit": "months", "count": 3},
        }
    )
    result = await client.receive_json()

    assert result["success"] is False
    assert result["error"]["code"] == "validation_error"


async def test_an_evening_bump_west_of_greenwich_keeps_the_calendar_day(
    hass: HomeAssistant, hass_ws_client, freezer, setup_entry
) -> None:
    """The moment the two day boundaries disagree, pinned.

    18:00 in Los Angeles is 02:00 the next day in UTC. Counting the bump from the
    UTC day therefore skipped the occurrence the household's own calendar was
    showing them for tomorrow — silently, and only for the part of the day the
    two disagree over, which is why neither the offline suite nor the UTC dev
    container could see it.
    """

    await hass.config.async_set_time_zone("America/Los_Angeles")
    await setup_entry()
    # After the client has authenticated: the token the fixture mints is checked
    # against the wall clock, and a frozen one is outside its window.
    client = await hass_ws_client(hass)
    freezer.move_to("2026-08-15T02:00:00+00:00")
    assert dt_util.now().date().isoformat() == "2026-08-14"

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "HVAC filter"})
    item_id = (await client.receive_json())["result"]["id"]
    await client.send_json(
        {
            "id": 2,
            "type": "haventory/reminder/set",
            "item_id": item_id,
            "reminder_date": "2026-08-14",
            "reminder_interval": {"unit": "days", "count": 1},
        }
    )
    assert (await client.receive_json())["success"]

    await client.send_json({"id": 3, "type": "haventory/reminder/bump", "item_id": item_id})
    result = await client.receive_json()

    assert result["success"], result
    assert result["result"]["reminder_date"] == "2026-08-15"


async def test_a_store_without_anchors_gains_one_for_every_reminder_it_holds(
    hass: HomeAssistant, hass_storage: dict, setup_entry
) -> None:
    """The upgrade an install with reminders on it takes, through a real `Store`.

    Before the anchor was stored, `reminder_date` was both the next occurrence
    and the series origin, because a bump wrote one over the other. Nothing can recover how far
    such a series had already drifted, and nothing needs to: from here on it is
    measured from wherever it currently stands.
    """

    data = _store_without_the_reminder_fields()
    data["schema_version"] = 8
    data["items"][REMINDER_ITEM_ID]["reminder_date"] = "2026-09-30"
    data["items"][REMINDER_ITEM_ID]["reminder_interval"] = {"unit": "months", "count": 1}
    data["items"][PLAIN_ITEM_ID]["reminder_date"] = None
    data["items"][PLAIN_ITEM_ID]["reminder_interval"] = None
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": data}

    await setup_entry()

    persisted = hass_storage[STORAGE_KEY]["data"]
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION
    assert persisted["items"][REMINDER_ITEM_ID]["reminder_anchor"] == "2026-09-30"
    assert persisted["items"][PLAIN_ITEM_ID]["reminder_anchor"] is None
    assert find_runtime(hass).repository.get_item(REMINDER_ITEM_ID).reminder_anchor == (
        "2026-09-30"
    )


async def test_a_bumped_month_end_series_keeps_its_day_across_a_reload(
    hass: HomeAssistant, hass_storage: dict, hass_ws_client, setup_entry
) -> None:
    """The whole point of the stored anchor, end to end and through a restart.

    Bumped once in a 30-day month, the series must still be a 31st series — on
    the wire, in the file, and after the entry has been unloaded and set up again
    from what was written.
    """

    entry = await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Meter reading"})
    item_id = (await client.receive_json())["result"]["id"]
    await client.send_json(
        {
            "id": 2,
            "type": "haventory/reminder/set",
            "item_id": item_id,
            "reminder_date": "2026-08-31",
            "reminder_interval": {"unit": "months", "count": 1},
        }
    )
    assert (await client.receive_json())["success"]

    await client.send_json({"id": 3, "type": "haventory/reminder/bump", "item_id": item_id})
    bumped = (await client.receive_json())["result"]
    assert (bumped["reminder_date"], bumped["reminder_anchor"]) == ("2026-09-30", "2026-08-31")

    await hass.async_block_till_done()
    stored = hass_storage[STORAGE_KEY]["data"]["items"][item_id]
    assert (stored["reminder_date"], stored["reminder_anchor"]) == ("2026-09-30", "2026-08-31")

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    reloaded = find_runtime(hass).repository.get_item(item_id)
    assert reloaded.reminder_anchor == "2026-08-31"
    # And the calendar draws the series the anchor describes, not the bump's date.
    events = await hass.services.async_call(
        "calendar",
        "get_events",
        {
            "entity_id": CALENDAR,
            "start_date_time": "2026-10-01 00:00:00",
            "end_date_time": "2026-11-01 00:00:00",
        },
        blocking=True,
        return_response=True,
    )
    assert [e["start"] for e in events[CALENDAR]["events"]] == ["2026-10-31"]
