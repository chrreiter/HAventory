"""Hold `docs/backend_api_contract.md` to the code it describes.

Two claims in that document are lists of names the code owns: the `items/bulk`
kinds a row may name, and the quick-filter vocabulary `haventory/config` reports.
A list nobody checks is a promise a client author reads once and builds against,
so each is compared here against its source of truth.
"""

from __future__ import annotations

import re
from pathlib import Path

from custom_components.haventory import ops
from custom_components.haventory.const import QUICK_FILTER_KEYS

CONTRACT = Path(__file__).resolve().parents[1] / "docs" / "backend_api_contract.md"


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
