"""Tests for the committed branch ruleset in ``.github/rulesets/``.

A required status check that never reports blocks every pull request forever, so
the checks named in the ruleset are validated against the workflows that are
supposed to produce them: the context has to be a job that runs on pull requests
to ``main`` through an unfiltered trigger.
"""

from __future__ import annotations

import importlib.util
import itertools
import json
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
RULESET_PATH = REPO_ROOT / ".github" / "rulesets" / "main.json"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"


def _load_ruleset_diff() -> Any:
    """Import ``scripts/ruleset_diff.py``, which is a standalone script, not a package."""
    spec = importlib.util.spec_from_file_location(
        "ruleset_diff", REPO_ROOT / "scripts" / "ruleset_diff.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ruleset_diff = _load_ruleset_diff()

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


def test_live_ruleset_matching_the_file_reports_no_drift(ruleset: dict[str, Any]) -> None:
    # What GitHub answers with: the declared policy plus ids, timestamps and
    # links the committed file cannot carry.
    live = ruleset | {
        "id": 7776748,
        "source_type": "Repository",
        "current_user_can_bypass": "never",
        "_links": {"self": {"href": "https://api.github.com/…"}},
    }
    assert ruleset_diff.differences(ruleset, live) == []


def test_reordered_required_checks_are_not_drift(ruleset: dict[str, Any]) -> None:
    live = json.loads(json.dumps(ruleset))
    for rule_entry in live["rules"]:
        if rule_entry["type"] == "required_status_checks":
            rule_entry["parameters"]["required_status_checks"].reverse()
    assert ruleset_diff.differences(ruleset, live) == []


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (lambda rs: rs.update(enforcement="disabled"), "enforcement:"),
        (lambda rs: rs.update(bypass_actors=[{"actor_id": 5}]), "bypass_actors:"),
        (lambda rs: rs["rules"].remove(rule(rs, "non_fast_forward")), "missing rule:"),
        (
            lambda rs: rule(rs, "required_status_checks")["parameters"][
                "required_status_checks"
            ].pop(),
            "required_status_checks.required_status_checks:",
        ),
        (
            lambda rs: rule(rs, "pull_request")["parameters"].update(
                required_approving_review_count=2
            ),
            "pull_request.required_approving_review_count:",
        ),
    ],
)
def test_weakened_live_ruleset_is_reported_as_drift(
    ruleset: dict[str, Any], mutate: Any, expected: str
) -> None:
    live = json.loads(json.dumps(ruleset))
    mutate(live)
    found = ruleset_diff.differences(ruleset, live)
    assert found and any(line.startswith(expected) for line in found), found


def test_absent_ruleset_is_reported_as_drift(ruleset: dict[str, Any]) -> None:
    assert ruleset_diff.differences(ruleset, {}) == ["no ruleset named 'main' exists"]
