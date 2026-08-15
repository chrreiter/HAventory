"""Offline tests for the `haventory/reminder/*` commands.

Scenarios:
- set a one-off and a recurring reminder, and read them back on the item
- clear one, including on an item that never had one
- bump a recurring reminder, from the anchor and from an anchor long past
- the refusals: no reminder to bump, a one-off with nothing to bump to,
  an interval with no anchor, a zero count
- optimistic concurrency: a stale `expected_version` is a `conflict`
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import DomainStore
from custom_components.haventory.ws import setup as ws_setup
from homeassistant.core import HomeAssistant

from ws_helpers import ws_send

MONTHLY = {"unit": "months", "count": 3}
_AFTER_ONE_EDIT = 2


def _hass() -> HomeAssistant:
    hass = HomeAssistant()
    hass.data.setdefault(DOMAIN, {})["repository"] = Repository()
    hass.data[DOMAIN]["store"] = DomainStore(hass)
    ws_setup(hass)
    return hass


async def _item(hass: HomeAssistant, name: str = "HVAC filter") -> str:
    created = await ws_send(hass, 1, "haventory/item/create", name=name)
    return str(created["result"]["id"])


def _today() -> date:
    return datetime.now(UTC).date()


@pytest.mark.asyncio
async def test_set_stores_the_anchor_and_the_interval() -> None:
    hass = _hass()
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

    hass = _hass()
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
    hass = _hass()
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

    hass = _hass()
    item_id = await _item(hass)

    res = await ws_send(hass, 2, "haventory/reminder/clear", item_id=item_id)

    assert res["success"] is True
    assert res["result"]["reminder_date"] is None


@pytest.mark.asyncio
async def test_bump_moves_a_due_reminder_on_by_one_interval() -> None:
    """The filter was changed today: the whole series moves with the anchor."""

    hass = _hass()
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

    hass = _hass()
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
    hass = _hass()
    item_id = await _item(hass)

    res = await ws_send(hass, 2, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_bump_refuses_a_one_off() -> None:
    """There is no next occurrence to move to, and guessing one would invent a series."""

    hass = _hass()
    item_id = await _item(hass)
    await ws_send(hass, 2, "haventory/reminder/set", item_id=item_id, reminder_date="2026-09-01")

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_an_interval_with_no_anchor_is_refused() -> None:
    """Through `item/update`, the one path that can name the interval alone."""

    hass = _hass()
    item_id = await _item(hass)

    res = await ws_send(
        hass, 2, "haventory/item/update", item_id=item_id, reminder_interval=MONTHLY
    )

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"


@pytest.mark.asyncio
async def test_clearing_the_anchor_of_a_recurring_reminder_is_refused() -> None:
    """The stored interval is what the update is validated against."""

    hass = _hass()
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
    hass = _hass()
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

    hass = _hass()
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

    hass = _hass()
    item_id = await _item(hass)
    await ws_send(hass, 2, "haventory/reminder/set", item_id=item_id, reminder_date="2026-09-01")
    repo = hass.data[DOMAIN]["repository"]
    repo.get_item(item_id).reminder_date = "next week"

    res = await ws_send(hass, 3, "haventory/reminder/bump", item_id=item_id)

    assert res["success"] is False
    assert res["error"]["code"] == "validation_error"
    assert "reminder_date" in res["error"]["message"]
