"""Canonical UTC timestamps and the household's local day.

Every stored timestamp is the fixed-width ``YYYY-MM-DDTHH:MM:SSZ``, so string
order is chronological order: sorting and the range filters compare them as
strings, and ``is_canonical_utc_timestamp`` keeps any other ISO form out.

Dates are not timestamps. ``today_local_date`` is the day in Home Assistant's
configured time zone, and every due, overdue and reminder count measures against
it rather than against the UTC date.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import TypeGuard

from homeassistant.util import dt as dt_util


def iso_utc_now() -> str:
    """The current time as the canonical ``YYYY-MM-DDTHH:MM:SSZ``."""

    return datetime.now(tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


#: Canonical timestamps are fixed-width, so lexicographic order is chronological
#: order. Sorting and range filters rely on it.
_CANONICAL_TS_LENGTH = 20


def monotonic_timestamp_after(previous_ts: str) -> str:
    """The current canonical timestamp, bumped to one second past ``previous_ts``."""

    now_ts = iso_utc_now()
    if now_ts > previous_ts or not is_canonical_utc_timestamp(previous_ts):
        return now_ts
    bumped = datetime.fromisoformat(previous_ts) + timedelta(seconds=1)
    return bumped.isoformat().replace("+00:00", "Z")


def is_canonical_utc_timestamp(ts: object) -> TypeGuard[str]:
    """Return True when ``ts`` is exactly the canonical YYYY-MM-DDTHH:MM:SSZ form.

    The separators are checked by position: ``datetime.fromisoformat`` alone
    accepts forms that would compare wrong against canonical timestamps.
    """

    if not (
        isinstance(ts, str)
        and len(ts) == _CANONICAL_TS_LENGTH
        and ts[4] == ts[7] == "-"
        and ts[10] == "T"
        and ts[13] == ts[16] == ":"
        and ts[19] == "Z"
    ):
        return False
    try:
        datetime.fromisoformat(ts)
    except ValueError:
        return False
    return True


def today_local_date() -> date:
    """Today in Home Assistant's configured time zone.

    Every date count, chip and reminder bump measures against this one day.
    `dt_util.now()` reads the zone Home Assistant configured, so no `hass` is
    needed.
    """
    return dt_util.now().date()
