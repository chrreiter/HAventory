"""Offline tests: the context a record carries reaches the rendered message.

Home Assistant's formatter renders the message and drops `extra=`, so every
field this integration attached was invisible in the one place it is wanted — a
log pasted into a bug report. These cover the rendering, the fields that have to
survive it, and the sweep that keeps a new module from quietly opting out.
"""

from __future__ import annotations

import ast
import inspect
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
    rendered = render_context({"op": "persist_complete", "elapsed_ms": 12})

    assert rendered == "op=persist_complete elapsed_ms=12"


def test_op_leads_wherever_it_was_written() -> None:
    """It is the field a maintainer greps for, and it says what the rest is about."""

    rendered = render_context({"generation": 7, "op": "persist_start"})

    assert rendered.startswith("op=persist_start")


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

    logger.debug("Persisted", extra={"op": "persist_complete", "ms": "3"})

    record = caplog.records[-1]
    assert record.getMessage() == "Persisted op=persist_complete ms=3"
    assert record.op == "persist_complete"
    assert record.ms == "3"


def test_a_percent_in_a_value_survives_a_call_with_args(caplog) -> None:
    """With args, `logging` formats the joined text; the value must not be read."""

    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.error("Failed to load %s", "item", extra={"op": "x", "item_id": "50%s off %d"})

    assert caplog.records[-1].getMessage() == 'Failed to load item op=x item_id="50%s off %d"'


def test_a_format_directive_in_a_value_cannot_take_the_args(caplog) -> None:
    """Unescaped, `%s` in the value would consume an arg and shift the rest."""

    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.warning("%s then %s", "a", "b", extra={"key": "%s"})

    assert caplog.records[-1].getMessage() == "a then b key=%s"


def test_a_percent_in_a_value_survives_mapping_args(caplog) -> None:
    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.info("%(what)s loaded", {"what": "item"}, extra={"key": "%(what)s"})

    assert caplog.records[-1].getMessage() == "item loaded key=%(what)s"


def test_a_percent_in_a_value_is_printed_once_without_args(caplog) -> None:
    """Without args nothing formats the text, so nothing may be doubled."""

    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.info("Swept", extra={"op": "sweep", "ratio": "50%"})

    assert caplog.records[-1].getMessage() == "Swept op=sweep ratio=50%"


@pytest.mark.parametrize("method", ["debug", "info", "warning", "error", "critical", "exception"])
def test_every_level_carries_a_percent_through(caplog, method: str) -> None:
    """Each level method reaches the one place that joins the tail."""

    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    getattr(logger, method)("Saw %s", "x", extra={"key": "5%d"})

    assert caplog.records[-1].getMessage() == "Saw x key=5%d"


def test_a_level_given_as_a_number_carries_a_percent_through(caplog) -> None:
    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.log(logging.INFO, "Saw %s", "x", extra={"key": "5%d"})

    assert caplog.records[-1].getMessage() == "Saw x key=5%d"


def test_the_record_points_at_the_caller_not_the_adapter(caplog) -> None:
    """Home Assistant's system log shows the file and line a record names."""

    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.info("Here", extra={"op": "x"})
    line = inspect.currentframe().f_lineno - 1  # type: ignore[union-attr]

    record = caplog.records[-1]
    assert (record.pathname, record.lineno) == (__file__, line)
    assert record.funcName == "test_the_record_points_at_the_caller_not_the_adapter"


def test_a_disabled_level_records_nothing(caplog) -> None:
    caplog.set_level(logging.INFO)
    logger = context_logger("custom_components.haventory.test")

    logger.debug("Quiet %s", "x", extra={"op": "x"})

    assert caplog.records == []


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


def test_no_module_takes_a_logger_around_the_adapter() -> None:
    """`logging.getLogger` anywhere but `logs.py` loses that module's context.

    Read from the source rather than by importing: several modules pull in Home
    Assistant packages the offline stubs deliberately do not provide.
    """

    offenders = []
    for path in sorted(PACKAGE.glob("*.py")):
        if path.name == "logs.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "logging.getLogger(" in line:
                offenders.append(f"{path.name}:{number}: {line.strip()}")

    assert offenders == [], "take the logger from logs.context_logger(__name__) instead"


def test_no_log_context_carries_the_domain() -> None:
    """The logger name already says which integration wrote the line.

    A log context is told apart by its `op` key, which every one carries and no
    WebSocket event payload does: those name their domain on the wire, as part
    of the contract.
    """

    offenders = []
    for path in sorted(PACKAGE.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Dict):
                continue
            keys = {key.value for key in node.keys if isinstance(key, ast.Constant)}
            if {"op", "domain"} <= keys:
                offenders.append(f"{path.name}:{node.lineno}")

    assert offenders == [], "drop `domain` from the context; the logger name carries it"


def test_every_module_that_logs_has_a_logger_from_the_adapter() -> None:
    """The other half: a module that logs at all takes its logger from here."""

    for path in sorted(PACKAGE.glob("*.py")):
        if path.name == "logs.py":
            continue
        source = path.read_text(encoding="utf-8")
        if "LOGGER." not in source:
            continue
        assert "context_logger(__name__)" in source, path.name


def test_the_logger_keeps_the_module_name_it_was_asked_for() -> None:
    """The name is what a user filters on in Settings → System → Logs."""

    logger = context_logger("custom_components.haventory.storage")

    assert isinstance(logger, ContextLogger)
    assert logger.logger.name == "custom_components.haventory.storage"


@pytest.mark.parametrize("field", GREPPABLE)
def test_the_fields_a_bug_report_is_asked_for_render(field: str) -> None:
    """Named one by one, so dropping one from the rendering is a failure."""

    assert f"{field}=" in render_context({field: "value"})
