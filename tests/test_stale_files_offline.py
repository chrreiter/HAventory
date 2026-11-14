"""Offline tests for the sweep of files earlier releases left in the install.

The sweep deletes files out of the directory the integration itself lives in, so
every case here points it at a throwaway directory instead (``install_dir``).
Two of the tests never touch it: they check the shipped list itself, and they are
the ones that matter most — a path listed by mistake is a delete on every install
that upgrades.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import custom_components.haventory as haven_init
import pytest
from custom_components.haventory import stale_files
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant


@pytest.fixture
def install_dir(tmp_path: Path, monkeypatch) -> Path:
    """A stand-in for the installed integration directory, safe to delete from."""
    directory = tmp_path / "custom_components" / "haventory"
    directory.mkdir(parents=True)
    monkeypatch.setattr(stale_files, "_PACKAGE_DIR", directory)
    return directory


@pytest.mark.asyncio
async def test_a_retired_file_is_removed(install_dir: Path) -> None:
    """The case the sweep exists for: the upgrade left the old module behind."""
    stale = install_dir / "reminders.py"
    stale.write_text("LEGACY = True\n", encoding="utf-8")

    removed = await stale_files.async_sweep_retired_files(HomeAssistant(), ["reminders.py"])

    assert removed == ("reminders.py",)
    assert not stale.exists()


@pytest.mark.asyncio
async def test_a_retired_file_that_is_absent_is_a_no_op(install_dir: Path) -> None:
    """Every install that never had the file — and every setup after the first."""
    removed = await stale_files.async_sweep_retired_files(HomeAssistant(), ["reminders.py"])

    assert removed == ()
    assert not (install_dir / "reminders.py").exists()


@pytest.mark.asyncio
async def test_a_file_that_is_not_listed_survives(install_dir: Path) -> None:
    """The list is the whole authority: an operator's own files sit in here too."""
    (install_dir / "reminders.py").write_text("LEGACY = True\n", encoding="utf-8")
    operator_file = install_dir / "notes.txt"
    operator_file.write_text("mine\n", encoding="utf-8")

    removed = await stale_files.async_sweep_retired_files(HomeAssistant(), ["reminders.py"])

    assert removed == ("reminders.py",)
    assert operator_file.read_text(encoding="utf-8") == "mine\n"


@pytest.mark.asyncio
async def test_a_renamed_bundle_is_swept_without_taking_its_replacement(
    install_dir: Path,
) -> None:
    """A renamed card bundle is the second way a release retires a path."""
    www = install_dir / "www"
    www.mkdir()
    (www / "haventory-card-old.js").write_text("// old\n", encoding="utf-8")
    current = www / "haventory-card.js"
    current.write_text("// current\n", encoding="utf-8")

    removed = await stale_files.async_sweep_retired_files(
        HomeAssistant(), ["www/haventory-card-old.js"]
    )

    assert removed == ("www/haventory-card-old.js",)
    assert current.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "escape", ["../secrets.yaml", "../../secrets.yaml", "www/../../secrets.yaml"]
)
async def test_a_path_outside_the_integration_directory_is_refused(
    install_dir: Path, escape: str, caplog
) -> None:
    """A typo in the list must not reach the operator's wider config tree."""
    outside = (install_dir / escape).resolve()
    outside.parent.mkdir(parents=True, exist_ok=True)
    outside.write_text("token: secret\n", encoding="utf-8")

    removed = await stale_files.async_sweep_retired_files(HomeAssistant(), [escape])

    assert removed == ()
    assert outside.read_text(encoding="utf-8") == "token: secret\n"
    assert any("outside the integration directory" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_an_absolute_path_is_refused(install_dir: Path, tmp_path: Path) -> None:
    """``package_dir / "/etc/passwd"`` is ``/etc/passwd`` — pathlib joins it away."""
    outside = tmp_path / "elsewhere.yaml"
    outside.write_text("token: secret\n", encoding="utf-8")

    removed = await stale_files.async_sweep_retired_files(HomeAssistant(), [str(outside)])

    assert removed == ()
    assert outside.exists()


@pytest.mark.asyncio
async def test_the_integration_directory_itself_is_refused(install_dir: Path) -> None:
    """A lone dot resolves to the install directory, which is not a file to unlink."""
    kept = install_dir / "const.py"
    kept.write_text('DOMAIN = "haventory"\n', encoding="utf-8")

    removed = await stale_files.async_sweep_retired_files(HomeAssistant(), ["."])

    assert removed == ()
    assert kept.exists()


@pytest.mark.asyncio
async def test_a_file_that_cannot_be_removed_does_not_stop_the_sweep(
    install_dir: Path, monkeypatch, caplog
) -> None:
    """A read-only install directory is the operator's problem, not a setup failure."""
    (install_dir / "locked.py").write_text("LEGACY = True\n", encoding="utf-8")
    sweepable = install_dir / "reminders.py"
    sweepable.write_text("LEGACY = True\n", encoding="utf-8")

    real_unlink = Path.unlink

    def _refuse_one(self: Path, *args, **kwargs):  # type: ignore[no-untyped-def]
        if self.name == "locked.py":
            raise PermissionError(13, "Permission denied")
        return real_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", _refuse_one)

    removed = await stale_files.async_sweep_retired_files(
        HomeAssistant(), ["locked.py", "reminders.py"]
    )

    assert removed == ("reminders.py",)
    assert not sweepable.exists()
    assert any("Could not remove a file" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_nothing_retired_touches_no_files_at_all() -> None:
    """With an empty list the sweep costs nothing — not even an executor hop."""

    class _NoExecutor(HomeAssistant):
        async def async_add_executor_job(self, target, *args):  # type: ignore[no-untyped-def]
            raise AssertionError("the sweep ran with nothing retired")

    assert await stale_files.async_sweep_retired_files(_NoExecutor(), ()) == ()


@pytest.mark.asyncio
async def test_setup_entry_sweeps_the_retired_paths(install_dir: Path, monkeypatch) -> None:
    """The sweep is wired into setup, which is the only thing that runs it."""
    stale = install_dir / "reminders.py"
    stale.write_text("LEGACY = True\n", encoding="utf-8")
    monkeypatch.setattr(stale_files, "RETIRED_PATHS", ("reminders.py",))

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    assert await haven_init.async_setup_entry(HomeAssistant(), ConfigEntry()) is True
    assert not stale.exists()


MANIFEST = {
    "_core-aaa.js": {"file": "chunks/core-aaa.js"},
    "src/index.ts": {"file": "haventory-card.js", "isEntry": True},
    "src/runtime.ts": {"file": "chunks/runtime-bbb.js"},
}


@pytest.fixture
def chunks_dir(install_dir: Path) -> Path:
    """``www/chunks/`` inside the stand-in install, with its two current chunks."""
    directory = install_dir / "www" / "chunks"
    directory.mkdir(parents=True)
    (directory / "core-aaa.js").write_text("// core\n", encoding="utf-8")
    (directory / "runtime-bbb.js").write_text("// runtime\n", encoding="utf-8")
    return directory


def _write_manifest(directory: Path, payload: object) -> None:
    (directory / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")


@pytest.mark.asyncio
async def test_an_unlisted_chunk_is_removed_and_listed_ones_survive(chunks_dir: Path) -> None:
    """Chunk names change with their content, so an upgrade leaves the old ones behind."""
    _write_manifest(chunks_dir, MANIFEST)
    (chunks_dir / "runtime-old.js").write_text("// old\n", encoding="utf-8")

    removed = await stale_files.async_sweep_stale_chunks(HomeAssistant())

    assert removed == ("runtime-old.js",)
    assert not (chunks_dir / "runtime-old.js").exists()
    assert (chunks_dir / "core-aaa.js").exists()
    assert (chunks_dir / "runtime-bbb.js").exists()
    assert (chunks_dir / "manifest.json").exists()


@pytest.mark.asyncio
async def test_the_chunk_sweep_accepts_an_explicit_directory(tmp_path: Path) -> None:
    """The directory argument overrides the package default."""
    directory = tmp_path / "chunks"
    directory.mkdir()
    _write_manifest(directory, MANIFEST)
    (directory / "core-aaa.js").write_text("// core\n", encoding="utf-8")
    (directory / "stale.js").write_text("// stale\n", encoding="utf-8")

    removed = await stale_files.async_sweep_stale_chunks(HomeAssistant(), directory)

    assert removed == ("stale.js",)
    assert (directory / "core-aaa.js").exists()


@pytest.mark.asyncio
async def test_without_a_manifest_no_chunk_is_removed(chunks_dir: Path) -> None:
    """A dev checkout or a half-extracted upgrade has no list to judge by."""
    removed = await stale_files.async_sweep_stale_chunks(HomeAssistant())

    assert removed == ()
    assert (chunks_dir / "core-aaa.js").exists()
    assert (chunks_dir / "runtime-bbb.js").exists()


@pytest.mark.asyncio
async def test_without_a_chunks_directory_the_sweep_is_a_no_op(install_dir: Path) -> None:
    """An install that has never had a chunked build."""
    assert await stale_files.async_sweep_stale_chunks(HomeAssistant()) == ()


@pytest.mark.asyncio
async def test_an_unparseable_manifest_removes_nothing_and_warns(chunks_dir: Path, caplog) -> None:
    """Deleting on a guess would take the current chunks down with the stale ones."""
    (chunks_dir / "manifest.json").write_text("{not json", encoding="utf-8")

    with caplog.at_level(logging.WARNING):
        removed = await stale_files.async_sweep_stale_chunks(HomeAssistant())

    assert removed == ()
    assert (chunks_dir / "core-aaa.js").exists()
    assert (chunks_dir / "runtime-bbb.js").exists()
    assert any("chunk manifest" in record.message for record in caplog.records)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload", [[], "text", {"src/index.ts": "haventory-card.js"}, {"src/index.ts": {}}]
)
async def test_a_manifest_of_the_wrong_shape_removes_nothing(
    chunks_dir: Path, payload: object, caplog
) -> None:
    """Valid JSON that is not a Vite manifest names no chunks, so it cannot condemn any."""
    _write_manifest(chunks_dir, payload)

    with caplog.at_level(logging.WARNING):
        removed = await stale_files.async_sweep_stale_chunks(HomeAssistant())

    assert removed == ()
    assert (chunks_dir / "core-aaa.js").exists()
    assert any("not in the expected shape" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_the_chunk_sweep_leaves_files_that_are_not_scripts(chunks_dir: Path) -> None:
    """An operator's own notes can sit in the directory; only ``*.js`` is a chunk."""
    _write_manifest(chunks_dir, MANIFEST)
    readme = chunks_dir / "README.md"
    readme.write_text("mine\n", encoding="utf-8")
    (chunks_dir / "old.js.map").write_text("{}", encoding="utf-8")

    removed = await stale_files.async_sweep_stale_chunks(HomeAssistant())

    assert removed == ()
    assert readme.read_text(encoding="utf-8") == "mine\n"
    assert (chunks_dir / "old.js.map").exists()


@pytest.mark.asyncio
async def test_the_chunk_sweep_never_touches_the_entry(chunks_dir: Path) -> None:
    """The entry sits in ``www/``, outside the manifest's chunk names."""
    _write_manifest(chunks_dir, MANIFEST)
    entry = chunks_dir.parent / "haventory-card.js"
    entry.write_text("// entry\n", encoding="utf-8")
    (chunks_dir / "stale.js").write_text("// stale\n", encoding="utf-8")

    await stale_files.async_sweep_stale_chunks(HomeAssistant())

    assert entry.read_text(encoding="utf-8") == "// entry\n"


def test_chunks_named_by_lists_only_the_files_under_chunks() -> None:
    """The entry is not a chunk, and each name is relative to ``chunks/``."""
    assert stale_files.chunks_named_by(MANIFEST) == frozenset({"core-aaa.js", "runtime-bbb.js"})


def test_chunks_named_by_an_entry_only_manifest_is_empty_not_invalid() -> None:
    """A build with no split chunks is a valid manifest that names none."""
    manifest = {"src/index.ts": {"file": "haventory-card.js"}}

    assert stale_files.chunks_named_by(manifest) == frozenset()


@pytest.mark.parametrize("manifest", [None, [], "x", 3, {"a": "b"}, {"a": {}}, {"a": {"file": 1}}])
def test_chunks_named_by_refuses_anything_that_is_not_a_build_manifest(manifest: object) -> None:
    """``None`` is the signal for 'do not sweep'; an empty set would condemn every chunk."""
    assert stale_files.chunks_named_by(manifest) is None


@pytest.mark.asyncio
async def test_setup_entry_sweeps_the_stale_chunks(chunks_dir: Path, monkeypatch) -> None:
    """The chunk sweep is wired into setup, which is the only thing that runs it."""
    _write_manifest(chunks_dir, MANIFEST)
    stale = chunks_dir / "runtime-old.js"
    stale.write_text("// old\n", encoding="utf-8")

    async def _fake_load(self):  # type: ignore[no-untyped-def]
        return {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}}

    monkeypatch.setattr(DomainStore, "async_load", _fake_load)

    assert await haven_init.async_setup_entry(HomeAssistant(), ConfigEntry()) is True
    assert not stale.exists()
    assert (chunks_dir / "core-aaa.js").exists()


def test_no_retired_path_names_a_file_this_release_ships() -> None:
    """A live file on the list is a delete on every install that upgrades."""
    package_dir = Path(haven_init.__file__).parent

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
