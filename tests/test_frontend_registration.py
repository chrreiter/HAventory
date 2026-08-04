"""Tests for how the HAventory card bundle is served and loaded.

The bundle ships inside the integration package and is served from there over a
registered static path. Three consumers then point the frontend at it — the
Lovelace resource collection (storage mode only; covers HA Cast), the frontend's
extra-module URL (covers YAML resource mode), and the sidebar panel's
``module_url`` — and they must receive the *same* URL string, or the card module
is evaluated more than once and the second ``customElements.define`` throws.

The sidebar panel section additionally covers the lifecycle the options toggle
drives: registration has to be idempotent, because HA raises
``ValueError: Overwriting panel haventory`` on a second registration of a path
that is already taken.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import logging
import re
import sys
import threading
import types
from pathlib import Path
from typing import Any

import pytest
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_SIDEBAR_PANEL_ENABLED,
    DEFAULT_CARD_TITLE,
    PANEL_ELEMENT_NAME,
    PANEL_ICON,
    PANEL_URL_PATH,
)
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL, DATA_PANELS, UrlManager
from homeassistant.config_entries import ConfigEntry

STATIC_URL_PATH = "/haventory_static"
CARD_PATH = f"{STATIC_URL_PATH}/haventory-card.js"
# Where installs from before the bundle moved into the package loaded it from.
LEGACY_CARD_PATH = "/local/haventory/haventory-card.js"
REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = REPO_ROOT / "custom_components" / "haventory" / "manifest.json"

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
    """Mock Lovelace resource collection in storage mode (create/update/delete).

    Mirrors where the real collection loads storage and where it does not:
    `async_items` reports nothing until something loads it, while each mutation
    method loads first — so a caller that reads before writing has to say so.
    """

    def __init__(self, items: list[dict[str, Any]] | None = None, *, loaded: bool = True):
        self.loaded = loaded
        self._items: list[dict[str, Any]] = list(items or [])
        self.created: list[dict[str, Any]] = []
        self.updated: list[tuple[str, dict[str, Any]]] = []
        self.deleted: list[str] = []

    def async_items(self) -> list[dict[str, Any]]:
        return self._items if self.loaded else []

    async def async_load(self):
        self.loaded = True

    async def async_create_item(self, data: dict[str, Any]) -> dict[str, Any]:
        self.loaded = True
        self.created.append(data)
        item = {"id": f"created_{len(self.created)}", **data}
        self._items.append(item)
        return item

    async def async_update_item(self, item_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        self.loaded = True
        for item in self._items:
            if item.get("id") == item_id:
                item.update(updates)
                self.updated.append((item_id, updates))
                return item
        raise KeyError(item_id)

    async def async_delete_item(self, item_id: str) -> None:
        self.loaded = True
        self.deleted.append(item_id)
        self._items = [item for item in self._items if item.get("id") != item_id]


class MockYamlResourceCollection:
    """Lovelace resources in YAML mode: readable, with no mutation API."""

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


class HttpStub:
    """Stands in for ``hass.http``, with aiohttp's one hard rule.

    aiohttp cannot unregister a route and rejects a second one on the same path,
    so a duplicate registration raises here rather than being recorded.
    """

    def __init__(self) -> None:
        self.registered: list[Any] = []
        self.calls = 0

    async def async_register_static_paths(self, configs) -> None:
        self.calls += 1
        for config in configs:
            if any(existing.url_path == config.url_path for existing in self.registered):
                raise RuntimeError(f"Duplicate static path: {config.url_path}")
            self.registered.append(config)


class HassStub:
    """Minimal Home Assistant stub: data bucket, static-path registrar, executor."""

    def __init__(self) -> None:
        self.data: dict[str, Any] = {DATA_EXTRA_MODULE_URL: UrlManager()}
        self.http = HttpStub()
        self.executor_jobs: list[Any] = []

    async def async_add_executor_job(self, target, *args):
        """Mirror HA's executor offload, recording what got handed off.

        A real worker thread, not an inline call: it is what lets a test tell an
        event-loop file read apart from an offloaded one.
        """
        self.executor_jobs.append(target)
        return await asyncio.get_running_loop().run_in_executor(None, target, *args)


def make_hass(*, manifest: Any = _NO_OVERRIDE) -> HassStub:
    """Hass stub with the frontend's URL manager in place.

    `manifest` seeds what the loader hands back for the `haventory` domain: omit it
    for the shipped manifest, pass a dict to choose the version, pass None to make
    the lookup fail the way it does for an integration HA has not loaded.
    """
    hass = HassStub()
    if manifest is not _NO_OVERRIDE:
        hass.data["__integration_manifests__"] = {"haventory": manifest}
    return hass


def install_bundle(monkeypatch, hav_init, tmp_path, *, built: bool = True) -> Path:
    """Point the module at a throwaway bundle directory and return it.

    The real one lives inside the installed package, so a test that used it would
    pass or fail depending on whether the card happens to have been built.
    """
    www = tmp_path / "www"
    www.mkdir(parents=True, exist_ok=True)
    bundle = www / "haventory-card.js"
    if built:
        bundle.write_text("// test bundle")
    monkeypatch.setattr(hav_init, "_WWW_DIR", www)
    monkeypatch.setattr(hav_init, "_CARD_BUNDLE_PATH", bundle)
    return www


def extra_js_urls(hass: HassStub) -> set[str]:
    return set(hass.data[DATA_EXTRA_MODULE_URL].urls)


def registered_panel(hass: HassStub) -> Any:
    """The HAventory entry in the frontend's panel registry, or None."""
    return hass.data.get(DATA_PANELS, {}).get(PANEL_URL_PATH)


def panel_registration_attempts(hass: HassStub) -> list[str]:
    """Every ``async_register_panel`` call, successful or not (see conftest)."""
    return hass.data.get("__panel_registrations__", [])


async def setup_frontend(hav_init, hass: HassStub, entry: ConfigEntry) -> None:
    """The two frontend steps of ``async_setup_entry``, in the order it runs them."""
    await hav_init._register_frontend_module(hass)
    await hav_init._async_apply_sidebar_panel(hass, entry)


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


@pytest.fixture
def hav_init(monkeypatch, tmp_path):
    """The integration module, with lovelace stubbed and a throwaway bundle built."""
    module = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, module, tmp_path)
    return module


# --------------------------------------------------------------------------- #
# Serving the bundle
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_serves_the_bundle_directory_without_cache_headers(hav_init, tmp_path):
    """The card directory is served at a fixed path, with revalidation left on.

    `cache_headers=True` would stamp a long `max-age` and no revalidation, which
    is how the old `/local` route kept browsers on a month-old bundle.
    """
    hass = make_hass()
    hass.data["lovelace_data_key"] = MockLovelaceData()

    await hav_init._register_frontend_module(hass)

    assert len(hass.http.registered) == 1
    config = hass.http.registered[0]
    assert config.url_path == STATIC_URL_PATH
    assert config.path == str(tmp_path / "www")
    assert config.cache_headers is False


@pytest.mark.asyncio
async def test_registers_both_loaders_with_the_same_url(hav_init):
    """One URL builder, two loaders — byte-identical, or the element defines twice."""
    hass = make_hass()
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    expected = f"{CARD_PATH}?v={manifest_version()}"
    assert [c["url"] for c in lovelace_data.resources.created] == [expected]
    assert lovelace_data.resources.created[0]["res_type"] == "module"
    assert extra_js_urls(hass) == {expected}


@pytest.mark.asyncio
async def test_static_path_is_registered_once_across_a_reload(hav_init):
    """Setup → unload → setup registers the route once: aiohttp cannot take one back."""
    hass = make_hass()
    hass.data["lovelace_data_key"] = MockLovelaceData()

    await hav_init._register_frontend_module(hass)
    await hav_init.async_unload_entry(hass, ConfigEntry())
    await hav_init._register_frontend_module(hass)

    assert hass.http.calls == 1
    assert len(hass.http.registered) == 1


@pytest.mark.asyncio
async def test_unload_hands_back_the_module_url_and_setup_restores_it(hav_init):
    """The extra-module URL is entry-scoped state, unlike the static route."""
    hass = make_hass()
    hass.data["lovelace_data_key"] = MockLovelaceData()
    expected = f"{CARD_PATH}?v={manifest_version()}"

    await hav_init._register_frontend_module(hass)
    assert extra_js_urls(hass) == {expected}

    await hav_init.async_unload_entry(hass, ConfigEntry())
    assert extra_js_urls(hass) == set()

    await hav_init._register_frontend_module(hass)
    assert extra_js_urls(hass) == {expected}


@pytest.mark.asyncio
async def test_skips_everything_when_the_bundle_is_not_built(monkeypatch, tmp_path):
    """A dev checkout without a card build registers nothing, and does not fail."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path, built=False)
    hass = make_hass()
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert hass.http.registered == []
    assert lovelace_data.resources.created == []
    assert extra_js_urls(hass) == set()


@pytest.mark.asyncio
async def test_skips_everything_when_http_is_unavailable(hav_init):
    """No static path means no URL worth handing out: neither loader is touched."""
    hass = make_hass()
    del hass.http
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert lovelace_data.resources.created == []
    assert extra_js_urls(hass) == set()


# --------------------------------------------------------------------------- #
# The versioned URL
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_registered_url_carries_the_manifest_version(monkeypatch, tmp_path):
    """The `?v=` value comes from the loaded manifest, not from a constant in the code."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    hass = make_hass(manifest={"domain": "haventory", "version": "9.9.9"})
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [f"{CARD_PATH}?v=9.9.9"]
    assert extra_js_urls(hass) == {f"{CARD_PATH}?v=9.9.9"}


@pytest.mark.asyncio
async def test_the_loaded_manifest_is_read_without_touching_the_filesystem(monkeypatch, tmp_path):
    """The version comes out of memory: no file read at all, on the loop or off it.

    Home Assistant already parsed `manifest.json` when it loaded the integration.
    Reading it again during `async_setup_entry` runs on the event loop thread,
    where HA's loop protection answers it with a stack-trace warning on every
    startup, so the registered URL must not depend on a file read.
    """
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    hass = make_hass(manifest={"domain": "haventory", "version": "9.9.9"})
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
async def test_falls_back_to_reading_the_manifest_off_the_loop(monkeypatch, tmp_path, manifest):
    """No version from the loader => read the file, but in the executor."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(
        json.dumps({"domain": "haventory", "version": "8.8.8"}), encoding="utf-8"
    )
    monkeypatch.setattr(hav_init, "_MANIFEST_PATH", manifest_file)

    hass = make_hass(manifest=manifest)
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data
    read_threads = track_manifest_reads(monkeypatch)

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [f"{CARD_PATH}?v=8.8.8"]
    assert hass.executor_jobs == [hav_init._read_manifest_version]
    assert read_threads and threading.get_ident() not in read_threads


@pytest.mark.asyncio
async def test_registers_bare_url_when_manifest_version_unavailable(monkeypatch, tmp_path):
    """Neither source yields a version => unversioned URL, rather than a failed setup."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    monkeypatch.setattr(hav_init, "_MANIFEST_PATH", tmp_path / "no-such-manifest.json")

    hass = make_hass(manifest=None)
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [CARD_PATH]
    assert extra_js_urls(hass) == {CARD_PATH}


@pytest.mark.asyncio
async def test_registers_bare_url_when_no_executor_is_available(monkeypatch, tmp_path):
    """A hass without an executor still registers the card, just without `?v=`."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    hass = make_hass(manifest=None)
    monkeypatch.delattr(HassStub, "async_add_executor_job")
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [CARD_PATH]


# --------------------------------------------------------------------------- #
# The Lovelace resource: one entry, always current
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "registered_url",
    [
        LEGACY_CARD_PATH,
        f"{LEGACY_CARD_PATH}?v=0.0.1",
        f"{LEGACY_CARD_PATH}?v=38b725595b78",
    ],
)
async def test_migrates_a_legacy_local_resource_in_place(monkeypatch, tmp_path, registered_url):
    """An install predating the move ends up with one entry, on the new URL.

    A second entry alongside the legacy one would load the card module twice and
    the second `customElements.define` would throw; the legacy one left alone
    would 404 once the copy under the config `www/` tree is gone.
    """
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    hass = make_hass(manifest={"domain": "haventory", "version": "9.9.9"})
    resources = MockResourceCollection([{"id": "legacy", "url": registered_url, "type": "module"}])
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    expected = f"{CARD_PATH}?v=9.9.9"
    assert resources.created == []
    assert resources.updated == [("legacy", {"res_type": "module", "url": expected})]
    assert [i["url"] for i in resources.async_items()] == [expected]
    assert extra_js_urls(hass) == {expected}


@pytest.mark.asyncio
async def test_reregistration_at_the_same_version_is_idempotent(hav_init):
    """Entry already at the current `?v=` => nothing is created and nothing is written."""
    hass = make_hass()
    current_url = f"{CARD_PATH}?v={manifest_version()}"
    resources = MockResourceCollection([{"id": "existing", "url": current_url, "type": "module"}])
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)
    await hav_init._register_frontend_module(hass)

    assert resources.created == []
    assert resources.updated == []
    assert resources.deleted == []
    assert [i["url"] for i in resources.async_items()] == [current_url]


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
    monkeypatch, tmp_path, registered_url
):
    """A stale entry for the card is rewritten in place, never duplicated."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    hass = make_hass(manifest={"domain": "haventory", "version": "9.9.9"})
    resources = MockResourceCollection(
        [{"id": "existing", "url": registered_url, "type": "module"}]
    )
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    expected = f"{CARD_PATH}?v=9.9.9"
    assert resources.created == []
    assert resources.updated == [("existing", {"res_type": "module", "url": expected})]
    assert [i["url"] for i in resources.async_items()] == [expected]

    # A second pass at the same version must not write again.
    await hav_init._register_frontend_module(hass)
    assert len(resources.updated) == 1
    assert resources.created == []


@pytest.mark.asyncio
async def test_collapses_duplicate_card_resources(monkeypatch, tmp_path):
    """A legacy entry beside a current one is one element definition too many."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    hass = make_hass(manifest={"domain": "haventory", "version": "9.9.9"})
    expected = f"{CARD_PATH}?v=9.9.9"
    resources = MockResourceCollection(
        [
            {"id": "current", "url": expected, "type": "module"},
            {"id": "legacy", "url": LEGACY_CARD_PATH, "type": "module"},
        ]
    )
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert resources.created == []
    assert resources.deleted == ["legacy"]
    assert [i["url"] for i in resources.async_items()] == [expected]


@pytest.mark.asyncio
async def test_finds_the_existing_entry_in_an_unloaded_collection(hav_init):
    """Registering against a collection nobody has read yet must not add a second entry.

    Nothing loads the resource collection at Lovelace setup, so this is the state
    setup meets on a Home Assistant that has served no dashboard. An unloaded
    collection reports no items, and creating on the strength of that would leave
    two resources for one module — the second `customElements.define` throws.
    """
    hass = make_hass()
    current_url = f"{CARD_PATH}?v={manifest_version()}"
    resources = MockResourceCollection(
        [{"id": "existing", "url": current_url, "type": "module"}], loaded=False
    )
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert resources.created == []
    assert [i["url"] for i in resources.async_items()] == [current_url]


@pytest.mark.asyncio
async def test_leaves_a_stale_entry_alone_when_it_has_no_id(hav_init):
    """An entry with no id cannot be addressed for update => leave it, add nothing."""
    hass = make_hass()
    resources = MockResourceCollection([{"url": f"{CARD_PATH}?v=0.0.0", "type": "module"}])
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert resources.created == []
    assert resources.updated == []
    assert [i["url"] for i in resources.async_items()] == [f"{CARD_PATH}?v=0.0.0"]


@pytest.mark.asyncio
async def test_registers_alongside_unrelated_resources(hav_init):
    """Another integration's card, and a malformed entry, must not block us."""
    hass = make_hass()
    resources = MockResourceCollection(
        [
            {"id": "other", "url": "/local/other-card.js", "type": "module"},
            # Same basename, different integration.
            {"id": "lookalike", "url": "/hacsfiles/elsewhere/haventory-card.js", "type": "module"},
            {"id": "malformed", "type": "module"},
            {"id": "wrong_type", "url": None, "type": "module"},
        ]
    )
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in resources.created] == [f"{CARD_PATH}?v={manifest_version()}"]
    assert resources.updated == []
    assert resources.deleted == []


@pytest.mark.asyncio
@pytest.mark.parametrize("registered_url", [None, LEGACY_CARD_PATH, f"{CARD_PATH}?v=0.0.0"])
async def test_yaml_mode_loads_the_card_through_the_module_url(hav_init, registered_url):
    """YAML resources are read-only — which is exactly what the extra-module URL is for."""
    hass = make_hass()
    items = [] if registered_url is None else [{"id": "yaml", "url": registered_url}]
    resources = MockYamlResourceCollection(items)
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert resources.async_items() == items
    assert extra_js_urls(hass) == {f"{CARD_PATH}?v={manifest_version()}"}


@pytest.mark.asyncio
async def test_registers_the_module_url_when_lovelace_is_not_initialized(hav_init):
    """Lovelace missing is not fatal: the card still loads through the frontend."""
    hass = make_hass()

    # hass.data["lovelace_data_key"] is NOT set - simulates Lovelace not initialized
    await hav_init._register_frontend_module(hass)

    assert extra_js_urls(hass) == {f"{CARD_PATH}?v={manifest_version()}"}


@pytest.mark.asyncio
async def test_skips_when_resources_is_none(hav_init):
    """lovelace_data.resources is None => skips gracefully without AttributeError."""
    hass = make_hass()
    hass.data["lovelace_data_key"] = types.SimpleNamespace(resources=None)

    await hav_init._register_frontend_module(hass)

    assert extra_js_urls(hass) == {f"{CARD_PATH}?v={manifest_version()}"}


# --------------------------------------------------------------------------- #
# Degrading when the frontend is out of reach
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_missing_frontend_component_degrades_gracefully(monkeypatch, tmp_path):
    """No `frontend` module to import => the Lovelace resource carries the card alone."""
    monkeypatch.delitem(sys.modules, "homeassistant.components.frontend")
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    assert hav_init.add_extra_js_url is None

    hass = make_hass()
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)
    await hav_init.async_unload_entry(hass, ConfigEntry())

    assert [c["url"] for c in lovelace_data.resources.created] == [
        f"{CARD_PATH}?v={manifest_version()}"
    ]


@pytest.mark.asyncio
async def test_frontend_without_a_url_manager_degrades_gracefully(hav_init):
    """Frontend importable but never set up => no URL manager in hass.data, and no crash."""
    hass = make_hass()
    del hass.data[DATA_EXTRA_MODULE_URL]
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)
    await hav_init.async_unload_entry(hass, ConfigEntry())

    assert [c["url"] for c in lovelace_data.resources.created] == [
        f"{CARD_PATH}?v={manifest_version()}"
    ]


# --------------------------------------------------------------------------- #
# The sidebar panel
# --------------------------------------------------------------------------- #


def test_the_sidebar_icon_is_the_one_the_card_bundle_publishes() -> None:
    """``PANEL_ICON`` names an icon set that only the card bundle registers.

    A non-``mdi:`` prefix is resolved against the frontend's icon registry, so
    the sidebar shows the mark only while the two spellings agree — and a
    disagreement is silent, costing the entry its icon and nothing else.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "brand-icon.ts").read_text(
        encoding="utf-8"
    )

    def declared(name: str) -> str:
        match = re.search(rf"^export const {name} = '([^']+)';$", source, re.MULTILINE)
        assert match is not None, f"{name} is no longer declared in brand-icon.ts"
        return match.group(1)

    assert PANEL_ICON == f"{declared('HAVENTORY_ICONSET')}:{declared('HAVENTORY_ICON_NAME')}"


@pytest.mark.asyncio
async def test_registers_the_sidebar_panel_against_the_card_bundle(hav_init):
    """The panel is a custom panel loading the card bundle, named by the card title.

    Its `module_url` is the string the extra-module loader got, character for
    character: a second URL for the same module makes the browser evaluate the
    bundle twice, and `defineCardElement` has nothing to say about a second
    evaluation of itself.
    """
    hass = make_hass()

    await setup_frontend(hav_init, hass, ConfigEntry())

    expected_url = f"{CARD_PATH}?v={manifest_version()}"
    panel = registered_panel(hass)
    assert panel.component_name == "custom"
    assert panel.frontend_url_path == PANEL_URL_PATH
    assert panel.sidebar_title == DEFAULT_CARD_TITLE
    assert panel.sidebar_icon == PANEL_ICON
    assert panel.require_admin is False
    assert panel.config == {
        "title": DEFAULT_CARD_TITLE,
        "_panel_custom": {
            "name": PANEL_ELEMENT_NAME,
            "embed_iframe": False,
            "trust_external": False,
            "module_url": expected_url,
        },
    }
    assert extra_js_urls(hass) == {expected_url}


@pytest.mark.asyncio
async def test_applying_twice_over_leaves_one_panel(hav_init):
    """Registering onto a path already taken raises in HA — so remove first, always."""
    hass = make_hass()
    entry = ConfigEntry()

    await setup_frontend(hav_init, hass, entry)
    await hav_init._async_apply_sidebar_panel(hass, entry)

    assert list(hass.data[DATA_PANELS]) == [PANEL_URL_PATH]
    assert panel_registration_attempts(hass) == [PANEL_URL_PATH] * 2


@pytest.mark.asyncio
async def test_reload_re_registers_the_panel_exactly_once(hav_init):
    """Setup → unload → setup: two registrations attempted, one panel live, nothing raised."""
    hass = make_hass()
    entry = ConfigEntry()

    await setup_frontend(hav_init, hass, entry)
    await hav_init.async_unload_entry(hass, entry)
    await setup_frontend(hav_init, hass, entry)

    assert list(hass.data[DATA_PANELS]) == [PANEL_URL_PATH]
    assert panel_registration_attempts(hass) == [PANEL_URL_PATH] * 2


@pytest.mark.asyncio
async def test_unload_takes_the_sidebar_entry_back(hav_init):
    """A sidebar entry outliving its backend opens a page that cannot load."""
    hass = make_hass()
    entry = ConfigEntry()

    await setup_frontend(hav_init, hass, entry)
    assert registered_panel(hass) is not None

    await hav_init.async_unload_entry(hass, entry)

    assert registered_panel(hass) is None
    assert hass.data[hav_init.DOMAIN].get("panel_registered") is None


@pytest.mark.asyncio
async def test_toggling_the_option_removes_and_restores_the_entry(hav_init):
    """The toggle applies through the options listener — no entry reload, no restart."""
    hass = make_hass()
    entry = ConfigEntry(options={CONF_SIDEBAR_PANEL_ENABLED: True})

    await setup_frontend(hav_init, hass, entry)
    assert registered_panel(hass) is not None

    entry.options[CONF_SIDEBAR_PANEL_ENABLED] = False
    await hav_init._async_options_updated(hass, entry)
    assert registered_panel(hass) is None

    entry.options[CONF_SIDEBAR_PANEL_ENABLED] = True
    await hav_init._async_options_updated(hass, entry)
    assert registered_panel(hass) is not None


@pytest.mark.asyncio
async def test_renaming_the_card_renames_the_sidebar_entry(hav_init):
    """One name for both surfaces: the panel carries the card title, live."""
    hass = make_hass()
    entry = ConfigEntry(options={CONF_CARD_TITLE: "Pantry"})

    await setup_frontend(hav_init, hass, entry)
    assert registered_panel(hass).sidebar_title == "Pantry"

    entry.options[CONF_CARD_TITLE] = "Garage"
    await hav_init._async_options_updated(hass, entry)

    panel = registered_panel(hass)
    assert panel.sidebar_title == "Garage"
    assert panel.config["title"] == "Garage"


@pytest.mark.asyncio
async def test_an_explicit_opt_out_registers_no_panel(hav_init):
    """Off in the options means off at setup too, not just on the toggle path."""
    hass = make_hass()

    await setup_frontend(hav_init, hass, ConfigEntry(options={CONF_SIDEBAR_PANEL_ENABLED: False}))

    assert registered_panel(hass) is None
    assert panel_registration_attempts(hass) == []
    # The card itself is unaffected: only the sidebar entry is opted out of.
    assert extra_js_urls(hass) == {f"{CARD_PATH}?v={manifest_version()}"}


@pytest.mark.asyncio
async def test_missing_panel_custom_degrades_to_a_debug_log(monkeypatch, tmp_path, caplog):
    """`panel_custom` is an internal component — treat its absence as our problem, not HA's."""
    monkeypatch.delitem(sys.modules, "homeassistant.components.panel_custom")
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path)
    assert hav_init.async_register_panel is None

    hass = make_hass()
    with caplog.at_level(logging.DEBUG, logger="custom_components.haventory"):
        await setup_frontend(hav_init, hass, ConfigEntry())

    assert registered_panel(hass) is None
    assert any("panel_custom" in record.message for record in caplog.records)
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []


@pytest.mark.asyncio
async def test_no_sidebar_panel_without_a_built_bundle(monkeypatch, tmp_path):
    """The panel is the bundle's second element; with no bundle there is nothing to show."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path, built=False)
    hass = make_hass()

    await setup_frontend(hav_init, hass, ConfigEntry())

    assert registered_panel(hass) is None
    assert panel_registration_attempts(hass) == []
