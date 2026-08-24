"""Dates a test writes relative to the household's own day.

Every date-derived answer the integration gives — the item predicates, the
`filter_items` flags, the repository counts, the subscription matcher — is
measured against `dt_util.now()` in the instance's time zone
(`models.today_local_date`). A test that writes "yesterday" or "tomorrow" has to
measure from that same clock: `datetime.now(UTC)` is a second, different reading
that disagrees with it for the hours a local day and a UTC one differ by, and
also whenever midnight falls between the test's reading and the integration's.
"""

from __future__ import annotations

from datetime import timedelta

from homeassistant.util import dt as dt_util


def day_offset(days: int) -> str:
    """A calendar date `days` from today in the instance's zone, as YYYY-MM-DD."""

    return (dt_util.now().date() + timedelta(days=days)).isoformat()
