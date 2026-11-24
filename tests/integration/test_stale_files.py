"""Integration: setup sweeps the files earlier releases left in the install.

The sweep deletes files out of the installed integration directory, so a wrong
entry or a wrong manifest costs an operator's files or the card itself. These
tests load the entry through Home Assistant and check what is left on disk.
`_PACKAGE_DIR` is redirected at a throwaway directory because it normally names
this checkout's own `custom_components/haventory/`, which a test must never
delete from.
"""

from __future__ import annotations

import gzip
import logging
import zlib
from pathlib import Path
from typing import Any

import pytest
from custom_components.haventory import stale_files
from homeassistant.config_entries import ConfigEntryState

SWEEP_LOGGER = "custom_components.haventory.stale_files"

GOOD_MANIFEST = (
    '{"_core-aaa.js": {"file": "chunks/core-aaa.js"},'
    ' "src/index.ts": {"file": "haventory-card.js", "isEntry": true},'
    ' "src/runtime.ts": {"file": "chunks/runtime-bbb.js"}}'
)

ALL_CHUNKS = [
    "README.md",
    "core-aaa.js",
    "manifest.json",
    "old.js.map",
    "runtime-bbb.js",
    "runtime-old.js",
]


@pytest.fixture
def install_dir(tmp_path: Path, monkeypatch) -> Path:
    """A stand-in for the installed integration directory, safe to delete from."""

    directory = tmp_path / "custom_components" / "haventory"
    directory.mkdir(parents=True)
    monkeypatch.setattr(stale_files, "_PACKAGE_DIR", directory)
    return directory


def _warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [
        record
        for record in caplog.records
        if record.name == SWEEP_LOGGER and record.levelno >= logging.WARNING
    ]


async def test_setup_sweeps_only_the_listed_files(
    install_dir: Path, monkeypatch, caplog, setup_entry
) -> None:
    """Listed files go, others stay, and a refused unlink is only logged."""

    (install_dir / "www").mkdir()
    for name in (
        "reminders.py",
        "notes.txt",
        "www/haventory-card-old.js",
        "www/haventory-card.js",
        "locked.py",
    ):
        (install_dir / name).write_text("x\n", encoding="utf-8")
    monkeypatch.setattr(
        stale_files,
        "RETIRED_PATHS",
        ("reminders.py", "www/haventory-card-old.js", "locked.py", "absent.py"),
    )

    real_unlink = Path.unlink

    def _refuse_locked(self: Path, *args: Any, **kwargs: Any) -> None:
        if self.name == "locked.py":
            raise PermissionError(13, "Permission denied")
        real_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", _refuse_locked)

    entry = await setup_entry()

    assert entry.state is ConfigEntryState.LOADED
    assert not (install_dir / "reminders.py").exists()
    assert not (install_dir / "www" / "haventory-card-old.js").exists()
    assert (install_dir / "notes.txt").exists()
    assert (install_dir / "www" / "haventory-card.js").exists()
    assert (install_dir / "locked.py").exists()
    assert any("Could not remove a file" in record.getMessage() for record in _warnings(caplog))


@pytest.mark.parametrize("escape", ["../secrets.yaml", "www/../../secrets.yaml", "absolute"])
async def test_a_swept_path_that_escapes_the_package_is_refused(
    install_dir: Path, monkeypatch, caplog, setup_entry, escape: str
) -> None:
    """A typo in the list points into the operator's config tree; setup must not follow it."""

    if escape == "absolute":
        outside = install_dir.parents[2] / "elsewhere.yaml"
        listed = str(outside)
    else:
        outside = (install_dir / escape).resolve()
        listed = escape
    outside.parent.mkdir(parents=True, exist_ok=True)
    outside.write_text("token: secret\n", encoding="utf-8")
    monkeypatch.setattr(stale_files, "RETIRED_PATHS", (listed,))

    entry = await setup_entry()

    assert entry.state is ConfigEntryState.LOADED
    assert outside.read_text(encoding="utf-8") == "token: secret\n"
    assert any(
        "outside the integration directory" in record.getMessage() for record in _warnings(caplog)
    )


@pytest.mark.parametrize(
    ("manifest", "outcome"),
    [
        pytest.param(
            GOOD_MANIFEST,
            (["README.md", "core-aaa.js", "manifest.json", "old.js.map", "runtime-bbb.js"], None),
            id="listed",
        ),
        pytest.param(
            None,
            ([name for name in ALL_CHUNKS if name != "manifest.json"], None),
            id="no_manifest",
        ),
        pytest.param("{not json", (ALL_CHUNKS, "chunk manifest"), id="unparsable"),
        pytest.param("[]", (ALL_CHUNKS, "not in the expected shape"), id="not_a_mapping"),
        pytest.param(
            '{"src/index.ts": {}}',
            (ALL_CHUNKS, "not in the expected shape"),
            id="record_without_file",
        ),
    ],
)
async def test_setup_sweeps_the_chunks_the_manifest_does_not_name(
    install_dir: Path,
    caplog,
    setup_entry,
    manifest: str | None,
    outcome: tuple[list[str], str | None],
) -> None:
    """Only a readable manifest condemns a chunk, and only a `.js` file it does not name."""

    kept, warning = outcome
    chunks = install_dir / "www" / "chunks"
    chunks.mkdir(parents=True)
    entry_bundle = install_dir / "www" / "haventory-card.js"
    entry_bundle.write_text("// entry\n", encoding="utf-8")
    for name in ("core-aaa.js", "runtime-bbb.js", "runtime-old.js", "README.md", "old.js.map"):
        (chunks / name).write_text("x\n", encoding="utf-8")
    if manifest is not None:
        (chunks / "manifest.json").write_text(manifest, encoding="utf-8")

    entry = await setup_entry()

    assert entry.state is ConfigEntryState.LOADED
    assert entry_bundle.exists()
    assert sorted(path.name for path in chunks.iterdir()) == sorted(kept)
    messages = [record.getMessage() for record in _warnings(caplog)]
    if warning is None:
        assert messages == []
    else:
        assert any(warning in message for message in messages)


@pytest.mark.parametrize("brotli_available", [True, False], ids=["brotli", "no_brotli"])
async def test_setup_sweeps_compressed_copies_that_are_not_their_file(
    install_dir: Path, monkeypatch, setup_entry, brotli_available: bool
) -> None:
    """aiohttp serves a copy in place of its `.js` unchecked; only a matching one stays.

    The entry keeps its name across releases, so a copy-over install leaves the old
    entry's copies beside the new entry. Without a Brotli decoder a `.br` cannot be
    checked and goes; the `.gz` beside it is served instead.
    """

    # Stands in for Brotli: the sweep only needs a decoder that inverts the encoder.
    monkeypatch.setattr(
        stale_files, "_brotli_decompress", zlib.decompress if brotli_available else None
    )
    www = install_dir / "www"
    chunks = www / "chunks"
    chunks.mkdir(parents=True)
    (chunks / "manifest.json").write_text(GOOD_MANIFEST, encoding="utf-8")
    entry_js, old_entry = b"// entry v2\n", b"// entry v1\n"
    files = {
        "haventory-card.js": entry_js,
        "haventory-card.js.gz": gzip.compress(old_entry),
        "haventory-card.js.br": zlib.compress(entry_js),
        "chunks/core-aaa.js": b"core\n",
        "chunks/core-aaa.js.gz": gzip.compress(b"core\n"),
        "chunks/core-aaa.js.br": b"not brotli",
        "chunks/runtime-old.js": b"old\n",
        "chunks/runtime-old.js.gz": gzip.compress(b"old\n"),
        "chunks/gone.js.br": zlib.compress(b"gone\n"),
    }
    for name, payload in files.items():
        (www / name).write_bytes(payload)

    entry = await setup_entry()

    assert entry.state is ConfigEntryState.LOADED
    left = sorted(path.relative_to(www).as_posix() for path in www.rglob("*"))
    assert left == sorted(
        [
            "chunks",
            "chunks/core-aaa.js",
            "chunks/core-aaa.js.gz",
            "chunks/manifest.json",
            "haventory-card.js",
            *(["haventory-card.js.br"] if brotli_available else []),
        ]
    )


def test_no_retired_path_names_a_file_this_release_ships() -> None:
    """A live file on the list is a delete on every install that upgrades."""

    package_dir = Path(stale_files.__file__).parent

    still_shipped = [
        relative_path
        for relative_path in stale_files.RETIRED_PATHS
        if (package_dir / relative_path).exists()
    ]

    assert still_shipped == []


def test_every_retired_path_is_a_relative_posix_path_inside_the_package() -> None:
    """An entry the sweep refuses at runtime would be a silent no-op forever."""

    for relative_path in stale_files.RETIRED_PATHS:
        assert not Path(relative_path).is_absolute()
        assert "\\" not in relative_path
        assert ".." not in relative_path.split("/")
        assert stale_files._target_path(relative_path) is not None
