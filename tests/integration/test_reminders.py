"""Integration: the reminder commands end to end, on a real core.

What is stored when a reminder is set, changed, cleared or refused, what a bump
moves and what it leaves alone, and what `calendar.haventory` draws from it,
including across a reload through a real `Store`.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from custom_components.haventory.repository import Repository
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
_AFTER_ONE_EDIT = 2
_EDITED_QUANTITY = 4

MONTHLY = {"unit": "months", "count": 1}

# One case per refusal: an optional setup frame, the frame under test, the code.
REFUSALS = [
    pytest.param(None, ("reminder/bump", {}), "validation_error", id="bump_no_reminder"),
    pytest.param(
        ("reminder/set", {"reminder_date": "2026-09-01"}),
        ("reminder/bump", {}),
        "validation_error",
        id="bump_one_off",
    ),
    # The stored interval is what the update is validated against.
    pytest.param(
        ("reminder/set", {"reminder_date": "2026-09-01", "reminder_interval": MONTHLY}),
        ("item/update", {"reminder_date": None}),
        "validation_error",
        id="clear_anchor_of_recurring",
    ),
    pytest.param(
        None,
        (
            "reminder/set",
            {
                "reminder_date": "2026-09-01",
                "reminder_interval": {"unit": "fortnights", "count": 1},
            },
        ),
        "validation_error",
        id="unknown_unit",
    ),
    pytest.param(
        None,
        ("reminder/set", {"reminder_date": "2026-09-01", "expected_version": 99}),
        "conflict",
        id="set_stale_version",
    ),
    pytest.param(
        ("reminder/set", {"reminder_date": "2026-09-01", "reminder_interval": MONTHLY}),
        ("reminder/bump", {"expected_version": 1}),
        "conflict",
        id="bump_stale_version",
    ),
]


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


async def test_a_bumped_month_end_series_keeps_its_day_across_a_reload(
    hass: HomeAssistant, hass_storage: dict, hass_ws_client, freezer, setup_entry
) -> None:
    """The whole point of the stored anchor, end to end and through a restart.

    Bumped once in a 30-day month, the series must still be a 31st series — on
    the wire, in the file, and after the entry has been unloaded and set up again
    from what was written.
    """

    entry = await setup_entry()
    client = await hass_ws_client(hass)
    # The bump counts from the later of the occurrence and today.
    freezer.move_to("2026-08-31T12:00:00+00:00")

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


async def _create(ws, name: str = "HVAC filter") -> str:
    res = await ws.send("haventory/item/create", name=name)
    return str(res["result"]["id"])


async def test_set_and_clear_walk_a_reminder_through_its_lifecycle(setup_entry, ws_connect) -> None:
    await setup_entry()
    ws = await ws_connect()
    item_id = await _create(ws)

    bare = await ws.send("haventory/reminder/clear", item_id=await _create(ws, "Hammer"))
    assert bare["success"] is True
    assert bare["result"]["reminder_date"] is None

    first = (
        await ws.send(
            "haventory/reminder/set",
            item_id=item_id,
            reminder_date="2026-08-31",
            reminder_interval=MONTHLY,
        )
    )["result"]
    assert first["reminder_date"] == first["reminder_anchor"] == "2026-08-31"
    assert first["reminder_interval"] == MONTHLY
    # A reminder is an ordinary edit, so it bumps the version.
    assert first["version"] == _AFTER_ONE_EDIT

    # An omitted interval means a one-off, not "keep the stored one".
    one_off = (
        await ws.send("haventory/reminder/set", item_id=item_id, reminder_date="2026-12-01")
    )["result"]
    assert one_off["reminder_interval"] is None
    assert one_off["reminder_anchor"] == "2026-12-01"

    gone = (await ws.send("haventory/reminder/clear", item_id=item_id))["result"]
    assert (gone["reminder_date"], gone["reminder_interval"], gone["reminder_anchor"]) == (
        None,
        None,
        None,
    )


@pytest.mark.parametrize(("setup", "frame", "code"), REFUSALS)
async def test_a_refused_reminder_command_answers_its_code(
    setup_entry, ws_connect, setup: Any, frame: Any, code: str
) -> None:
    await setup_entry()
    ws = await ws_connect()
    item_id = await _create(ws)
    if setup is not None:
        assert (await ws.send(f"haventory/{setup[0]}", item_id=item_id, **setup[1]))["success"]

    res = await ws.send(f"haventory/{frame[0]}", item_id=item_id, **frame[1])

    assert res["success"] is False
    assert res["error"]["code"] == code


async def test_bump_names_a_stored_anchor_it_cannot_read(setup_entry, ws_connect) -> None:
    """No write can store one, so the answer points at the field, not at a crash."""

    repo = Repository()
    item = repo.create_item(
        {"name": "HVAC filter", "reminder_date": "2026-09-01", "reminder_interval": MONTHLY}
    )
    stored = {**repo.export_state(), "schema_version": CURRENT_SCHEMA_VERSION}
    stored["items"][str(item.id)]["reminder_date"] = "next week"
    await setup_entry(stored=stored)
    ws = await ws_connect()

    res = await ws.send("haventory/reminder/bump", item_id=str(item.id))

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "reminder date" in res["error"]["message"]


async def test_a_month_end_series_keeps_its_day_through_bumps_and_edits(
    setup_entry, ws_connect, freezer
) -> None:
    """A client may resend the date it holds, and re-anchoring on the key's presence would
    decay a month-end series one short month at a time."""

    await setup_entry()
    ws = await ws_connect()
    freezer.move_to("2026-01-15T12:00:00+00:00")
    item_id = await _create(ws)
    await ws.send(
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-01-31",
        reminder_interval=MONTHLY,
    )

    freezer.move_to("2026-08-15T12:00:00+00:00")
    bumped = (await ws.send("haventory/reminder/bump", item_id=item_id))["result"]
    assert (bumped["reminder_date"], bumped["reminder_anchor"]) == ("2026-08-31", "2026-01-31")

    # The card's whole save payload, carrying the date the bump left.
    saved = await ws.send(
        "haventory/item/update",
        item_id=item_id,
        expected_version=bumped["version"],
        name="HVAC filter",
        description=None,
        quantity=_EDITED_QUANTITY,
        status="ok",
        low_stock_threshold=None,
        category=None,
        tags=[],
        location_id=None,
        checked_out=False,
        due_date=None,
        inspection_date=None,
        reminder_date=bumped["reminder_date"],
        reminder_interval=MONTHLY,
        custom_fields_set={},
    )
    assert saved["success"] is True, saved
    assert saved["result"]["quantity"] == _EDITED_QUANTITY
    assert saved["result"]["reminder_anchor"] == "2026-01-31"

    for today, landing in (("2026-08-31", "2026-09-30"), ("2026-09-30", "2026-10-31")):
        freezer.move_to(f"{today}T12:00:00+00:00")
        step = (await ws.send("haventory/reminder/bump", item_id=item_id))["result"]
        assert (step["reminder_date"], step["reminder_anchor"]) == (landing, "2026-01-31")

    moved = await ws.send(
        "haventory/item/update",
        item_id=item_id,
        expected_version=step["version"],
        reminder_date="2026-03-15",
    )
    assert moved["result"]["reminder_anchor"] == "2026-03-15"


async def test_items_sort_by_reminder_date(setup_entry, ws_connect) -> None:
    """Soonest first ascending, and an item with no reminder sorts last."""

    await setup_entry()
    ws = await ws_connect()
    late = await _create(ws, "Water filter")
    soon = await _create(ws, "Smoke detector")
    none = await _create(ws, "Hammer")
    for item_id, day in ((late, "2027-03-01"), (soon, "2026-09-01")):
        await ws.send(
            "haventory/reminder/set",
            item_id=item_id,
            reminder_date=day,
            reminder_interval=MONTHLY,
        )

    res = await ws.send("haventory/item/list", sort={"field": "reminder_date", "order": "asc"})

    assert [i["id"] for i in res["result"]["items"]] == [soon, late, none]
