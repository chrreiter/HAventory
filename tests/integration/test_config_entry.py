"""Integration: config entry lifecycle against a real Home Assistant core.

Verifies the integration sets up and tears down cleanly through the real
``hass.config_entries`` machinery — the path the offline stubs can't exercise.
Teardown especially: the offline stub takes our handlers back out of its fake
command registry on unload, which real Home Assistant has no API for, so only
here can "the commands are still registered and refuse" be told apart from "the
commands are gone".

The reload tests are the reason this file talks to a real WebSocket rather than
calling handlers: unload, setup and the subscription registry all move under one
connection that outlives them, and that interleaving is exactly what the stubs
cannot reproduce.
"""

from __future__ import annotations

import pytest
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CONF_SIDEBAR_PANEL_ENABLED,
    DOMAIN,
)
from custom_components.haventory.repository import Repository
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType, InvalidData
from pytest_homeassistant_custom_component.common import MockConfigEntry


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


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
    # Setup wired the runtime data structures into hass.data.
    bucket = hass.data[DOMAIN]
    assert "store" in bucket
    assert isinstance(bucket["repository"], Repository)

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    # Ephemeral registration flags are cleared on unload.
    assert hass.data[DOMAIN].get("ws_registered") is None


async def test_unloaded_entry_leaves_the_ws_api_refusing(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """An entry that owns nothing serves nothing — the reload window, held open.

    A reload is this state followed by a setup, so what a command meets here is
    what it meets mid-reload.
    """

    entry = await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Screwdriver"})
    assert (await client.receive_json())["success"] is True

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    # Still dispatched — Home Assistant has no API to unregister a command — and
    # answering the contract's storage_error rather than serving dropped state.
    for msg_id, command in enumerate(("haventory/item/list", "haventory/ping"), start=2):
        await client.send_json({"id": msg_id, "type": command})
        refused = await client.receive_json()
        assert refused["success"] is False, refused
        assert refused["error"]["code"] == "storage_error", refused

    assert hass.data[DOMAIN].get("repository") is None

    # The second half of a reload puts it all back, inventory included.
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    await client.send_json({"id": 4, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]


async def test_disabled_entry_refuses_like_a_removed_one(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """Disabling is the case with no setup coming to end it."""

    entry = await _setup(hass)
    client = await hass_ws_client(hass)

    await hass.config_entries.async_set_disabled_by(entry.entry_id, ConfigEntryDisabler.USER)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Ghost"})
    refused = await client.receive_json()
    assert refused["success"] is False, refused
    assert refused["error"]["code"] == "storage_error", refused


async def test_reload_tells_an_open_subscriber_and_lets_it_re_subscribe(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """The whole loop a dashboard left open goes through, over one connection.

    The connection outlives the config entry, so the subscription it opened is
    the one thing a reload breaks without any error reaching the client: no
    further event would arrive and nothing would say why. The teardown signal is
    what turns that into something a card can act on.
    """

    first_sub, second_sub = 10, 12

    entry = await _setup(hass)
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


async def test_reload_keeps_the_inventory(hass: HomeAssistant, hass_ws_client) -> None:
    """Teardown flushes and setup reads it back, so a reload loses nothing."""

    entry = await _setup(hass)
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
    hass: HomeAssistant, hass_ws_client
) -> None:
    """A dashboard left open cannot go on reading or writing a removed inventory."""

    entry = await _setup(hass)
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

    assert hass.data[DOMAIN].get("repository") is None


async def test_re_adding_a_removed_entry_restores_the_inventory(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """Removal keeps the store file, so adding the integration again brings it back."""

    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Screwdriver"})
    assert (await client.receive_json())["success"] is True

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    await _setup(hass)

    await client.send_json({"id": 2, "type": "haventory/item/list"})
    listed = await client.receive_json()
    assert listed["success"] is True, listed
    assert [item["name"] for item in listed["result"]["items"]] == ["Screwdriver"]


async def test_the_options_flow_stores_a_pill_choice_the_card_then_reads(
    hass: HomeAssistant, hass_ws_client
) -> None:
    """The pill picker is a real selector, and only real HA applies it.

    Offline the selector is a stand-in, so the shape of its config — the option
    list, `multiple`, the mode — is asserted nowhere else. This walks the whole
    path instead: the form Home Assistant builds, a submission through it, and
    what `haventory/config` then reports to the card.
    """

    entry = await _setup(hass)
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/config"})
    before = await client.receive_json()
    assert before["success"] is True, before
    # Nothing chosen yet: null, not an empty list — the card keeps every pill.
    assert before["result"]["quick_filters"] is None

    flow = await hass.config_entries.options.async_init(entry.entry_id)
    assert flow["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        flow["flow_id"],
        {
            CONF_CARD_TITLE: "HAventory",
            CONF_SIDEBAR_PANEL_ENABLED: True,
            CONF_QUICK_FILTERS: ["overdue", "low_stock"],
            "todo": {},
            "rate_limit": {},
        },
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    await hass.async_block_till_done()

    assert entry.options[CONF_QUICK_FILTERS] == ["low_stock", "overdue"]

    await client.send_json({"id": 2, "type": "haventory/config"})
    after = await client.receive_json()
    assert after["success"] is True, after
    assert after["result"]["quick_filters"] == ["low_stock", "overdue"]


async def test_the_options_flow_refuses_a_pill_it_does_not_offer(hass: HomeAssistant) -> None:
    """A name outside the five is rejected by the form, not stored and dropped later."""

    entry = await _setup(hass)

    flow = await hass.config_entries.options.async_init(entry.entry_id)
    with pytest.raises(InvalidData):
        await hass.config_entries.options.async_configure(
            flow["flow_id"],
            {
                CONF_CARD_TITLE: "HAventory",
                CONF_SIDEBAR_PANEL_ENABLED: True,
                CONF_QUICK_FILTERS: ["sideways"],
                "todo": {},
                "rate_limit": {},
            },
        )

    assert CONF_QUICK_FILTERS not in entry.options
