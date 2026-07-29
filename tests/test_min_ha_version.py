"""The declared minimum supported Home Assistant version must agree everywhere.

``hacs.json`` carries the number HACS enforces at install time, so it is the
source of truth here; every other spelling of it is a copy that silently goes
stale. The copies are enumerated explicitly rather than discovered — a grep for
version-shaped tokens also matches example versions (the bug-report placeholder)
and unrelated pins.

``requirements-integration.txt`` is the one that makes the claim testable: the
in-process HA suite runs against exactly that pin, so pinning it to the floor is
what turns "minimum supported" from an assertion into something CI defends.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]

# Three components, so a trailing sentence period cannot be swallowed into the
# match and a two-component claim ("2026.3") fails rather than passing loosely.
VERSION = r"\d+\.\d+\.\d+"

# (path, pattern, expected number of occurrences). Every capture group must
# equal the hacs.json floor.
DECLARATION_SITES: tuple[tuple[str, str, int], ...] = (
    ("requirements-integration.txt", rf"^homeassistant==({VERSION})$", 1),
    ("README.md", rf"Minimum Home Assistant (?:version: )?\*\*({VERSION})\*\*", 2),
    ("CONTRIBUTING.md", rf"\*\*Home Assistant ({VERSION})\+\*\*", 1),
    (".github/ISSUE_TEMPLATE/bug_report.yml", rf"Minimum supported is ({VERSION})\.", 1),
    (
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        rf"supported Home Assistant version \(>= ({VERSION})\)",
        1,
    ),
    ("pyproject.toml", rf"HA ({VERSION}) =>", 2),
    (".github/workflows/ci.yml", rf"declared HA ({VERSION}) runtime", 1),
)


def declared_floor() -> str:
    """The minimum supported HA version as HACS reads it."""
    return json.loads((REPO_ROOT / "hacs.json").read_text(encoding="utf-8"))["homeassistant"]


def test_floor_is_on_the_python_314_side_of_the_split() -> None:
    """A floor below 2026.3 would be unusable, not merely optimistic.

    HA raised its Python floor to 3.14 in 2026.3. The integration's source uses
    PEP 758 unparenthesized ``except A, B:``, which does not parse on 3.13, so
    an older HA could not import it at all.
    """
    year, month, _ = (int(part) for part in declared_floor().split("."))
    assert (year, month) >= (2026, 3)


@pytest.mark.parametrize(("relative_path", "pattern", "occurrences"), DECLARATION_SITES)
def test_declaration_sites_match_hacs_json(
    relative_path: str, pattern: str, occurrences: int
) -> None:
    """Every copy of the floor agrees with ``hacs.json``."""
    text = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
    found = re.findall(pattern, text, flags=re.MULTILINE)

    assert len(found) == occurrences, (
        f"{relative_path}: expected {occurrences} match(es) for {pattern!r}, found {len(found)}"
    )
    assert set(found) == {declared_floor()}, (
        f"{relative_path} declares {sorted(set(found))}, hacs.json declares {declared_floor()!r}"
    )
