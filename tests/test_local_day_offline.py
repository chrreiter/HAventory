"""One household day, pinned east of Greenwich.

Every date-derived answer HAventory gives — the five item predicates, the five
`filter_items` flags, the five repository counts behind the sensors and
`haventory/stats`, and the subscription matcher — has to name the same day as
the calendar entity, the reminder bump and the card's chips: the one Home
Assistant is configured for. Until #568 those first four read a UTC day, so
between local midnight and UTC midnight a row said Overdue while the sensor,
the pill and `overdue_only` said not yet.

The offline suite and the dev container both run in UTC, which is the one zone
where the bug is invisible, so the zone is pinned here. A fixed +12 offset
stands in for `Pacific/Auckland` in August: `zoneinfo` needs a tzdata package
the offline environment does not carry on every host, and the offset is what
the assertions turn on.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from custom_components.haventory.models import (
    Item,
    ItemCreate,
    filter_items,
    item_inspection_is_due,
    item_inspection_is_overdue,
    item_is_due,
    item_is_overdue,
    item_reminder_is_due,
    today_local_date,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.serialization import serialize_item
from custom_components.haventory.subscriptions import _item_matches_filter
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from runtime_helpers import install_runtime

# 13:30 UTC on 22 August is 01:30 on the **23rd** in New Zealand: the window in
# which the two days disagree, and the instant every case below is frozen at.
INSTANT_UTC = datetime(2026, 8, 22, 13, 30, tzinfo=UTC)
NZ = timezone(timedelta(hours=12))
LOCAL_TODAY = "2026-08-23"
UTC_TODAY = "2026-08-22"


@pytest.fixture
def household_in_new_zealand(monkeypatch: pytest.MonkeyPatch) -> None:
    """Move the instance east of Greenwich and stop the clock inside the window.

    `monkeypatch` puts both back afterwards; the rest of the suite assumes UTC.
    """

    monkeypatch.setattr(dt_util, "DEFAULT_TIME_ZONE", NZ)
    monkeypatch.setattr(dt_util, "now", lambda *_a, **_k: INSTANT_UTC.astimezone(NZ))


def _item(**fields: object) -> Item:
    repo = Repository()
    payload: ItemCreate = {"name": "Harness", **fields}  # type: ignore[typeddict-item]
    return repo.create_item(payload)


def _repo_with(**fields: object) -> Repository:
    repo = Repository()
    payload: ItemCreate = {"name": "Harness", **fields}  # type: ignore[typeddict-item]
    repo.create_item(payload)
    return repo


@pytest.mark.usefixtures("household_in_new_zealand")
def test_today_is_the_instances_day_and_not_the_utc_one() -> None:
    """The whole fix in one line: 01:30 in Auckland is still yesterday in UTC."""

    assert today_local_date() == LOCAL_TODAY
    # The frozen instant, not the machine's clock: the pair is a claim about
    # the zone the household is in, and reading the real day here made the
    # whole file pass only on the date the constants were written.
    assert INSTANT_UTC.date().isoformat() == UTC_TODAY


@pytest.mark.usefixtures("household_in_new_zealand")
def test_an_inspection_dated_today_is_due_on_every_surface() -> None:
    """The issue's reproduction: the predicate, the count and the filter agree."""

    item = _item(inspection_date=LOCAL_TODAY)

    assert item_inspection_is_due(item) is True
    assert item_inspection_is_overdue(item) is False

    repo = _repo_with(inspection_date=LOCAL_TODAY)
    counts = repo.get_counts()
    assert counts["inspection_due_count"] == 1
    assert counts["inspection_overdue_count"] == 0

    assert [i.id for i in filter_items([item], {"inspection_due_only": True})] == [item.id]


@pytest.mark.usefixtures("household_in_new_zealand")
def test_a_date_that_passed_locally_is_overdue_before_utc_agrees() -> None:
    """Yesterday for the household is still today in UTC, and it counts as past."""

    item = _item(checked_out=True, due_date=UTC_TODAY)

    assert item_is_overdue(item) is True
    assert item_is_due(item) is True

    repo = _repo_with(checked_out=True, due_date=UTC_TODAY)
    counts = repo.get_counts()
    assert counts["overdue_count"] == 1
    assert counts["checked_out_due_count"] == 1

    assert [i.id for i in filter_items([item], {"overdue_only": True})] == [item.id]


@pytest.mark.usefixtures("household_in_new_zealand")
def test_a_reminder_dated_today_has_come_round() -> None:
    """A reminder counts today, and the bump already read this same day."""

    item = _item(reminder_date=LOCAL_TODAY)

    assert item_reminder_is_due(item) is True
    assert _repo_with(reminder_date=LOCAL_TODAY).get_counts()["reminder_due_count"] == 1
    assert [i.id for i in filter_items([item], {"reminder_due_only": True})] == [item.id]


@pytest.mark.usefixtures("household_in_new_zealand")
def test_tomorrow_is_not_yet_due_anywhere() -> None:
    """The other edge of the window: moving the day forward must not over-count.

    A UTC reading would call 2026-08-24 two days away and this one day away, but
    neither is today, so nothing here may report it as due.
    """

    item = _item(inspection_date="2026-08-24", reminder_date="2026-08-24")

    assert item_inspection_is_due(item) is False
    assert item_reminder_is_due(item) is False

    repo = _repo_with(inspection_date="2026-08-24", reminder_date="2026-08-24")
    counts = repo.get_counts()
    assert counts["inspection_due_count"] == 0
    assert counts["reminder_due_count"] == 0

    assert filter_items([item], {"inspection_due_only": True}) == []


@pytest.mark.usefixtures("household_in_new_zealand")
@pytest.mark.parametrize(
    ("inspection_date", "expected"),
    [("2026-08-21", True), (UTC_TODAY, True), (LOCAL_TODAY, False), ("2026-08-24", False)],
)
def test_the_subscription_matcher_and_the_item_predicate_read_one_day(
    inspection_date: str, expected: bool
) -> None:
    """`inspection_overdue_only` runs twice on the same item, over two shapes.

    `item/list` asks the `Item` predicate and a subscription asks the serialized
    payload, so the two are separate pieces of code that have to answer the same
    thing for the same date — including on the day the household turned over and
    UTC has not.
    """

    hass = HomeAssistant()
    install_runtime(hass)
    item = _item(inspection_date=inspection_date)

    payload = serialize_item(hass, item)
    matched = _item_matches_filter(payload, {"topic": "items", "inspection_overdue_only": True})

    assert item_inspection_is_overdue(item) is expected
    assert matched is expected
