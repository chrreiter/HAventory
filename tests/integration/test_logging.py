"""Integration: the context survives a real Home Assistant log record.

The offline suite reads `record.getMessage()` off a stub-driven call. What only a
real core shows is that the fields are still there after Home Assistant's own
logging setup has had the record — that nothing in its handler chain, its
formatter or its filters puts them back where they were.
"""

from __future__ import annotations

import logging

from custom_components.haventory.const import DOMAIN
from homeassistant.core import HomeAssistant


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


async def test_a_refusal_logs_the_operation_it_refused(
    hass: HomeAssistant, hass_ws_client, caplog, setup_entry
) -> None:
    """The other half: a rejection says which command it was, in the message.

    The taxonomy already logs every rejection once with the same structured
    context the envelope carries; this is that context arriving where somebody
    reading the log can see it.
    """

    await setup_entry()
    client = await hass_ws_client(hass)
    caplog.clear()
    caplog.set_level(logging.WARNING, logger="custom_components.haventory.ws")

    await client.send_json({"id": 1, "type": "haventory/item/get", "item_id": "nope"})
    result = await client.receive_json()
    assert result["success"] is False
    assert result["error"]["code"] == "not_found"

    refusals = [r.getMessage() for r in caplog.records if "op=item_get" in r.getMessage()]
    assert refusals, [r.getMessage() for r in caplog.records]
    assert "item_id=nope" in refusals[-1]


async def test_the_setup_line_carries_the_numbers_a_boot_is_diagnosed_from(
    hass: HomeAssistant, caplog, setup_entry
) -> None:
    """The line an operator reads first after a start-up that looks wrong."""

    caplog.set_level(logging.DEBUG, logger="custom_components.haventory")
    await setup_entry()

    health = [r.getMessage() for r in caplog.records if "Storage health" in r.getMessage()]

    assert health, [r.getMessage() for r in caplog.records][-10:]
    assert "op=setup_storage_health" in health[-1]
    assert "schema_version=" in health[-1]
    assert "items_count=" in health[-1]
    # Once each: the numbers are context, not part of the message text.
    assert health[-1].count("schema_version=") == 1
