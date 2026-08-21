"""The card's typecheck covers the package, not only ``src/``.

``tsc`` reads whatever ``include`` names and nothing else, so a config file or a
driver added beside the source is un-typechecked until someone notices — and
nothing notices, because the gate stays green. The files outside ``src/`` are
the ones that drift hardest: they are edited rarely, run outside the bundle, and
`e2e/live-updates.smoke.mjs` talks to both Node and a browser.

``checkJs`` stays off deliberately. That driver imports a module from
``.claude/skills/run-haventory/``, which enters the compiler's program; with
``checkJs`` on, a file belonging to another gate would be blamed for errors
here. Each JavaScript file this package owns opts in with ``// @ts-check``
instead, and this module is what keeps a new one from forgetting.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
CARD = REPO_ROOT / "cards" / "haventory-card"
TSCONFIG = CARD / "tsconfig.json"

# Built output, vendored packages and coverage reports are not sources.
SKIPPED_DIRS = frozenset({"node_modules", "coverage", "dist", "www"})
SOURCE_SUFFIXES = frozenset({".ts", ".js", ".mjs", ".cjs"})
JAVASCRIPT_SUFFIXES = frozenset({".js", ".mjs", ".cjs"})
OPT_IN = "// @ts-check"


def tsconfig() -> dict[str, Any]:
    """The card's compiler configuration.

    ``tsconfig.json`` is JSONC — TypeScript accepts comments there and the file
    uses them, so the whole-line ones are dropped before parsing.
    """
    return json.loads(re.sub(r"(?m)^\s*//.*$", "", TSCONFIG.read_text(encoding="utf-8")))


def package_sources() -> list[Path]:
    """Every source file the card package owns, relative to the package root.

    The skipped directories are pruned as the walk goes rather than filtered
    afterwards: ``node_modules`` alone holds tens of thousands of files.
    """
    found: list[Path] = []
    for directory, subdirectories, filenames in CARD.walk():
        subdirectories[:] = [name for name in subdirectories if name not in SKIPPED_DIRS]
        for filename in filenames:
            path = directory / filename
            if path.suffix in SOURCE_SUFFIXES:
                found.append(path.relative_to(CARD))
    return sorted(found)


def is_included(relative: Path, include: list[str]) -> bool:
    """Whether ``include`` names the file, or a directory it sits under."""
    return any(relative == Path(entry) or Path(entry) in relative.parents for entry in include)


def test_every_source_in_the_package_is_typechecked() -> None:
    """A config file added beside the source cannot slip past the gate."""
    include = tsconfig()["include"]

    missed = [str(path) for path in package_sources() if not is_included(path, include)]

    assert missed == [], f"not named by tsconfig `include`: {missed}"


def test_the_gate_reaches_past_the_source_directory() -> None:
    """The three files the widening was for, named rather than implied."""
    include = set(tsconfig()["include"])

    assert {"src", "vite.config.ts", "eslint.config.js", "e2e"} <= include


def test_javascript_is_parsed_and_opts_in_to_checking() -> None:
    """``allowJs`` lets the JavaScript in; ``// @ts-check`` is what checks it."""
    options = tsconfig()["compilerOptions"]
    assert options["allowJs"] is True
    assert options["checkJs"] is False

    unmarked = [
        str(path)
        for path in package_sources()
        if path.suffix in JAVASCRIPT_SUFFIXES
        and not (CARD / path).read_text(encoding="utf-8").startswith(OPT_IN)
    ]

    assert unmarked == [], f"JavaScript without a `{OPT_IN}` line: {unmarked}"


def test_an_uncovered_file_is_reported() -> None:
    """The error case: `include` naming only the source directory."""
    assert is_included(Path("src/index.ts"), ["src"])
    assert is_included(Path("vite.config.ts"), ["src", "vite.config.ts"])
    assert not is_included(Path("eslint.config.js"), ["src"])
    assert not is_included(Path("e2e/live-updates.smoke.mjs"), ["src", "vite.config.ts"])
