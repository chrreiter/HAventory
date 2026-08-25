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

import importlib
import json
import logging
import re
import sys
import types
from pathlib import Path
from typing import Any

import pytest
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_SIDEBAR_PANEL_ENABLED,
    INTEGRATION_VERSION,
    MEDIA_NAME_TOKEN_PARAM,
    MEDIA_SIZE_PARAM,
    MEDIA_SIZE_THUMB,
    MEDIA_URL_TEMPLATE,
    PANEL_ICON,
    PANEL_URL_PATH,
    QUICK_FILTER_KEYS,
    STATUS_COLORS,
    STATUS_ICONS,
)
from custom_components.haventory.models import seed_status_definitions
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL, DATA_PANELS, UrlManager
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from lovelace_helpers import MockResourceCollection, MockYamlResourceCollection

STATIC_URL_PATH = "/haventory_static"
CARD_PATH = f"{STATIC_URL_PATH}/haventory-card.js"
# What both loaders and the panel receive, cache-buster and all.
CURRENT_CARD_URL = f"{CARD_PATH}?v={INTEGRATION_VERSION}"
REPO_ROOT = Path(__file__).resolve().parents[1]


def import_haventory(monkeypatch, lovelace_key: str):
    """Import the integration with ``homeassistant.components.lovelace`` stubbed.

    ``LOVELACE_DATA`` is bound at import time, so the stub has to be in
    ``sys.modules`` before the import and any cached module has to be dropped.
    """
    lovelace_module = types.SimpleNamespace(LOVELACE_DATA=lovelace_key)
    monkeypatch.setitem(sys.modules, "homeassistant.components.lovelace", lovelace_module)
    sys.modules.pop("custom_components.haventory", None)
    return importlib.import_module("custom_components.haventory")


class MockLovelaceData:
    """Mock Lovelace data container."""

    def __init__(self, resources: Any = None):
        self.resources = MockResourceCollection() if resources is None else resources


def make_hass() -> HomeAssistant:
    """Hass stub with the frontend's URL manager in place.

    The manager is created by the frontend component's own setup, which nothing
    here runs — so a test that wants the extra-module loader to work has to put
    one there, and one that does not gets the KeyError a bare hass gives.
    """
    hass = HomeAssistant()
    hass.data[DATA_EXTRA_MODULE_URL] = UrlManager()
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


def extra_js_urls(hass: HomeAssistant) -> set[str]:
    return set(hass.data[DATA_EXTRA_MODULE_URL].urls)


def registered_panel(hass: HomeAssistant) -> Any:
    """The HAventory entry in the frontend's panel registry, or None."""
    return hass.data.get(DATA_PANELS, {}).get(PANEL_URL_PATH)


async def setup_frontend(hav_init, hass: HomeAssistant, entry: ConfigEntry) -> None:
    """The two frontend steps of ``async_setup_entry``, in the order it runs them."""
    await hav_init._register_frontend_module(hass)
    await hav_init._async_apply_sidebar_panel(hass, entry)


@pytest.fixture
def hav_init(monkeypatch, tmp_path):
    """The integration module, with lovelace stubbed and a throwaway bundle built."""
    module = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, module, tmp_path)
    return module


# --------------------------------------------------------------------------- #
# Serving the bundle
# --------------------------------------------------------------------------- #


def test_the_card_build_emits_a_single_file() -> None:
    """The card build keeps code splitting off, so the bundle has no siblings.

    Everything the loaders name is one file. A split chunk would land in the
    served directory beside it, and both the directory's ``.gitignore`` entry and
    the release-zip check — which asserts the bundle is present, not that it is
    alone — would pass it through into the HACS asset. ``emptyOutDir: false``
    then keeps every such chunk across later builds.
    """
    config = (REPO_ROOT / "cards" / "haventory-card" / "vite.config.ts").read_text(encoding="utf-8")

    assert re.search(r"^\s*codeSplitting: false$", config, re.MULTILINE) is not None


@pytest.mark.asyncio
async def test_skips_everything_when_the_bundle_is_not_built(monkeypatch, tmp_path):
    """A dev checkout without a card build registers nothing, and does not fail."""
    hav_init = import_haventory(monkeypatch, "lovelace_data_key")
    install_bundle(monkeypatch, hav_init, tmp_path, built=False)
    hass = make_hass()
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert hass.http.static_paths == []
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


@pytest.mark.asyncio
async def test_a_failed_static_route_logs_at_error(hav_init, caplog):
    """A route that fails to register leaves the card served by nothing.

    This is the one frontend-registration failure worth an operator's attention:
    it short-circuits both loaders below it. The Lovelace-resource sites stay at
    WARNING because ``add_extra_js_url`` has already run on the identical URL, so
    the card still loads.
    """
    hass = make_hass()
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    async def refuse(configs):
        raise RuntimeError("aiohttp refused the route")

    hass.http.async_register_static_paths = refuse

    with caplog.at_level(logging.DEBUG):
        await hav_init._register_frontend_module(hass)

    failures = [r for r in caplog.records if "cannot load" in r.getMessage()]
    assert [r.levelno for r in failures] == [logging.ERROR]
    assert lovelace_data.resources.created == []
    assert extra_js_urls(hass) == set()


# --------------------------------------------------------------------------- #
# The versioned URL
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_registered_url_carries_the_integration_version(hav_init):
    """The `?v=` value is the version this build declares.

    `INTEGRATION_VERSION` and `manifest.json` are rewritten together by
    release-please and held equal by `tests/test_release_version_consistency.py`,
    so the constant is the shipped version and the URL needs no second source
    for it.
    """
    hass = make_hass()
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)

    assert [c["url"] for c in lovelace_data.resources.created] == [CURRENT_CARD_URL]
    assert extra_js_urls(hass) == {CURRENT_CARD_URL}


# --------------------------------------------------------------------------- #
# The Lovelace resource: one entry, always current
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_reregistration_at_the_same_version_is_idempotent(hav_init):
    """Entry already at the current `?v=` => nothing is created and nothing is written."""
    hass = make_hass()
    current_url = CURRENT_CARD_URL
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
    hass = make_hass()
    resources = MockResourceCollection(
        [{"id": "existing", "url": registered_url, "type": "module"}]
    )
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    expected = CURRENT_CARD_URL
    assert resources.created == []
    assert resources.updated == [("existing", {"res_type": "module", "url": expected})]
    assert [i["url"] for i in resources.async_items()] == [expected]

    # A second pass at the same version must not write again.
    await hav_init._register_frontend_module(hass)
    assert len(resources.updated) == 1
    assert resources.created == []


@pytest.mark.asyncio
async def test_collapses_duplicate_card_resources(hav_init):
    """A second entry for the card is one element definition too many."""
    hass = make_hass()
    expected = CURRENT_CARD_URL
    resources = MockResourceCollection(
        [
            {"id": "current", "url": expected, "type": "module"},
            {"id": "stale", "url": f"{CARD_PATH}?v=0.0.1", "type": "module"},
        ]
    )
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert resources.created == []
    assert resources.deleted == ["stale"]
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
    current_url = CURRENT_CARD_URL
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

    assert [c["url"] for c in resources.created] == [CURRENT_CARD_URL]
    assert resources.updated == []
    assert resources.deleted == []


@pytest.mark.asyncio
@pytest.mark.parametrize("registered_url", [None, f"{CARD_PATH}?v=0.0.0"])
async def test_yaml_mode_loads_the_card_through_the_module_url(hav_init, registered_url):
    """YAML resources are read-only — which is exactly what the extra-module URL is for."""
    hass = make_hass()
    items = [] if registered_url is None else [{"id": "yaml", "url": registered_url}]
    resources = MockYamlResourceCollection(items)
    hass.data["lovelace_data_key"] = MockLovelaceData(resources)

    await hav_init._register_frontend_module(hass)

    assert resources.async_items() == items
    assert extra_js_urls(hass) == {CURRENT_CARD_URL}


@pytest.mark.asyncio
async def test_registers_the_module_url_when_lovelace_is_not_initialized(hav_init):
    """Lovelace missing is not fatal: the card still loads through the frontend."""
    hass = make_hass()

    # hass.data["lovelace_data_key"] is NOT set - simulates Lovelace not initialized
    await hav_init._register_frontend_module(hass)

    assert extra_js_urls(hass) == {CURRENT_CARD_URL}


@pytest.mark.asyncio
async def test_skips_when_resources_is_none(hav_init):
    """lovelace_data.resources is None => skips gracefully without AttributeError."""
    hass = make_hass()
    hass.data["lovelace_data_key"] = types.SimpleNamespace(resources=None)

    await hav_init._register_frontend_module(hass)

    assert extra_js_urls(hass) == {CURRENT_CARD_URL}


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

    assert [c["url"] for c in lovelace_data.resources.created] == [CURRENT_CARD_URL]


@pytest.mark.asyncio
async def test_frontend_without_a_url_manager_degrades_gracefully(hav_init):
    """Frontend importable but never set up => no URL manager in hass.data, and no crash."""
    hass = make_hass()
    del hass.data[DATA_EXTRA_MODULE_URL]
    lovelace_data = MockLovelaceData()
    hass.data["lovelace_data_key"] = lovelace_data

    await hav_init._register_frontend_module(hass)
    await hav_init.async_unload_entry(hass, ConfigEntry())

    assert [c["url"] for c in lovelace_data.resources.created] == [CURRENT_CARD_URL]


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


def test_the_card_builds_media_urls_on_the_route_the_backend_serves() -> None:
    """The attachment route is a constant on both sides and checked by neither.

    The card builds a media path itself, signs it, and puts the result straight
    into an ``<img src>``; a disagreement here is a 404 per photo, with nothing
    in any log to say the two spellings drifted apart.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "media.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"^export const MEDIA_URL_TEMPLATE = '([^']+)';$", source, re.MULTILINE)
    assert match is not None, "MEDIA_URL_TEMPLATE is no longer declared in media.ts"

    assert match.group(1) == MEDIA_URL_TEMPLATE


def test_the_card_versions_media_urls_under_the_parameter_the_backend_reads() -> None:
    """The name-token parameter is a constant on both sides and checked by neither.

    Drift here fails silently in the direction that matters least at first: the
    card keeps working, the backend simply stops seeing the token and serves
    every attachment uncacheable. The visible symptom is a photo grid that
    refetches on every render, which reads as a performance problem rather than
    a renamed constant.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "media.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"^export const MEDIA_NAME_TOKEN_PARAM = '([^']+)';$", source, re.MULTILINE)
    assert match is not None, "MEDIA_NAME_TOKEN_PARAM is no longer declared in media.ts"

    assert match.group(1) == MEDIA_NAME_TOKEN_PARAM


def test_the_card_asks_for_a_row_tile_by_the_name_the_backend_accepts() -> None:
    """The size parameter and its one value are constants on both sides.

    Neither side can see the other, and the view answers an unknown ``size``
    with a 400 — so a rename on the card turns every row tile into a broken
    image, and a rename on the backend quietly serves the whole picture again
    with nothing but the download size to say so.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "media.ts").read_text(
        encoding="utf-8"
    )
    for name, expected in (
        ("MEDIA_SIZE_PARAM", MEDIA_SIZE_PARAM),
        ("MEDIA_VARIANT_THUMB", MEDIA_SIZE_THUMB),
    ):
        match = re.search(
            rf"^export const {name}(?:: MediaVariant)? = '([^']+)';$", source, re.MULTILINE
        )
        assert match is not None, f"{name} is no longer declared in media.ts"
        assert match.group(1) == expected


def test_every_status_icon_has_a_glyph_in_the_bundle() -> None:
    """``STATUS_ICONS`` names glyphs only the card defines.

    The backend validates a status's icon against this vocabulary and the card
    looks it up in ``ICONS``; neither can see the other. A name the card lacks
    stores fine and then renders nothing, with no error anywhere to say why.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "icons.ts").read_text(
        encoding="utf-8"
    )
    defined = set(re.findall(r"^  ([A-Za-z][A-Za-z0-9]*):", source, re.MULTILINE))

    assert set(STATUS_ICONS) <= defined, f"no glyph for: {sorted(set(STATUS_ICONS) - defined)}"


def test_the_card_offers_exactly_the_vocabularies_the_backend_accepts() -> None:
    """The management picker enumerates colours and glyphs from its own arrays.

    These are the *offered* palettes, and they have to match: a card offering
    one token more hands the user a control that fails on save, and one
    offering fewer hides a colour the store may already hold. Beside them the
    backend also accepts a `#rrggbb` literal, which is not a vocabulary either
    side enumerates — the card's own picker produces it.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "status.ts").read_text(
        encoding="utf-8"
    )

    def declared(name: str) -> list[str]:
        match = re.search(rf"export const {name}: readonly \w+\[\] = \[(.*?)\];", source, re.S)
        assert match is not None, f"{name} is no longer declared in status.ts"
        return re.findall(r"'([^']+)'", match.group(1))

    assert declared("STATUS_COLORS") == list(STATUS_COLORS)
    assert declared("STATUS_ICONS") == list(STATUS_ICONS)


def test_the_cards_built_in_statuses_are_the_ones_the_backend_seeds() -> None:
    """``BUILT_IN_STATUSES`` mirrors ``seed_status_definitions()``, label included.

    The card draws that array until ``haventory/config`` answers, so a label
    that differs reworded three chips for the first moment of every page load.
    The label carries a second job since #536: a built-in still storing the
    English the seed wrote is printed in the reader's language, and the card
    decides that by comparing the stored label against this copy. A seed the
    card does not know the wording of translates nowhere — every language keeps
    the English, silently, which is the state that issue was filed about.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "status.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(
        r"export const BUILT_IN_STATUSES: readonly StatusDefinition\[\] = \[(.*?)\n\];",
        source,
        re.S,
    )
    assert match is not None, "BUILT_IN_STATUSES is no longer declared in status.ts"

    def field(entry: str, name: str) -> str:
        found = re.search(rf"\b{name}:\s*'([^']*)'", entry)
        assert found is not None, f"{name} is missing from a BUILT_IN_STATUSES entry"
        return found.group(1)

    def order(entry: str) -> int:
        found = re.search(r"\border:\s*(\d+)", entry)
        assert found is not None, "order is missing from a BUILT_IN_STATUSES entry"
        return int(found.group(1))

    declared = [
        (
            field(entry, "slug"),
            field(entry, "label"),
            order(entry),
            field(entry, "color"),
            field(entry, "icon"),
        )
        for entry in re.findall(r"\{([^{}]*)\}", match.group(1))
    ]
    seeded = [
        (d.slug, d.label, d.order, d.color, d.icon) for d in seed_status_definitions().values()
    ]

    assert declared == seeded


def test_the_options_flow_offers_exactly_the_pills_the_card_draws() -> None:
    """The pill vocabulary is spelled out in both languages and must agree.

    Neither side can check the other: the options flow stores names the card
    looks up, and a name only one of them knows is dropped in silence — the
    household ticks a pill that never appears, or loses one it never untucked.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "quick-filters.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"export const QUICK_FILTER_KEYS = \[(.*?)\] as const;", source, re.S)
    assert match is not None, "QUICK_FILTER_KEYS is no longer declared in quick-filters.ts"
    declared = re.findall(r"'([^']+)'", match.group(1))

    assert declared == list(QUICK_FILTER_KEYS)


def test_every_pill_the_options_flow_offers_carries_a_label() -> None:
    """A selector option with no translation renders its raw wire name.

    Home Assistant looks the labels up under `selector.<key>.options.<value>`,
    so a pill added on the Python side alone reaches the form as `low_stock`.
    """
    strings = json.loads(
        (REPO_ROOT / "custom_components" / "haventory" / "strings.json").read_text(encoding="utf-8")
    )
    labels = strings["selector"]["quick_filters"]["options"]

    assert sorted(labels) == sorted(QUICK_FILTER_KEYS)
    assert all(isinstance(text, str) and text for text in labels.values())


def test_every_status_colour_has_a_rule_in_the_chip_stylesheet() -> None:
    """``STATUS_COLORS`` names tones only the card can paint.

    Same blind spot as the icons: a token with no rule falls back to the base
    chip and the status renders in the wrong colour rather than failing.
    """
    source = (REPO_ROOT / "cards" / "haventory-card" / "src" / "ui" / "chip.ts").read_text(
        encoding="utf-8"
    )
    styled = set(re.findall(r"\.hv-status-chip\.tone-([a-z-]+)", source))

    expected = {token.replace("_", "-") for token in STATUS_COLORS}
    assert expected <= styled, f"no rule for: {sorted(expected - styled)}"


@pytest.mark.asyncio
async def test_applying_twice_over_registers_once(hav_init):
    """An options save that changes nothing about the panel must not touch it.

    Registering onto a path already taken raises in HA, so a changed
    registration has to be removed first — and for the moment it is gone, the
    frontend sends whoever is on `/haventory` back to the default dashboard.
    """
    hass = make_hass()
    entry = ConfigEntry()

    await setup_frontend(hav_init, hass, entry)
    panel = registered_panel(hass)
    await hav_init._async_apply_sidebar_panel(hass, entry)

    assert list(hass.data[DATA_PANELS]) == [PANEL_URL_PATH]
    # The same object, so the second pass neither replaced the registration nor
    # took it away and put it back.
    assert registered_panel(hass) is panel


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
