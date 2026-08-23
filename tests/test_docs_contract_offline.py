"""Hold `docs/backend_api_contract.md` to the code it describes.

Two claims in that document are lists of names the code owns, and both went stale
without anything noticing: the fields whose wrong type answers `invalid_format`
rather than `validation_error`, and the quick-filter vocabulary `haventory/config`
reports. A list nobody checks is a promise a client author reads once and builds
against, so each is compared here against its source of truth.

The field list is read back off the registered handlers rather than out of `ws.py`'s
text: `_ws_schema` is what the connection applies to a frame, so a field it types
`object` is exactly a field whose wrong type reaches the guard.

Scenarios:
- the contract's exception list names every concretely-typed command field, and no other
- the extractor reports a missing name rather than silently matching an empty list
- the contract's `quick_filters` vocabulary is `QUICK_FILTER_KEYS`
- the contract's `items/bulk` kinds are the subset of the op table a row may name
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from custom_components.haventory import ops, ws
from custom_components.haventory.const import QUICK_FILTER_KEYS

CONTRACT = Path(__file__).resolve().parents[1] / "docs" / "backend_api_contract.md"

#: The heading whose bullets enumerate the fields that keep a concrete schema type.
EXCEPTIONS_HEADING = "#### Which of the two answers a wrong type"

#: Fields the envelope carries rather than the command declaring them.
ENVELOPE_KEYS = frozenset({"id", "type"})


def _bulleted_names(markdown: str, heading: str) -> set[str]:
    """Collect the backticked field names from one section's bullet list.

    Only the bullets are read — whole bullets, so a name that wrapped onto the
    next line still counts — which leaves the prose around them free to name
    types and commands. A command path carries a ``/`` and so cannot be mistaken
    for a field name.
    """

    lines = markdown.splitlines()
    try:
        start = lines.index(heading) + 1
    except ValueError:
        raise AssertionError(f"{heading!r} is not in {CONTRACT.name}") from None

    names: set[str] = set()
    in_bullet = False
    for line in lines[start:]:
        if line.startswith("#"):
            break
        if line.startswith("- "):
            in_bullet = True
        elif not line.strip() or not line.startswith(" "):
            in_bullet = False
        if in_bullet:
            names.update(re.findall(r"`([a-z][a-z0-9_]*)`", line))
    return names


def _concretely_typed_fields() -> set[str]:
    """Every command field that is not typed ``object`` in its schema."""

    fields: set[str] = set()
    for name in dir(ws):
        schema = getattr(getattr(ws, name), "_ws_schema", None)
        if not schema:  # unregistered, or a command declaring nothing but its type
            continue
        mapping = schema.schema if hasattr(schema, "schema") else schema.validators[0].schema
        for marker, validator in mapping.items():
            key = str(marker)
            if key not in ENVELOPE_KEYS and validator is not object:
                fields.add(key)
    return fields


def test_contract_names_every_concretely_typed_field() -> None:
    """The `invalid_format` exception list is the code's, name for name."""

    documented = _bulleted_names(CONTRACT.read_text(encoding="utf-8"), EXCEPTIONS_HEADING)
    actual = _concretely_typed_fields()

    assert actual, "no concretely-typed fields found — the schemas were not read"
    assert documented == actual, (
        "docs/backend_api_contract.md and ws.py disagree about which fields answer "
        f"invalid_format. Only in the document: {sorted(documented - actual)}. "
        f"Only in the code: {sorted(actual - documented)}."
    )


def test_the_extractor_reports_a_missing_name() -> None:
    """A green run cannot mean "read no names".

    The comparison is only worth trusting if a document that has fallen behind
    fails it, so the extractor is run against one bullet with a name removed.
    """

    markdown = "\n".join(
        [
            EXCEPTIONS_HEADING,
            "",
            "Prose naming `object` and `haventory/status/*`, neither of them a field.",
            "",
            "- The handles: `file_id`, `filename`, and one that wrapped onto the",
            "  next line: `attachment_ids`.",
            "",
            "Trailing prose naming `document`, which is not in a bullet.",
            "",
            "### Next section",
            "",
            "- `never_read`",
        ]
    )

    assert _bulleted_names(markdown, EXCEPTIONS_HEADING) == {
        "file_id",
        "filename",
        "attachment_ids",
    }

    with pytest.raises(AssertionError, match="is not in"):
        _bulleted_names(markdown, "#### No such heading")


def test_contract_names_every_kind_a_bulk_row_may_take() -> None:
    """The op table is wider than the batch, so the two lists are held together.

    `ops.OPS` also carries the writes only a command or a service can make — a
    create, a reminder bump, the location verbs — and `items/bulk` refuses
    those. The document is where a client author reads which is which.
    """

    text = CONTRACT.read_text(encoding="utf-8")
    line = next(ln for ln in text.splitlines() if ln.lstrip().startswith("- Supported `kind`"))
    documented = set(re.findall(r"`([a-z][a-z0-9_]*)`", line.split("values:", 1)[1]))

    assert documented == set(ops.BULK_KINDS)
    assert ops.BULK_KINDS < set(ops.OPS), "every bulk kind is an operation, and not every one"


def test_contract_names_the_whole_quick_filter_vocabulary() -> None:
    """`haventory/config`'s documented pill names are `QUICK_FILTER_KEYS`."""

    text = CONTRACT.read_text(encoding="utf-8")
    line = next(
        ln for ln in text.splitlines() if ln.lstrip().startswith("- `quick_filters` is which")
    )
    offered = line.split("out of ", 1)[1].split(", set in", 1)[0]

    assert re.findall(r"`([a-z][a-z0-9_]*)`", offered) == list(QUICK_FILTER_KEYS)
