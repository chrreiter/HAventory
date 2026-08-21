"""Tests for the repository configuration that CI itself cannot report on.

The committed branch ruleset in ``.github/rulesets/`` comes first: a required
status check that never reports blocks every pull request forever, so the checks
it names are validated against the workflows that are supposed to produce them —
the context has to be a job that runs on pull requests to ``main`` through an
unfiltered trigger.

Then two things a workflow run cannot tell you about itself: that every
third-party action it calls is pinned to an immutable revision, and that
Dependabot is configured to keep ``requirements-integration.txt`` patched
without fighting the pins that file carries deliberately.

Last, the scheduled ``ha-latest`` run, which is worthless in two specific ways
that a green run of its own would not reveal: reporting a check that a pull
request then waits on, and installing the pinned floor instead of the newest
core — which would make it a second, slower copy of ``ci.yml``'s integration job.
"""

from __future__ import annotations

import itertools
import json
import re
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
RULESET_PATH = REPO_ROOT / ".github" / "rulesets" / "main.json"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
DEPENDABOT_PATH = REPO_ROOT / ".github" / "dependabot.yml"
HA_LATEST_PATH = WORKFLOWS_DIR / "ha-latest.yml"

# `actions/*` is GitHub's own namespace, and this repository pins it by tag on
# purpose; everything else names an immutable revision, because a tag can be
# repointed by whoever owns it and Scorecard's pinned-dependencies check reads a
# tag as unpinned. A `docker://` image counts as third party too.
FIRST_PARTY_ACTION = re.compile(r"^actions/")
IMMUTABLE_REVISION = re.compile(r"@(?:[0-9a-f]{40}|sha256:[0-9a-f]{64})$")

# The two pins `requirements-integration.txt` carries as derived numbers rather
# than as dependencies to keep current.
HA_PINS = ("homeassistant", "home-assistant-frontend")
VERSION_UPDATE_TYPES = frozenset(
    {
        "version-update:semver-major",
        "version-update:semver-minor",
        "version-update:semver-patch",
    }
)

# App id of GitHub Actions. Pinning it on a required check means a status posted
# by any other app cannot satisfy the requirement.
GITHUB_ACTIONS_APP_ID = 15368

PR_EVENTS = ("pull_request", "pull_request_target")


def workflow_triggers(workflow: dict[str, Any]) -> dict[str, Any]:
    """Trigger mapping of a parsed workflow.

    PyYAML resolves the bare ``on`` key to the boolean ``True`` (YAML 1.1
    treats it as a truthy scalar), so both spellings have to be accepted.
    """
    for key in ("on", True):
        if key in workflow:
            triggers = workflow[key]
            return triggers if isinstance(triggers, dict) else dict.fromkeys(triggers or [])
    return {}


def runs_on_pull_requests_to_main(workflow: dict[str, Any]) -> bool:
    """Whether the workflow reports on every pull request targeting ``main``.

    A ``paths``/``paths-ignore`` filter disqualifies it: on a pull request that
    touches nothing matching, the checks are never created, and a required check
    that is never created leaves the pull request permanently unmergeable.
    """
    for event, config in workflow_triggers(workflow).items():
        if event not in PR_EVENTS:
            continue
        if not isinstance(config, dict):
            return True
        if "paths" in config or "paths-ignore" in config:
            continue
        branches = config.get("branches")
        if branches is None or "main" in branches:
            return True
    return False


def job_contexts(job_id: str, job: dict[str, Any]) -> list[str]:
    """Check-run names a single job reports.

    A matrix job reports one check per combination, named
    ``<job> (<value>, <value>)`` in matrix-key order — the same shape the API
    returns for a completed run.
    """
    name = str(job.get("name", job_id))
    matrix = job.get("strategy", {}).get("matrix", {})
    axes = [values for values in matrix.values() if isinstance(values, list)]
    if not axes:
        return [name]
    return [f"{name} ({', '.join(str(v) for v in combo)})" for combo in itertools.product(*axes)]


def workflow_contexts(workflow: dict[str, Any]) -> set[str]:
    """Check-run names a workflow reports on a pull request to ``main``."""
    if not runs_on_pull_requests_to_main(workflow):
        return set()
    return {
        context
        for job_id, job in workflow.get("jobs", {}).items()
        for context in job_contexts(job_id, job)
    }


def available_contexts() -> set[str]:
    """Every check-run name the repository's workflows report on a pull request."""
    contexts: set[str] = set()
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        contexts |= workflow_contexts(yaml.safe_load(path.read_text(encoding="utf-8")))
    return contexts


@pytest.fixture
def ruleset() -> dict[str, Any]:
    return json.loads(RULESET_PATH.read_text(encoding="utf-8"))


def rule(ruleset: dict[str, Any], rule_type: str) -> dict[str, Any]:
    for entry in ruleset["rules"]:
        if entry["type"] == rule_type:
            return entry
    raise AssertionError(f"ruleset has no {rule_type!r} rule")


def test_required_checks_are_reported_on_pull_requests(ruleset: dict[str, Any]) -> None:
    checks = rule(ruleset, "required_status_checks")["parameters"]["required_status_checks"]
    contexts = {check["context"] for check in checks}
    assert contexts, "the ruleset requires no status checks"
    assert contexts <= available_contexts()


def test_required_checks_are_pinned_to_github_actions(ruleset: dict[str, Any]) -> None:
    checks = rule(ruleset, "required_status_checks")["parameters"]["required_status_checks"]
    assert all(check.get("integration_id") == GITHUB_ACTIONS_APP_ID for check in checks)


def test_ruleset_gates_the_default_branch(ruleset: dict[str, Any]) -> None:
    assert ruleset["enforcement"] == "active"
    assert ruleset["target"] == "branch"
    assert ruleset["conditions"]["ref_name"]["include"] == ["~DEFAULT_BRANCH"]
    for rule_type in ("deletion", "non_fast_forward", "pull_request", "required_status_checks"):
        assert rule(ruleset, rule_type)


def test_merges_do_not_require_an_up_to_date_branch(ruleset: dict[str, Any]) -> None:
    # Parallel pull requests are the normal working mode here; a strict policy
    # would force a rebase of every open branch after each merge.
    parameters = rule(ruleset, "required_status_checks")["parameters"]
    assert parameters["strict_required_status_checks_policy"] is False


def test_review_requirement_does_not_deadlock_a_solo_maintainer(ruleset: dict[str, Any]) -> None:
    parameters = rule(ruleset, "pull_request")["parameters"]
    assert parameters["required_approving_review_count"] == 0
    assert parameters["require_last_push_approval"] is False


def test_matrix_jobs_expand_to_one_context_per_combination() -> None:
    job = {"name": "CodeQL", "strategy": {"matrix": {"language": ["python", "typescript"]}}}
    assert job_contexts("analyze", job) == ["CodeQL (python)", "CodeQL (typescript)"]

    two_axes = {"strategy": {"matrix": {"os": ["linux"], "node": [22, 24]}}}
    assert job_contexts("frontend", two_axes) == ["frontend (linux, 22)", "frontend (linux, 24)"]


def test_path_filtered_workflow_reports_no_required_contexts() -> None:
    workflow = yaml.safe_load(
        """
        name: docs-only
        on:
          pull_request:
            branches: [main]
            paths: ["docs/**"]
        jobs:
          check:
            runs-on: ubuntu-latest
        """
    )
    # `on:` survived YAML's boolean coercion, and the filtered trigger is dropped.
    assert workflow_triggers(workflow) != {}
    assert workflow_contexts(workflow) == set()


def test_unknown_required_check_is_not_satisfied_by_the_workflows() -> None:
    assert "backend (3.13)" not in available_contexts()


def uses_values(node: Any) -> list[str]:
    """Every ``uses:`` value anywhere in a parsed workflow."""
    if isinstance(node, dict):
        return [
            *([str(node["uses"])] if "uses" in node else []),
            *(value for child in node.values() for value in uses_values(child)),
        ]
    if isinstance(node, list):
        return [value for child in node for value in uses_values(child)]
    return []


def unpinned_actions(workflow: dict[str, Any]) -> list[str]:
    """Third-party references a workflow calls without naming a revision."""
    return [
        reference
        for reference in uses_values(workflow)
        if not FIRST_PARTY_ACTION.match(reference) and not IMMUTABLE_REVISION.search(reference)
    ]


def dependabot_block(ecosystem: str, directory: str) -> dict[str, Any] | None:
    """The update block for one ecosystem and directory, if it is configured."""
    config = yaml.safe_load(DEPENDABOT_PATH.read_text(encoding="utf-8"))
    for update in config["updates"]:
        if update["package-ecosystem"] == ecosystem and update["directory"] == directory:
            return dict(update)
    return None


def ignored_update_types(block: dict[str, Any]) -> dict[str, set[str]]:
    """What each ignored dependency is ignored for; an empty set means everything."""
    return {
        entry["dependency-name"]: set(entry.get("update-types", []))
        for entry in block.get("ignore", [])
    }


def test_third_party_actions_are_pinned_by_digest() -> None:
    """A tag can be moved under the workflow that calls it; a digest cannot."""
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        workflow = yaml.safe_load(path.read_text(encoding="utf-8"))

        assert unpinned_actions(workflow) == [], f"{path.name} calls an unpinned action"


def test_a_tag_pinned_reference_is_reported() -> None:
    """The error case, in the shape a new workflow arrives in."""
    workflow = yaml.safe_load(
        """
        name: new
        on: [push]
        jobs:
          check:
            runs-on: ubuntu-latest
            steps:
              - uses: actions/checkout@v7
              - uses: astral-sh/setup-uv@v10
              - uses: docker://rhysd/actionlint:1.7.12
        """
    )

    assert unpinned_actions(workflow) == [
        "astral-sh/setup-uv@v10",
        "docker://rhysd/actionlint:1.7.12",
    ]


def test_dependabot_updates_the_integration_requirements() -> None:
    """Without a pip block nothing opens the fix for an advisory in that file.

    The dependency graph scans ``requirements-integration.txt`` either way, so
    the alert arrives; the pull request that closes it does not.
    """
    assert dependabot_block("pip", "/") is not None


def test_dependabot_leaves_the_ha_pins_alone() -> None:
    """Both pins are derived numbers: a version bump of either is a red build.

    ``homeassistant`` is the floor ``hacs.json`` declares, and
    ``home-assistant-frontend`` must equal what that release's own manifest asks
    for — so an automated bump is not an upgrade. Ignoring them outright would
    also swallow the security update this block exists to receive, so the ignore
    names version updates and nothing else.
    """
    block = dependabot_block("pip", "/")
    assert block is not None
    ignored = ignored_update_types(block)

    assert set(HA_PINS) <= set(ignored), f"pip block ignores {sorted(ignored)}"
    for name in HA_PINS:
        assert ignored[name] == VERSION_UPDATE_TYPES, (
            f"{name} is ignored for {sorted(ignored[name]) or 'every update'} — a blanket "
            f"ignore also mutes the security channel"
        )


def test_a_blanket_ignore_is_told_from_a_scoped_one() -> None:
    """The two are one line apart in the file and opposite in effect."""
    blanket = {"ignore": [{"dependency-name": "homeassistant"}]}
    scoped = {
        "ignore": [
            {
                "dependency-name": "homeassistant",
                "update-types": sorted(VERSION_UPDATE_TYPES),
            }
        ]
    }

    assert ignored_update_types(blanket) == {"homeassistant": set()}
    assert ignored_update_types(scoped) == {"homeassistant": set(VERSION_UPDATE_TYPES)}


@pytest.fixture
def ha_latest() -> dict[str, Any]:
    return yaml.safe_load(HA_LATEST_PATH.read_text(encoding="utf-8"))


def test_scheduled_ha_latest_reports_no_required_contexts(ha_latest: dict[str, Any]) -> None:
    """A monthly run must never become a check a pull request waits on.

    It has no pull-request trigger, so it reports nothing on one and the ruleset
    needs no edit. Adding that trigger later would put two check names into
    ``available_contexts()`` that no pull request can satisfy quickly.
    """
    assert workflow_contexts(ha_latest) == set()


def test_ha_latest_installs_no_pinned_home_assistant(ha_latest: dict[str, Any]) -> None:
    """The failure mode that would leave it green and worthless.

    Either naming ``homeassistant`` on the command line or installing
    ``requirements-integration.txt`` would pull the declared floor, and the job
    would quietly re-test what ``ci.yml`` already tests.
    """
    commands = "\n".join(
        str(step["run"])
        for job in ha_latest["jobs"].values()
        for step in job.get("steps", [])
        if "run" in step
    )

    assert "requirements-integration.txt" not in commands
    assert "homeassistant==" not in commands
    assert "pytest-homeassistant-custom-component" in commands


def test_ha_latest_is_dispatchable_and_scheduled(ha_latest: dict[str, Any]) -> None:
    """Both triggers: the cron is the point, and dispatch is how it is proved."""
    triggers = workflow_triggers(ha_latest)

    assert "workflow_dispatch" in triggers
    assert [entry["cron"] for entry in triggers["schedule"]] == ["0 5 8 * *"]
