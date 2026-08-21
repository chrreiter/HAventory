"""Every relative Markdown link in the public documents resolves.

The repository had no Markdown link check, which is exactly how a deletion leaves a
dangling one: the file goes, the sentence pointing at it stays, and nothing is red.
This covers the documents a reader arrives at — `README.md`, `CONTRIBUTING.md`,
`CLAUDE.md` and `docs/*.md`.

Only *relative* targets are checked. An `http(s)://` link is a network call and a
bare `#anchor` is a heading this test would have to render Markdown to know about;
both are out of scope, and saying so is what keeps the check honest about what it
does not cover.

Scenarios:
- every relative link in the tracked documents points at a path that exists
- the resolver reports a missing target rather than passing over it
- the extractor finds links at all, so a green run cannot mean "found none"
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

#: `[text](target)` — the target is everything up to the closing paren.
LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")

#: Floors that make a green run mean something. Both sit well under the real
#: numbers: passing them says the glob and the pattern still match, not that the
#: documents are the size they were.
MIN_DOCUMENTS = 7
MIN_RELATIVE_LINKS = 15


def _documents() -> list[Path]:
    named = [REPO_ROOT / "README.md", REPO_ROOT / "CONTRIBUTING.md", REPO_ROOT / "CLAUDE.md"]
    return named + sorted((REPO_ROOT / "docs").glob("*.md"))


def _broken_links(document: Path, root: Path) -> list[str]:
    """Relative link targets in ``document`` that resolve to nothing under ``root``."""

    broken: list[str] = []
    for raw in LINK.findall(document.read_text(encoding="utf-8")):
        target = raw.split()[0].strip()  # drop an optional "title"
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        path = target.split("#", 1)[0]
        if not path:
            continue
        if not (document.parent / path).resolve().is_relative_to(root):
            broken.append(f"{document.name} → {target} (escapes the repository)")
        elif not (document.parent / path).exists():
            broken.append(f"{document.name} → {target}")
    return broken


def test_every_relative_link_resolves() -> None:
    """No document points at a path this repository does not hold."""

    documents = _documents()
    assert len(documents) >= MIN_DOCUMENTS, "the document set collapsed; the glob found nothing"

    relative = [
        target
        for d in documents
        for target in LINK.findall(d.read_text(encoding="utf-8"))
        if not target.startswith(("http://", "https://", "mailto:", "#"))
    ]
    assert len(relative) >= MIN_RELATIVE_LINKS, (
        f"only {len(relative)} relative links extracted — the extractor stopped matching"
    )

    broken = [entry for d in documents for entry in _broken_links(d, REPO_ROOT)]
    assert not broken, "dangling relative links:\n  " + "\n  ".join(broken)


def test_the_resolver_reports_a_missing_target(tmp_path: Path) -> None:
    """A green run above has to mean the targets were really looked for."""

    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "present.md").write_text("here", encoding="utf-8")
    document = tmp_path / "index.md"
    document.write_text(
        "\n".join(
            [
                "[fine](docs/present.md)",
                "[fine with an anchor](docs/present.md#a-heading)",
                "[external](https://example.invalid/gone.md)",
                "[anchor only](#somewhere)",
                "[gone](docs/absent.md)",
                "[escapes](../outside.md)",
            ]
        ),
        encoding="utf-8",
    )

    assert _broken_links(document, tmp_path) == [
        "index.md → docs/absent.md",
        "index.md → ../outside.md (escapes the repository)",
    ]
