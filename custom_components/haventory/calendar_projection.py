"""Projection of stored item dates onto calendar occurrences.

Home Assistant is not imported here. The entity in `calendar.py` is a thin
wrapper over these functions, which keeps the projection testable in the offline
suite — importing `calendar.py` there would mean standing in for the entity
platform, the device registry and the time helpers, none of which the projection
itself touches.

Nothing is scheduled and nothing is stored: an occurrence exists because a date
on an item falls inside the window somebody asked about.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from .models import Item

# The two dated fields on `Item`, and the word each one contributes to an
# event's summary. `due_date` only exists while an item is checked out
# (`models.validate_due_date_rules`), so the due half of the calendar is the
# checked-out population.
KIND_DUE = "due"
KIND_INSPECTION = "inspection"

_ONE_DAY = timedelta(days=1)


@dataclass(frozen=True, slots=True)
class ProjectedEvent:
    """One all-day occurrence derived from one date on one item.

    `end` follows the all-day convention Home Assistant expects — exclusive, the
    day after `start`. `uid` is stable across reads so a client that saw the
    occurrence before recognises it again.
    """

    uid: str
    summary: str
    description: str
    start: date
    end: date
    item_id: str
    kind: str


def window_dates(start: datetime, end: datetime) -> tuple[date, date]:
    """Reduce a datetime range to the half-open range of days it touches.

    All-day occurrences have no time of day, so a range is only ever compared
    day by day. The exclusive end rounds *up* past any time component: a request
    for the next four hours from midday overlaps today's all-day occurrences, and
    truncating would answer with nothing.

    Both bounds are read in whatever offset they carry — the caller converts to
    local time first, because a UTC-stamped midnight is the previous day for half
    the world.
    """

    last = end.date()
    return start.date(), (last + _ONE_DAY if end.time() != time.min else last)


def build_events(items: Iterable[Item], start: date, end: date) -> list[ProjectedEvent]:
    """Every occurrence inside `[start, end)`, ordered for display.

    A date exactly on `start` is included and one exactly on `end` is not, which
    is the same half-open rule Home Assistant applies to the all-day events this
    produces.
    """

    return sorted(_iter_events(items, start, end), key=_order)


def next_event(items: Iterable[Item], on_or_after: date) -> ProjectedEvent | None:
    """The earliest occurrence from `on_or_after` onwards, or none.

    What the entity reports as its state. An all-day occurrence covers the whole
    of its day, so today's counts as current rather than past.

    Unbounded ahead rather than scanning a fixed horizon: a date years out is
    still the next thing that happens if nothing is nearer, and picking a horizon
    would be picking how far ahead the state stops being true.
    """

    return min(_iter_events(items, on_or_after, date.max), key=_order, default=None)


def _iter_events(items: Iterable[Item], start: date, end: date) -> Iterator[ProjectedEvent]:
    for item in items:
        yield from _item_events(item, start, end)


def _item_events(item: Item, start: date, end: date) -> Iterator[ProjectedEvent]:
    for kind, stored, summary in (
        (KIND_DUE, item.due_date, f"{item.name} due back"),
        (KIND_INSPECTION, item.inspection_date, f"{item.name} inspection"),
    ):
        if stored is None:
            continue
        day = date.fromisoformat(stored)
        if not (start <= day < end):
            continue
        yield ProjectedEvent(
            uid=f"{item.id}:{kind}",
            summary=summary,
            # The path is what tells one "Fire extinguisher inspection" from the
            # next; an item with no location contributes an empty one.
            description=item.location_path.display_path,
            start=day,
            end=day + _ONE_DAY,
            item_id=str(item.id),
            kind=kind,
        )


def _order(event: ProjectedEvent) -> tuple[date, str, str]:
    # `uid` last so the order is total: two items can share a name and a date.
    return (event.start, event.summary, event.uid)
