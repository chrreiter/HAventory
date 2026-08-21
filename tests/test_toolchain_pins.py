"""The Python floor, the Node floor and the ruff pin must agree everywhere.

Each of the three is declared in exactly one place — ``requires-python`` in
``pyproject.toml``, ``engines.node`` in the card's ``package.json``, and the
``ruff==`` entry in the ``dev`` dependency group — and each is then copied into
files that read nothing back. A copy that goes stale stays stale: the CodeQL
workflow analysed Python on 3.12 for as long as nothing looked at it.

The Python side works in two passes. Registered files are checked by count and
by value, so changing a copy without changing the declaration fails; every
committed file is then swept for the same spellings, so a copy in an
unregistered file fails too. Adding a copy means registering it here or not
writing it.

The floor is declared at patch level because Home Assistant declares its own
that way; most copies name only the series an interpreter belongs to — ruff's
target, mypy's ``python_version``, the CI matrix. Both spellings are registered
per file, so relaxing a patch-level copy to the series fails as loudly as
changing the number does. Whether the declared patch is the one the pinned Home
Assistant release demands cannot be read without HA installed, and is asserted
in ``tests/integration/test_python_floor.py``.

Two Python copies are shaped so no interpreter-version pattern can see them, and
neither is unguarded: ``.github/rulesets/main.json`` names the required check
``backend (3.14)``, which ``tests/test_repo_hardening_offline.py`` ties to the
job the ``ci.yml`` matrix actually produces, and ``hacs.json``'s Home Assistant
floor implies the interpreter, which ``tests/test_min_ha_version.py`` holds to
the 2026.3 split where HA itself moved to 3.14.
"""

from __future__ import annotations

import json
import re
import subprocess
import tomllib
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]

PYPROJECT = REPO_ROOT / "pyproject.toml"
CARD_PACKAGE_JSON = REPO_ROOT / "cards" / "haventory-card" / "package.json"
PRE_COMMIT_CONFIG = REPO_ROOT / ".pre-commit-config.yaml"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"


def read_toml(path: Path) -> dict[str, Any]:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def collapse(text: str) -> str:
    """Text with wrapping, comment leaders and Markdown emphasis flattened away.

    ``Python **3.14**`` split across two lines of prose is the same copy as
    ``python3.14`` in a shell script, and a version that wrapped onto the next
    line of a ``#`` comment block is the same copy again. One pattern has to see
    all three, so the shapes that only separate them are removed first.
    """
    return re.sub(r"\s+", " ", re.sub(r"(?m)^[ \t]*#+[ \t]?", "", text.replace("**", "")))


# --------------------------------------------------------------------------
# The Python floor
# --------------------------------------------------------------------------

_PY = r"3\.\d+(?:\.\d+)?"

# Every spelling of an interpreter version this repository uses. Anchored on
# "python" or on the "3.14-only" phrase so that release versions which merely
# look alike (``aiohttp==3.14.2``) are not mistaken for the floor.
PYTHON_VERSION_FORMS = re.compile(
    "|".join(
        (
            rf"--python[ =]({_PY})",  # uv: `uv venv --python 3.14`
            rf"python install ({_PY})",  # uv: `uv python install 3.14`
            rf"PYTHON:-({_PY})",  # shell default: `${HA_PYTHON:-3.14}`
            rf"python[-_]version[\"']? *[:=] *\[? *[\"']?({_PY})",  # setup-python, mypy
            rf"requires-python *= *\">=({_PY})\"",  # the declaration
            rf"[Cc]?[Pp]ython[ :]?({_PY})",  # prose, `python3.14`, image tags
            rf"({_PY})-only",  # "the source is 3.14-only"
        )
    )
)

# ruff spells the same number without the dot.
RUFF_TARGET_VERSION = re.compile(r"target-version *= *\"py3(\d\d)\"")

# (path relative to the repository root, copies naming the series, copies
# naming the patch-level floor).
PYTHON_FLOOR_SITES: tuple[tuple[str, int, int], ...] = (
    ("pyproject.toml", 6, 2),
    (".github/workflows/ci.yml", 5, 0),
    (".github/workflows/codeql.yml", 1, 0),
    ("README.md", 10, 0),
    ("CONTRIBUTING.md", 1, 0),
    ("docs/backend_api_contract.md", 1, 0),
    ("requirements-integration.txt", 2, 0),
    ("scripts/test_integration.sh", 4, 0),
    (".devcontainer/Dockerfile", 1, 0),
    (".devcontainer/develop.sh", 2, 0),
    (".devcontainer/post-create.sh", 1, 0),
    (".claude/hooks/session-start.sh", 8, 0),
    (".claude/skills/run-haventory/SKILL.md", 2, 0),
    (".claude/skills/test-haventory/SKILL.md", 7, 0),
)

# `dev/` holds design documents that quote configuration verbatim to describe
# it — snapshots, not copies anyone keeps true, and they are deleted with the
# work they plan.
SWEPT_SKIP_DIR_PREFIXES = ("dev/",)

# Committed files that carry versions nobody here writes.
SWEPT_SKIP_PATHS = frozenset(
    {
        "cards/haventory-card/package-lock.json",
        "uv.lock",
        # This file names the spellings it looks for; it is the register, not a copy.
        "tests/test_toolchain_pins.py",
    }
)

SWEPT_SUFFIXES = frozenset(
    {
        ".cfg",
        ".ini",
        ".js",
        ".json",
        ".md",
        ".mjs",
        ".py",
        ".pyi",
        ".sh",
        ".toml",
        ".ts",
        ".txt",
        ".yaml",
        ".yml",
    }
)

SWEPT_NAMES = frozenset({"Dockerfile"})


def declared_python_floor() -> str:
    """The interpreter version ``requires-python`` demands, patch level and all."""
    return read_toml(PYPROJECT)["project"]["requires-python"].removeprefix(">=")


def declared_python_series() -> str:
    """The floor's ``major.minor`` — the spelling a runtime target is written in."""
    major, minor, *_ = declared_python_floor().split(".")
    return f"{major}.{minor}"


def python_versions_in(text: str) -> list[str]:
    """Every interpreter version a file states, in both spellings."""
    collapsed = collapse(text)
    dotted = [
        next(group for group in match.groups() if group is not None)
        for match in PYTHON_VERSION_FORMS.finditer(collapsed)
    ]
    compact = [f"3.{match.group(1)}" for match in RUFF_TARGET_VERSION.finditer(collapsed)]
    return dotted + compact


def swept_files() -> list[Path]:
    """Every committed text file that could carry a copy of a version.

    Committed means read from the git index, not the working tree: a
    contributor's local-only files are not copies anyone ships, and sweeping
    them would fail the gate on one machine for files no other checkout has.
    """
    # S603/S607: the argument list is fixed, and `git` comes from PATH the same
    # way it did for the clone this test is reading.
    tracked = subprocess.run(  # noqa: S603
        ["git", "-C", str(REPO_ROOT), "ls-files", "-z"],  # noqa: S607
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8")
    found: list[Path] = []
    for relative in sorted(filter(None, tracked.split("\0"))):
        if relative.startswith(SWEPT_SKIP_DIR_PREFIXES) or relative in SWEPT_SKIP_PATHS:
            continue
        path = REPO_ROOT / relative
        # A deletion not yet staged leaves the index entry behind with no file
        # under it; there is nothing to read.
        if not path.is_file():
            continue
        if path.suffix in SWEPT_SUFFIXES or path.name in SWEPT_NAMES:
            found.append(path)
    return found


def test_the_floor_cannot_drop_below_the_syntax_the_source_uses() -> None:
    """3.14 is a hard bottom, not a preference.

    The integration uses PEP 758 unparenthesized ``except A, B:``, which no
    older interpreter parses — an environment below the floor cannot import the
    package at all, so lowering the declaration would not merely widen support.
    """
    major, minor = (int(part) for part in declared_python_series().split("."))
    assert (major, minor) >= (3, 14)


def test_the_floor_is_declared_at_patch_level() -> None:
    """A series-only declaration admits interpreters Home Assistant refuses.

    Home Assistant states its own floor at patch level — ``>=3.14.2`` for the
    release ``requirements-integration.txt`` installs — so a declaration of
    ``>=3.14`` here is satisfied by interpreters that cannot install Home
    Assistant at all. The failure then surfaces as an unsatisfiable dependency
    resolution rather than as an interpreter a couple of patch releases too old.
    """
    assert re.fullmatch(r"\d+\.\d+\.\d+", declared_python_floor()), (
        f"requires-python declares {declared_python_floor()!r}, which names no patch release"
    )


@pytest.mark.parametrize(("relative_path", "series_copies", "floor_copies"), PYTHON_FLOOR_SITES)
def test_python_floor_sites_match_pyproject(
    relative_path: str, series_copies: int, floor_copies: int
) -> None:
    """Every registered copy names the floor, in the spelling registered for it."""
    found = Counter(python_versions_in((REPO_ROOT / relative_path).read_text(encoding="utf-8")))
    expected = Counter(
        {
            version: count
            for version, count in (
                (declared_python_series(), series_copies),
                (declared_python_floor(), floor_copies),
            )
            if count
        }
    )

    assert found == expected, (
        f"{relative_path} states {dict(found)}; registered here are {series_copies} copy/copies "
        f"of the {declared_python_series()} series and {floor_copies} of the "
        f"{declared_python_floor()} floor — register the new copy here or drop it"
    )


def test_a_local_only_file_is_not_swept() -> None:
    """The sweep reads the index, so an untracked file cannot redden the gate.

    A contributor's machine carries files no other checkout has — session
    settings, scratch notes — and some of them state interpreter versions.
    Failing on those fails one machine for a copy nothing ships.
    """
    probe = REPO_ROOT / "sweep_probe_local_only.md"
    probe.write_text("built on Python 3.99\n", encoding="utf-8")
    try:
        assert probe not in swept_files()
    finally:
        probe.unlink()


def test_no_unregistered_file_states_an_interpreter_version() -> None:
    """A copy in a file this test does not know about fails the same way."""
    registered = {path for path, *_ in PYTHON_FLOOR_SITES}
    carrying = {
        path.relative_to(REPO_ROOT).as_posix()
        for path in swept_files()
        if python_versions_in(path.read_text(encoding="utf-8", errors="replace"))
    }

    assert carrying == registered, (
        f"unregistered: {sorted(carrying - registered)}; "
        f"registered but no longer carrying one: {sorted(registered - carrying)}"
    )


def test_version_numbers_that_are_not_the_interpreter_are_left_alone() -> None:
    """Release pins that look like an interpreter version are not copies of it."""
    assert python_versions_in("aiohttp==3.14.2\nhomeassistant==2026.6.0\nidna==3.18\n") == []
    assert python_versions_in("does not parse on 3.13") == []


def test_both_spellings_of_a_version_are_found() -> None:
    """ruff's dotless target and a line-wrapped prose mention read the same."""
    assert python_versions_in('target-version = "py315"') == ["3.15"]
    assert python_versions_in("needs Python\n**3.15** to run") == ["3.15"]
    assert python_versions_in("uv venv --python 3.15 .venv") == ["3.15"]
    assert python_versions_in('requires-python = ">=3.15.2"') == ["3.15.2"]


# --------------------------------------------------------------------------
# The Node floor
# --------------------------------------------------------------------------

# Prose states the floor as a major, or as the major and minor `engines` names.
NODE_PROSE = re.compile(r"Node ?(\d+)(?:\.(\d+))?")

NODE_PROSE_SITES: tuple[str, ...] = (
    "README.md",
    "CONTRIBUTING.md",
    "scripts/setup.sh",
    "scripts/test_frontend.sh",
    ".claude/skills/run-haventory/SKILL.md",
    ".claude/skills/test-haventory/SKILL.md",
)


def declared_node_range() -> str:
    """The Node range the card's ``engines`` field demands."""
    return json.loads(CARD_PACKAGE_JSON.read_text(encoding="utf-8"))["engines"]["node"]


def node_majors() -> set[str]:
    """The majors ``engines`` names — one per comparator in the range."""
    named = re.findall(r"\d+(?:\.\d+)*", declared_node_range())
    return {version.split(".")[0] for version in named}


def node_floor() -> tuple[str, str]:
    """The oldest supported major and minor, as ``engines`` states them."""
    with_minor = re.findall(r"\d+\.\d+", declared_node_range())
    major, minor = min(with_minor, key=lambda v: tuple(map(int, v.split(".")))).split(".")
    return major, minor


def workflows() -> dict[str, dict[str, Any]]:
    return {
        path.name: yaml.safe_load(path.read_text(encoding="utf-8"))
        for path in sorted(WORKFLOWS_DIR.glob("*.yml"))
    }


def values_for_key(node: Any, key: str) -> list[Any]:
    """Every value stored under ``key`` anywhere in a parsed workflow."""
    if isinstance(node, dict):
        return [
            *(node[key] if key in node and isinstance(node[key], list) else []),
            *([node[key]] if key in node and not isinstance(node[key], list) else []),
            *(value for child in node.values() for value in values_for_key(child, key)),
        ]
    if isinstance(node, list):
        return [value for child in node for value in values_for_key(child, key)]
    return []


def test_ci_frontend_matrix_is_exactly_the_majors_engines_names() -> None:
    """The matrix tests every supported major and nothing `engines` rejects.

    Dropping a major from ``engines`` while CI keeps testing it — or the
    reverse — is the failure this catches; nothing else reads the two together.
    """
    matrix = yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))["jobs"]["frontend"]
    tested = {str(version) for version in matrix["strategy"]["matrix"]["node-version"]}

    assert tested == node_majors()


def test_every_workflow_node_pin_is_a_supported_major() -> None:
    """A job pinned to an unsupported major builds the card on it anyway."""
    for name, workflow in workflows().items():
        # A matrix reference is checked where the matrix is declared, not here.
        pins = (str(value) for value in values_for_key(workflow, "node-version"))
        pinned = {value for value in pins if "${{" not in value}
        assert pinned <= node_majors(), f"{name} pins Node {sorted(pinned - node_majors())}"


def test_prose_node_versions_agree_with_engines() -> None:
    """Documented majors are supported, and a stated minor is the floor's."""
    major, minor = node_floor()
    for relative_path in NODE_PROSE_SITES:
        text = collapse((REPO_ROOT / relative_path).read_text(encoding="utf-8"))
        for stated_major, stated_minor in NODE_PROSE.findall(text):
            assert stated_major in node_majors(), f"{relative_path} names Node {stated_major}"
            if stated_minor:
                assert (stated_major, stated_minor) == (major, minor), (
                    f"{relative_path} states Node {stated_major}.{stated_minor}, "
                    f"engines declares {declared_node_range()!r}"
                )


# --------------------------------------------------------------------------
# Tool pins written twice
# --------------------------------------------------------------------------


def dev_dependency_pin(name: str) -> str:
    """The version the ``dev`` dependency group pins a tool to."""
    group = read_toml(PYPROJECT)["dependency-groups"]["dev"]
    return next(entry for entry in group if entry.startswith(f"{name}==")).removeprefix(f"{name}==")


def pre_commit_rev(repo_url: str) -> str:
    """The revision ``.pre-commit-config.yaml`` checks a hook repository out at."""
    config = yaml.safe_load(PRE_COMMIT_CONFIG.read_text(encoding="utf-8"))
    rev = next(repo["rev"] for repo in config["repos"] if repo["repo"] == repo_url)
    return str(rev).removeprefix("v")


def test_pre_commit_runs_the_pinned_ruff() -> None:
    """A pre-commit hook on another ruff reformats what CI then rejects."""
    hook = pre_commit_rev("https://github.com/astral-sh/ruff-pre-commit")
    assert hook == dev_dependency_pin("ruff")


def test_the_documented_ruff_command_runs_the_pinned_ruff() -> None:
    """The skill's lint command names its own ruff, so it can disagree with CI."""
    text = (REPO_ROOT / ".claude/skills/test-haventory/SKILL.md").read_text(encoding="utf-8")
    documented = set(re.findall(r"ruff==(\S+)", text))

    assert documented == {dev_dependency_pin("ruff")}


def test_pre_commit_runs_the_actionlint_ci_runs() -> None:
    """Same split as ruff: the hook and the CI job are pinned independently.

    The job pins the image by digest, which names no version — so the trailing
    comment is where the version lives, and the tie to the hook's ``rev`` is
    only readable if the two are written together.
    """
    ci_image = re.search(
        r"docker://rhysd/actionlint@sha256:[0-9a-f]{64} +# v(\S+)",
        CI_WORKFLOW.read_text(encoding="utf-8"),
    )
    assert ci_image is not None, "the actionlint job names no digest-pinned image with a version"
    assert pre_commit_rev("https://github.com/rhysd/actionlint") == ci_image.group(1)
