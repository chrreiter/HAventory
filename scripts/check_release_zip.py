#!/usr/bin/env python3
"""Assert the HACS release zip extracts to a usable integration directory.

With ``zip_release`` set, HACS extracts the asset *straight into*
``<config>/custom_components/haventory/`` and strips no prefix, so a zip built one
directory too high installs no integration and reports success. A missing or empty
card bundle silently never registers the card. The card's chunks are checked
against the manifest the build wrote beside them: one missing leaves the card
blank, one extra is a stale build that leaked into the asset, and one that
imports the entry by name loads it a second time without its ``?v=`` and
defines every element twice. Every ``.js`` under ``www/`` needs a ``.br`` and a
``.gz`` copy that decompress to it: Home Assistant serves those copies in its
place, so a missing one costs the transfer size and a wrong one serves other
code. A copy without its ``.js`` is a stale build's. The zip is only built on a
tag, so this runs on the real asset before the release is published.

The ``.br`` copies are decoded by Node's ``node:zlib``, the library the build
wrote them with: Node is on every host that builds the asset, and no Python
Brotli binding is.

Run as ``check_release_zip.py <path-to-zip>``; exits non-zero listing the offending
paths.
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import subprocess
import sys
import zipfile
from collections.abc import Callable, Iterable

# Paths as they must appear once HACS has extracted the asset; a release missing
# any of the three installs cleanly and does nothing.
REQUIRED_MEMBERS: tuple[str, ...] = (
    "__init__.py",
    "manifest.json",
    "www/haventory-card.js",
    "www/chunks/manifest.json",
)

# A zero-byte bundle passes a presence check but defines no custom element.
NON_EMPTY_MEMBERS: tuple[str, ...] = ("www/haventory-card.js",)


_ENTRY_FILE = "haventory-card.js"
_WWW_DIR = "www/"
_CHUNKS_DIR = "www/chunks/"
_CHUNK_MANIFEST = f"{_CHUNKS_DIR}manifest.json"
_COMPRESSED_SUFFIXES = (".br", ".gz")

# Reads one Brotli stream on stdin and writes it decoded to stdout.
_NODE_BROTLI_DECODE = (
    "try { process.stdout.write(require('node:zlib').brotliDecompressSync("
    "require('node:fs').readFileSync(0))) }"
    " catch (err) { process.stderr.write(err.message); process.exit(1) }"
)


def node_brotli_decompress(data: bytes) -> bytes:
    """Decode ``data`` with Node's Brotli; raises ``ValueError`` if it is not Brotli."""
    node = shutil.which("node")
    if node is None:
        raise ValueError("node is not on PATH, so no .br copy can be checked")
    result = subprocess.run(  # noqa: S603 - fixed program, data only on stdin
        [node, "-e", _NODE_BROTLI_DECODE], input=data, capture_output=True, check=False
    )
    if result.returncode != 0:
        lines = result.stderr.decode(errors="replace").strip().splitlines()
        raise ValueError(lines[0] if lines else f"node exited {result.returncode}")
    return result.stdout


def extracted_path(name: str) -> str:
    """Where ``zipfile.extractall`` writes ``name``, relative to its target.

    Mirrors its sanitizing (empty, ``.`` and ``..`` components dropped), so the
    ``./`` prefix from ``zip -r <zip> .`` is harmless and ``haventory/`` is not.
    """
    return "/".join(part for part in name.split("/") if part not in ("", ".", ".."))


def chunk_problems(manifest: object, chunks: dict[str, bytes], extracted: set[str]) -> list[str]:
    """What is wrong with the card's chunks, given the manifest and their bytes.

    ``chunks`` maps each ``www/chunks/*.js`` member to its contents.
    """
    if not isinstance(manifest, dict) or not all(
        isinstance(record, dict) and isinstance(record.get("file"), str)
        for record in manifest.values()
    ):
        return [f"not a build manifest: {_CHUNK_MANIFEST}"]

    files = {f"www/{record['file']}" for record in manifest.values()}
    listed = {file for file in files if file.startswith(_CHUNKS_DIR)}
    problems = [
        f"chunk the manifest names is missing: {file}" for file in sorted(listed - extracted)
    ]
    problems += [
        f"chunk the manifest does not name: {file}" for file in sorted(set(chunks) - listed)
    ]
    problems += [
        f"empty chunk: {file}" for file in sorted(listed & set(chunks)) if not chunks[file]
    ]
    problems += [
        f"chunk imports the entry: {file}"
        for file, body in sorted(chunks.items())
        if _ENTRY_FILE.encode() in body
    ]
    return problems


def compressed_problems(
    www_files: dict[str, bytes],
    brotli_decompress: Callable[[bytes], bytes] = node_brotli_decompress,
) -> list[str]:
    """What is wrong with the ``.br`` / ``.gz`` copies, given every ``www/`` member's bytes."""
    problems: list[str] = []
    for path in sorted(www_files):
        if path.endswith(_COMPRESSED_SUFFIXES) and path.rsplit(".", 1)[0] not in www_files:
            problems.append(f"compressed copy without its file: {path}")
    for path in sorted(p for p in www_files if p.endswith(".js")):
        for suffix in _COMPRESSED_SUFFIXES:
            copy = path + suffix
            if copy not in www_files:
                problems.append(f"compressed copy is missing: {copy}")
                continue
            decode = gzip.decompress if suffix == ".gz" else brotli_decompress
            try:
                decoded = decode(www_files[copy])
            except (OSError, EOFError, ValueError) as err:
                problems.append(f"compressed copy does not decompress: {copy} ({err})")
                continue
            if decoded != www_files[path]:
                problems.append(f"compressed copy differs from its file: {copy}")
    return problems


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
        by_path = {extracted_path(info.filename): info for info in infos if not info.is_dir()}
        www_files = {
            path: archive.read(info) for path, info in by_path.items() if path.startswith(_WWW_DIR)
        }
        chunks = {
            path: body
            for path, body in www_files.items()
            if path.startswith(_CHUNKS_DIR) and path.endswith(".js")
        }
        manifest_info = by_path.get(_CHUNK_MANIFEST)
        manifest_text = archive.read(manifest_info) if manifest_info else None
    sizes = {path: info.file_size for path, info in by_path.items()}
    problems = layout_problems([info.filename for info in infos], sizes)
    if manifest_text is not None:
        try:
            manifest = json.loads(manifest_text)
        except ValueError:
            manifest = None
        problems += chunk_problems(manifest, chunks, set(by_path))
    problems += compressed_problems(www_files)
    return problems


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
