"""A log record's context reaches its rendered message, and no module logs around the adapter."""

from __future__ import annotations

import ast
import inspect
import logging
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
from custom_components.haventory.logs import ContextLogger, context_logger, render_context

LONG = "x" * 500
PACKAGE = Path(__file__).resolve().parents[1] / "custom_components" / "haventory"


@pytest.mark.parametrize(
    ("context", "check"),
    [
        pytest.param(
            {"op": "persist_complete", "elapsed_ms": 12},
            lambda r: r == "op=persist_complete elapsed_ms=12",
            id="key-value-pairs",
        ),
        # `op` is the field a maintainer greps for, and it says what the rest is about.
        pytest.param(
            {"generation": 7, "op": "persist_start"},
            lambda r: r.startswith("op=persist_start"),
            id="op-leads",
        ),
        # A reader splits the tail on spaces and then on the first `=`.
        pytest.param(
            {"item_name": "Photo Album #0318", "note": "", "key": "a=b"},
            lambda r: 'item_name="Photo Album #0318"' in r and 'note=""' in r and 'key="a=b"' in r,
            id="scan-breaking-values-quoted",
        ),
        pytest.param(
            {"path": LONG},
            lambda r: len(r.split("=", 1)[1]) < len(LONG) and r.endswith("…"),
            id="long-value-truncated",
        ),
    ],
)
def test_render_context(context: Mapping[str, Any], check: Callable[[str], bool]) -> None:
    rendered = render_context(context)

    assert check(rendered), rendered


@pytest.mark.parametrize(
    ("log", "expected"),
    [
        # With args, `logging` formats the joined text; the value must not be read.
        pytest.param(
            lambda lg: lg.error(
                "Failed to load %s", "item", extra={"op": "x", "item_id": "50%s off %d"}
            ),
            'Failed to load item op=x item_id="50%s off %d"',
            id="percent-with-args",
        ),
        # Unescaped, `%s` in the value would consume an arg and shift the rest.
        pytest.param(
            lambda lg: lg.warning("%s then %s", "a", "b", extra={"key": "%s"}),
            "a then b key=%s",
            id="directive-cannot-take-args",
        ),
        pytest.param(
            lambda lg: lg.info("%(what)s loaded", {"what": "item"}, extra={"key": "%(what)s"}),
            "item loaded key=%(what)s",
            id="percent-with-mapping-args",
        ),
        # Without args nothing formats the text, so nothing may be doubled.
        pytest.param(
            lambda lg: lg.info("Swept", extra={"op": "sweep", "ratio": "50%"}),
            "Swept op=sweep ratio=50%",
            id="percent-printed-once-without-args",
        ),
        # Each level method reaches the one place that joins the tail.
        *(
            pytest.param(
                lambda lg, method=method: getattr(lg, method)("Saw %s", "x", extra={"key": "5%d"}),
                "Saw x key=5%d",
                id=f"level-{method}",
            )
            for method in ("debug", "info", "warning", "error", "critical", "exception")
        ),
        pytest.param(
            lambda lg: lg.log(logging.INFO, "Saw %s", "x", extra={"key": "5%d"}),
            "Saw x key=5%d",
            id="numeric-level",
        ),
        pytest.param(
            lambda lg: lg.debug("Nothing attached"),
            "Nothing attached",
            id="no-context-left-alone",
        ),
    ],
)
def test_a_percent_in_a_value_is_carried_through(
    caplog: pytest.LogCaptureFixture, log: Callable[[ContextLogger], None], expected: str
) -> None:
    caplog.set_level(logging.DEBUG)

    log(context_logger("custom_components.haventory.test"))

    assert caplog.records[-1].getMessage() == expected


def test_the_extra_mapping_is_handed_on_untouched(caplog) -> None:
    """A structured handler still gets the fields; the text is the addition."""

    caplog.set_level(logging.DEBUG)
    logger = context_logger("custom_components.haventory.test")

    logger.debug("Persisted", extra={"op": "persist_complete", "ms": "3"})

    record = caplog.records[-1]
    assert record.getMessage() == "Persisted op=persist_complete ms=3"
    assert record.op == "persist_complete"
    assert record.ms == "3"


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


def test_every_module_logs_through_the_adapter() -> None:
    """The `logging.getLogger` sweep: one walk over the package source, one list of offenders.

    Read from the source, so a module counts whether or not anything imports
    it. A log context is told apart by its `op` key, which every one carries and no
    WebSocket event payload does: those name their domain on the wire.
    """

    offenders = []
    for path in sorted(PACKAGE.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Dict):
                keys = {key.value for key in node.keys if isinstance(key, ast.Constant)}
                if {"op", "domain"} <= keys:
                    offenders.append(
                        f"{path.name}:{node.lineno}: log context carries `domain`;"
                        " the logger name already says it"
                    )
        if path.name == "logs.py":
            continue
        lines = source.splitlines()
        for number, line in enumerate(lines, start=1):
            if "logging.getLogger(" in line:
                offenders.append(
                    f"{path.name}:{number}: logging.getLogger loses the module's context;"
                    " use logs.context_logger(__name__)"
                )
        if "context_logger(__name__)" not in source:
            first = next((n for n, line in enumerate(lines, 1) if "LOGGER." in line), None)
            if first is not None:
                offenders.append(
                    f"{path.name}:{first}: logs without a logger from context_logger(__name__)"
                )

    assert offenders == []
