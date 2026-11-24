"""The HACS release asset must extract to a working integration directory.

The asset itself only exists on a tag build, so what is testable here is the
check that runs there: ``scripts/check_release_zip.py``. Each case builds the
archive shape a plausible packaging mistake would produce and asserts the check
rejects it — the mistakes all install cleanly and do nothing, so a check that
quietly passes them is worth nothing.
"""

from __future__ import annotations

import gzip
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from check_release_zip import check, extracted_path  # noqa: E402

CHUNK_MANIFEST = {
    "_core-aaa.js": {"file": "chunks/core-aaa.js", "name": "core"},
    "src/index.ts": {"file": "haventory-card.js", "isEntry": True, "imports": ["_core-aaa.js"]},
    "src/runtime.ts": {"file": "chunks/runtime-bbb.js", "isDynamicEntry": True},
}


def node_brotli(data: bytes) -> bytes:
    """Brotli-encode with ``node:zlib``, the library the card build uses."""
    node = shutil.which("node")
    assert node is not None, "the release check decodes .br copies with node"
    return subprocess.run(  # noqa: S603 - fixed program, data only on stdin
        [
            node,
            "-e",
            "process.stdout.write(require('node:zlib').brotliCompressSync("
            "require('node:fs').readFileSync(0)))",
        ],
        input=data,
        capture_output=True,
        check=True,
    ).stdout


def with_copies(members: dict[str, bytes]) -> dict[str, bytes]:
    """``members`` plus the ``.br`` and ``.gz`` copy the build writes beside each ``.js``."""
    copies: dict[str, bytes] = {}
    for name, payload in members.items():
        if name.startswith("www/") and name.endswith(".js"):
            copies[f"{name}.br"] = node_brotli(payload)
            copies[f"{name}.gz"] = gzip.compress(payload)
    return {**members, **copies}


BUILD: dict[str, bytes] = {
    "__init__.py": b"async def async_setup_entry(): ...\n",
    "manifest.json": b'{"domain": "haventory"}',
    "const.py": b'DOMAIN = "haventory"\n',
    "translations/en.json": b"{}",
    "www/haventory-card.js": b"import './chunks/core-aaa.js';\n",
    "www/chunks/manifest.json": json.dumps(CHUNK_MANIFEST).encode(),
    "www/chunks/core-aaa.js": b"customElements.define('haventory-card', C);\n",
    "www/chunks/runtime-bbb.js": b"export const runtime = 1;\n",
}
GOOD_LAYOUT = with_copies(BUILD)


def write_zip(path: Path, members: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return path


def test_a_correctly_built_asset_passes(tmp_path: Path) -> None:
    assert check(str(write_zip(tmp_path / "haventory.zip", GOOD_LAYOUT))) == []


def test_a_leading_dot_slash_is_not_a_prefix(tmp_path: Path) -> None:
    """``zip -r ../../haventory.zip .`` may store ``./`` — extraction drops it."""
    members = {f"./{name}": payload for name, payload in GOOD_LAYOUT.items()}

    assert check(str(write_zip(tmp_path / "haventory.zip", members))) == []


def test_zipping_one_directory_too_high_is_rejected(tmp_path: Path) -> None:
    """The failure this check exists for: HACS strips no prefix on extraction."""
    members = {f"haventory/{name}": payload for name, payload in GOOD_LAYOUT.items()}

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == [
        "missing at the zip root: __init__.py",
        "missing at the zip root: manifest.json",
        "missing at the zip root: www/haventory-card.js",
        "missing at the zip root: www/chunks/manifest.json",
    ]


def test_a_card_build_that_never_ran_is_rejected(tmp_path: Path) -> None:
    """The bundle is git-ignored, so a zip of a clean checkout simply lacks it."""
    members = {
        name: payload for name, payload in GOOD_LAYOUT.items() if not name.startswith("www/")
    }

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == [
        "missing at the zip root: www/haventory-card.js",
        "missing at the zip root: www/chunks/manifest.json",
    ]


def test_an_empty_bundle_is_rejected(tmp_path: Path) -> None:
    """A zero-byte bundle is present, served, and defines no custom element."""
    members = with_copies({**BUILD, "www/haventory-card.js": b""})

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["empty at the zip root: www/haventory-card.js"]


def test_a_zip_without_the_chunk_manifest_is_rejected(tmp_path: Path) -> None:
    """Without the manifest nothing says which chunks the card needs."""
    members = {k: v for k, v in GOOD_LAYOUT.items() if k != "www/chunks/manifest.json"}

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["missing at the zip root: www/chunks/manifest.json"]


def test_a_chunk_the_manifest_names_but_the_zip_lacks_is_rejected(tmp_path: Path) -> None:
    """A missing chunk installs cleanly and leaves the card blank."""
    members = {k: v for k, v in GOOD_LAYOUT.items() if not k.startswith("www/chunks/runtime-bbb")}

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["chunk the manifest names is missing: www/chunks/runtime-bbb.js"]


def test_a_chunk_the_manifest_does_not_name_is_rejected(tmp_path: Path) -> None:
    """A stale build's chunk that leaked into the asset ships to every install."""
    members = with_copies({**BUILD, "www/chunks/runtime-old.js": b"export const runtime = 0;\n"})

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["chunk the manifest does not name: www/chunks/runtime-old.js"]


def test_an_empty_chunk_is_rejected(tmp_path: Path) -> None:
    """A zero-byte chunk is served fine and defines nothing."""
    members = with_copies({**BUILD, "www/chunks/runtime-bbb.js": b""})

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["empty chunk: www/chunks/runtime-bbb.js"]


def test_a_chunk_that_imports_the_entry_is_rejected(tmp_path: Path) -> None:
    """The import carries no ``?v=``, so the entry loads twice and defines elements twice."""
    members = with_copies(
        {**BUILD, "www/chunks/runtime-bbb.js": b"import './../haventory-card.js';\n"}
    )

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["chunk imports the entry: www/chunks/runtime-bbb.js"]


@pytest.mark.parametrize(
    "manifest",
    [b"not json", b"[]", b'{"src/index.ts": "haventory-card.js"}', b'{"src/index.ts": {}}'],
)
def test_a_manifest_in_the_wrong_shape_is_rejected(tmp_path: Path, manifest: bytes) -> None:
    """Unparsable or foreign JSON cannot vouch for the chunks beside it."""
    members = {**GOOD_LAYOUT, "www/chunks/manifest.json": manifest}

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["not a build manifest: www/chunks/manifest.json"]


OLD_ENTRY = b"import './chunks/core-old.js';\n"


@pytest.mark.parametrize(
    ("change", "problem"),
    [
        pytest.param(
            {"www/haventory-card.js.br": node_brotli(OLD_ENTRY)},
            "compressed copy differs from its file: www/haventory-card.js.br",
            id="stale_entry_br",
        ),
        pytest.param(
            {"www/chunks/core-aaa.js.gz": gzip.compress(OLD_ENTRY)},
            "compressed copy differs from its file: www/chunks/core-aaa.js.gz",
            id="stale_chunk_gz",
        ),
        pytest.param(
            {"www/haventory-card.js.br": b"not brotli"},
            "compressed copy does not decompress: www/haventory-card.js.br",
            id="undecodable",
        ),
        pytest.param(
            {"www/chunks/runtime-old.js.br": node_brotli(b"export const runtime = 0;\n")},
            "compressed copy without its file: www/chunks/runtime-old.js.br",
            id="orphan",
        ),
        pytest.param(
            {"www/chunks/runtime-bbb.js.gz": None},
            "compressed copy is missing: www/chunks/runtime-bbb.js.gz",
            id="missing",
        ),
    ],
)
def test_a_compressed_copy_that_is_not_its_file_is_rejected(
    tmp_path: Path, change: dict[str, bytes | None], problem: str
) -> None:
    """Home Assistant serves the copy in place of the ``.js``, whatever bytes it holds."""
    members = {
        name: payload for name, payload in {**GOOD_LAYOUT, **change}.items() if payload is not None
    }

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert [line.split(" (")[0] for line in problems] == [problem]


@pytest.mark.parametrize(
    "artifact", ["__pycache__/const.cpython-314.pyc", "const.pyc", "translations/en.pyo"]
)
def test_build_artifacts_are_rejected(tmp_path: Path, artifact: str) -> None:
    """The workflow's exclude glob is a shell pattern; this is the backstop."""
    members = {**GOOD_LAYOUT, artifact: b"\x00"}

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == [f"build artifact: {artifact}"]


@pytest.mark.parametrize(
    ("stored", "extracted"),
    [
        ("manifest.json", "manifest.json"),
        ("./manifest.json", "manifest.json"),
        ("www/", "www"),
        ("../manifest.json", "manifest.json"),
        ("/manifest.json", "manifest.json"),
    ],
)
def test_extracted_path_matches_zipfile_sanitizing(stored: str, extracted: str) -> None:
    """Absolute and parent-relative members cannot escape the target directory."""
    assert extracted_path(stored) == extracted
