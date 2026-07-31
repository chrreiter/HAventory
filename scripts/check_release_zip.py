#!/usr/bin/env python3
"""Assert the HACS release zip extracts to a usable integration directory.

With ``zip_release`` set, HACS downloads the release asset named in ``hacs.json``
and extracts it *straight into* ``<config>/custom_components/haventory/``. It
strips no prefix, so a zip built one directory too high lands as
``custom_components/haventory/haventory/manifest.json`` — which Home Assistant
reads as no integration at all. Nothing errors: the install reports success and
the user has no HAventory. The same goes for a missing or empty card bundle,
which yields an integration whose card silently never registers.

The zip is only built on a tag, so the layout has exactly one chance to be right.
This check runs there, on the real asset, before the release is published.

Run as ``check_release_zip.py <path-to-zip>``; exits non-zero with the offending
paths listed on failure.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from collections.abc import Iterable

# Paths as they must appear once HACS has extracted the asset, relative to the
# integration directory. `__init__.py` makes the directory importable,
# `manifest.json` makes it an integration, and `www/haventory-card.js` is the
# bundle the integration serves at `/haventory_static/` — a release missing any
# of the three installs cleanly and does nothing.
REQUIRED_MEMBERS: tuple[str, ...] = (
    "__init__.py",
    "manifest.json",
    "www/haventory-card.js",
)

# Members that must carry bytes. A zero-byte bundle is the failure mode a
# presence check cannot see: the static route serves it, the browser parses
# nothing, and no custom element is ever defined.
NON_EMPTY_MEMBERS: tuple[str, ...] = ("www/haventory-card.js",)


def extracted_path(name: str) -> str:
    """Where ``zipfile.extractall`` writes ``name``, relative to its target.

    Mirrors ``ZipFile._extract_member``'s sanitizing: empty, ``.`` and ``..``
    components are dropped, which is why a ``./`` prefix from ``zip -r <zip> .``
    is harmless while a real ``haventory/`` prefix is not. Reimplemented here
    because that method is private and takes a destination directory.
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

    # `zip -x '*__pycache__*'` is a glob against the shell's idea of the tree; a
    # renamed cache directory or a stray `.pyc` slips past it, and HACS would
    # install bytecode compiled against whatever Python built the release.
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
