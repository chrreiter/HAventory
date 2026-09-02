"""Tests for the repository configuration that CI itself cannot report on.

The committed branch ruleset in ``.github/rulesets/`` comes first: a required
status check that never reports blocks every pull request forever, so the checks
it names are validated against the workflows that are supposed to produce them —
the context has to be a job that runs on pull requests to ``main`` through an
unfiltered trigger.

Then two things a workflow run cannot tell you about itself: that every
third-party action it calls is pinned to an immutable revision, and that
Dependabot is configured to keep ``requirements-integration.txt`` patched
without fighting the pins that file carries deliberately, without bumping them
from the other block that reads the same file, and without proposing the dev
toolchain a second time out of a generated export — and that the ruff pin and
the pre-commit rev held equal to it move in one pull request, since apart each
half arrives red for the copy it did not touch. The dev container is held to
the same bar: its Dockerfile names every image on a ``FROM`` line, the only line
Dependabot's docker updater takes a tag from, and a block reads it, while
``develop.sh`` clears no directory it has not first read a ``pyvenv.cfg`` in.

Last, the two scheduled runs — ``ha-latest`` and ``card-smoke`` — each of which
can be worthless in ways a green run of its own would not reveal: reporting a
check that a pull request then waits on, installing the pinned floor instead of
the newest core, or driving a smoke that skips itself because its opt-in flag is
missing.
"""

from __future__ import annotations

import itertools
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
RULESET_PATH = REPO_ROOT / ".github" / "rulesets" / "main.json"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
DEPENDABOT_PATH = REPO_ROOT / ".github" / "dependabot.yml"
HA_LATEST_PATH = WORKFLOWS_DIR / "ha-latest.yml"
CARD_SMOKE_PATH = WORKFLOWS_DIR / "card-smoke.yml"

# Every workflow that only ever runs on a timer, and the slot each one claims.
# Two crons in the same minute would have them contending for runners.
SCHEDULED_WORKFLOWS = ((HA_LATEST_PATH, "0 5 8 * *"), (CARD_SMOKE_PATH, "0 6 8 * *"))

# `actions/*` is GitHub's own namespace, and this repository pins it by tag on
# purpose; everything else names an immutable revision, because a tag can be
# repointed by whoever owns it and a moved tag runs code nobody here reviewed.
# A `docker://` image counts as third party too.
FIRST_PARTY_ACTION = re.compile(r"^actions/")
IMMUTABLE_REVISION = re.compile(r"@(?:[0-9a-f]{40}|sha256:[0-9a-f]{64})$")

# The two pins `requirements-integration.txt` carries as derived numbers rather
# than as dependencies to keep current. Both updaters pointed at the repository
# root read that file, so both have to be told.
HA_PINS = ("homeassistant", "home-assistant-frontend")
ROOT_PYTHON_ECOSYSTEMS = ("uv", "pip")

# The ruff pin in the `dev` group and the pre-commit hook rev that
# tests/test_toolchain_pins.py holds equal to it live in two ecosystems. One
# pull request has to move both, or the sweep fails whichever arrives alone.
RUFF_PIN_ECOSYSTEMS = ("uv", "pre-commit")

DEVCONTAINER_DOCKERFILE = REPO_ROOT / ".devcontainer" / "Dockerfile"
DEVCONTAINER_DEVELOP = REPO_ROOT / ".devcontainer" / "develop.sh"

#: `FROM [--platform=…] image [AS name]` — the one line Dependabot's docker
#: updater reads a tag or digest from.
FROM_LINE = re.compile(
    r"^FROM\s+(?:--platform=\S+\s+)?(?P<image>\S+)(?:\s+AS\s+(?P<stage>\S+))?\s*$",
    re.IGNORECASE | re.MULTILINE,
)

#: `COPY --from=<source>`: a stage declared above, or an image the updater never sees.
COPY_FROM = re.compile(r"^COPY\s+--from=(?P<source>\S+)", re.IGNORECASE | re.MULTILINE)

#: The Dockerfile stages two binaries out of their images before its own base, so a
#: match count below this says the ``FROM`` pattern stopped matching, not that the
#: file got simpler.
MIN_DEVCONTAINER_FROM_LINES = 3

# The root manifests the `uv` block owns, and which the `pip` block therefore has
# to be scoped off: `requirements-dev.txt` is a `uv export` that says so on line
# 1, and `pyproject.toml` has a lockfile beside it that a pip edit would not
# touch.
UV_OWNED_MANIFESTS = ("pyproject.toml", "requirements-dev.txt")
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


def still_scanned(block: dict[str, Any], paths: tuple[str, ...]) -> list[str]:
    """Which of ``paths`` this block's ``exclude-paths`` leaves in its scan.

    ``exclude-paths`` entries are glob patterns resolved against the block's
    ``directory``, so a literal path and ``**/name`` are both legitimate ways to
    write the same exclusion.
    """
    patterns = block.get("exclude-paths", [])
    return [
        path
        for path in paths
        if not any(PurePosixPath(path).full_match(pattern) for pattern in patterns)
    ]


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


@pytest.mark.parametrize("ecosystem", ROOT_PYTHON_ECOSYSTEMS)
def test_dependabot_leaves_the_ha_pins_alone(ecosystem: str) -> None:
    """Both pins are derived numbers: a version bump of either is a red build.

    ``homeassistant`` is the floor ``hacs.json`` declares, and
    ``home-assistant-frontend`` must equal what that release's own manifest asks
    for — so an automated bump is not an upgrade. Ignoring them outright would
    also swallow the security update the ``pip`` block exists to receive, so the
    ignore names version updates and nothing else.

    Both root blocks need it. The ``uv`` updater is named for ``pyproject.toml``
    and ``uv.lock`` but reads the root's requirements files as well, and writes
    either pin straight into ``requirements-integration.txt`` when it is not
    told otherwise.
    """
    block = dependabot_block(ecosystem, "/")
    assert block is not None, f"no {ecosystem} block for the repository root"
    ignored = ignored_update_types(block)

    assert set(HA_PINS) <= set(ignored), f"{ecosystem} block ignores {sorted(ignored)}"
    for name in HA_PINS:
        assert ignored[name] == VERSION_UPDATE_TYPES, (
            f"{name} is ignored for {sorted(ignored[name]) or 'every update'} in the "
            f"{ecosystem} block — a blanket ignore also mutes the security channel"
        )


def multi_ecosystem_groups() -> dict[str, Any]:
    """The groups that span ecosystems, by name; a block joins one by naming it."""
    config = yaml.safe_load(DEPENDABOT_PATH.read_text(encoding="utf-8"))
    return dict(config.get("multi-ecosystem-groups") or {})


def test_dependabot_moves_the_ruff_pin_and_its_hook_together() -> None:
    """Two copies of one number, in two ecosystems, in one pull request.

    The ``dev`` group pins ruff exactly because the formatter's output moves
    between releases; the hook rev is the same number written where pre-commit
    reads it. The ``uv`` updater moves the pin and the ``pre-commit`` updater the
    rev, and each on its own arrived as a red pull request every time — the
    group is what puts both edits under one head for the sweep to pass.
    """
    blocks = {ecosystem: dependabot_block(ecosystem, "/") for ecosystem in RUFF_PIN_ECOSYSTEMS}
    for ecosystem, block in blocks.items():
        assert block is not None, f"no {ecosystem} block for the repository root"
    groups = {
        ecosystem: block.get("multi-ecosystem-group")
        for ecosystem, block in blocks.items()
        if block is not None
    }

    assert None not in groups.values(), f"a block is outside every group: {groups}"
    assert len(set(groups.values())) == 1, f"the two blocks join different groups: {groups}"
    (name,) = set(groups.values())
    assert name in multi_ecosystem_groups(), (
        f"{name!r} is not declared under multi-ecosystem-groups"
    )
    for ecosystem, block in blocks.items():
        assert block is not None and "*" in block.get("patterns", []), (
            f"the {ecosystem} block keeps some dependencies out of {name!r}"
        )


def images_copied_past_every_from_line(dockerfile: str) -> list[str]:
    """Sources a ``COPY --from=`` names that are not a stage the file declares.

    A stage name resolves to a ``FROM`` line above it, where the tag is. Anything
    else is an image reference of its own, and no updater reads it.
    """
    stages = {match.group("stage") for match in FROM_LINE.finditer(dockerfile)}
    return [
        match.group("source")
        for match in COPY_FROM.finditer(dockerfile)
        if match.group("source") not in stages
    ]


def test_dependabot_reads_the_devcontainer() -> None:
    """The Dockerfile's images and the devcontainer's features each have an updater.

    Without the ``docker`` block, the uv and go2rtc tags in the Dockerfile are
    pins that move only when someone remembers them; without the
    ``devcontainers`` block, the Node feature is. Neither file is read by any
    other block.
    """
    assert dependabot_block("docker", "/.devcontainer") is not None
    assert dependabot_block("devcontainers", "/") is not None


def test_devcontainer_dockerfile_names_every_image_on_a_from_line() -> None:
    """A ``COPY --from=`` naming a registry image is a pin the docker updater skips."""
    dockerfile = DEVCONTAINER_DOCKERFILE.read_text(encoding="utf-8")

    assert len(FROM_LINE.findall(dockerfile)) >= MIN_DEVCONTAINER_FROM_LINES, (
        "the FROM pattern matches too little"
    )
    assert images_copied_past_every_from_line(dockerfile) == []


def test_a_copy_from_a_registry_image_is_reported() -> None:
    """The error case, in the shape it had before the images were staged."""
    dockerfile = "\n".join(
        [
            "FROM ghcr.io/astral-sh/uv:0.11.31 AS uv",
            "FROM --platform=linux/amd64 debian:bookworm",
            "COPY --from=uv /uv /uvx /usr/local/bin/",
            "COPY --from=ghcr.io/alexxit/go2rtc:1.9.14 /usr/local/bin/go2rtc /usr/local/bin/",
            "",
        ]
    )

    assert images_copied_past_every_from_line(dockerfile) == ["ghcr.io/alexxit/go2rtc:1.9.14"]


def test_develop_clears_no_directory_it_has_not_read_a_pyvenv_cfg_in() -> None:
    """uv refuses to ``--clear`` a directory that is not a virtual environment.

    Its hint is ``--force``, which removes the directory whatever it holds, and
    ``HA_VENV`` is overridable — so on that hint the script would delete a path
    the operator named and this script never made. The check for ``pyvenv.cfg``
    is what turns that into a message naming the directory, and it has to come
    first: past the ``uv venv`` call there is nothing left to refuse.
    """
    script = DEVCONTAINER_DEVELOP.read_text(encoding="utf-8")
    creating = [line for line in script.splitlines() if "uv venv" in line]

    assert creating, "develop.sh no longer builds the Home Assistant environment"
    for line in creating:
        assert "--force" not in line, f"--force removes whatever HA_VENV names: {line.strip()}"
    assert script.index("pyvenv.cfg") < script.index("uv venv"), (
        "the guard has to be read before the directory is cleared"
    )


def test_dependabot_keeps_pip_off_the_manifests_uv_owns() -> None:
    """The generated export is not a manifest to edit, and never on its own.

    ``requirements-dev.txt`` is written by ``uv export`` and carries "do not edit
    by hand" on its first line; ``pyproject.toml`` is half of a pair whose other
    half is ``uv.lock``. The pip updater parses both anyway, so every dev package
    the ``uv`` group already carries arrives a second time, in a shape that
    dirties the tree for whoever runs ``uv`` next.
    """
    block = dependabot_block("pip", "/")
    assert block is not None
    left_in = still_scanned(block, UV_OWNED_MANIFESTS)

    assert left_in == [], f"pip block still scans {left_in} — add them to exclude-paths"


def test_an_unscoped_pip_block_is_reported() -> None:
    """The shape the block had while it was opening the duplicates."""
    unscoped: dict[str, Any] = {}
    literal = {"exclude-paths": ["pyproject.toml", "requirements-dev.txt"]}
    globbed = {"exclude-paths": ["**/*.toml", "**/requirements-dev.txt"]}
    partial = {"exclude-paths": ["requirements-dev.txt"]}

    assert still_scanned(unscoped, UV_OWNED_MANIFESTS) == list(UV_OWNED_MANIFESTS)
    assert still_scanned(literal, UV_OWNED_MANIFESTS) == []
    assert still_scanned(globbed, UV_OWNED_MANIFESTS) == []
    assert still_scanned(partial, UV_OWNED_MANIFESTS) == ["pyproject.toml"]


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


def load(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


@pytest.fixture
def ha_latest() -> dict[str, Any]:
    return load(HA_LATEST_PATH)


@pytest.fixture
def card_smoke() -> dict[str, Any]:
    return load(CARD_SMOKE_PATH)


@pytest.mark.parametrize("path", [path for path, _ in SCHEDULED_WORKFLOWS])
def test_a_scheduled_workflow_reports_no_required_contexts(path: Path) -> None:
    """A monthly run must never become a check a pull request waits on.

    Neither has a pull-request trigger, so neither reports on one and the ruleset
    needs no edit. Adding that trigger to either would put check names into
    ``available_contexts()`` that no pull request can satisfy quickly — the card
    smoke's worst, since it boots Home Assistant twice.
    """
    assert workflow_contexts(load(path)) == set()


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


@pytest.mark.parametrize(("path", "cron"), SCHEDULED_WORKFLOWS)
def test_a_scheduled_workflow_is_dispatchable_and_on_its_own_slot(path: Path, cron: str) -> None:
    """Both triggers: the cron is the point, and dispatch is how it is proved."""
    triggers = workflow_triggers(load(path))

    assert "workflow_dispatch" in triggers
    assert [entry["cron"] for entry in triggers["schedule"]] == [cron]


def test_the_card_smoke_opts_into_the_online_test(card_smoke: dict[str, Any]) -> None:
    """Its own green-and-worthless mode.

    `e2e/live-updates.smoke.mjs` is opt-in: without ``RUN_ONLINE`` it prints SKIP
    and exits 0, so the job would boot Home Assistant twice, drive nothing and
    pass. The flag has to be on the step that runs it, not merely somewhere in
    the file.
    """
    steps = [
        step
        for job in card_smoke["jobs"].values()
        for step in job.get("steps", [])
        if "live-updates.smoke.mjs" in str(step.get("run", ""))
    ]

    assert steps, "no step runs the live-update smoke"
    for step in steps:
        assert str(step.get("env", {}).get("RUN_ONLINE", "")) == "1"


def test_the_scheduled_runs_do_not_share_a_notification_label(
    ha_latest: dict[str, Any], card_smoke: dict[str, Any]
) -> None:
    """One label between them would have each closing the other's report."""

    def labels(workflow: dict[str, Any]) -> set[str]:
        commands = "\n".join(
            str(step["run"])
            for job in workflow["jobs"].values()
            for step in job.get("steps", [])
            if "run" in step
        )
        return set(re.findall(r"ci:[a-z-]+", commands))

    ha_latest_labels, card_smoke_labels = labels(ha_latest), labels(card_smoke)

    assert ha_latest_labels and card_smoke_labels
    assert ha_latest_labels.isdisjoint(card_smoke_labels)


def test_every_notification_label_is_declared_as_code(
    ha_latest: dict[str, Any], card_smoke: dict[str, Any]
) -> None:
    """`gh issue create` refuses a label the repository does not have.

    So a label named in a workflow and missing from `.github/labels.yml` is not a
    cosmetic gap — it is the notification failing on the month it is needed.
    """
    declared = {
        entry["name"]
        for entry in yaml.safe_load((REPO_ROOT / ".github" / "labels.yml").read_text("utf-8"))
    }
    used = set(
        re.findall(
            r"ci:[a-z-]+",
            "\n".join(
                str(step["run"])
                for workflow in (ha_latest, card_smoke)
                for job in workflow["jobs"].values()
                for step in job.get("steps", [])
                if "run" in step
            ),
        )
    )

    assert used, "no notification label is named by either scheduled workflow"
    assert used <= declared, f"undeclared: {sorted(used - declared)}"
