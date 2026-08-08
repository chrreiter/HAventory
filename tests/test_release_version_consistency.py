"""The release version must be identical in every file that carries it.

This runs in the ordinary gate, so it fires on the release PR itself — the one
place where a version that release-please failed to rewrite is still cheap to
fix. The tag half of the same check runs on the tag build; see
``scripts/check_version_consistency.py``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import check_version_consistency  # noqa: E402
from check_version_consistency import collect_versions, tag_version  # noqa: E402

# The two sources release-please rewrites outside `extra-files`: the `python`
# release type owns pyproject, and the manifest file is its own bookkeeping.
NOT_EXTRA_FILES = {"pyproject.toml", ".release-please-manifest.json"}


def test_every_version_file_agrees() -> None:
    versions = collect_versions()

    # Named explicitly: a source that stops being collected would otherwise make
    # the agreement assertion pass by covering less.
    assert set(versions) == {
        "custom_components/haventory/manifest.json",
        ".release-please-manifest.json",
        "pyproject.toml",
        "cards/haventory-card/package.json",
        "cards/haventory-card/package-lock.json",
        "custom_components/haventory/const.py",
        "uv.lock",
    }
    assert len(set(versions.values())) == 1, f"version mismatch: {versions}"


def test_release_please_rewrites_every_collected_file() -> None:
    """Every file this check compares must be one release-please actually writes.

    Checking agreement only catches a file release-please forgot once the two
    have already diverged. This catches the wiring itself: a version file added
    to the check but never listed in ``extra-files`` would sit at the old
    version until the first release proved it.
    """
    config = json.loads((REPO_ROOT / "release-please-config.json").read_text(encoding="utf-8"))
    extra_files = config["packages"]["."]["extra-files"]
    listed = {entry["path"] if isinstance(entry, dict) else entry for entry in extra_files}

    assert listed == set(collect_versions()) - NOT_EXTRA_FILES


def test_release_please_rewrites_both_copies_in_the_card_lockfile() -> None:
    """The card lockfile needs one ``extra-files`` entry per copy of the version.

    The wiring check above compares paths, so a single entry for this file looks
    complete there while leaving the second copy at the previous release. A
    jsonpath that matches nothing is a silent no-op in release-please, so the
    entries themselves are the only place this can be asserted.
    """
    config = json.loads((REPO_ROOT / "release-please-config.json").read_text(encoding="utf-8"))
    jsonpaths = {
        entry["jsonpath"]
        for entry in config["packages"]["."]["extra-files"]
        if isinstance(entry, dict) and entry["path"] == "cards/haventory-card/package-lock.json"
    }

    assert jsonpaths == {"$.version", '$.packages[""].version'}


def _write_card_lock(root: Path, top: str, nested: str) -> None:
    path = root / "cards/haventory-card/package-lock.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"name": "haventory-card", "version": top, "packages": {"": {"version": nested}}}
        ),
        encoding="utf-8",
    )


def test_card_lock_version_reads_the_version_both_copies_agree_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_card_lock(tmp_path, "0.4.0", "0.4.0")
    monkeypatch.setattr(check_version_consistency, "REPO_ROOT", tmp_path)

    assert check_version_consistency._package_lock_version() == "0.4.0"


def test_card_lock_version_rejects_a_half_rewritten_lockfile(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One copy bumped and the other left behind must fail, not pick a winner."""
    _write_card_lock(tmp_path, "0.4.0", "0.3.1")
    monkeypatch.setattr(check_version_consistency, "REPO_ROOT", tmp_path)

    with pytest.raises(AssertionError, match="disagrees"):
        check_version_consistency._package_lock_version()


def test_tag_version_strips_the_prefix() -> None:
    assert tag_version("v0.1.0") == "0.1.0"
    assert tag_version("v1.0.0-rc.1") == "1.0.0-rc.1"


@pytest.mark.parametrize("tag", ["0.1.0", "v0.1", "release-0.1.0", "v0.1.0.1", ""])
def test_tag_version_rejects_non_release_tags(tag: str) -> None:
    """A tag that is not a release tag must fail loudly rather than parse."""
    with pytest.raises(AssertionError):
        tag_version(tag)
