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
- every image the README names by raw URL is a file git actually holds
"""

from __future__ import annotations

import re
import subprocess
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


# --------------------------------------------------------------------------
# Images
# --------------------------------------------------------------------------
#
# `hacs.json` sets `render_readme`, so the HACS info panel renders `README.md`
# from outside this repository, where a relative image path resolves against
# nothing. The screenshots are therefore referenced by absolute
# `raw.githubusercontent.com` URL — one string GitHub and HACS both resolve —
# and that string is exactly what no other check would notice going stale.

#: `![alt](target)` — a link with a bang in front of it.
IMAGE = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")

#: The prefix a raw URL for this repository carries, up to the git ref.
RAW_PREFIX = "https://raw.githubusercontent.com/chrreiter/HAventory/"

#: Badges come from other hosts and are checked by nobody here; the screenshots
#: are what this floor is about.
MIN_REPOSITORY_IMAGES = 3


def _tracked_paths() -> set[str]:
    """Every path git holds, which is what a raw URL can actually serve.

    Existence on disk is not the property under test: a screenshot written but
    never added resolves locally and 404s for every reader.
    """
    # S603/S607: a fixed argument list, and `git` from PATH as everywhere else.
    listing = subprocess.run(  # noqa: S603
        ["git", "-C", str(REPO_ROOT), "ls-files", "-z"],  # noqa: S607
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8")
    return set(filter(None, listing.split("\0")))


def _repository_images(document: Path) -> list[str]:
    """Repository-relative paths the document's raw-URL images name."""

    found: list[str] = []
    for target in IMAGE.findall(document.read_text(encoding="utf-8")):
        if not target.startswith(RAW_PREFIX):
            continue
        # Everything after the git ref is the path inside the repository.
        _ref, _, path = target.removeprefix(RAW_PREFIX).partition("/")
        found.append(path)
    return found


def _missing_images(document: Path, tracked: set[str]) -> list[str]:
    return [
        f"{document.name} → {path}" for path in _repository_images(document) if path not in tracked
    ]


def test_every_repository_image_names_a_committed_file() -> None:
    """A screenshot that was renamed or never added is a broken image for everyone."""

    documents = _documents()
    referenced = [path for d in documents for path in _repository_images(d)]
    assert len(referenced) >= MIN_REPOSITORY_IMAGES, (
        f"only {len(referenced)} repository image(s) found — the README lost its screenshots, "
        "or they stopped being referenced by raw URL"
    )

    tracked = _tracked_paths()
    missing = [entry for d in documents for entry in _missing_images(d, tracked)]
    assert not missing, "images naming nothing this repository holds:\n  " + "\n  ".join(missing)


def test_an_uncommitted_image_is_reported(tmp_path: Path) -> None:
    """The green run above has to mean the files were really looked for."""

    document = tmp_path / "README.md"
    document.write_text(
        "\n".join(
            [
                f"![hero]({RAW_PREFIX}main/docs/assets/screenshots/full-view.png)",
                f"![gone]({RAW_PREFIX}main/docs/assets/screenshots/absent.png)",
                "[![CI](https://img.shields.io/badge/x.svg)](https://example.invalid/ci)",
                "![relative](docs/assets/social-preview.png)",
            ]
        ),
        encoding="utf-8",
    )

    assert _repository_images(document) == [
        "docs/assets/screenshots/full-view.png",
        "docs/assets/screenshots/absent.png",
    ]
    assert _missing_images(document, {"docs/assets/screenshots/full-view.png"}) == [
        "README.md → docs/assets/screenshots/absent.png"
    ]
