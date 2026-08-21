"""The dev helpers resolve one instance, and say which one before they act.

``scripts/dev_env.py`` is the single answer to "which Home Assistant is this
run about to touch". A shell profile that exports ``HA_BASE_URL``/``HA_TOKEN``
for one instance must not silently outrank the ``.env`` sitting in the checkout
the helper was started from, and the resolved target has to be printed rather
than inferred from a count that looks off.
"""

# The tokens below are fixtures; S105 cannot tell a fake one from a real one.
# ruff: noqa: S105

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from dev_env import (  # noqa: E402
    DEFAULT_BASE_URL,
    IGNORE_FLAG,
    load_env,
    parse_env_file,
    target_lines,
)

ENV_A = "HA_BASE_URL=http://instance-a:8123\nHA_TOKEN=token-a\n"


def test_env_file_beats_an_inherited_export(tmp_path: Path) -> None:
    """The worktree's .env names the instance that worktree is for."""
    (tmp_path / ".env").write_text(ENV_A, encoding="utf-8")
    env = {"HA_BASE_URL": "http://instance-b:8123", "HA_TOKEN": "token-b"}

    target = load_env(tmp_path, env)

    assert env["HA_BASE_URL"] == "http://instance-a:8123"
    assert env["HA_TOKEN"] == "token-a"
    assert target.base_url == "http://instance-a:8123"
    assert target.token == "token-a"
    assert target.overrode == ("HA_BASE_URL", "HA_TOKEN")
    assert target.source == str(tmp_path / ".env")


def test_keys_the_file_does_not_declare_survive(tmp_path: Path) -> None:
    """A per-command HA_CONTAINER=... still reaches the helper.

    The .env deliberately declares no container (setting one there arms
    ``scripts/smoke_online.sh`` to purge that container's store), so overriding
    the whole environment rather than the declared keys would break the one way
    the container is named.
    """
    (tmp_path / ".env").write_text(ENV_A, encoding="utf-8")
    env = {"HA_CONTAINER": "throwaway-ha"}

    load_env(tmp_path, env)

    assert env["HA_CONTAINER"] == "throwaway-ha"


def test_the_ignore_flag_hands_the_decision_back(tmp_path: Path) -> None:
    """A recipe pointing a helper at a remote instance says so out loud."""
    (tmp_path / ".env").write_text(ENV_A, encoding="utf-8")
    env = {
        "HA_BASE_URL": "http://release-host:8123",
        "HA_TOKEN": "token-b",
        IGNORE_FLAG: "1",
    }

    target = load_env(tmp_path, env)

    assert target.base_url == "http://release-host:8123"
    assert target.token == "token-b"
    assert target.overrode == ()
    assert IGNORE_FLAG in target.source
    assert IGNORE_FLAG in target_lines(target)[0]


def test_no_env_file_leaves_the_environment_alone(tmp_path: Path) -> None:
    """Nothing to be more specific than: the export is the only statement there is."""
    env = {"HA_BASE_URL": "http://instance-b:8123"}

    target = load_env(tmp_path, env)

    assert target.base_url == "http://instance-b:8123"
    assert target.env_file is None
    assert target.overrode == ()


def test_an_unset_base_url_falls_back_to_the_local_default(tmp_path: Path) -> None:
    target = load_env(tmp_path, {})

    assert target.base_url == DEFAULT_BASE_URL
    assert target.token is None


def test_a_value_the_environment_already_agrees_with_is_not_reported(tmp_path: Path) -> None:
    """ "Overrode" means the target moved; repeating a value is not a warning."""
    (tmp_path / ".env").write_text(ENV_A, encoding="utf-8")
    env = {"HA_BASE_URL": "http://instance-a:8123"}

    assert load_env(tmp_path, env).overrode == ()


def test_parse_skips_comments_and_blanks() -> None:
    parsed = parse_env_file("# a comment\n\nHA_BASE_URL=http://x:8123\nnot-a-pair\nHA_TOKEN=t\n")

    assert parsed == {"HA_BASE_URL": "http://x:8123", "HA_TOKEN": "t"}


def test_the_banner_names_the_url_the_counts_and_the_write(tmp_path: Path) -> None:
    """What the operator reads before a destructive command starts."""
    (tmp_path / ".env").write_text(ENV_A, encoding="utf-8")
    target = load_env(tmp_path, {"HA_BASE_URL": "http://instance-b:8123"})

    counts = {"items_total": 1079, "locations_total": 48, "status_counts": {"ok": 1079}}
    lines = target_lines(target, counts=counts, action="bulk")

    assert "HA_BASE_URL=http://instance-a:8123" in lines[0]
    assert "HA_BASE_URL=http://instance-b:8123" in lines[1]
    assert lines[2].endswith("items_total=1079 locations_total=48")  # and nothing else
    assert "bulk writes to this instance" in lines[3]
    assert all(line.isascii() for line in lines)


def test_the_banner_never_prints_a_displaced_token(tmp_path: Path) -> None:
    """The displaced base URL is the tell; the displaced token is a secret."""
    (tmp_path / ".env").write_text(ENV_A, encoding="utf-8")
    target = load_env(tmp_path, {"HA_TOKEN": "token-b"})

    lines = target_lines(target, counts={"items_total": 0})

    assert any("HA_TOKEN" in line for line in lines)
    assert not any("token-b" in line for line in lines)


def test_the_banner_says_why_the_counts_are_missing(tmp_path: Path) -> None:
    """An unreachable or unloaded instance still gets its URL named."""
    lines = target_lines(load_env(tmp_path, {}), unavailable="unknown_command: haventory/health")

    assert "unavailable (unknown_command: haventory/health)" in lines[1]
    assert not any("writes to this instance" in line for line in lines)
