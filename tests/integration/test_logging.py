"""Integration: what a person reading a pasted Home Assistant log depends on.

The line names the operation it is about, its level says whether anyone has to
act, and a traceback appears only where it adds something. The fields also have
to survive Home Assistant's own logging chain.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest
from custom_components.haventory import ops as ops_module
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.ops import OPS
from custom_components.haventory.repository import Repository
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

WS_LOGGER = "custom_components.haventory.ws"
SERVICES_LOGGER = "custom_components.haventory.services"
BULK_ROW_OP = "items_bulk_op_failed"
GHOST_ID = "00000000-0000-4000-8000-000000000000"


def _boom(*_args: Any, **_kwargs: Any) -> Any:
    raise RuntimeError("boom")


async def _item_id(ws) -> str:
    return (await ws.send("haventory/item/create", name="Drill"))["result"]["id"]


# (name, logger, op in the line, level, traceback, further context the line carries).
# Each is provoked by `_provoke`.
LINES = [
    ("ws_validation", WS_LOGGER, "item_set_quantity", logging.WARNING, False, ""),
    ("ws_not_found", WS_LOGGER, "item_get", logging.WARNING, False, "item_id=nope"),
    ("ws_conflict", WS_LOGGER, "item_update", logging.WARNING, False, ""),
    ("ws_storage", WS_LOGGER, "item_create", logging.ERROR, True, ""),
    ("ws_unknown", WS_LOGGER, "item_create", logging.ERROR, True, ""),
    ("ws_not_loaded", WS_LOGGER, "item_create", logging.WARNING, False, ""),
    ("bulk_conflict", WS_LOGGER, BULK_ROW_OP, logging.WARNING, False, ""),
    ("bulk_unknown", WS_LOGGER, BULK_ROW_OP, logging.ERROR, True, ""),
    ("service_conflict", SERVICES_LOGGER, "item_update", logging.WARNING, False, ""),
    ("service_storage", SERVICES_LOGGER, "item_create", logging.ERROR, True, ""),
    ("service_not_loaded", SERVICES_LOGGER, "item_create", logging.WARNING, False, ""),
    (
        "service_move_unknown",
        SERVICES_LOGGER,
        "item_move",
        logging.WARNING,
        False,
        f"item_id={GHOST_ID} new_location_id=shelf-9",
    ),
    ("service_blank_name", SERVICES_LOGGER, "item_create", logging.WARNING, False, "item_name="),
]


async def _provoke(  # noqa: PLR0912, PLR0913, PLR0917 - a branch per row, one input per thing a row may touch
    case, hass, entry, ws, item_id, call_service, fail_next_save, monkeypatch
):
    """Do the one thing that makes the integration log `case`."""

    bulk = {"op_id": "r1", "kind": "item_update", "payload": {"item_id": item_id}}
    match case:
        case "ws_validation":
            await ws.send("haventory/item/set_quantity", item_id=item_id, quantity=-1)
        case "ws_not_found":
            await ws.send("haventory/item/get", item_id="nope")
        case "ws_conflict":
            await ws.send("haventory/item/update", item_id=item_id, expected_version=999)
        case "ws_storage":
            fail_next_save()
            await ws.send("haventory/item/create", name="X")
        case "ws_unknown":
            monkeypatch.setattr(ops_module, "serialize_item", _boom)
            await ws.send("haventory/item/create", name="X")
        case "ws_not_loaded":
            await hass.config_entries.async_unload(entry.entry_id)
            await ws.send("haventory/item/create", name="X")
        case "bulk_conflict":
            bulk["payload"]["expected_version"] = 999
            await ws.send("haventory/items/bulk", operations=[bulk])
        case "bulk_unknown":
            monkeypatch.setitem(OPS, "item_update", _boom)
            await ws.send("haventory/items/bulk", operations=[bulk])
        case "service_conflict":
            with pytest.raises(HomeAssistantError):
                await call_service("item_update", item_id=item_id, expected_version=999, name="X")
        case "service_storage":
            fail_next_save()
            with pytest.raises(HomeAssistantError):
                await call_service("item_create", name="X")
        case "service_move_unknown":
            with pytest.raises(HomeAssistantError):
                await call_service("item_move", item_id=GHOST_ID, new_location_id="shelf-9")
        case "service_blank_name":
            with pytest.raises(HomeAssistantError):
                await call_service("item_create", name="   ")
        case "service_not_loaded":
            await hass.config_entries.async_unload(entry.entry_id)
            with pytest.raises(HomeAssistantError):
                await call_service("item_create", name="X")


@pytest.mark.parametrize(("case", "logger", "op", "level", "traceback", "says"), LINES)
async def test_a_refusal_is_one_line_naming_its_op_at_the_right_level(  # noqa: PLR0913, PLR0917
    case,
    logger,
    op,
    level,
    traceback,
    says,
    hass,
    caplog,
    monkeypatch,
    setup_entry,
    ws_connect,
    call_service,
    fail_next_save,
) -> None:
    """ERROR with a traceback only where someone must act; a retryable refusal is a WARNING."""

    entry = await setup_entry()
    ws = await ws_connect()
    item_id = await _item_id(ws)
    caplog.clear()
    caplog.set_level(logging.DEBUG, logger=logger)

    await _provoke(case, hass, entry, ws, item_id, call_service, fail_next_save, monkeypatch)

    lines = [r for r in caplog.records if r.name == logger and f"op={op}" in r.getMessage()]
    assert len(lines) == 1, [(r.name, r.getMessage()) for r in caplog.records]
    assert lines[0].levelno == level
    assert (lines[0].exc_info is not None) is traceback
    assert says in lines[0].getMessage()


async def test_a_service_mutation_logs_a_greppable_persist_line(
    hass: HomeAssistant, caplog, setup_entry
) -> None:
    """`grep persist_complete` on a user's log finds the line, and its timing."""

    caplog.set_level(logging.DEBUG, logger="custom_components.haventory.storage")
    await setup_entry()

    await hass.services.async_call(DOMAIN, "item_create", {"name": "Torch"}, blocking=True)
    await hass.async_block_till_done()

    formatter = logging.Formatter("%(levelname)s [%(name)s] %(message)s")
    rendered = [formatter.format(record) for record in caplog.records]
    complete = [line for line in rendered if "op=persist_complete" in line]

    assert complete, rendered[-10:]
    assert "elapsed_ms=" in complete[-1]
    # The name is what a user filters on, and it is still the module's own.
    assert "[custom_components.haventory.storage]" in complete[-1]


def _populated() -> Repository:
    repo = Repository()
    garage = repo.create_location(name="Garage")
    repo.create_item({"name": "Drill", "location_id": str(garage.id)})
    return repo


@pytest.mark.parametrize(
    ("stored", "counts"),
    [
        pytest.param(None, "items_count=0 locations_count=0", id="fresh_install"),
        pytest.param(_populated, "items_count=1 locations_count=1", id="populated"),
    ],
)
async def test_the_setup_line_carries_the_numbers_a_boot_is_diagnosed_from(
    hass: HomeAssistant, caplog, setup_entry, stored, counts
) -> None:
    """The line an operator reads first after a start-up that looks wrong.

    DEBUG, and nothing at WARNING beside it: every fresh install boots empty, and
    Home Assistant shows WARNING with no logger configured, so a new household's
    first line about HAventory must not be a warning about nothing.
    """

    caplog.set_level(logging.DEBUG, logger="custom_components.haventory")
    await setup_entry(stored=stored() if stored else None)

    health = [r for r in caplog.records if "Storage health" in r.getMessage()]

    assert [r.levelno for r in health] == [logging.DEBUG], [r.getMessage() for r in caplog.records]
    message = health[0].getMessage()
    assert "op=setup_storage_health" in message
    assert counts in message
    # Once each: the numbers are context, not part of the message text.
    assert message.count("schema_version=") == 1
    assert not [
        r.getMessage()
        for r in caplog.records
        if r.name.startswith("custom_components.haventory") and r.levelno >= logging.WARNING
    ]
