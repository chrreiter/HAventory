"""Integration: the retired-files sweep runs on Home Assistant's own executor.

Setup deletes files out of the installed integration directory, and it does so
through `hass.async_add_executor_job` — on HA's thread pool in production, and
on a bare loop executor offline. What only a real core can show is that the
deletion is complete by the time the rest of setup runs: the sweep is awaited
inside `async_setup_entry`, ahead of the step that serves the card directory,
so a retired bundle is gone before anything can be served from beside it.

`_PACKAGE_DIR` is redirected at a throwaway directory the same way the offline
tests do it. The directory it normally names is this checkout's own
`custom_components/haventory/`, and a test that wrote probe files into the tree
it is testing would leave them behind on any failure — the executor, the
setup ordering and the escape guard are all exercised either way.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from custom_components.haventory import stale_files
from custom_components.haventory.const import DOMAIN
from custom_components.haventory.runtime import find_runtime
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

RETIRED_MODULE = "reminders.py"


@pytest.fixture
def install_dir(tmp_path: Path, monkeypatch) -> Path:
    """A stand-in for the installed integration directory, safe to delete from."""

    directory = tmp_path / "custom_components" / "haventory"
    directory.mkdir(parents=True)
    monkeypatch.setattr(stale_files, "_PACKAGE_DIR", directory)
    return directory


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_setup_sweeps_a_retired_file_through_the_real_executor(
    hass: HomeAssistant, install_dir: Path, monkeypatch
) -> None:
    """The upgrade case, end to end: the file is gone and the entry is loaded."""

    monkeypatch.setattr(stale_files, "RETIRED_PATHS", (RETIRED_MODULE,))
    left_behind = install_dir / RETIRED_MODULE
    left_behind.write_text("LEGACY = True\n", encoding="utf-8")

    entry = await _setup(hass)

    assert entry.state is ConfigEntryState.LOADED
    assert not left_behind.exists()
    # Setup carried on past the sweep rather than the sweep being all that ran.
    assert find_runtime(hass) is not None


async def test_a_swept_path_that_escapes_the_package_is_refused_on_the_executor(
    hass: HomeAssistant, install_dir: Path, monkeypatch, caplog
) -> None:
    """A typo in the list points into the operator's config tree; setup must not follow it."""

    monkeypatch.setattr(stale_files, "RETIRED_PATHS", ("../secrets.yaml",))
    outside = (install_dir / "../secrets.yaml").resolve()
    outside.write_text("token: secret\n", encoding="utf-8")

    entry = await _setup(hass)

    assert entry.state is ConfigEntryState.LOADED
    assert outside.read_text(encoding="utf-8") == "token: secret\n"
    assert any("outside the integration directory" in record.message for record in caplog.records)
