"""Projection of stored item dates onto calendar occurrences.

Home Assistant is not imported here, so the projection is testable offline;
`calendar.py` is the entity wrapper. Nothing is scheduled and nothing is stored:
an occurrence exists because a date on an item, or a reminder's anchor and
interval, falls inside the window somebody asked about.
"""

from __future__ import annotations

from calendar import monthrange
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from types import MappingProxyType

from .logs import context_logger
from .models import Item, ReminderInterval

LOGGER = context_logger(__name__)

# ``(item_id, field, value)`` already warned about: the projection runs on every
# calendar read, and one line per distinct bad value is enough.
_REPORTED_UNREADABLE: set[tuple[str, str, str]] = set()

# The dated fields on `Item`. `due_date` only exists while an item is checked out.
KIND_DUE = "due"
KIND_INSPECTION = "inspection"
KIND_REMINDER = "reminder"

# English defaults; `calendar.py` passes the translated patterns in. `{name}` is
# a placeholder so a translation can put the noun where its language puts it.
SUMMARY_PATTERNS: Mapping[str, str] = MappingProxyType(
    {
        KIND_DUE: "{name} due back",
        KIND_INSPECTION: "{name} inspection",
        KIND_REMINDER: "{name} reminder",
    }
)

# What one item's reminder may contribute to one window.
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

    The exclusive end rounds *up* past any time component, or a request for the
    next four hours from midday would miss today. The caller converts both bounds
    to local time first.
    """

    last = end.date()
    return start.date(), (last + _ONE_DAY if end.time() != time.min else last)


def build_events(
    items: Iterable[Item],
    start: date,
    end: date,
    *,
    summaries: Mapping[str, str] = SUMMARY_PATTERNS,
) -> list[ProjectedEvent]:
    """Every occurrence inside the half-open `[start, end)`, ordered for display."""

    return sorted(_iter_events(items, start, end, summaries=summaries), key=_order)


def next_event(
    items: Iterable[Item],
    on_or_after: date,
    *,
    summaries: Mapping[str, str] = SUMMARY_PATTERNS,
) -> ProjectedEvent | None:
    """The earliest occurrence from `on_or_after` onwards, or none.

    What the entity reports as its state; today's counts as current. Unbounded
    ahead, and each recurring reminder contributes only its next occurrence.
    """

    return min(
        _iter_events(items, on_or_after, date.max, limit=1, summaries=summaries),
        key=_order,
        default=None,
    )


def next_occurrence_after(
    anchor: date, interval: ReminderInterval | None, after: date
) -> date | None:
    """Where a reminder lands once it has been done; none for a one-off."""

    if interval is None:
        return None
    return _occurrence(anchor, interval, _first_step_after(anchor, interval, after))


def _iter_events(
    items: Iterable[Item],
    start: date,
    end: date,
    *,
    limit: int = MAX_REMINDER_OCCURRENCES,
    summaries: Mapping[str, str] = SUMMARY_PATTERNS,
) -> Iterator[ProjectedEvent]:
    for item in items:
        yield from _item_events(item, start, end, limit=limit, summaries=summaries)


def _summary(summaries: Mapping[str, str], kind: str, item: Item) -> str:
    """One event's title. Substituted, not `str.format`ted: a name may hold braces."""

    pattern = summaries.get(kind) or SUMMARY_PATTERNS[kind]
    return pattern.replace("{name}", item.name)


def _item_events(
    item: Item, start: date, end: date, *, limit: int, summaries: Mapping[str, str]
) -> Iterator[ProjectedEvent]:
    for kind, stored in (
        (KIND_DUE, item.due_date),
        (KIND_INSPECTION, item.inspection_date),
    ):
        if stored is None:
            continue
        day = _stored_date(item, f"{kind}_date", stored)
        if day is None or not (start <= day < end):
            continue
        yield _event(item, kind, _summary(summaries, kind, item), day, uid=f"{item.id}:{kind}")

    yield from _reminder_events(item, start, end, limit=limit, summaries=summaries)


def _reminder_events(
    item: Item, start: date, end: date, *, limit: int, summaries: Mapping[str, str]
) -> Iterator[ProjectedEvent]:
    """Every occurrence of the item's reminder inside `[start, end)`.

    With no interval `reminder_date` is a one-off. With one, the series is
    measured from `reminder_anchor` and begins at `reminder_date`, which is how
    far the household has marked it done.
    """

    if item.reminder_date is None:
        return
    occurrence = _stored_date(item, "reminder_date", item.reminder_date)
    if occurrence is None:
        return
    interval = item.reminder_interval
    summary = _summary(summaries, KIND_REMINDER, item)

    if interval is None:
        if start <= occurrence < end:
            yield _event(item, KIND_REMINDER, summary, occurrence, uid=f"{item.id}:{KIND_REMINDER}")
        return

    anchor = _stored_date(item, "reminder_anchor", item.reminder_anchor or item.reminder_date)
    if anchor is None:
        return
    # Nothing before the stored occurrence: those are already marked done.
    step = _first_step_on_or_after(anchor, interval, max(start, occurrence))
    for _ in range(limit):
        day = _occurrence(anchor, interval, step)
        if day >= end:
            return
        # Each occurrence carries its own date in the uid, so every one is
        # named the same way on every read.
        yield _event(
            item, KIND_REMINDER, summary, day, uid=f"{item.id}:{KIND_REMINDER}:{day.isoformat()}"
        )
        step += 1


def _stored_date(item: Item, field: str, stored: str) -> date | None:
    """Read one stored date, or none if this build cannot parse it.

    Only a hand-edited store gets here. Skipping costs that row its events;
    raising would cost the whole calendar.
    """

    try:
        return date.fromisoformat(stored)
    except ValueError:
        key = (str(item.id), field, stored)
        if key not in _REPORTED_UNREADABLE:
            _REPORTED_UNREADABLE.add(key)
            LOGGER.warning(
                "Leaving an item off the calendar: its %s is not a date this build can read",
                field,
                extra={
                    "op": "calendar_projection",
                    "item_id": str(item.id),
                    "item_name": item.name,
                    "field": field,
                    "value": stored,
                },
            )
        return None


def _first_step_on_or_after(anchor: date, interval: ReminderInterval, target: date) -> int:
    """How many steps from the anchor the first occurrence not before `target` is.

    Jumped to rather than stepped to. Exact for days and weeks; for months it can
    land one step short when the anchor's day of month is later than the
    target's, so one correction follows.
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

    Measured from the anchor, not the previous occurrence, so a series anchored
    on the 31st returns to it after a clamped February.
    """

    if step <= 0:
        return anchor
    if interval.unit == "days":
        return anchor + timedelta(days=interval.count * step)
    if interval.unit == "weeks":
        return anchor + timedelta(weeks=interval.count * step)
    return _add_months(anchor, interval.count * step)


def _add_months(day: date, months: int) -> date:
    """`day` moved `months` on, clamped onto the target month's last day."""

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
