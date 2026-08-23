"""Offline tests for the sweep of files earlier releases left in the install.

The sweep deletes files out of the directory the integration itself lives in, so
every case here points it at a throwaway directory instead (``install_dir``).
Two of the tests never touch it: they check the shipped list itself, and they are
the ones that matter most — a path listed by mistake is a delete on every install
that upgrades.
"""

from __future__ import annotations

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
