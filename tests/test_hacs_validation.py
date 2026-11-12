"""The HACS validation step in CI runs every check, with none switched off.

The HACS default store only accepts a repository whose ``hacs/action`` run passes
with no ``ignore``, so an exception left in ``ci.yml`` is a green job that says
nothing about whether the submission would be accepted.

The one check that needs something from this repository beyond valid metadata is
``brands``. HACS looks for ``<integration directory>/brand/icon.png`` in the
repository tree and only asks the ``home-assistant/brands`` list about the domain
when that file is missing. The file is therefore what keeps the check passing, and
it is asserted here beside the workflow that depends on it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
INTEGRATION_DIR = REPO_ROOT / "custom_components" / "haventory"

HACS_ACTION = "hacs/action"

# The file name the HACS ``brands`` check looks for.
BRAND_ASSET = "icon.png"


def hacs_steps(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    """Every step in ``workflow`` that runs the HACS action, whatever revision it pins."""
    return [
        step
        for job in workflow["jobs"].values()
        for step in job.get("steps", [])
        if str(step.get("uses", "")).split("@")[0] == HACS_ACTION
    ]


def ignored_checks(workflow: dict[str, Any]) -> list[str]:
    """The checks ``workflow`` tells the HACS action to skip.

    The action's ``ignore`` input is a space-separated list. A workflow without the
    step is refused rather than read as "nothing ignored": a renamed or removed step
    would otherwise leave this file passing while guarding nothing.
    """
    steps = hacs_steps(workflow)
    if not steps:
        raise LookupError(f"no step uses {HACS_ACTION}")
    return [
        check for step in steps for check in str((step.get("with") or {}).get("ignore", "")).split()
    ]


def workflow_with(inputs: dict[str, Any] | None) -> dict[str, Any]:
    step: dict[str, Any] = {"uses": f"{HACS_ACTION}@0000000"}
    if inputs is not None:
        step["with"] = inputs
    return {"jobs": {"validation": {"steps": [{"uses": "actions/checkout@v7"}, step]}}}


def test_ci_runs_hacs_validation_with_no_check_ignored() -> None:
    workflow = yaml.safe_load(CI_WORKFLOW.read_text(encoding="utf-8"))

    assert ignored_checks(workflow) == []
    assert [step["with"]["category"] for step in hacs_steps(workflow)] == ["integration"]


@pytest.mark.parametrize(
    ("inputs", "expected"),
    [
        (None, []),
        ({"category": "integration"}, []),
        ({"category": "integration", "ignore": "brands"}, ["brands"]),
        ({"category": "integration", "ignore": "brands hacsjson"}, ["brands", "hacsjson"]),
    ],
)
def test_an_ignore_input_is_read_as_the_checks_it_names(
    inputs: dict[str, Any] | None, expected: list[str]
) -> None:
    assert ignored_checks(workflow_with(inputs)) == expected


def test_a_workflow_without_the_hacs_step_is_refused() -> None:
    workflow = {"jobs": {"validation": {"steps": [{"uses": "actions/checkout@v7"}]}}}

    with pytest.raises(LookupError):
        ignored_checks(workflow)


def test_the_integration_ships_the_icon_the_brands_check_looks_for() -> None:
    """HACS builds the path from ``content_in_root``, so both halves are held here.

    With ``content_in_root`` false it reads ``custom_components/<domain>/brand/``.
    Set to true it would read ``brand/`` at the repository root, where there is
    nothing, and fall back to a list this domain is not on.
    """
    hacs = json.loads((REPO_ROOT / "hacs.json").read_text(encoding="utf-8"))

    assert hacs["content_in_root"] is False
    assert (INTEGRATION_DIR / "brand" / BRAND_ASSET).is_file()
