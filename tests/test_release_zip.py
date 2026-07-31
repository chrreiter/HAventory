"""The HACS release asset must extract to a working integration directory.

The asset itself only exists on a tag build, so what is testable here is the
check that runs there: ``scripts/check_release_zip.py``. Each case builds the
archive shape a plausible packaging mistake would produce and asserts the check
rejects it — the mistakes all install cleanly and do nothing, so a check that
quietly passes them is worth nothing.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from check_release_zip import check, extracted_path  # noqa: E402

GOOD_LAYOUT: dict[str, bytes] = {
    "__init__.py": b"async def async_setup_entry(): ...\n",
    "manifest.json": b'{"domain": "haventory"}',
    "const.py": b'DOMAIN = "haventory"\n',
    "translations/en.json": b"{}",
    "www/haventory-card.js": b"customElements.define('haventory-card', C);\n",
}


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
    ]


def test_a_card_build_that_never_ran_is_rejected(tmp_path: Path) -> None:
    """The bundle is git-ignored, so a zip of a clean checkout simply lacks it."""
    members = {
        name: payload for name, payload in GOOD_LAYOUT.items() if not name.startswith("www/")
    }

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["missing at the zip root: www/haventory-card.js"]


def test_an_empty_bundle_is_rejected(tmp_path: Path) -> None:
    """A zero-byte bundle is present, served, and defines no custom element."""
    members = {**GOOD_LAYOUT, "www/haventory-card.js": b""}

    problems = check(str(write_zip(tmp_path / "haventory.zip", members)))

    assert problems == ["empty at the zip root: www/haventory-card.js"]


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
