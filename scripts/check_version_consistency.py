#!/usr/bin/env python3
"""Assert every version string in the repository agrees — and matches the tag.

Five files carry the release version, and release-please rewrites each of them
through a different mechanism: the `python` release type handles
``pyproject.toml``, two ``extra-files`` JSON entries handle the integration
manifest and the card's ``package.json``, a generic annotation handles
``const.py``, and the manifest file is release-please's own bookkeeping. Any one
of them can silently stop being rewritten — a moved line drops a generic
annotation, a renamed key orphans a jsonpath — and the failure mode is a release
that ships mismatched versions rather than an error.

Run with no arguments to check the files against each other. Pass ``--tag`` (or
set ``GITHUB_REF_NAME`` on a tag build) to also require the git tag to name the
same version, which is what closes the loop between the tag and what the
integration reports at runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _json_version(relative_path: str, key: str = "version") -> str:
    return json.loads((REPO_ROOT / relative_path).read_text(encoding="utf-8"))[key]


def _pyproject_version() -> str:
    with (REPO_ROOT / "pyproject.toml").open("rb") as handle:
        return str(tomllib.load(handle)["project"]["version"])


def _const_version() -> str:
    text = (REPO_ROOT / "custom_components/haventory/const.py").read_text(encoding="utf-8")
    match = re.search(r'^INTEGRATION_VERSION:\s*str\s*=\s*"([^"]+)"', text, flags=re.MULTILINE)
    if match is None:
        raise AssertionError("const.py: INTEGRATION_VERSION assignment not found")
    return match.group(1)


def collect_versions() -> dict[str, str]:
    """The declared version of every file that carries one, by source name."""
    return {
        "custom_components/haventory/manifest.json": _json_version(
            "custom_components/haventory/manifest.json"
        ),
        ".release-please-manifest.json": _json_version(".release-please-manifest.json", key="."),
        "pyproject.toml": _pyproject_version(),
        "cards/haventory-card/package.json": _json_version("cards/haventory-card/package.json"),
        "custom_components/haventory/const.py": _const_version(),
    }


def tag_version(tag: str) -> str:
    """The version a release tag names, e.g. ``v0.1.0`` -> ``0.1.0``."""
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", tag):
        raise AssertionError(f"tag {tag!r} is not a release tag of the form vMAJOR.MINOR.PATCH")
    return tag[1:]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tag",
        default=None,
        help="Release tag to check against (defaults to GITHUB_REF_NAME on a tag build).",
    )
    args = parser.parse_args()

    versions = collect_versions()
    distinct = set(versions.values())
    if len(distinct) != 1:
        print("Version mismatch across the repository:", file=sys.stderr)
        for source, version in sorted(versions.items()):
            print(f"  {version:>12}  {source}", file=sys.stderr)
        return 1

    declared = distinct.pop()

    tag = args.tag
    if tag is None and os.environ.get("GITHUB_REF_TYPE") == "tag":
        tag = os.environ.get("GITHUB_REF_NAME")

    if tag is not None:
        expected = tag_version(tag)
        if expected != declared:
            print(
                f"Tag {tag!r} names version {expected!r}, but the repository declares "
                f"{declared!r} in all {len(versions)} version files.",
                file=sys.stderr,
            )
            return 1
        print(f"OK: tag {tag} and all {len(versions)} version files agree on {declared}")
        return 0

    print(f"OK: all {len(versions)} version files agree on {declared}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
