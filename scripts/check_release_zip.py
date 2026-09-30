#!/usr/bin/env python3
"""Assert the HACS release zip extracts to a usable integration directory.

With ``zip_release`` set, HACS extracts the asset *straight into*
``<config>/custom_components/haventory/`` and strips no prefix, so a zip built one
directory too high installs no integration and reports success. A missing or empty
card bundle silently never registers the card. The zip is only built on a tag, so
this runs on the real asset before the release is published.

Run as ``check_release_zip.py <path-to-zip>``; exits non-zero listing the offending
paths.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from collections.abc import Iterable

# Paths as they must appear once HACS has extracted the asset; a release missing
# any of the three installs cleanly and does nothing.
REQUIRED_MEMBERS: tuple[str, ...] = (
    "__init__.py",
    "manifest.json",
    "www/haventory-card.js",
)

# A zero-byte bundle passes a presence check but defines no custom element.
NON_EMPTY_MEMBERS: tuple[str, ...] = ("www/haventory-card.js",)


def extracted_path(name: str) -> str:
    """Where ``zipfile.extractall`` writes ``name``, relative to its target.

    Mirrors its sanitizing (empty, ``.`` and ``..`` components dropped), so the
    ``./`` prefix from ``zip -r <zip> .`` is harmless and ``haventory/`` is not.
    """
    return "/".join(part for part in name.split("/") if part not in ("", ".", ".."))


def layout_problems(names: Iterable[str], sizes: dict[str, int]) -> list[str]:
    """Every reason the given zip member list would install wrong, in order."""
    extracted = {extracted_path(name) for name in names}
    problems = [
        f"missing at the zip root: {member}"
        for member in REQUIRED_MEMBERS
        if member not in extracted
    ]

    problems += [
        f"empty at the zip root: {member}"
        for member in NON_EMPTY_MEMBERS
        if member in extracted and sizes.get(member, 0) == 0
    ]

    # `zip -x '*__pycache__*'` misses a stray `.pyc`, which HACS would install.
    problems += [
        f"build artifact: {name}"
        for name in sorted(names)
        if "__pycache__" in name or name.endswith((".pyc", ".pyo"))
    ]

    return problems


def check(zip_path: str) -> list[str]:
    """Layout problems in the archive at ``zip_path`` (empty list means good)."""
    with zipfile.ZipFile(zip_path) as archive:
        infos = archive.infolist()
    sizes = {extracted_path(info.filename): info.file_size for info in infos}
    return layout_problems([info.filename for info in infos], sizes)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_path", help="Path to the release asset to check.")
    args = parser.parse_args()

    problems = check(args.zip_path)
    if problems:
        print(f"{args.zip_path} would not install as an integration:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    print(f"OK: {args.zip_path} extracts to a complete integration directory")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
