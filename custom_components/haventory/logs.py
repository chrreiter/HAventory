"""Making the context a log line carries reach the log.

Every module attaches structured context to its records — `op`, `elapsed_ms`,
the schema versions, `storage_key` — through `extra=`. Home Assistant's log
formatter renders the message and its `%`-args and drops everything else, so all
of it was invisible in the one place it is wanted: a log pasted into a bug
report. `grep persist_complete home-assistant.log` found nothing, because the
string only existed in a field nothing rendered.

`context_logger` is what every module takes its logger from. It is a
`LoggerAdapter` whose `process` folds the `extra=` mapping into the message text
and hands the same mapping on untouched, so a structured handler still sees the
fields and a plain reader finally does too. Nothing at the call sites changes:
they keep writing `_LOGGER.warning("...", extra={...})`.

The rendering is `key=value`, space separated, appended to the message — a shape
`grep` and `awk` both take apart:

    Repository persisted successfully op=persist_complete generation=7 elapsed_ms=12

`domain` is the one field left out of the text: every record already carries the
logger name it would repeat.
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
    """The `key=value` tail for one record's context, `op` first.

    `op` leads because it is the field a maintainer greps for and the one that
    says which operation the rest of the line is about.
    """

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
