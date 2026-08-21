"""The declared minimum supported Home Assistant version must agree everywhere.

``hacs.json`` carries the number HACS enforces at install time, so it is the
source of truth here; every other spelling of it is a copy that silently goes
stale. The copies are enumerated explicitly rather than discovered — a grep for
version-shaped tokens also matches example versions (the bug-report placeholder)
and unrelated pins.

``requirements-integration.txt`` is the one that makes the claim testable: the
in-process HA suite runs against exactly that pin, so pinning it to the floor is
what turns "minimum supported" from an assertion into something CI defends.

That is also why there is one floor and not two. A lower "runs on" number beside
a higher "recommended" one could not be pinned here — the releases below the
current floor carry the advisory ``dependency-review`` rejects — so the declared
minimum would become the one version CI never runs at. The README is therefore
held to a single Home Assistant version, by a guard that reads the shape rather
than the two registered sentences.
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
    ("docs/backend_api_contract.md", rf"Target HA: ≥ ({VERSION});", 1),
)


# A Home Assistant version as the README writes one. Prose wraps, so the mention
# and the number often land on different lines; whitespace is flattened before
# the window in front of a number decides whether it is Home Assistant's.
BOLD_VERSION = re.compile(rf"\*\*({VERSION})\*\*")
HOME_ASSISTANT = re.compile(r"\b(?:Home Assistant|HA)\b")
CONTEXT_CHARS = 120


def home_assistant_versions_in(text: str) -> list[str]:
    """Every bold three-component version the text states about Home Assistant."""
    flattened = re.sub(r"\s+", " ", text)
    return [
        match.group(1)
        for match in BOLD_VERSION.finditer(flattened)
        if HOME_ASSISTANT.search(flattened[max(0, match.start() - CONTEXT_CHARS) : match.start()])
    ]


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


def test_readme_names_one_home_assistant_version() -> None:
    """A second version in the README would be a floor nothing keeps true.

    ``DECLARATION_SITES`` pins the two sentences that state the floor today, by
    the wording they use. A "recommended version" written anywhere else, in any
    wording, is the copy that goes stale — and this project decided there is one
    number, so the guard reads the shape instead of a sentence.
    """
    stated = home_assistant_versions_in((REPO_ROOT / "README.md").read_text(encoding="utf-8"))

    assert set(stated) == {declared_floor()}, (
        f"README.md states Home Assistant {sorted(set(stated))}; hacs.json declares "
        f"{declared_floor()!r}, and there is one floor — anchor a second number in "
        f"DECLARATION_SITES or drop it"
    )


def test_a_second_home_assistant_version_is_reported() -> None:
    """The guard sees the number that was added, not only the declared one."""
    sample = (
        "Minimum Home Assistant version: **2026.3.1** is the oldest release that\n"
        "runs the integration. For Home Assistant itself we recommend\n"
        "**2026.6.0** or newer.\n"
    )

    assert home_assistant_versions_in(sample) == ["2026.3.1", "2026.6.0"]


def test_a_version_that_is_not_home_assistants_is_left_alone() -> None:
    """The card and the integration carry their own versions, in the same shape."""
    assert home_assistant_versions_in("The store listing lands with **1.0.0**.") == []
