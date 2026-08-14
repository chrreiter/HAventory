"""Offline tests for the calendar projection.

`calendar.py` itself is not imported here: it is a wrapper over these functions
and everything it adds — the entity platform, the device registry, the midnight
rewrite — belongs to the phacc suite (`tests/integration/test_calendar.py`).
What is checkable offline is the projection, which touches no Home Assistant
type at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from custom_components.haventory.calendar_projection import (
    KIND_DUE,
    KIND_INSPECTION,
    build_events,
    next_event,
    window_dates,
)
from custom_components.haventory.models import Item, LocationPath

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
