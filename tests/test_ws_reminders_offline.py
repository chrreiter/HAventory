"""Offline tests for the `haventory/reminder/*` commands.

A bump moves the series by whole intervals measured from its anchor, so a
series stays on its own day however far past the anchor the bump happens.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from runtime_helpers import repo_of, ws_hass
from ws_helpers import ws_send

MONTHLY = {"unit": "months", "count": 3}
_AFTER_ONE_EDIT = 2
#: An arbitrary new quantity, standing in for any edit that is not the reminder.
_EDITED_QUANTITY = 4


async def _item(hass: HomeAssistant, name: str = "HVAC filter") -> str:
    created = await ws_send(hass, 1, "haventory/item/create", name=name)
    return str(created["result"]["id"])


def _today() -> date:
    """The day a bump counts from, read off the clock the bump itself reads."""

    return dt_util.now().date()


def _freeze(monkeypatch, today: date) -> None:
    """Pin the household's day, which is what a bump counts from."""

    frozen = datetime(today.year, today.month, today.day, tzinfo=UTC)
    monkeypatch.setattr(dt_util, "now", lambda *_a, **_k: frozen)


@pytest.mark.asyncio
async def test_set_stores_the_anchor_and_the_interval() -> None:
    hass = ws_hass()
    item_id = await _item(hass)

    res = await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-09-01",
        reminder_interval=MONTHLY,
    )

    assert res["success"] is True
    assert res["result"]["reminder_date"] == "2026-09-01"
    assert res["result"]["reminder_interval"] == MONTHLY
    # A reminder is something the household chose, so it is an ordinary edit:
    # the create left the item at version 1, and this bumped it.
    assert res["result"]["version"] == _AFTER_ONE_EDIT


@pytest.mark.asyncio
async def test_set_without_an_interval_is_a_one_off() -> None:
    """An omitted interval means no recurrence, not "keep the stored one"."""

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-09-01",
        reminder_interval=MONTHLY,
    )

    res = await ws_send(
        hass, 3, "haventory/reminder/set", item_id=item_id, reminder_date="2026-10-01"
    )

    assert res["result"]["reminder_date"] == "2026-10-01"
    assert res["result"]["reminder_interval"] is None


@pytest.mark.asyncio
async def test_clear_removes_both_halves() -> None:
    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-09-01",
        reminder_interval=MONTHLY,
    )

    res = await ws_send(hass, 3, "haventory/reminder/clear", item_id=item_id)

    assert res["success"] is True
    assert res["result"]["reminder_date"] is None
    assert res["result"]["reminder_interval"] is None


@pytest.mark.asyncio
async def test_clear_on_an_item_with_no_reminder_succeeds() -> None:
    """Clearing is idempotent: the end state is what the caller asked for."""

    hass = ws_hass()
    item_id = await _item(hass)

    res = await ws_send(hass, 2, "haventory/reminder/clear", item_id=item_id)

    assert res["success"] is True
    assert res["result"]["reminder_date"] is None


@pytest.mark.asyncio
async def test_bump_moves_a_due_reminder_on_by_one_interval() -> None:
    """The filter was changed today: the whole series moves with the anchor."""

    hass = ws_hass()
    item_id = await _item(hass)
    anchor = _today()
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date=anchor.isoformat(),
        reminder_interval={"unit": "days", "count": 30},
    )

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is True
    assert res["result"]["reminder_date"] == (anchor + timedelta(days=30)).isoformat()
    assert res["result"]["reminder_interval"] == {"unit": "days", "count": 30}


@pytest.mark.asyncio
async def test_bump_from_a_long_past_anchor_lands_in_the_future() -> None:
    """A reminder nobody bumped for years does not advance to another past date."""

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2020-01-01",
        reminder_interval={"unit": "days", "count": 7},
    )

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    assert date.fromisoformat(res["result"]["reminder_date"]) > _today()


@pytest.mark.asyncio
async def test_bump_refuses_an_item_with_no_reminder() -> None:
    hass = ws_hass()
    item_id = await _item(hass)

    res = await ws_send(hass, 2, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_bump_refuses_a_one_off() -> None:
    """There is no next occurrence to move to, and guessing one would invent a series."""

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(hass, 2, "haventory/reminder/set", item_id=item_id, reminder_date="2026-09-01")

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_an_interval_with_no_anchor_is_refused() -> None:
    """Through `item/update`, the one path that can name the interval alone."""

    hass = ws_hass()
    item_id = await _item(hass)

    res = await ws_send(
        hass, 2, "haventory/item/update", item_id=item_id, reminder_interval=MONTHLY
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_clearing_the_anchor_of_a_recurring_reminder_is_refused() -> None:
    """The stored interval is what the update is validated against."""

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-09-01",
        reminder_interval=MONTHLY,
    )

    res = await ws_send(hass, 3, "haventory/item/update", item_id=item_id, reminder_date=None)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.parametrize(
    "interval",
    [
        {"unit": "months", "count": 0},
        {"unit": "months", "count": -1},
        {"unit": "fortnights", "count": 1},
        {"unit": "days", "count": True},
        {"count": 3},
    ],
    ids=["zero", "negative", "unknown-unit", "bool-count", "no-unit"],
)
@pytest.mark.asyncio
async def test_an_unusable_interval_is_refused(interval: dict) -> None:
    hass = ws_hass()
    item_id = await _item(hass)

    res = await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-09-01",
        reminder_interval=interval,
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_a_stale_expected_version_is_a_conflict() -> None:
    """Reminders take part in the same optimistic concurrency as every edit."""

    hass = ws_hass()
    item_id = await _item(hass)

    res = await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-09-01",
        expected_version=99,
    )

    assert res["success"] is False
    assert res["error"]["code"] == "conflict"


@pytest.mark.asyncio
async def test_bump_names_a_stored_anchor_it_cannot_read() -> None:
    """A hand-edited store is the only way in, and `unknown_error` says nothing.

    No write path and no import can store one, so the answer's job is to point
    at the field and at the way out rather than to report a crash.
    """

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-09-01",
        reminder_interval=MONTHLY,
    )
    repo = repo_of(hass)
    repo.get_item(item_id).reminder_date = "next week"

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "reminder date" in res["error"]["message"]


@pytest.mark.asyncio
async def test_a_bump_counts_from_the_household_day_not_the_utc_one(monkeypatch) -> None:
    """West of Greenwich an evening bump is already tomorrow in UTC.

    The calendar rolls over at local midnight and a reminder is a household-facing
    date, so counting from the UTC day skipped the occurrence the household's own
    calendar was showing for tomorrow — silently, and only for the part of the day
    the two disagree over. Neither the offline suite nor the dev container runs
    anywhere but UTC, so the zone has to be pinned here.
    """

    hass = ws_hass()
    item_id = await _item(hass)
    # 18:00 on the 14th in Los Angeles is 02:00 on the 15th in UTC.
    evening_local = datetime(2026, 8, 14, 18, 0, tzinfo=timezone(timedelta(hours=-8)))
    monkeypatch.setattr(dt_util, "DEFAULT_TIME_ZONE", evening_local.tzinfo)
    monkeypatch.setattr(dt_util, "now", lambda *_a, **_k: evening_local)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-08-14",
        reminder_interval={"unit": "days", "count": 1},
    )

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is True, res
    # The 15th — the occurrence the calendar is showing for tomorrow — not the 16th.
    assert res["result"]["reminder_date"] == "2026-08-15"


@pytest.mark.asyncio
async def test_a_month_end_series_still_lands_on_the_31st_after_a_bump(monkeypatch) -> None:
    """A bump leaves the anchor where it is, so the series keeps its own day.

    Month steps are measured from the anchor, so a series on the 31st returns to
    the 31st in every month that has one. Writing the occurrence back as the new
    anchor would re-anchor the series on the 30th after one pass through a
    30-day month, and on the 28th after February — permanently.
    """

    hass = ws_hass()
    item_id = await _item(hass)
    _freeze(monkeypatch, date(2026, 8, 15))
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-08-31",
        reminder_interval={"unit": "months", "count": 1},
    )

    first = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)
    assert first["result"]["reminder_date"] == "2026-09-30"
    # The anchor did not move with it — that is what the next bump counts from.
    assert first["result"]["reminder_anchor"] == "2026-08-31"

    _freeze(monkeypatch, date(2026, 9, 30))
    second = await ws_send(hass, 4, "haventory/reminder/bump", item_id=item_id)
    assert second["result"]["reminder_date"] == "2026-10-31"
    assert second["result"]["reminder_anchor"] == "2026-08-31"


@pytest.mark.asyncio
async def test_a_bump_through_february_skips_no_occurrence(monkeypatch) -> None:
    """The worst case in the issue, and the one the rejected fix would have skipped.

    A 1/31 series bumped in February lands on 2/28 — the occurrence February
    actually has — and the one after it is 3/31, not 3/28. Advancing straight to
    3/31 would have kept the day at the price of the household never being
    reminded in February.
    """

    hass = ws_hass()
    item_id = await _item(hass)
    _freeze(monkeypatch, date(2027, 1, 20))
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2027-01-31",
        reminder_interval={"unit": "months", "count": 1},
    )

    _freeze(monkeypatch, date(2027, 2, 10))
    first = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)
    assert first["result"]["reminder_date"] == "2027-02-28"

    _freeze(monkeypatch, date(2027, 2, 28))
    second = await ws_send(hass, 4, "haventory/reminder/bump", item_id=item_id)
    assert second["result"]["reminder_date"] == "2027-03-31"


@pytest.mark.asyncio
async def test_setting_a_date_re_anchors_the_series_on_it() -> None:
    """A household picking a date is saying where the series starts."""

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-08-31",
        reminder_interval={"unit": "months", "count": 1},
    )
    await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    reset = await ws_send(
        hass,
        4,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-12-01",
        reminder_interval={"unit": "months", "count": 1},
    )

    assert reset["result"]["reminder_date"] == "2026-12-01"
    assert reset["result"]["reminder_anchor"] == "2026-12-01"


@pytest.mark.asyncio
async def test_clearing_a_reminder_takes_the_anchor_with_it() -> None:
    """An anchor with no date names a series with no next occurrence."""

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-08-31",
        reminder_interval={"unit": "months", "count": 1},
    )

    cleared = await ws_send(hass, 3, "haventory/reminder/clear", item_id=item_id)

    assert cleared["result"]["reminder_date"] is None
    assert cleared["result"]["reminder_anchor"] is None


@pytest.mark.asyncio
async def test_a_bump_answers_conflict_on_a_stale_version() -> None:
    """It is an ordinary item edit, so it takes the same concurrency check."""

    hass = ws_hass()
    item_id = await _item(hass)
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date=_today().isoformat(),
        reminder_interval={"unit": "days", "count": 7},
    )

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id, expected_version=1)

    assert res["success"] is False
    assert res["error"]["code"] == "conflict"


@pytest.mark.asyncio
async def test_an_edit_that_resends_the_same_date_leaves_the_anchor_alone(monkeypatch) -> None:
    """The whole walk: a series on the 31st survives edits landing between bumps.

    A client may send `reminder_date` unchanged — a service call built from a
    template, a script handing an item back, a WebSocket client that posts every
    field it holds — so a write that meant to change the quantity can still carry
    whatever the last bump left. Re-anchoring on presence of the key would move
    the anchor to that occurrence, and the day of the month would decay one short
    month at a time with nothing on screen showing it.
    """

    hass = ws_hass()
    item_id = await _item(hass)
    _freeze(monkeypatch, date(2026, 1, 15))
    created = await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-01-31",
        reminder_interval={"unit": "months", "count": 1},
    )
    assert created["result"]["reminder_anchor"] == "2026-01-31"

    _freeze(monkeypatch, date(2026, 8, 15))
    bumped = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)
    assert bumped["result"]["reminder_date"] == "2026-08-31"
    assert bumped["result"]["reminder_anchor"] == "2026-01-31"

    edited = await ws_send(
        hass,
        4,
        "haventory/item/update",
        item_id=item_id,
        expected_version=bumped["result"]["version"],
        quantity=_EDITED_QUANTITY,
        reminder_date="2026-08-31",
    )
    assert edited["success"] is True, edited
    assert edited["result"]["quantity"] == _EDITED_QUANTITY
    assert edited["result"]["reminder_anchor"] == "2026-01-31"

    _freeze(monkeypatch, date(2026, 8, 31))
    again = await ws_send(hass, 5, "haventory/reminder/bump", item_id=item_id)
    # September has no 31st; counted from the anchor the one after it does.
    assert again["result"]["reminder_date"] == "2026-09-30"
    assert again["result"]["reminder_anchor"] == "2026-01-31"

    _freeze(monkeypatch, date(2026, 9, 30))
    final = await ws_send(hass, 6, "haventory/reminder/bump", item_id=item_id)
    assert final["result"]["reminder_date"] == "2026-10-31"


@pytest.mark.asyncio
async def test_the_cards_whole_save_payload_leaves_the_anchor_alone(monkeypatch) -> None:
    """Pin the payload shape, not a minimal stand-in.

    `commonFields` in `cards/haventory-card/src/ui/item-form.ts` builds this set
    of keys for every save, and `toUpdatePayload` spreads it beside the custom
    fields. A minimal update carrying only the reminder date would keep passing
    if the builder started sending something else that re-anchors, so the test
    sends what the editor sends.
    """

    hass = ws_hass()
    item_id = await _item(hass)
    _freeze(monkeypatch, date(2026, 1, 15))
    await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-01-31",
        reminder_interval={"unit": "months", "count": 1},
    )
    _freeze(monkeypatch, date(2026, 8, 15))
    bumped = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)
    assert bumped["result"]["reminder_anchor"] == "2026-01-31"

    saved = await ws_send(
        hass,
        4,
        "haventory/item/update",
        item_id=item_id,
        expected_version=bumped["result"]["version"],
        name="HVAC filter",
        description=None,
        quantity=2,
        status="ok",
        low_stock_threshold=None,
        category=None,
        tags=[],
        location_id=None,
        checked_out=False,
        due_date=None,
        inspection_date=None,
        reminder_date=bumped["result"]["reminder_date"],
        reminder_interval={"unit": "months", "count": 1},
        custom_fields_set={},
    )

    assert saved["success"] is True, saved
    assert saved["result"]["reminder_date"] == "2026-08-31"
    assert saved["result"]["reminder_anchor"] == "2026-01-31"


@pytest.mark.asyncio
async def test_an_edit_that_moves_the_date_still_re_anchors() -> None:
    """Picking a new date is still saying where the series starts."""

    hass = ws_hass()
    item_id = await _item(hass)
    created = await ws_send(
        hass,
        2,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date="2026-01-31",
        reminder_interval=MONTHLY,
    )

    moved = await ws_send(
        hass,
        3,
        "haventory/item/update",
        item_id=item_id,
        expected_version=created["result"]["version"],
        reminder_date="2026-03-15",
    )

    assert moved["result"]["reminder_date"] == "2026-03-15"
    assert moved["result"]["reminder_anchor"] == "2026-03-15"


async def _item_with_reminder(hass: HomeAssistant, name: str, date_str: str, msg_id: int) -> str:
    item_id = await _item(hass, name)
    await ws_send(
        hass,
        msg_id,
        "haventory/reminder/set",
        item_id=item_id,
        reminder_date=date_str,
        reminder_interval={"unit": "months", "count": 1},
    )
    return item_id


@pytest.mark.asyncio
async def test_items_sort_by_reminder_date() -> None:
    """Soonest first ascending, and an item with no reminder sorts last."""

    hass = ws_hass()
    late = await _item_with_reminder(hass, "Water filter", "2027-03-01", 10)
    soon = await _item_with_reminder(hass, "Smoke detector", "2026-09-01", 20)
    none = await _item(hass, "Hammer")

    res = await ws_send(
        hass, 30, "haventory/item/list", sort={"field": "reminder_date", "order": "asc"}
    )

    assert res["success"] is True, res
    assert [i["id"] for i in res["result"]["items"]] == [soon, late, none]


@pytest.mark.asyncio
async def test_reminder_due_only_takes_today_and_leaves_the_future() -> None:
    """Today counts: a reminder names the day it is asking about."""

    hass = ws_hass()
    today = _today().isoformat()
    past = await _item_with_reminder(hass, "Gutters", "2020-01-01", 10)
    now = await _item_with_reminder(hass, "Smoke detector", today, 20)
    await _item_with_reminder(hass, "Water filter", "2099-01-01", 30)
    await _item(hass, "Hammer")

    res = await ws_send(hass, 40, "haventory/item/list", filter={"reminder_due_only": True})

    assert res["success"] is True, res
    assert sorted(i["id"] for i in res["result"]["items"]) == sorted([past, now])


@pytest.mark.asyncio
async def test_stats_counts_the_reminders_that_have_come_round() -> None:
    """The count behind the quick-filter pill, on the same inclusive rule."""

    hass = ws_hass()
    await _item_with_reminder(hass, "Gutters", "2020-01-01", 10)
    await _item_with_reminder(hass, "Smoke detector", _today().isoformat(), 20)
    await _item_with_reminder(hass, "Water filter", "2099-01-01", 30)

    res = await ws_send(hass, 40, "haventory/stats")

    assert res["result"]["reminder_due_count"] == _AFTER_ONE_EDIT


@pytest.mark.asyncio
async def test_an_unknown_reminder_sort_field_is_still_refused() -> None:
    """The new key is additive; it does not open the vocabulary up."""

    hass = ws_hass()
    await _item(hass)

    res = await ws_send(
        hass, 10, "haventory/item/list", sort={"field": "reminder_anchor", "order": "asc"}
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
