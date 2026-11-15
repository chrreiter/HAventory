"""Integration: what setup does with each schema stamp a stored file can carry.

Seeds HA's storage backend and sets the entry up through `hass.config_entries`. A
readable stamp loads, and is restamped only when it was below the current one.
A stamp this build will not read, or a payload that is no mapping, ends in the
entry state HA gives that failure, with the file left exactly as it was. Abort
instead of retry is HA's own dispatch.
"""

from __future__ import annotations

import logging
import uuid
from copy import deepcopy

import pytest
from custom_components.haventory.const import (
    DOMAIN,
    ISSUE_CORRUPT_SCHEMA_VERSION,
    ISSUE_SCHEMA_DOWNGRADE,
)
from custom_components.haventory.migrations import PRE_COLLAPSE_SCHEMA_VERSIONS
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

ITEM_ID = str(uuid.uuid4())
FLAGGED_ITEM_ID = str(uuid.uuid4())

HUGE_STAMP = "x" * 5000

#: One above every stamp this project used before the collapse: a store only a
#: genuinely newer build could have written.
FROM_A_NEWER_BUILD = max(PRE_COLLAPSE_SCHEMA_VERSIONS) + 1


def _store_data(schema_version: int) -> dict:
    """A store as a build before the collapse wrote it: no status, no statuses."""

    return {
        "schema_version": schema_version,
        "items": {
            ITEM_ID: {"id": ITEM_ID, "name": "Hammer", "quantity": 2},
            FLAGGED_ITEM_ID: {
                "id": FLAGGED_ITEM_ID,
                "name": "Drill",
                "quantity": 1,
                "status": "needs_repair",
            },
        },
        "locations": {},
    }


def _seed_store(hass_storage: dict, data: object) -> None:
    """Put ``data`` on disk under HAventory's key, exactly as written."""

    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": data}


async def _setup_expecting_failure(hass: HomeAssistant) -> MockConfigEntry:
    """Set the entry up knowing it will not load, and hand it back to be read."""

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id) is False
    await hass.async_block_till_done()
    return entry


@pytest.mark.parametrize("stored_version", sorted(PRE_COLLAPSE_SCHEMA_VERSIONS))
async def test_a_store_from_before_the_collapse_stops_setup_and_is_left_alone(
    hass: HomeAssistant, hass_storage: dict, stored_version: int
) -> None:
    stored = _store_data(stored_version)
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": deepcopy(stored)}

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # The entry's error state is where a user reads it, and what it names is the
    # build that can still open this file rather than one that never will.
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert str(stored_version) in entry.reason
    assert "0.8" in entry.reason
    assert "Upgrade HAventory" not in entry.reason

    assert hass_storage[STORAGE_KEY]["data"] == stored


async def test_a_store_from_a_newer_build_stops_setup_and_is_left_alone(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    stored = _store_data(FROM_A_NEWER_BUILD)
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": deepcopy(stored)}

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    # ConfigEntryError, so HA stops instead of retrying forever, and the message
    # names both numbers in the entry's error state.
    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert str(FROM_A_NEWER_BUILD) in entry.reason
    assert f"({CURRENT_SCHEMA_VERSION})" in entry.reason
    assert find_runtime(hass) is None

    # Refusing means refusing to write: the file is what it was.
    assert hass_storage[STORAGE_KEY]["data"] == stored


@pytest.mark.parametrize(
    ("extra", "rewritten"),
    [
        pytest.param({}, True, id="absent"),
        pytest.param({"schema_version": 0}, True, id="zero"),
        # A key a dev build wrote: kept as is, and no reason to rewrite the file.
        pytest.param(
            {"schema_version": CURRENT_SCHEMA_VERSION, "_generation": 17},
            False,
            id="stale_generation",
        ),
        pytest.param({"schema_version": CURRENT_SCHEMA_VERSION}, False, id="current"),
    ],
)
async def test_a_store_at_or_below_the_current_stamp_loads(
    hass_storage: dict, setup_entry, ws_connect, extra: dict, rewritten: bool
) -> None:
    """An older or unstamped file loads and is restamped; a current one is not rewritten.

    `hass_storage` replaces its entry on every write, so the seeded object still
    being there means nothing wrote the store.
    """

    rows = {ITEM_ID: {"id": ITEM_ID, "name": "Hammer", "quantity": 2}}
    seeded = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {**extra, "items": deepcopy(rows), "locations": {}},
    }
    hass_storage[STORAGE_KEY] = seeded

    await setup_entry()
    ws = await ws_connect()
    listed = await ws.send("haventory/item/list")

    assert [item["name"] for item in listed["result"]["items"]] == ["Hammer"]
    if rewritten:
        assert hass_storage[STORAGE_KEY] is not seeded
        data = hass_storage[STORAGE_KEY]["data"]
        assert data["schema_version"] == CURRENT_SCHEMA_VERSION
        assert data["items"] == rows
    else:
        assert hass_storage[STORAGE_KEY] is seeded


async def test_a_store_written_before_the_status_field_reads_every_item_as_ok(
    setup_entry, ws_connect
) -> None:
    """A row with no status, or one naming an undefined slug, reads as the default."""

    ids = [str(uuid.uuid4()) for _ in range(3)]
    rows = {
        ids[0]: {"id": ids[0], "name": "Hammer"},
        ids[1]: {"id": ids[1], "name": "Drill", "status": "needs_repair"},
        ids[2]: {"id": ids[2], "name": "Wrench", "status": "shattered"},
    }
    await setup_entry(stored={"schema_version": 0, "items": rows, "locations": {}})
    ws = await ws_connect()

    listed = await ws.send("haventory/item/list")
    statuses = {item["name"]: item["status"] for item in listed["result"]["items"]}
    assert statuses == {"Hammer": "ok", "Drill": "needs_repair", "Wrench": "ok"}
    defined = await ws.send("haventory/status/list")
    assert sorted(s["slug"] for s in defined["result"]) == ["missing", "needs_repair", "ok"]


@pytest.mark.parametrize(
    "stamp",
    [
        pytest.param(None, id="none"),
        pytest.param("4", id="numeric_string"),
        pytest.param("abc", id="word"),
        pytest.param(4.0, id="float"),
        pytest.param(True, id="bool"),
        pytest.param([4], id="list"),
        pytest.param({"v": 4}, id="dict"),
        pytest.param(HUGE_STAMP, id="huge"),
    ],
)
async def test_an_unreadable_schema_version_stops_the_entry_with_its_own_message(
    hass: HomeAssistant, hass_storage: dict, stamp: object
) -> None:
    """A hand-edited store says nothing about its schema; guessing is the bug.

    The message quotes the stamp, so `"4"` is told from `4`, and cuts a huge one
    short instead of pasting it into the entry's error state.
    """

    data = {"schema_version": stamp, "items": {}, "locations": {}}
    _seed_store(hass_storage, deepcopy(data))

    entry = await _setup_expecting_failure(hass)

    assert entry.state is ConfigEntryState.SETUP_ERROR
    assert "corrupt schema_version" in entry.reason
    if stamp is HUGE_STAMP:
        assert stamp not in entry.reason
        assert "…" in entry.reason
        assert len(entry.reason) < len(stamp)
    else:
        assert repr(stamp) in entry.reason
    # Its own Repairs card, so restoring a store clears one card rather than the wrong one.
    registry = ir.async_get(hass)
    assert registry.async_get_issue(DOMAIN, ISSUE_CORRUPT_SCHEMA_VERSION) is not None
    assert registry.async_get_issue(DOMAIN, ISSUE_SCHEMA_DOWNGRADE) is None
    assert find_runtime(hass) is None
    assert hass_storage[STORAGE_KEY]["data"] == data


@pytest.mark.parametrize(
    ("stored", "says"),
    [
        # A payload that is not a mapping at all is a plain storage failure, not
        # a verdict about which schema wrote it.
        pytest.param(
            {"version": 1, "key": STORAGE_KEY, "data": ["not", "a", "mapping"]},
            ("op=migrate", STORAGE_KEY),
            id="payload_not_a_mapping",
        ),
        # Written by something other than this integration; a restore in the
        # background is a fix a retry picks up.
        pytest.param(
            {
                "version": 1,
                "key": STORAGE_KEY,
                "data": {"schema_version": CURRENT_SCHEMA_VERSION, "items": [], "locations": {}},
            },
            ("Storage validation failed during setup", "op=setup_storage"),
            id="collection_not_a_mapping",
        ),
        # A file a newer Home Assistant wrote, as a restored backup can be:
        # `Store` refuses to read it at all.
        pytest.param(
            {"version": 99, "key": STORAGE_KEY, "data": {}},
            ("Failed to load storage during setup", "op=setup_storage"),
            id="file_the_store_cannot_read",
        ),
    ],
)
async def test_a_store_that_cannot_be_read_right_now_is_retried_instead(
    hass: HomeAssistant, hass_storage: dict, caplog: pytest.LogCaptureFixture, stored, says
) -> None:
    """The counter-case that gives the refusals above their meaning.

    Without it "raises ConfigEntryError" and "raises ConfigEntryNotReady" would
    be indistinguishable from the outside.
    """

    caplog.set_level(logging.ERROR)
    hass_storage[STORAGE_KEY] = stored

    entry = await _setup_expecting_failure(hass)

    assert entry.state is ConfigEntryState.SETUP_RETRY
    assert find_runtime(hass) is None
    # Home Assistant's formatter drops record attributes, so the context a log
    # reader needs is in the message text.
    logged = [
        record.getMessage()
        for record in caplog.records
        if record.levelno == logging.ERROR and says[0] in record.getMessage()
    ]
    assert len(logged) == 1, logged
    assert all(part in logged[0] for part in says), logged[0]
