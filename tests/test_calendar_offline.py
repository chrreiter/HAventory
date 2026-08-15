"""Offline tests for the calendar projection.

`calendar.py` itself is not imported here: it is a wrapper over these functions
and everything it adds — the entity platform, the device registry, the midnight
rewrite — belongs to the phacc suite (`tests/integration/test_calendar.py`).
What is checkable offline is the projection, which touches no Home Assistant
type at all.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from custom_components.haventory.calendar_projection import (
    KIND_DUE,
    KIND_INSPECTION,
    KIND_REMINDER,
    MAX_REMINDER_OCCURRENCES,
    build_events,
    next_event,
    next_occurrence_after,
    window_dates,
)
from custom_components.haventory.models import Item, LocationPath, ReminderInterval

WINDOW_START = date(2026, 8, 1)
WINDOW_END = date(2026, 9, 1)


def _item(
    name: str,
    *,
    due: str | None = None,
    inspection: str | None = None,
    path: str = "Garage / Shelf A",
) -> Item:
    return Item(
        id=uuid.uuid4(),
        name=name,
        checked_out=due is not None,
        due_date=due,
        inspection_date=inspection,
        location_path=LocationPath(
            id_path=[], name_path=path.split(" / ") if path else [], display_path=path, sort_key=""
        ),
    )


def test_one_due_and_one_inspection_yield_two_all_day_events() -> None:
    """The happy path: both dated fields project, each as a one-day event."""

    ladder = _item("Ladder", due="2026-08-10")
    extinguisher = _item("Extinguisher", inspection="2026-08-20", path="Hall")

    events = build_events([ladder, extinguisher], WINDOW_START, WINDOW_END)

    assert [e.summary for e in events] == ["Ladder due back", "Extinguisher inspection"]
    assert [e.uid for e in events] == [f"{ladder.id}:{KIND_DUE}", f"{extinguisher.id}:inspection"]
    assert [e.description for e in events] == ["Garage / Shelf A", "Hall"]
    # All-day, in Home Assistant's exclusive-end convention.
    for event in events:
        assert event.end == event.start + timedelta(days=1)
    assert events[0].start == date(2026, 8, 10)


def test_a_window_that_excludes_both_dates_yields_nothing() -> None:
    events = build_events(
        [_item("Ladder", due="2026-08-10"), _item("Extinguisher", inspection="2026-08-20")],
        date(2026, 10, 1),
        date(2026, 11, 1),
    )

    assert events == []


def test_the_window_includes_its_start_and_excludes_its_end() -> None:
    """Half-open, so two adjoining windows never report the same day twice."""

    on_start = _item("On start", inspection=WINDOW_START.isoformat())
    on_end = _item("On end", inspection=WINDOW_END.isoformat())
    before = _item("Before", inspection="2026-07-31")

    events = build_events([on_start, on_end, before], WINDOW_START, WINDOW_END)

    assert [e.summary for e in events] == ["On start inspection"]


def test_an_item_with_both_dates_yields_two_distinct_events() -> None:
    """One item, two occurrences — and neither uid collides with the other."""

    both = _item("Ladder", due="2026-08-10", inspection="2026-08-12")

    events = build_events([both], WINDOW_START, WINDOW_END)

    assert {e.uid for e in events} == {f"{both.id}:{KIND_DUE}", f"{both.id}:{KIND_INSPECTION}"}
    assert {e.item_id for e in events} == {str(both.id)}


def test_an_item_with_neither_date_contributes_nothing() -> None:
    assert build_events([_item("Hammer")], WINDOW_START, WINDOW_END) == []


def test_an_item_with_no_location_still_projects() -> None:
    """A location is not what makes a date real — the description is just empty."""

    events = build_events([_item("Ladder", due="2026-08-10", path="")], WINDOW_START, WINDOW_END)

    assert [e.description for e in events] == [""]


def test_events_are_ordered_by_day_then_totally() -> None:
    """Two items sharing a name and a day still come back in a stable order."""

    later = _item("Ladder", inspection="2026-08-20")
    twin_a = _item("Ladder", inspection="2026-08-10")
    twin_b = _item("Ladder", inspection="2026-08-10")

    events = build_events([later, twin_a, twin_b], WINDOW_START, WINDOW_END)

    assert [e.start for e in events] == [date(2026, 8, 10), date(2026, 8, 10), date(2026, 8, 20)]
    assert [e.uid for e in events[:2]] == sorted(
        [f"{twin_a.id}:inspection", f"{twin_b.id}:inspection"]
    )


def test_next_event_reports_today_and_ignores_the_past() -> None:
    """An all-day occurrence covers its whole day, so today's is current."""

    today = date(2026, 8, 14)
    items = [
        _item("Yesterday", inspection="2026-08-13"),
        _item("Today", inspection=today.isoformat()),
        _item("Tomorrow", inspection="2026-08-15"),
    ]

    assert next_event(items, today).summary == "Today inspection"


def test_next_event_reaches_past_any_fixed_horizon() -> None:
    """A date years out is still the next thing that happens."""

    assert next_event([_item("Boiler", inspection="2031-03-01")], date(2026, 8, 14)) is not None


def test_next_event_is_none_when_nothing_is_dated() -> None:
    assert next_event([_item("Hammer")], date(2026, 8, 14)) is None


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        # A calendar view asks midnight to midnight: the days are exactly those.
        (
            datetime(2026, 8, 1, tzinfo=UTC),
            datetime(2026, 9, 1, tzinfo=UTC),
            (date(2026, 8, 1), date(2026, 9, 1)),
        ),
        # "The next four hours" from midday overlaps today's all-day events, so
        # the exclusive end has to round up past the time component.
        (
            datetime(2026, 8, 14, 12, 0, tzinfo=UTC),
            datetime(2026, 8, 14, 16, 0, tzinfo=UTC),
            (date(2026, 8, 14), date(2026, 8, 15)),
        ),
        # The offset the caller hands over is the one the days are read in.
        (
            datetime(2026, 8, 1, 0, 0, tzinfo=timezone(timedelta(hours=13))),
            datetime(2026, 8, 2, 0, 0, tzinfo=timezone(timedelta(hours=13))),
            (date(2026, 8, 1), date(2026, 8, 2)),
        ),
    ],
    ids=["midnight-to-midnight", "part-of-a-day", "far-east-offset"],
)
def test_window_dates_covers_every_day_the_range_touches(
    start: datetime, end: datetime, expected: tuple[date, date]
) -> None:
    assert window_dates(start, end) == expected


def test_a_part_day_window_finds_the_all_day_event_it_overlaps() -> None:
    """The reason `window_dates` rounds up, stated as the behaviour it buys."""

    start, end = window_dates(
        datetime(2026, 8, 14, 12, 0, tzinfo=UTC), datetime(2026, 8, 14, 16, 0, tzinfo=UTC)
    )

    events = build_events([_item("Ladder", due="2026-08-14")], start, end)

    assert [e.summary for e in events] == ["Ladder due back"]


# ---------------------------------------------------------------------------
# Recurring reminders — the anchor plus its interval, expanded on read
# ---------------------------------------------------------------------------


def _reminder(name: str, *, anchor: str, unit: str | None = None, count: int = 1) -> Item:
    item = _item(name)
    item.reminder_date = anchor
    item.reminder_interval = ReminderInterval(unit=unit, count=count) if unit else None
    return item


def test_a_reminder_with_no_interval_is_a_single_occurrence() -> None:
    events = build_events([_reminder("HVAC filter", anchor="2026-08-10")], WINDOW_START, WINDOW_END)

    assert [(e.summary, e.start) for e in events] == [("HVAC filter reminder", date(2026, 8, 10))]
    assert events[0].kind == KIND_REMINDER


def test_a_monthly_reminder_shows_every_occurrence_the_window_covers() -> None:
    """ "Every 3 months" over a year — the story the issue tells."""

    filter_change = _reminder("HVAC filter", anchor="2026-03-01", unit="months", count=3)

    events = build_events([filter_change], date(2026, 1, 1), date(2027, 1, 1))

    assert [e.start for e in events] == [
        date(2026, 3, 1),
        date(2026, 6, 1),
        date(2026, 9, 1),
        date(2026, 12, 1),
    ]


def test_occurrences_before_the_window_are_not_drawn() -> None:
    """The anchor may be years back; only what the window covers is projected.

    Six months from 15 January lands on 15 January and 15 July, so the month
    either side of one holds nothing at all.
    """

    smoke_alarm = _reminder("Smoke alarm", anchor="2020-01-15", unit="months", count=6)

    assert [e.start for e in build_events([smoke_alarm], date(2026, 7, 1), date(2026, 8, 1))] == [
        date(2026, 7, 15)
    ]
    assert build_events([smoke_alarm], date(2026, 8, 1), date(2026, 9, 1)) == []


def test_a_series_anchored_on_the_31st_returns_to_the_31st() -> None:
    """Clamping is measured from the anchor, so February does not capture it."""

    events = build_events(
        [_reminder("Meter reading", anchor="2026-01-31", unit="months", count=1)],
        date(2026, 1, 1),
        date(2026, 6, 1),
    )

    assert [e.start for e in events] == [
        date(2026, 1, 31),
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
        date(2026, 5, 31),
    ]


def test_every_occurrence_of_a_series_gets_its_own_uid() -> None:
    """Two occurrences sharing a uid would be one event to any client reading them."""

    events = build_events(
        [_reminder("Water filter", anchor="2026-08-01", unit="weeks", count=1)],
        WINDOW_START,
        WINDOW_END,
    )

    assert len({e.uid for e in events}) == len(events)
    assert all(e.uid.endswith(e.start.isoformat()) for e in events)


def test_a_daily_reminder_is_capped_rather_than_expanded_without_bound() -> None:
    """A window nothing could draw gets a bounded answer, not an unbounded list."""

    events = build_events(
        [_reminder("Watering", anchor="2026-01-01", unit="days", count=1)],
        date(2026, 1, 1),
        date(2036, 1, 1),
    )

    assert len(events) == MAX_REMINDER_OCCURRENCES


def test_next_event_over_a_recurring_reminder_returns_the_nearest_occurrence() -> None:
    """Unbounded ahead, but a series still costs one occurrence, not a horizon's worth."""

    reminder = _reminder("Boiler service", anchor="2020-02-01", unit="months", count=12)

    assert next_event([reminder], date(2026, 8, 14)).start == date(2027, 2, 1)


def test_a_reminder_and_an_inspection_on_one_item_are_separate_events() -> None:
    item = _reminder("Extinguisher", anchor="2026-08-10", unit="months", count=6)
    item.inspection_date = "2026-08-12"

    events = build_events([item], WINDOW_START, WINDOW_END)

    assert [(e.kind, e.start) for e in events] == [
        (KIND_REMINDER, date(2026, 8, 10)),
        (KIND_INSPECTION, date(2026, 8, 12)),
    ]


@pytest.mark.parametrize(
    ("anchor", "unit", "count", "after", "expected"),
    [
        # Bumped on the day it came round: exactly one interval on.
        ("2026-08-14", "months", 3, date(2026, 8, 14), date(2026, 11, 14)),
        ("2026-08-14", "days", 30, date(2026, 8, 14), date(2026, 9, 13)),
        ("2026-08-14", "weeks", 2, date(2026, 8, 14), date(2026, 8, 28)),
        # Long overdue: the next *future* occurrence, not the next one after
        # the anchor, which would still be in the past.
        ("2020-01-01", "months", 6, date(2026, 8, 14), date(2027, 1, 1)),
        # Month-end anchors keep counting from the anchor.
        ("2026-01-31", "months", 1, date(2026, 1, 31), date(2026, 2, 28)),
    ],
    ids=["monthly", "days", "weeks", "long-overdue", "month-end"],
)
def test_next_occurrence_after_is_where_a_bump_lands(
    anchor: str, unit: str, count: int, after: date, expected: date
) -> None:
    result = next_occurrence_after(date.fromisoformat(anchor), ReminderInterval(unit, count), after)

    assert result == expected


def test_next_occurrence_after_a_one_off_is_none() -> None:
    """A one-off has nothing to move to; the caller decides to clear it instead."""

    assert next_occurrence_after(date(2026, 8, 14), None, date(2026, 8, 14)) is None


# -----------------------------
# Dates this build cannot read — one row's problem, not the entity's
# -----------------------------


def test_a_reminder_date_that_cannot_be_parsed_costs_only_that_item(caplog) -> None:
    """One unreadable row used to answer 500 for every window and every item.

    The projection serves the whole entity, so raising on a row nobody can parse
    takes every other item's occurrences down with it. Only a hand-edited store
    can produce one now — every write path and the import side refuse it — and
    the answer is to leave that item off and say so once.
    """

    broken = _reminder("Boiler", anchor="2026-08-10")
    broken.reminder_date = "next week"
    ladder = _item("Ladder", due="2026-08-10")

    with caplog.at_level(logging.WARNING):
        events = build_events([broken, ladder], WINDOW_START, WINDOW_END)

    assert [e.summary for e in events] == ["Ladder due back"]
    assert any("not a date this build can read" in record.message for record in caplog.records)


def test_an_unreadable_due_or_inspection_date_is_skipped_the_same_way() -> None:
    """All three dated fields reach the same parse, so all three need the same guard."""

    broken_due = _item("Ladder", due="whenever")
    broken_inspection = _item("Extinguisher", inspection="2026-13-40")
    fine = _item("Drill", inspection="2026-08-20")

    events = build_events([broken_due, broken_inspection, fine], WINDOW_START, WINDOW_END)

    assert [e.summary for e in events] == ["Drill inspection"]


def test_the_next_event_walk_survives_an_unreadable_date() -> None:
    """The entity's state comes from this walk, so it fails the same way or not at all."""

    broken = _reminder("Boiler", anchor="2026-08-10")
    broken.reminder_date = "next week"

    assert next_event([broken], date(2026, 8, 1)) is None
    assert next_event([broken, _item("Ladder", due="2026-08-10")], date(2026, 8, 1)) is not None


def test_one_unreadable_value_is_reported_once_however_often_it_is_read(caplog) -> None:
    """A calendar read happens on every state write; a warning per read is a log nobody reads."""

    broken = _reminder("Boiler", anchor="2026-08-10")
    broken.reminder_date = "not-a-date-at-all"

    with caplog.at_level(logging.WARNING):
        for _ in range(5):
            build_events([broken], WINDOW_START, WINDOW_END)

    matching = [r for r in caplog.records if "not a date this build can read" in r.message]
    assert len(matching) == 1
