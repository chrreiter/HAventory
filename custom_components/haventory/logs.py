"""Making the context a log line carries reach the log.

Home Assistant's log formatter renders the message and its `%`-args and drops
everything else, so the `extra=` context every module attaches would never reach
a pasted log. `context_logger` is a `LoggerAdapter` that appends that mapping to
the message as `key=value` pairs and passes `extra=` on unchanged:

    Repository persisted successfully op=persist_complete elapsed_ms=12

`domain` is left out of the text: the logger name already carries it.
"""

from __future__ import annotations

import logging
from collections.abc import MutableMapping
from typing import Any

# Long enough for a path, a URL or a store key; short enough that one field
# cannot push the message itself off the readable part of a line.
_MAX_VALUE_CHARS = 160

# Rendered from the logger name on every record already.
_SKIPPED_FIELDS = frozenset({"domain"})

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


def render_context(context: MutableMapping[str, Any]) -> str:
    """The `key=value` tail for one record's context, `op` first."""

    fields = [(key, value) for key, value in context.items() if key not in _SKIPPED_FIELDS]
    fields.sort(key=lambda pair: pair[0] != "op")
    return " ".join(f"{key}={_render_value(value)}" for key, value in fields)


class ContextLogger(logging.LoggerAdapter):  # type: ignore[type-arg]
    """A logger whose `extra=` context is also written into the message."""

    def process(
        self, msg: Any, kwargs: MutableMapping[str, Any]
    ) -> tuple[Any, MutableMapping[str, Any]]:
        """Append the context to the message, and pass `extra=` on unchanged."""

        context = kwargs.get("extra")
        if not isinstance(context, MutableMapping):
            return msg, kwargs
        tail = render_context(context)
        return (f"{msg} {tail}" if tail else msg), kwargs


def context_logger(name: str) -> ContextLogger:
    """The logger a module should use. Same underlying logger, same name."""

    return ContextLogger(logging.getLogger(name), {})
