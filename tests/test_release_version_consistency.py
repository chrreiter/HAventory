"""The release version must be identical in every file that carries it.

This runs in the ordinary gate, so it fires on the release PR itself — the one
place where a version that release-please failed to rewrite is still cheap to
fix. The tag half of the same check runs on the tag build; see
``scripts/check_version_consistency.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from check_version_consistency import collect_versions, tag_version  # noqa: E402


def test_every_version_file_agrees() -> None:
    versions = collect_versions()

    # Named explicitly: a source that stops being collected would otherwise make
    # the agreement assertion pass by covering less.
    assert set(versions) == {
        "custom_components/haventory/manifest.json",
        ".release-please-manifest.json",
        "pyproject.toml",
        "cards/haventory-card/package.json",
        "custom_components/haventory/const.py",
    }
    assert len(set(versions.values())) == 1, f"version mismatch: {versions}"


def test_tag_version_strips_the_prefix() -> None:
    assert tag_version("v0.1.0") == "0.1.0"
    assert tag_version("v1.0.0-rc.1") == "1.0.0-rc.1"


@pytest.mark.parametrize("tag", ["0.1.0", "v0.1", "release-0.1.0", "v0.1.0.1", ""])
def test_tag_version_rejects_non_release_tags(tag: str) -> None:
    """A tag that is not a release tag must fail loudly rather than parse."""
    with pytest.raises(AssertionError):
        tag_version(tag)
