"""Tests for frontend auto-registration of the HAventory card asset."""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
import threading
import types
from pathlib import Path
from typing import Any

import pytest

CARD_PATH = "/local/haventory/haventory-card.js"
MANIFEST_PATH = (
    Path(__file__).resolve().parents[1] / "custom_components" / "haventory" / "manifest.json"
)

# Distinguishes "leave the loader stub at its default (the shipped manifest)" from
# "register None", which makes the lookup raise the way an absent integration does.
_NO_OVERRIDE = object()


def manifest_version() -> str:
    """Version the shipped manifest declares, read independently of the module under test."""
    return str(json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))["version"])


def import_haventory(monkeypatch, lovelace_key: str):
    """Import the integration with ``homeassistant.components.lovelace`` stubbed.

    ``LOVELACE_DATA`` is bound at import time, so the stub has to be in
    ``sys.modules`` before the import and any cached module has to be dropped.
    """
    lovelace_module = types.SimpleNamespace(LOVELACE_DATA=lovelace_key)
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace", lovelace_module)
    sys.modules.pop("custom_components.haventory", None)
    return importlib.import_module("custom_components.haventory")


class MockResourceCollection:
    """Mock Lovelace resource collection in storage mode (create + update allowed)."""

    def __init__(self):
        self.loaded = True
        self._items: list[dict[str, Any]] = []
        self.created: list[dict[str, Any]] = []
        self.updated: list[tuple[str, dict[str, Any]]] = []

    def async_items(self) -> list[dict[str, Any]]:
        return self._items

    async def async_load(self):
        pass

    async def async_create_item(self, data: dict[str, Any]) -> dict[str, Any]:
        self.created.append(data)
        item = {"id": f"created_{len(self.created)}", **data}
        self._items.append(item)
        return item

    async def async_update_item(self, item_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        for item in self._items:
            if item.get("id") == item_id:
                item.update(updates)
                self.updated.append((item_id, updates))
                return item
        raise KeyError(item_id)


class MockYamlResourceCollection:
    """Lovelace resources in YAML mode: readable, with no create/update API."""

    def __init__(self, items: list[dict[str, Any]] | None = None):
        self.loaded = True
        self._items: list[dict[str, Any]] = list(items or [])

    def async_items(self) -> list[dict[str, Any]]:
        return self._items

    async def async_load(self):
        pass


class MockLovelaceData:
    """Mock Lovelace data container."""

    def __init__(self, resources: Any = None):
        self.resources = MockResourceCollection() if resources is None else resources


class HassStub:
    """Minimal Home Assistant stub."""

    def __init__(self, base_path: str) -> None:
        self.data: dict[str, Any] = {}
        self._base_path = base_path
        self.executor_jobs: list[Any] = []

    class _Config:
        def __init__(self, base_path: str) -> None:
            self._base_path = base_path

        def path(self, *parts: str) -> str:
            return os.path.join(self._base_path, *parts)

    @property
    def config(self):
        return self._config

    @config.setter
    def config(self, value):
        self._config = value

    async def async_add_executor_job(self, target, *args):
        """Mirror HA's executor offload, recording what got handed off.

        A real worker thread, not an inline call: it is what lets a test tell an
        event-loop file read apart from an offloaded one.
        """
        self.executor_jobs.append(target)
        return await asyncio.get_running_loop().run_in_executor(None, target, *args)


def make_hass(tmp_path, *, with_asset: bool = True, manifest: Any = _NO_OVERRIDE) -> HassStub:
    """Hass stub whose config dir is `tmp_path`, optionally holding the built card.

    `manifest` seeds what the loader hands back for the `haventory` domain: omit it
    for the shipped manifest, pass a dict to choose the version, pass None to make
    the lookup fail the way it does for an integration HA has not loaded.
    """
    if with_asset:
        asset_dir = tmp_path / "www" / "haventory"
        asset_dir.mkdir(parents=True, exist_ok=True)
        (asset_dir / "haventory-card.js").write_text("// test asset")
    hass = HassStub(str(tmp_path))
    hass.config = HassStub._Config(str(tmp_path))
    if manifest is not _NO_OVERRIDE:
        hass.data["__integration_manifests__"] = {"haventory": manifest}
    return hass


def track_manifest_reads(monkeypatch) -> list[int]:
    """Record the thread of every `Path.read_text` call from here on.

    HA's blocking-call protection flags exactly this call when it happens on the
    event loop thread, and answers it with a stack trace on every startup.
    """
    threads: list[int] = []
    real_read_text = Path.read_text

    def tracking_read_text(self, *args, **kwargs):
        threads.append(threading.get_ident())
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", tracking_read_text)
    return threads


@pytest.mark.asyncio
async def test_registers_lovelace_resource_when_present(tmp_path, monkeypatch):
    """Asset present, resource collection in storage mode => creates versioned resource."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path)
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert len(lovelace_data.resources.created) == 1
    created = lovelace_data.resources.created[0]
    assert created["url"] == f"{CARD_PATH}?v={manifest_version()}"
    assert created["res_type"] == "module"


@pytest.mark.asyncio
async def test_registered_url_carries_the_manifest_version(tmp_path, monkeypatch):
    """The `?v=` value comes from the loaded manifest, not from a constant in the code."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path, manifest={"domain": "haventory", "version": "9.9.9"})
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [f"{CARD_PATH}?v=9.9.9"]


@pytest.mark.asyncio
async def test_the_loaded_manifest_is_read_without_touching_the_filesystem(tmp_path, monkeypatch):
    """The version comes out of memory: no file read at all, on the loop or off it.

    Home Assistant already parsed `manifest.json` when it loaded the integration.
    Reading it again during `async_setup_entry` runs on the event loop thread,
    where HA's loop protection answers it with a stack-trace warning on every
    startup, so the registered URL must not depend on a file read.
    """
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path, manifest={"domain": "haventory", "version": "9.9.9"})
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data
    read_threads = track_manifest_reads(monkeypatch)

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [f"{CARD_PATH}?v=9.9.9"]
    assert read_threads == []
    assert hass.executor_jobs == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "manifest",
    [
        # Domain unknown to the loader, which raises rather than returning.
        None,
        # Loaded, but carrying nothing usable as a version.
        {"domain": "haventory"},
        {"domain": "haventory", "version": ""},
        {"domain": "haventory", "version": 9},
    ],
)
async def test_falls_back_to_reading_the_manifest_off_the_loop(tmp_path, monkeypatch, manifest):
    """No version from the loader => read the file, but in the executor."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(
        json.dumps({"domain": "haventory", "version": "8.8.8"}), encoding="utf-8"
    )
    monkeypatch.setattr(hav_init, "_MANIFEST_PATH", manifest_file)

    hass = make_hass(tmp_path, manifest=manifest)
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data
    read_threads = track_manifest_reads(monkeypatch)

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [f"{CARD_PATH}?v=8.8.8"]
    assert hass.executor_jobs == [hav_init._read_manifest_version]
    assert read_threads and threading.get_ident() not in read_threads


@pytest.mark.asyncio
async def test_registers_bare_url_when_manifest_version_unavailable(tmp_path, monkeypatch):
    """Neither source yields a version => unversioned URL, rather than a failed setup."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    monkeypatch.setattr(hav_init, "_MANIFEST_PATH", tmp_path / "no-such-manifest.json")

    hass = make_hass(tmp_path, manifest=None)
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [CARD_PATH]


@pytest.mark.asyncio
async def test_registers_bare_url_when_no_executor_is_available(tmp_path, monkeypatch):
    """A hass without an executor still registers the card, just without `?v=`."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path, manifest=None)
    monkeypatch.delattr(HassStub, "async_add_executor_job")
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [CARD_PATH]


@pytest.mark.asyncio
async def test_skips_when_asset_missing(tmp_path, monkeypatch):
    """Asset not present => does not create resource."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path, with_asset=False)
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert len(lovelace_data.resources.created) == 0


@pytest.mark.asyncio
async def test_reregistration_at_the_same_version_is_idempotent(tmp_path, monkeypatch):
    """Entry already at the current `?v=` => nothing is created and nothing is written."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path)
    current_url = f"{CARD_PATH}?v={manifest_version()}"
    lovelace_data = MockLovelaceData()
    lovelace_data.resources._items = [
        {"id": "existing", "url": current_url, "type": "module"},
    ]
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)
    await hav_init._register_frontend_module(hass)

    assert lovelace_data.resources.created == []
    assert lovelace_data.resources.updated == []
    assert [i["url"] for i in lovelace_data.resources.async_items()] == [current_url]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "registered_url",
    [
        # Registered before cache-busting existed.
        CARD_PATH,
        f"{CARD_PATH}?v=0.0.1",
        f"{CARD_PATH}?v=38b725595b78",
        f"{CARD_PATH}?v=1&foo=bar",
        f"{CARD_PATH}#frag",
    ],
)
async def test_updates_existing_entry_when_the_version_changed(
    tmp_path, monkeypatch, registered_url
):
    """A stale entry for the card is rewritten in place, never duplicated.

    `/local/` is served with a month-long `max-age`, so an entry left at the old
    `?v=` keeps browsers on the previous bundle. Adding a second entry instead
    would load the card module twice and the second `customElements.define`
    throws.
    """
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path, manifest={"domain": "haventory", "version": "9.9.9"})
    lovelace_data = MockLovelaceData()
    lovelace_data.resources._items = [
        {"id": "existing", "url": registered_url, "type": "module"},
    ]
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    expected = f"{CARD_PATH}?v=9.9.9"
    assert lovelace_data.resources.created == []
    assert lovelace_data.resources.updated == [
        ("existing", {"res_type": "module", "url": expected})
    ]
    assert [i["url"] for i in lovelace_data.resources.async_items()] == [expected]

    # A second pass at the same version must not write again.
    await hav_init._register_frontend_module(hass)
    assert len(lovelace_data.resources.updated) == 1
    assert lovelace_data.resources.created == []


@pytest.mark.asyncio
async def test_leaves_a_stale_entry_alone_when_it_has_no_id(tmp_path, monkeypatch):
    """An entry with no id cannot be addressed for update => leave it, add nothing."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path)
    lovelace_data = MockLovelaceData()
    lovelace_data.resources._items = [{"url": f"{CARD_PATH}?v=0.0.0", "type": "module"}]
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert lovelace_data.resources.created == []
    assert lovelace_data.resources.updated == []
    assert [i["url"] for i in lovelace_data.resources.async_items()] == [f"{CARD_PATH}?v=0.0.0"]


@pytest.mark.asyncio
async def test_registers_alongside_unrelated_resources(tmp_path, monkeypatch):
    """Another integration's card, and a malformed entry, must not block us."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path)
    lovelace_data = MockLovelaceData()
    lovelace_data.resources._items = [
        {"id": "other", "url": "/local/other-card.js", "type": "module"},
        # Same basename, different integration.
        {"id": "lookalike", "url": "/hacsfiles/elsewhere/haventory-card.js", "type": "module"},
        {"id": "malformed", "type": "module"},
        {"id": "wrong_type", "url": None, "type": "module"},
    ]
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [
        f"{CARD_PATH}?v={manifest_version()}"
    ]
    assert lovelace_data.resources.updated == []


@pytest.mark.asyncio
@pytest.mark.parametrize("registered_url", [None, CARD_PATH, f"{CARD_PATH}?v=0.0.0"])
async def test_yaml_mode_never_touches_resources(tmp_path, monkeypatch, registered_url):
    """YAML mode has no writable collection: skip, whatever is (or is not) registered."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path)
    items = [] if registered_url is None else [{"id": "yaml", "url": registered_url}]
    resources = MockYamlResourceCollection(items)
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert resources.async_items() == items


@pytest.mark.asyncio
async def test_skips_when_lovelace_not_initialized(tmp_path, monkeypatch):
    """Lovelace not initialized => skips gracefully."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path)

    # hass.data["lovelace_data_key"] is NOT set - simulates Lovelace not initialized
    await hav_init._register_frontend_module(hass)


@pytest.mark.asyncio
async def test_skips_when_resources_is_none(tmp_path, monkeypatch):
    """lovelace_data.resources is None => skips gracefully without AttributeError."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    hass = make_hass(tmp_path)
    hass.data["lovelace_data_key"] = types.SimpleNamespace(resources=None)

    await hav_init._register_frontend_module(hass)
