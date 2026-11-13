"""The card's gate is spelled the same in every place that runs or asks for it.

``CONTRIBUTING.md`` → "The gate" is the declaration. CI's ``frontend`` job runs
it, the pull-request template asks for it, and pre-commit runs the part that is
fast enough to run on every commit. A command added to one of them and not the
others is a check that is green locally and red in CI, or the reverse.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRIBUTING = REPO_ROOT / "CONTRIBUTING.md"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
PR_TEMPLATE = REPO_ROOT / ".github" / "pull_request_template.md"
PRE_COMMIT_CONFIG = REPO_ROOT / ".pre-commit-config.yaml"

# The audit, the test suite and the build stay out of pre-commit: the first
# needs the network, the other two take long enough to invite `--no-verify`.
NOT_ON_EVERY_COMMIT = frozenset({"npm audit", "npx vitest", "npm run build"})


def frontend_gate(contributing: str) -> list[str]:
    """The commands under ``# Frontend`` in the gate block, comments dropped."""
    block = contributing.split("## The gate", 1)[1].split("```bash", 1)[1].split("```", 1)[0]
    frontend = block.split("# Frontend", 1)[1].splitlines()[1:]
    commands = (line.split("#", 1)[0].strip() for line in frontend)
    return [command for command in commands if command]


def ci_frontend_commands() -> list[str]:
    job = yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))["jobs"]["frontend"]
    return [step["run"].strip() for step in job["steps"] if "run" in step]


def pre_commit_entries() -> list[str]:
    config = yaml.safe_load(PRE_COMMIT_CONFIG.read_text(encoding="utf-8"))
    return [
        hook["entry"]
        for repo in config["repos"]
        if repo["repo"] == "local"
        for hook in repo["hooks"]
        if hook["id"].startswith("card-")
    ]


def runs(command: str, candidates: list[str]) -> bool:
    """Whether a candidate runs ``command``, extra trailing flags allowed."""
    return any(re.search(rf"(^|&& ){re.escape(command)}( |'|$)", c) for c in candidates)


def gate() -> list[str]:
    return frontend_gate(CONTRIBUTING.read_text(encoding="utf-8"))


def test_the_gate_names_the_formatter_and_the_linter() -> None:
    commands = gate()

    assert "npx prettier --check ." in commands
    assert "npx eslint ." in commands


def test_ci_runs_every_gate_command() -> None:
    ci = ci_frontend_commands()

    assert [command for command in gate() if not runs(command, ci)] == []


def test_the_pull_request_template_asks_for_every_gate_command() -> None:
    template = PR_TEMPLATE.read_text(encoding="utf-8")

    assert [command for command in gate() if f"`{command}`" not in template] == []


def test_pre_commit_runs_the_fast_gate_commands() -> None:
    fast = [c for c in gate() if not c.startswith(tuple(NOT_ON_EVERY_COMMIT))]
    entries = pre_commit_entries()

    assert fast, "the gate names no command pre-commit could run"
    assert [command for command in fast if not runs(command, entries)] == []


def test_a_command_missing_from_a_runner_is_reported() -> None:
    """The error case: a near-miss spelling is not the same command."""
    text = (
        "## The gate\n```bash\n# Backend\nx\n"
        "# Frontend (in card)\nnpx eslint .  # lint\nnpx tsc\n```\n"
    )

    assert frontend_gate(text) == ["npx eslint .", "npx tsc"]
    assert runs("npx eslint .", ["bash -c 'cd card && npx eslint .'"])
    assert runs("npx vitest run", ["npx vitest run --coverage"])
    assert not runs("npx eslint .", ["npx eslint src"])
    assert not runs("npm run build", ["npm run build:watch"])
