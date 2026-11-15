"""Integration: every date-derived answer names the instance's day, not the UTC one.

At 01:30 on the 23rd in Auckland it is still the 22nd in UTC; the list filters, the
stats counts and the items subscription must all call the 23rd today.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from homeassistant.core import HomeAssistant

NZ_ZONE = "Pacific/Auckland"
NZ_EARLY_MORNING = datetime(2026, 8, 22, 13, 30, tzinfo=UTC)
LOCAL_TODAY = "2026-08-23"
UTC_TODAY = "2026-08-22"
TOMORROW = "2026-08-24"

# (item fields, [(item/list flag, stats count key, is it listed and counted)]).
CASES = [
    pytest.param(
        (
            {"inspection_date": LOCAL_TODAY},
            [
                ("inspection_due_only", "inspection_due_count", True),
                ("inspection_overdue_only", "inspection_overdue_count", False),
            ],
        ),
        id="inspection_dated_local_today",
    ),
    pytest.param(
        (
            {"checked_out": True, "due_date": UTC_TODAY},
            [
                ("overdue_only", "overdue_count", True),
                ("checked_out_due_only", "checked_out_due_count", True),
            ],
        ),
        id="due_yesterday_locally",
    ),
    pytest.param(
        ({"reminder_date": LOCAL_TODAY}, [("reminder_due_only", "reminder_due_count", True)]),
        id="reminder_dated_local_today",
    ),
    pytest.param(
        (
            {"inspection_date": TOMORROW, "reminder_date": TOMORROW},
            [
                ("inspection_due_only", "inspection_due_count", False),
                ("reminder_due_only", "reminder_due_count", False),
            ],
        ),
        id="tomorrow_is_not_due",
    ),
    pytest.param(
        (
            {"inspection_date": UTC_TODAY},
            [("inspection_overdue_only", "inspection_overdue_count", True)],
        ),
        id="inspection_dated_utc_today",
    ),
]


@pytest.mark.parametrize("case", CASES)
async def test_the_filters_counts_and_subscription_read_the_instances_day(
    hass: HomeAssistant,
    freezer: Any,
    setup_entry: Callable[..., Awaitable[Any]],
    ws_connect: Callable[[], Awaitable[Any]],
    case: tuple[dict[str, Any], list[tuple[str, str, bool]]],
) -> None:
    fields, checks = case
    await hass.config.async_set_time_zone(NZ_ZONE)
    freezer.move_to(NZ_EARLY_MORNING)
    await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("items", inspection_overdue_only=True)

    created = await ws.send("haventory/item/create", name="Harness", **fields)
    item_id = created["result"]["id"]

    for flag, count_key, expected in checks:
        listed = await ws.send("haventory/item/list", filter={flag: True})
        stats = await ws.send("haventory/stats")
        assert [i["id"] for i in listed["result"]["items"]] == ([item_id] if expected else []), flag
        assert stats["result"][count_key] == int(expected), count_key
        if flag == "inspection_overdue_only":
            arrived = [e["action"] for e in ws.events("items")]
            assert arrived == (["created"] if expected else []), arrived
