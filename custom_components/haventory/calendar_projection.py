"""Projection of stored item dates onto calendar occurrences.

Home Assistant is not imported here. The entity in `calendar.py` is a thin
wrapper over these functions, which keeps the projection testable in the offline
suite — importing `calendar.py` there would mean standing in for the entity
platform, the device registry and the time helpers, none of which the projection
itself touches.

Nothing is scheduled and nothing is stored: an occurrence exists because a date
on an item falls inside the window somebody asked about. A recurring reminder is
the same rule applied more than once — the anchor and the interval generate the
occurrences the window covers, and none of them is written anywhere.
"""

from __future__ import annotations

from calendar import monthrange
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from .models import Item, ReminderInterval

# The dated fields on `Item`, and the word each one contributes to an event's
# summary. `due_date` only exists while an item is checked out
# (`models.validate_due_date_rules`), so the due half of the calendar is the
# checked-out population.
KIND_DUE = "due"
KIND_INSPECTION = "inspection"
KIND_REMINDER = "reminder"

# What one item's reminder may contribute to one window. A bound on the answer,
# not on the data: a daily reminder against a decade-wide window is a request
# nothing renders, and the alternative is building a list nothing can draw.
MAX_REMINDER_OCCURRENCES = 500

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
    would be picking how far ahead the state stops being true. A recurring
    reminder contributes only its next occurrence to this walk, so an unbounded
    window costs no more than a bounded one.
    """

    return min(_iter_events(items, on_or_after, date.max, limit=1), key=_order, default=None)


def next_occurrence_after(
    anchor: date, interval: ReminderInterval | None, after: date
) -> date | None:
    """Where a reminder lands once the thing it reminds about has been done.

    A one-off has no next occurrence and answers none — bumping it is clearing
    it, which is the caller's decision to make rather than this function's.
    """

    if interval is None:
        return None
    return _occurrence(anchor, interval, _first_step_after(anchor, interval, after))


def _iter_events(
    items: Iterable[Item], start: date, end: date, *, limit: int = MAX_REMINDER_OCCURRENCES
) -> Iterator[ProjectedEvent]:
    for item in items:
        yield from _item_events(item, start, end, limit=limit)


def _item_events(item: Item, start: date, end: date, *, limit: int) -> Iterator[ProjectedEvent]:
    for kind, stored, summary in (
        (KIND_DUE, item.due_date, f"{item.name} due back"),
        (KIND_INSPECTION, item.inspection_date, f"{item.name} inspection"),
    ):
        if stored is None:
            continue
        day = date.fromisoformat(stored)
        if not (start <= day < end):
            continue
        yield _event(item, kind, summary, day, uid=f"{item.id}:{kind}")

    yield from _reminder_events(item, start, end, limit=limit)


def _reminder_events(item: Item, start: date, end: date, *, limit: int) -> Iterator[ProjectedEvent]:
    """Every occurrence of the item's reminder inside `[start, end)`.

    With no interval the anchor is the whole series — a one-off. With one, the
    anchor and every step after it are occurrences, and the window is what bounds
    them; the anchor itself may be years before `start`.
    """

    if item.reminder_date is None:
        return
    anchor = date.fromisoformat(item.reminder_date)
    interval = item.reminder_interval
    summary = f"{item.name} reminder"

    if interval is None:
        if start <= anchor < end:
            yield _event(item, KIND_REMINDER, summary, anchor, uid=f"{item.id}:{KIND_REMINDER}")
        return

    step = _first_step_on_or_after(anchor, interval, start)
    for _ in range(limit):
        day = _occurrence(anchor, interval, step)
        if day >= end:
            return
        # Each occurrence carries its own date in the uid. This calendar is
        # read-only — it implements neither `async_create_event` nor
        # `async_delete_event` — so a uid's whole job is to name the same
        # occurrence the same way twice, which one shared across a series
        # could not do.
        yield _event(
            item, KIND_REMINDER, summary, day, uid=f"{item.id}:{KIND_REMINDER}:{day.isoformat()}"
        )
        step += 1


def _first_step_on_or_after(anchor: date, interval: ReminderInterval, target: date) -> int:
    """How many steps from the anchor the first occurrence not before `target` is.

    Jumped to rather than stepped to: a daily reminder anchored decades back
    would otherwise cost one iteration per day before the window even opens.

    The jump is exact for days and weeks. For months it can land one step short —
    whole elapsed months undercount when the anchor's day of month falls later
    than the target's — so one correction follows. It cannot overshoot: the step
    before the estimate always lands in an earlier month than `target`.
    """

    if anchor >= target:
        return 0

    if interval.unit == "months":
        elapsed = (target.year - anchor.year) * 12 + (target.month - anchor.month)
        steps = max(0, elapsed // interval.count)
    else:
        span = (target - anchor).days
        per_step = interval.count * (7 if interval.unit == "weeks" else 1)
        steps = -(-span // per_step)  # ceiling division

    return steps if _occurrence(anchor, interval, steps) >= target else steps + 1


def _first_step_after(anchor: date, interval: ReminderInterval, target: date) -> int:
    step = _first_step_on_or_after(anchor, interval, target)
    return step + 1 if _occurrence(anchor, interval, step) == target else step


def _occurrence(anchor: date, interval: ReminderInterval, step: int) -> date:
    """The occurrence `step` intervals after the anchor.

    Always measured from the anchor rather than from the occurrence before it.
    Month steps clamp onto short months, and clamping the *previous* result would
    make a series anchored on the 31st slip to the 28th in February and stay
    there; measured from the anchor it returns to the 31st in the months that
    have one.
    """

    if step <= 0:
        return anchor
    if interval.unit == "days":
        return anchor + timedelta(days=interval.count * step)
    if interval.unit == "weeks":
        return anchor + timedelta(weeks=interval.count * step)
    return _add_months(anchor, interval.count * step)


def _add_months(day: date, months: int) -> date:
    """`day` moved `months` on, clamped onto the target month's last day.

    The 31st plus one month is the 28th, 29th or 30th — that month has no 31st,
    and a household that said "every month" means the end of it rather than a
    date that slips into the month after.
    """

    index = (day.year * 12 + day.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))


def _event(item: Item, kind: str, summary: str, day: date, *, uid: str) -> ProjectedEvent:
    return ProjectedEvent(
        uid=uid,
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
