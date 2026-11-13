"""Making the context a log line carries reach the log.

Home Assistant's log formatter renders the message and its `%`-args and drops
everything else, so the `extra=` context every module attaches would never reach
a pasted log. `context_logger` is a `LoggerAdapter` that appends that mapping to
the message as `key=value` pairs and passes `extra=` on unchanged:

    Repository persisted successfully op=persist_complete elapsed_ms=12

The tail is joined in `log`, where the call's `%`-args are visible, and its `%`
signs are doubled exactly when there are args for `logging` to format, so a
contributor keeps writing ordinary `%`-arg calls and no context value can be
read as a format directive.

No call passes `domain`: the logger name already says which integration wrote
the line.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

# Long enough for a path, a URL or a store key; short enough that one field
# cannot push the message itself off the readable part of a line.
_MAX_VALUE_CHARS = 160

# What a value has to contain before it needs quoting: anything that would break
# a reader splitting the tail on spaces and then on the first `=`.
_NEEDS_QUOTING = (" ", "\t", "\n", "=", '"')


def _render_value(value: Any) -> str:
    text = str(value)
    if len(text) > _MAX_VALUE_CHARS:
        text = text[: _MAX_VALUE_CHARS - 1] + "…"
    if any(char in text for char in _NEEDS_QUOTING) or text == "":
        return '"' + text.replace('"', "'").replace("\n", " ") + '"'
    return text


def render_context(context: Mapping[str, Any]) -> str:
    """The `key=value` tail for one record's context, `op` first."""

    fields = list(context.items())
    fields.sort(key=lambda pair: pair[0] != "op")
    return " ".join(f"{key}={_render_value(value)}" for key, value in fields)


class ContextLogger(logging.LoggerAdapter[logging.Logger]):
    """A logger whose `extra=` context is also written into the message."""

    def log(self, level: int, msg: Any, *args: Any, **kwargs: Any) -> None:
        """Append the context to the message, and pass `extra=` on unchanged.

        Overridden rather than `process`, which is never shown the args: with
        args, `logging` runs `msg % args` over the joined text, so a `%` in a
        value has to be doubled; without them it formats nothing, so doubling
        would print `%%`. The extra stack level keeps the record's file and line
        on the caller, not on this method.
        """

        if not self.isEnabledFor(level):
            return
        context = kwargs.get("extra")
        if isinstance(context, Mapping):
            tail = render_context(context)
            if tail:
                msg = f"{msg} {tail.replace('%', '%%') if args else tail}"
        kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + 1
        self.logger.log(level, msg, *args, **kwargs)


def context_logger(name: str) -> ContextLogger:
    """The logger a module should use. Same underlying logger, same name."""

    return ContextLogger(logging.getLogger(name), {})
