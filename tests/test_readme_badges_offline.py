"""The README's header row, and the button its Install section opens with.

A badge row is markdown no other check parses. A fifth badge added because it
was easy, or one whose service stops answering, reads to every visitor as a
statement about the project and is invisible to CI. Four is a decision — one CI
signal, the released version, how it installs, and the licence — and this is
where that decision is written down.

The Install section is held to its first element for the same reason. The My HA
button is the only badge here that *does* something rather than reporting
something, and it collapses the opening steps of the instructions only for a
reader who meets it before them.

Scenarios:
- the header carries exactly the four badges, in order, each pointing where it says
- the Install section opens with the My HA "open this repository in HACS" button
- a fifth badge, a reordered row and a section opening with prose are all reported
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
README = REPO_ROOT / "README.md"

#: `[![alt](image)](target)` on a line of its own — the shape every badge takes.
BADGE = re.compile(r"^\[!\[(?P<alt>[^\]]*)\]\((?P<image>[^)\s]+)\)\]\((?P<target>[^)\s]+)\)$")

#: Alt text and link target of each header badge, in the order they are flown.
HEADER_BADGES = (
    ("CI", "https://github.com/chrreiter/HAventory/actions/workflows/ci.yml"),
    ("Release", "https://github.com/chrreiter/HAventory/releases"),
    ("HACS: Custom", "https://github.com/hacs/integration"),
    ("License: Apache-2.0", "LICENSE"),
)

#: The redirect the Install button has to hand Home Assistant, and the image it
#: shows. My HA resolves the redirect against the reader's own instance, so the
#: query has to name this repository and the integration category.
INSTALL_REDIRECT = (
    "https://my.home-assistant.io/redirect/hacs_repository/"
    "?owner=chrreiter&repository=HAventory&category=integration"
)
INSTALL_IMAGE = "https://my.home-assistant.io/badges/hacs_repository.svg"


def _badges_after(lines: list[str], start: int) -> list[re.Match[str]]:
    """The run of badge lines beginning at the first non-blank line after ``start``."""

    found: list[re.Match[str]] = []
    for line in lines[start + 1 :]:
        stripped = line.strip()
        if not stripped:
            if found:
                break
            continue
        match = BADGE.match(stripped)
        if match is None:
            break
        found.append(match)
    return found


def _heading_index(lines: list[str], heading: str) -> int:
    for index, line in enumerate(lines):
        if line.strip() == heading:
            return index
    raise AssertionError(f"README.md has no {heading!r} heading")


def _header_badges(text: str) -> list[tuple[str, str]]:
    """Alt text and target of each badge in the row under the title."""

    lines = text.splitlines()
    return [
        (m["alt"], m["target"]) for m in _badges_after(lines, _heading_index(lines, "# HAventory"))
    ]


def _install_opener(text: str) -> tuple[str, str] | None:
    """Image and target of the badge the Install section opens with, if it does."""

    lines = text.splitlines()
    opening = _badges_after(lines, _heading_index(lines, "## Install"))
    if not opening:
        return None
    return opening[0]["image"], opening[0]["target"]


def test_the_header_carries_the_four_badges() -> None:
    """One CI signal, the version, how it installs, the licence — and nothing else."""

    assert _header_badges(README.read_text(encoding="utf-8")) == list(HEADER_BADGES)


def test_install_opens_with_the_my_ha_button() -> None:
    """A reader who clicks it never has to read the manual route at all."""

    assert _install_opener(README.read_text(encoding="utf-8")) == (INSTALL_IMAGE, INSTALL_REDIRECT)


def test_a_drifted_row_and_a_prose_opener_are_reported() -> None:
    """The green runs above have to mean the markdown was really parsed."""

    extra = "\n".join(
        [
            "# HAventory",
            "",
            "[![CI](https://example.invalid/ci.svg)](https://example.invalid/ci)",
            "[![Coverage](https://example.invalid/cov.svg)](https://example.invalid/cov)",
            "",
            "## Install",
            "",
            "Add it as a custom repository:",
            "",
            f"[![Add]({INSTALL_IMAGE})]({INSTALL_REDIRECT})",
        ]
    )
    assert _header_badges(extra) == [
        ("CI", "https://example.invalid/ci"),
        ("Coverage", "https://example.invalid/cov"),
    ]
    assert _install_opener(extra) is None
