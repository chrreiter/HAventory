"""Integration: config entry lifecycle against a real Home Assistant core.

Verifies the integration sets up and tears down cleanly through the real
``hass.config_entries`` machinery. Teardown especially: real Home Assistant has
no API to take a WebSocket command back out on unload, so "the commands are still
registered and refuse" must hold rather than "the commands are gone".

The reload tests talk to a real WebSocket rather than calling handlers: unload,
setup and the subscription registry all move under one connection that outlives
them.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
from custom_components.haventory.const import (
    ATTACHMENT_MANUAL_MIME_TYPES,
    ATTACHMENT_PICTURE_MIME_TYPES,
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    DEFAULT_CARD_TITLE,
    DOMAIN,
    INTEGRATION_VERSION,
    MAX_ATTACHMENT_BYTES,
    MAX_MANUALS_PER_ITEM,
    MAX_PICTURES_PER_ITEM,
)
from custom_components.haventory.repository import Repository
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def _subscribe(client, sub_id: int, topic: str = "items") -> None:
    """Open one topic subscription and assert the backend accepted it."""

    await client.send_json({"id": sub_id, "type": "haventory/subscribe", "topic": topic})
    result = await client.receive_json()
    assert result["success"] is True, result


async def test_config_entry_setup_and_unload(hass: HomeAssistant) -> None:
    """A config entry sets up (LOADED) and unloads (NOT_LOADED) cleanly."""

    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    # Setup handed the runtime to Home Assistant, on the entry.
    assert isinstance(entry.runtime_data.repository, Repository)
    assert entry.runtime_data.store is not None
    assert find_runtime(hass) is entry.runtime_data

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    # And took it back: Home Assistant *deletes* the attribute, which is the one
    # thing only a real core can be asked to prove.
    assert not hasattr(entry, "runtime_data")
    assert find_runtime(hass) is None


async def test_unloaded_entry_leaves_the_ws_api_refusing(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """An entry that owns nothing serves nothing — the reload window, held open.

    A reload is this state followed by a setup, so what a command meets here is
    what it meets mid-reload.
    """

    entry = await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Screwdriver"})
    assert (await client.receive_json())["success"] is True

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    # Still dispatched — Home Assistant has no API to unregister a command — and
    # answering the contract's storage_error rather than serving dropped state.
    # A refused write must not reach the repository either: the list after the
    # setup below would show it.
    refusals = (
        {"type": "haventory/item/list"},
        {"type": "haventory/ping"},
        {"type": "haventory/item/create", "name": "Ghost"},
    )
    for msg_id, command in enumerate(refusals, start=2):
        await client.send_json({"id": msg_id, **command})
        refused = await client.receive_json()
        assert refused["success"] is False, refused
        assert refused["error"]["code"] == "storage_error", refused

    assert find_runtime(hass) is None

    # The second half of a reload puts it all back, inventory included.
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    await client.send_json({"id": 5, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]


async def test_a_command_during_teardown_is_refused_and_a_failed_flush_still_unloads(  # noqa: PLR0913, PLR0917 - one fixture per step
    hass: HomeAssistant,
    hass_storage: dict,
    caplog: pytest.LogCaptureFixture,
    setup_entry,
    ws_connect,
    fail_next_save,
) -> None:
    """While the unload flushes, the entry is no longer `LOADED` but its runtime is still there.

    The commands go through the loaded-entry lookup and the flush through the one
    that ignores entry state (`runtime.py`); were they swapped, the command below
    would write into an inventory that is being given up. A save that fails at
    that moment is logged at ERROR and the unload still completes.
    """

    entry = await setup_entry()
    ws = await ws_connect()
    assert (await ws.send("haventory/item/create", name="Kept"))["success"] is True
    started, release = asyncio.Event(), asyncio.Event()
    fail_next_save(started=started, until=release)

    unload = asyncio.create_task(hass.config_entries.async_unload(entry.entry_id))
    await asyncio.wait_for(started.wait(), 5)
    assert entry.state is ConfigEntryState.UNLOAD_IN_PROGRESS
    refused = await asyncio.wait_for(ws.send("haventory/item/create", name="Ghost"), 5)
    release.set()

    assert await asyncio.wait_for(unload, 5)
    assert refused["error"]["code"] == "storage_error", refused
    assert entry.state is ConfigEntryState.NOT_LOADED
    stored = hass_storage[STORAGE_KEY]["data"]["items"]
    assert [item["name"] for item in stored.values()] == ["Kept"]
    failures = [r for r in caplog.records if "Failed to persist during teardown" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.ERROR]


async def test_disabled_entry_refuses_like_a_removed_one(
    hass: HomeAssistant, caplog: pytest.LogCaptureFixture, setup_entry, ws_connect
) -> None:
    """Disabling is the case with no setup coming to end it.

    The dashboard's connection outlives the entry, and its close callbacks fire
    whenever the tab goes, long after the runtime they would look up is gone.
    """

    entry = await setup_entry()
    ws = await ws_connect()
    await ws.subscribe("items")

    await hass.config_entries.async_set_disabled_by(entry.entry_id, ConfigEntryDisabler.USER)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    refused = await ws.send("haventory/item/create", name="Ghost")
    assert refused["error"]["code"] == "storage_error", refused
    assert [event["action"] for event in ws.events("items")] == ["unavailable"]

    caplog.clear()
    await ws.socket.close()
    await hass.async_block_till_done()
    assert not [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]


async def test_reload_tells_an_open_subscriber_and_lets_it_re_subscribe(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """The whole loop a dashboard left open goes through, over one connection.

    The connection outlives the config entry, so the subscription it opened is
    the one thing a reload breaks without any error reaching the client: no
    further event would arrive and nothing would say why. The teardown signal is
    what turns that into something a card can act on.
    """

    first_sub, second_sub = 10, 12

    entry = await setup_entry()
    client = await hass_ws_client(hass)
    await _subscribe(client, first_sub)

    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED

    # Delivered on the subscription's own id, so a client with several topics
    # open knows which one stopped.
    signal = await client.receive_json()
    assert signal["type"] == "event", signal
    assert signal["id"] == first_sub
    assert signal["event"] == {
        "domain": DOMAIN,
        "topic": "items",
        "action": "unavailable",
        "ts": signal["event"]["ts"],
    }

    # The old subscription is gone with the entry that served it...
    await client.send_json({"id": 11, "type": "haventory/item/create", "name": "Before"})
    assert (await client.receive_json())["success"] is True

    # ...and re-opening it is all the card has to do to be live again.
    await _subscribe(client, second_sub)
    await client.send_json({"id": 13, "type": "haventory/item/create", "name": "After"})

    # The broadcast is written before the command's own result, so take both
    # frames and sort them out by type rather than by arrival order.
    frames = [await client.receive_json(), await client.receive_json()]
    result = next(f for f in frames if f["type"] == "result")
    event = next(f for f in frames if f["type"] == "event")
    assert result["success"] is True, result
    assert event["id"] == second_sub, event
    assert event["event"]["action"] == "created"
    assert event["event"]["item"]["name"] == "After"


async def test_reload_keeps_the_inventory(hass: HomeAssistant, hass_ws_client, setup_entry) -> None:
    """Teardown flushes and setup reads it back, so a reload loses nothing."""

    entry = await setup_entry()
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Hammer"})
    assert (await client.receive_json())["success"] is True

    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    await client.send_json({"id": 2, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Hammer"]


async def test_removed_entry_leaves_the_ws_api_refusing(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """A dashboard left open cannot go on reading or writing a removed inventory."""

    entry = await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Screwdriver"})
    assert (await client.receive_json())["success"] is True

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()

    # Still dispatched — Home Assistant has no API to unregister a command — and
    # answering the contract's storage_error rather than serving dropped state.
    await client.send_json({"id": 2, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is False, listed
    assert listed["error"]["code"] == "storage_error", listed

    await client.send_json({"id": 3, "type": "haventory/item/create", "name": "Ghost"})
    created = await client.receive_json()
    assert created["success"] is False, created
    assert created["error"]["code"] == "storage_error", created

    assert find_runtime(hass) is None


async def test_re_adding_a_removed_entry_restores_the_inventory(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Removal keeps the store file, so adding the integration again brings it back."""

    entry = await setup_entry()
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Screwdriver"})
    assert (await client.receive_json())["success"] is True

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    await setup_entry()

    await client.send_json({"id": 2, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]


@pytest.mark.parametrize(
    ("options", "title", "pills"),
    [
        pytest.param({}, DEFAULT_CARD_TITLE, None, id="never_configured"),
        # No pills is a choice: it arrives as [], not as the null of "never chose".
        pytest.param(
            {CONF_CARD_TITLE: "Pantry", CONF_QUICK_FILTERS: []}, "Pantry", [], id="chosen"
        ),
        # An upgraded entry still carries the options of a retired rate limiter;
        # setup reads its keys by name, so those load and do nothing.
        pytest.param(
            {CONF_CARD_TITLE: "Pantry", "rate_limit_enabled": True, "rate_limit_commands_burst": 1},
            "Pantry",
            None,
            id="retired_keys",
        ),
    ],
)
async def test_config_reports_the_entry_options(
    setup_entry, ws_connect, options, title, pills
) -> None:
    """The card gets its title and pill choice from the entry's options."""

    await setup_entry(options)
    ws = await ws_connect()

    res = await ws.send("haventory/config")

    assert res["result"]["card_title"] == title
    assert res["result"]["quick_filters"] == pills


async def test_the_reads_the_card_makes_before_it_renders(setup_entry, ws_connect) -> None:
    """ping, version, config, stats and health answer with what the card relies on."""

    repo = Repository()
    repo.create_item({"name": "Hammer", "status": "missing"})
    repo.create_item({"name": "Saw"})
    await setup_entry(stored=repo)
    ws = await ws_connect()

    ping = (await ws.send("haventory/ping", echo={"hello": "world"}))["result"]
    assert ping["echo"] == {"hello": "world"}
    assert ping["ts"]

    version = (await ws.send("haventory/version"))["result"]
    assert version["integration_version"] == INTEGRATION_VERSION
    assert int(version["schema_version"]) == CURRENT_SCHEMA_VERSION

    config = (await ws.send("haventory/config"))["result"]
    assert config["statuses"] == [
        {"slug": "ok", "label": "OK", "order": 0, "color": "green", "icon": "check"},
        {"slug": "missing", "label": "Missing", "order": 1, "color": "amber", "icon": "alert"},
        {
            "slug": "needs_repair",
            "label": "Needs repair",
            "order": 2,
            "color": "amber",
            "icon": "wrench",
        },
    ]
    media = config["media"]
    assert media["picture_mime_types"] == list(ATTACHMENT_PICTURE_MIME_TYPES)
    assert media["manual_mime_types"] == list(ATTACHMENT_MANUAL_MIME_TYPES)
    assert media["max_pictures_per_item"] == MAX_PICTURES_PER_ITEM
    assert media["max_manuals_per_item"] == MAX_MANUALS_PER_ITEM
    assert media["max_attachment_bytes"] == MAX_ATTACHMENT_BYTES
    # SVG carries script and the attachment view serves from the HA origin.
    assert "image/svg+xml" not in media["picture_mime_types"]

    stats = (await ws.send("haventory/stats"))["result"]
    assert stats["status_counts"] == {"ok": 1, "missing": 1, "needs_repair": 0}
    assert stats["missing_count"] == 1

    health = (await ws.send("haventory/health"))["result"]
    assert set(health) == {"healthy", "issues", "counts"}
    assert health["healthy"] is True
    assert health["issues"] == []
