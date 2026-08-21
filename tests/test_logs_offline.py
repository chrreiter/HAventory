"""Offline tests: the context a record carries reaches the rendered message.

Home Assistant's formatter renders the message and drops `extra=`, so every
field this integration attached was invisible in the one place it is wanted — a
log pasted into a bug report. These cover the rendering, the fields that have to
survive it, and the sweep that keeps a new module from quietly opting out.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from custom_components.haventory import storage as storage_mod
from custom_components.haventory.logs import ContextLogger, context_logger, render_context
from homeassistant.core import HomeAssistant

from runtime_helpers import install_runtime, repo_of

PACKAGE = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"

# The fields a maintainer asks a bug report for, per #430.
GREPPABLE = ("op", "elapsed_ms", "storage_key", "schema_version", "from_version")


def test_the_context_becomes_key_value_pairs_after_the_message() -> None:
    rendered = render_context({"domain": "haventory", "op": "persist_complete", "elapsed_ms": 12})

    assert rendered == "op=persist_complete elapsed_ms=12"


def test_op_leads_wherever_it_was_written() -> None:
    """It is the field a maintainer greps for, and it says what the rest is about."""

    rendered = render_context({"generation": 7, "op": "persist_start", "domain": "haventory"})

    assert rendered.startswith("op=persist_start")


def test_the_domain_is_left_out_because_the_logger_name_already_says_it() -> None:
    assert render_context({"domain": "haventory"}) == ""


def test_a_value_that_would_break_the_scan_is_quoted() -> None:
    """A reader splits the tail on spaces and then on the first `=`."""

    rendered = render_context({"item_name": "Photo Album #0318", "note": "", "key": "a=b"})

    assert 'item_name="Photo Album #0318"' in rendered
    assert 'note=""' in rendered
    assert 'key="a=b"' in rendered


def test_a_long_value_cannot_push_the_message_off_the_line() -> None:
    rendered = render_context({"path": "x" * 500})

    value = rendered.split("=", 1)[1]
    assert len(value) < len("x" * 500)
    assert value.endswith("…")


def test_a_record_with_no_context_is_left_alone(caplog) -> None:
    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.debug("Nothing attached")

    assert [record.getMessage() for record in caplog.records] == ["Nothing attached"]


def test_the_extra_mapping_is_handed_on_untouched(caplog) -> None:
    """A structured handler still gets the fields; the text is the addition."""

    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.debug("Persisted", extra={"domain": "haventory", "op": "persist_complete", "ms": 3})

    record = caplog.records[-1]
    assert record.getMessage() == "Persisted op=persist_complete ms=3"
    assert record.op == "persist_complete"
    assert record.domain == "haventory"


@pytest.mark.asyncio
async def test_a_real_persist_writes_its_op_and_elapsed_ms_into_the_message(caplog) -> None:
    """#430's acceptance: `grep persist_complete` finds a line, with the timing on it.

    The measurement this was found by needed the median of `elapsed_ms`, and
    getting it meant editing `storage.py` inside a running container.
    """

    caplog.set_level(logging.DEBUG)
    hass = HomeAssistant()
    install_runtime(hass)
    repo_of(hass).create_item({"name": "Torch"})  # type: ignore[arg-type]

    await storage_mod.async_persist_repo(hass)

    messages = [record.getMessage() for record in caplog.records]
    complete = [message for message in messages if "op=persist_complete" in message]
    assert complete, messages
    assert "elapsed_ms=" in complete[0]
    assert any("op=persist_start" in message for message in messages)


def test_every_module_logger_goes_through_the_adapter() -> None:
    """A module taking `logging.getLogger` directly loses its context silently.

    Read from the source rather than by importing: several modules pull in Home
    Assistant packages the offline stubs deliberately do not provide.
    """

    offenders = []
    for path in sorted(PACKAGE.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        for line in source.splitlines():
            if line.startswith(("LOGGER = ", "_LOGGER = ")) and "context_logger" not in line:
                offenders.append(f"{path.name}: {line.strip()}")

    assert offenders == []


def test_the_logger_keeps_the_module_name_it_was_asked_for() -> None:
    """The name is what a user filters on in Settings → System → Logs."""

    logger = context_logger("custom_components.haventory.storage")

    assert isinstance(logger, ContextLogger)
    assert logger.logger.name == "custom_components.haventory.storage"


@pytest.mark.parametrize("field", GREPPABLE)
def test_the_fields_a_bug_report_is_asked_for_render(field: str) -> None:
    """Named one by one, so dropping one from the rendering is a failure."""

    assert f"{field}=" in render_context({"domain": "haventory", field: "value"})
