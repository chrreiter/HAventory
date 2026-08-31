"""The automation examples in the documents are Home Assistant's current YAML.

Home Assistant 2024.8 renamed an action step's ``service:`` to ``action:``, and
2024.10 renamed an automation's blocks to ``triggers:`` / ``conditions:`` /
``actions:``, with ``- trigger: <kind>`` where a trigger entry used to say
``- platform: <kind>``. Both older spellings still load, so an example that keeps
them stays green everywhere except in front of the reader who copies it out — and
the floor ``hacs.json`` declares is years above both releases, so there is no Home
Assistant this repository supports that wants the older words.

Only automation- and script-shaped blocks are swept. ``platform:`` is still
current YAML for an integration platform (``sensor:`` / ``- platform: template``),
so a fenced block carrying no automation marker is left alone.

Scenarios:
- no automation example in the tracked documents carries a retired key
- the extractor finds blocks at all, so a green run cannot mean "found none"
- the sweep reports each retired key rather than passing over it
- a current example passes, and integration config is not swept
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

#: The body of a fenced ```yaml block.
YAML_BLOCK = re.compile(r"^```ya?ml\n(.*?)^```", re.MULTILINE | re.DOTALL)

#: What makes a block an automation or a script rather than integration config.
#: Both spellings of an action step are markers: a block that has drifted back to
#: ``- service:`` is exactly the one this sweep exists to find.
AUTOMATION_MARKER = re.compile(
    r"^\s*(?:automation|script|sequence):|^\s*-\s*(?:alias|action|service):",
    re.MULTILINE,
)

#: Each retired key, and the current spelling to answer a failure with. A block
#: header carries no leading dash and a list entry does, which is what separates a
#: retired ``condition:`` block from a current ``- condition: template`` entry.
RETIRED = (
    (re.compile(r"^(?!\s*-)\s*trigger:\s*$", re.MULTILINE), "an automation's block is `triggers:`"),
    (
        re.compile(r"^(?!\s*-)\s*condition:(?:\s|$)", re.MULTILINE),
        "an automation's block is `conditions:`",
    ),
    (re.compile(r"^(?!\s*-)\s*action:\s*$", re.MULTILINE), "an automation's block is `actions:`"),
    (re.compile(r"^\s*-?\s*platform:", re.MULTILINE), "a trigger entry names its kind `trigger:`"),
    (re.compile(r"^\s*-\s*service:", re.MULTILINE), "an action step calls `action:`"),
)

#: A floor that makes a green run mean something: passing it says the fence
#: pattern and the marker still match, not that the documents are unchanged.
MIN_AUTOMATION_BLOCKS = 6


def _documents() -> list[Path]:
    named = [REPO_ROOT / "README.md", REPO_ROOT / "CONTRIBUTING.md", REPO_ROOT / "CLAUDE.md"]
    return named + sorted((REPO_ROOT / "docs").glob("*.md"))


def _automation_blocks(text: str) -> list[str]:
    return [block for block in YAML_BLOCK.findall(text) if AUTOMATION_MARKER.search(block)]


def _retired_keys(text: str) -> list[str]:
    """The retired spellings the automation examples in ``text`` still use."""

    return [
        current
        for block in _automation_blocks(text)
        for pattern, current in RETIRED
        if pattern.search(block)
    ]


def test_no_example_uses_a_retired_automation_key() -> None:
    """One spelling across every example: a half-modernised one reads as a typo."""

    documents = [(d, d.read_text(encoding="utf-8")) for d in _documents()]
    blocks = [block for _d, text in documents for block in _automation_blocks(text)]
    assert len(blocks) >= MIN_AUTOMATION_BLOCKS, (
        f"only {len(blocks)} automation example(s) extracted — the fence pattern or the "
        "marker stopped matching"
    )

    stale = [f"{d.name}: {current}" for d, text in documents for current in _retired_keys(text)]
    assert not stale, "examples in Home Assistant's older YAML:\n  " + "\n  ".join(stale)


def test_the_sweep_reports_each_retired_key() -> None:
    """A green run above has to mean the blocks were really read."""

    document = "\n".join(
        [
            "```yaml",
            "automation:",
            "  - alias: Old",
            "    trigger:",
            "      platform: state",
            "      entity_id: input_button.x",
            '    condition: "{{ true }}"',
            "    action:",
            "      - service: notify.notify",
            "```",
        ]
    )

    assert sorted(_retired_keys(document)) == sorted(current for _pattern, current in RETIRED)


def test_a_current_example_passes_and_platform_config_is_left_alone() -> None:
    """``platform:`` outside an automation is current YAML and no business of this sweep."""

    document = "\n".join(
        [
            "```yaml",
            "automation:",
            "  - alias: New",
            "    triggers:",
            "      - trigger: event",
            "        event_type: haventory_low_stock",
            "        event_data:",
            "          action: entered",
            '    conditions: "{{ true }}"',
            "    actions:",
            "      - action: notify.notify",
            "```",
            "",
            "```yaml",
            "sensor:",
            "  - platform: template",
            "```",
        ]
    )

    assert _automation_blocks(document)
    assert _retired_keys(document) == []
