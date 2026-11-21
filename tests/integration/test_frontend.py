"""Integration: the card is served and loaded, against a real Home Assistant core.

The aiohttp route, the real ``StaticPathConfig``, the ``UrlManager`` and the
Lovelace resource collection do the work, so a change in any of those APIs fails here.
"""

from __future__ import annotations

import json
import logging
from importlib.metadata import version
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from custom_components.haventory import frontend_registration
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_QUICK_FILTERS,
    CONF_SIDEBAR_PANEL_ENABLED,
    DEFAULT_CARD_TITLE,
    INTEGRATION_VERSION,
    PANEL_ELEMENT_NAME,
    PANEL_ICON,
    PANEL_URL_PATH,
)
from homeassistant.components import frontend
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.config_entries import ConfigEntryDisabler, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

CARD_PATH = "/haventory_static/haventory-card.js"
CURRENT = f"{CARD_PATH}?v={quote(INTEGRATION_VERSION, safe='')}"
STALE = f"{CARD_PATH}?v=0.0.1"
FOREIGN_MODULE = "/other_static/other-card.js"
LOGGER_NAME = "custom_components.haventory.frontend_registration"
RESOURCES_KEY = "lovelace_resources"
HTTP_OK = 200
BUNDLE = (
    Path(__file__).resolve().parents[2]
    / "custom_components"
    / "haventory"
    / "www"
    / "haventory-card.js"
)

CHUNKS_DIR = BUNDLE.parent / "chunks"

needs_bundle = pytest.mark.skipif(
    not BUNDLE.is_file(),
    reason="card bundle not built (npm run build in cards/haventory-card)",
)


def test_the_frontend_wheel_matches_what_this_ha_release_asks_for() -> None:
    """`requirements-integration.txt` pins a wheel HA's own manifest chooses.

    Home Assistant installs component requirements at startup; this harness does
    not, so the pin is hand-carried and goes stale the moment the HA pin moves.
    Without the wheel, `frontend` fails to set up and every test here fails with
    a dependency error rather than anything about HAventory.
    """
    required = json.loads(
        (Path(frontend.__file__).with_name("manifest.json")).read_text(encoding="utf-8")
    )["requirements"]

    assert [f"home-assistant-frontend=={version('home-assistant-frontend')}"] == required


@needs_bundle
async def test_bundle_is_served_without_cache_control(
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator, setup_entry
) -> None:
    """The static route serves the real bytes with an ETag and no `Cache-Control`.

    A `Cache-Control` header here is the old `/local` failure mode: the browser
    keeps a stale card for as long as the header says, whatever the server has.
    Without one a browser still applies heuristic freshness, which the versioned
    URL and the hashed chunk names get around; see `_card_url`.
    """
    await setup_entry()

    response = await (await hass_client_no_auth()).get(CARD_PATH)

    assert response.status == HTTP_OK
    assert "Cache-Control" not in response.headers
    assert response.headers.get("ETag")
    assert await response.read() == BUNDLE.read_bytes()


@needs_bundle
async def test_a_chunk_the_build_manifest_names_is_served(
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator, setup_entry
) -> None:
    """The static path covers ``chunks/``, where the entry's imports resolve.

    The entry imports its chunks by relative URL, so a chunk the route does not
    serve leaves the card unable to start.
    """
    manifest = json.loads((CHUNKS_DIR / "manifest.json").read_text(encoding="utf-8"))
    chunk = next(
        record["file"] for record in manifest.values() if record["file"].startswith("chunks/")
    )
    await setup_entry()

    response = await (await hass_client_no_auth()).get(f"/haventory_static/{chunk}")

    assert response.status == HTTP_OK
    assert await response.read() == (BUNDLE.parent / chunk).read_bytes()


@needs_bundle
async def test_both_loaders_get_the_same_url(hass: HomeAssistant, setup_entry) -> None:
    """One URL string, registered twice — the browser module map dedupes it.

    Two *different* URLs for the same module evaluate it twice, and the second
    `customElements.define("haventory-card", ...)` throws.
    """
    await setup_entry()

    module_urls = hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    resources = hass.data["lovelace"].resources.async_items()
    card_resources = [r for r in resources if r["url"].startswith(CARD_PATH)]

    assert [r["url"] for r in card_resources] == [CURRENT]
    assert set(module_urls) == {CURRENT}


@needs_bundle
async def test_reload_registers_the_static_route_once(
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator, setup_entry
) -> None:
    """aiohttp cannot drop a route, so the one the first setup added serves after a reload."""
    entry = await setup_entry()

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    assert (await (await hass_client_no_auth()).get(CARD_PATH)).status == HTTP_OK


@needs_bundle
async def test_unload_hands_back_the_module_url(hass: HomeAssistant, setup_entry) -> None:
    """Unload takes the module URL out of the frontend's set; the route stays."""
    entry = await setup_entry()
    assert hass.data[frontend.DATA_EXTRA_MODULE_URL].urls

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert set(hass.data[frontend.DATA_EXTRA_MODULE_URL].urls) == set()


def seed_resources(hass_storage: dict[str, Any], rows: list[tuple[str, str]]) -> None:
    """Fill the Lovelace resource store before setup, as `(id, url)` rows."""
    hass_storage[RESOURCES_KEY] = {
        "version": 1,
        "key": RESOURCES_KEY,
        "data": {"items": [{"id": i, "url": u, "type": "module"} for i, u in rows]},
    }


def resource_rows(hass: HomeAssistant) -> list[tuple[str, str]]:
    """The `(id, url)` rows of the storage-mode resource collection."""
    return [(r["id"], r["url"]) for r in hass.data["lovelace"].resources.async_items()]


def module_urls(hass: HomeAssistant) -> set[str]:
    return set(hass.data[frontend.DATA_EXTRA_MODULE_URL].urls)


def assert_rows(actual: list[tuple[str, str]], expected: list[tuple[str | None, str]]) -> None:
    """Rows equal expected ones, an expected id of `None` standing for any generated id."""
    assert [url for _, url in actual] == [url for _, url in expected]
    for (actual_id, _), (expected_id, _) in zip(actual, expected, strict=True):
        assert expected_id is None or actual_id == expected_id


@needs_bundle
@pytest.mark.parametrize(
    ("seeded", "after_setup", "after_removal"),
    [
        pytest.param([], [(None, CURRENT)], [], id="none"),
        pytest.param(
            [("existing", CURRENT)],
            [("existing", CURRENT)],
            [],
            id="current-in-unloaded-collection",
        ),
        pytest.param([("existing", CARD_PATH)], [("existing", CURRENT)], [], id="stale-bare-path"),
        pytest.param([("existing", STALE)], [("existing", CURRENT)], [], id="stale-version"),
        pytest.param(
            [("existing", f"{CARD_PATH}?v=1&foo=bar")],
            [("existing", CURRENT)],
            [],
            id="stale-extra-query",
        ),
        pytest.param(
            [("existing", f"{CARD_PATH}#frag")], [("existing", CURRENT)], [], id="stale-fragment"
        ),
        pytest.param(
            [("current", CURRENT), ("stale", STALE)],
            [("current", CURRENT)],
            [],
            id="duplicate",
        ),
        pytest.param(
            [
                ("other", "/local/other-card.js"),
                ("lookalike", "/hacsfiles/elsewhere/haventory-card.js"),
            ],
            [
                ("other", "/local/other-card.js"),
                ("lookalike", "/hacsfiles/elsewhere/haventory-card.js"),
                (None, CURRENT),
            ],
            [
                ("other", "/local/other-card.js"),
                ("lookalike", "/hacsfiles/elsewhere/haventory-card.js"),
            ],
            id="beside-others",
        ),
    ],
)
async def test_the_card_resource_converges_on_one_current_entry(  # noqa: PLR0913, PLR0917 - one parameter per stage
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    setup_entry,
    seeded: list[tuple[str, str]],
    after_setup: list[tuple[str | None, str]],
    after_removal: list[tuple[str, str]],
) -> None:
    """Setup leaves one card resource at the current URL, and removal leaves none of ours.

    A reload changes nothing, an entry of someone else's is never touched, and the
    module URL another integration registered outlives the removal.
    """
    seed_resources(hass_storage, seeded)
    assert await async_setup_component(hass, "frontend", {})
    frontend.add_extra_js_url(hass, FOREIGN_MODULE)
    entry = await setup_entry()

    rows = resource_rows(hass)
    assert_rows(rows, after_setup)
    assert module_urls(hass) == {FOREIGN_MODULE, CURRENT}

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert resource_rows(hass) == rows

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert resource_rows(hass) == after_removal
    assert module_urls(hass) == {FOREIGN_MODULE}


@needs_bundle
async def test_removal_leaves_the_static_route_serving(
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator, setup_entry
) -> None:
    """Removal cannot take the route back, and the integration added again serves the card."""
    entry = await setup_entry()

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    await setup_entry()

    assert (await (await hass_client_no_auth()).get(CARD_PATH)).status == HTTP_OK


@needs_bundle
async def test_the_sidebar_panel_lands_in_the_real_panel_registry(
    hass: HomeAssistant, setup_entry
) -> None:
    """`panel_custom` puts a real `Panel` in `hass.data`, built the way HA builds them.

    This proves the `_panel_custom` block HA's frontend reads is the one we asked
    for, module URL and element name included.

    A subset rather than an equality: `panel_custom` fills the block with its own
    defaults too, and Home Assistant adds one from time to time (`2026.8`
    introduced `handle_safe_area`). What matters is what this integration asked
    for; a key HA chose for itself is not drift and must not fail the scheduled
    run against a newer core.
    """
    await setup_entry()

    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]

    assert panel.component_name == "custom"
    assert panel.sidebar_title == DEFAULT_CARD_TITLE
    assert panel.sidebar_icon == PANEL_ICON
    assert panel.require_admin is False
    assert panel.config["title"] == DEFAULT_CARD_TITLE
    assert (
        panel.config["_panel_custom"].items()
        >= {
            "name": PANEL_ELEMENT_NAME,
            "embed_iframe": False,
            "trust_external": False,
            "module_url": next(iter(hass.data[frontend.DATA_EXTRA_MODULE_URL].urls)),
        }.items()
    )


@needs_bundle
@pytest.mark.parametrize("step", ["reload", "options_save"])
async def test_a_reload_leaves_the_same_panel_object_in_place(
    hass: HomeAssistant, setup_entry, step: str
) -> None:
    """A browser standing on `/haventory` is sent away the moment the panel goes.

    Identity rather than presence: a remove-then-register would put a different
    `Panel` in the registry and fire the panel-update event that moves the
    browser. An options save that leaves the panel alone must not do it either.
    """
    entry = await setup_entry()
    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]

    if step == "reload":
        assert await hass.config_entries.async_reload(entry.entry_id)
    else:
        hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_QUICK_FILTERS: ["total"]}
        )
    await hass.async_block_till_done()

    assert hass.data[frontend.DATA_PANELS][PANEL_URL_PATH] is panel


@needs_bundle
async def test_an_unload_on_its_own_keeps_the_sidebar_panel(
    hass: HomeAssistant, setup_entry
) -> None:
    """The half of a reload the panel has to survive, asserted on its own.

    A reload is an unload followed by a setup; if the unload took the panel, the
    setup could only put a new one back and the page would be gone either way.
    """
    entry = await setup_entry()

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert PANEL_URL_PATH in hass.data[frontend.DATA_PANELS]


@needs_bundle
async def test_a_rename_replaces_the_panel_without_the_overwriting_error(
    hass: HomeAssistant,
    setup_entry,
) -> None:
    """`async_register_built_in_panel` raises on a path already taken.

    Renaming is the path that registers a second time now, so it is the path
    that has to remove first. Unguarded, the raise comes out of the options
    listener, the sidebar keeps the old name, and nothing about it reaches the
    user.
    """
    entry = await setup_entry()

    hass.config_entries.async_update_entry(entry, options={CONF_CARD_TITLE: "Pantry"})
    await hass.async_block_till_done()

    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]
    assert panel.sidebar_title == "Pantry"
    assert panel.config["title"] == "Pantry"


@needs_bundle
async def test_a_disabled_entry_gives_the_sidebar_panel_back(
    hass: HomeAssistant, setup_entry
) -> None:
    """A disabled entry stays unloaded, so its sidebar entry opens nothing.

    Home Assistant sets `disabled_by` before it unloads; that ordering is what
    the unload path reads.
    """
    entry = await setup_entry()

    assert await hass.config_entries.async_set_disabled_by(entry.entry_id, ConfigEntryDisabler.USER)
    await hass.async_block_till_done()

    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]


@needs_bundle
async def test_removing_the_entry_gives_the_sidebar_panel_back(
    hass: HomeAssistant, setup_entry
) -> None:
    """The other end: nothing is coming back to serve the page it opens."""
    entry = await setup_entry()

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()

    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]


@needs_bundle
async def test_an_opted_out_entry_registers_no_panel(hass: HomeAssistant, setup_entry) -> None:
    """The toggle is honoured at setup, and takes nothing else down with it."""
    await setup_entry({CONF_SIDEBAR_PANEL_ENABLED: False})

    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]
    assert hass.data[frontend.DATA_EXTRA_MODULE_URL].urls


@needs_bundle
async def test_the_sidebar_toggle_applies_without_a_reload(
    hass: HomeAssistant, setup_entry
) -> None:
    """Switching the option off and on takes the panel away and brings it back."""
    entry = await setup_entry()

    for enabled in (False, True):
        hass.config_entries.async_update_entry(entry, options={CONF_SIDEBAR_PANEL_ENABLED: enabled})
        await hass.async_block_till_done()

        assert (PANEL_URL_PATH in hass.data[frontend.DATA_PANELS]) is enabled
        assert entry.state is ConfigEntryState.LOADED


@needs_bundle
@pytest.mark.parametrize(
    "resources",
    [[], [STALE], [CURRENT, STALE]],
    ids=["empty", "stale", "current-and-stale"],
)
async def test_yaml_resources_are_left_as_the_user_wrote_them(
    hass: HomeAssistant,
    setup_entry,
    caplog: pytest.LogCaptureFixture,
    resources: list[str],
) -> None:
    """In YAML mode the card loads as a module URL and the user's list is never edited."""
    caplog.set_level(logging.INFO, logger=LOGGER_NAME)
    assert await async_setup_component(
        hass,
        "lovelace",
        {
            "lovelace": {
                "resource_mode": "yaml",
                "resources": [{"url": u, "type": "module"} for u in resources],
            }
        },
    )
    written = list(hass.data["lovelace"].resources.async_items())
    entry = await setup_entry()

    assert list(hass.data["lovelace"].resources.async_items()) == written
    assert module_urls(hass) == {CURRENT}

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()

    assert list(hass.data["lovelace"].resources.async_items()) == written
    assert module_urls(hass) == set()
    assert "remove any HAventory card resource from configuration.yaml" in caplog.text


@needs_bundle
@pytest.mark.parametrize(
    ("method", "seeded"),
    [
        ("async_create_item", []),
        ("async_update_item", [("stale", STALE)]),
        ("async_delete_item", [("current", CURRENT), ("stale", STALE)]),
    ],
)
async def test_a_refused_card_resource_is_a_warning_not_a_failed_setup(  # noqa: PLR0913, PLR0917 - one fixture per check
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    setup_entry,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    method: str,
    seeded: list[tuple[str, str]],
) -> None:
    """A resource store that refuses a write costs a warning; the card still loads by module URL."""

    async def refuse(self: Any, *args: Any, **kwargs: Any) -> None:
        raise RuntimeError("the resource store is unreadable")

    seed_resources(hass_storage, seeded)
    monkeypatch.setattr(ResourceStorageCollection, method, refuse)

    entry = await setup_entry()

    assert entry.state is ConfigEntryState.LOADED
    warnings = [r for r in caplog.records if r.name == LOGGER_NAME and r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "frontend resource" in warnings[0].getMessage()
    assert module_urls(hass) == {CURRENT}


async def test_an_unbuilt_bundle_registers_nothing_and_setup_goes_on(
    hass: HomeAssistant, setup_entry, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Without the bundle there is nothing to serve, load or open, and the inventory still runs."""
    monkeypatch.setattr(frontend_registration, "_CARD_BUNDLE_PATH", tmp_path / "missing.js")

    entry = await setup_entry()

    assert entry.state is ConfigEntryState.LOADED
    assert module_urls(hass) == set()
    assert [url for _, url in resource_rows(hass) if CARD_PATH in url] == []
    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]


@needs_bundle
async def test_a_foreign_panel_on_our_path_is_left_alone(
    hass: HomeAssistant, setup_entry, caplog: pytest.LogCaptureFixture
) -> None:
    """Another integration's panel on `/haventory` is not overwritten; setup warns and goes on."""
    assert await async_setup_component(hass, "frontend", {})
    frontend.async_register_built_in_panel(
        hass, "iframe", sidebar_title="Not ours", frontend_url_path=PANEL_URL_PATH
    )

    entry = await setup_entry()

    assert entry.state is ConfigEntryState.LOADED
    assert hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].sidebar_title == "Not ours"
    assert (
        sum(
            "Failed to register the HAventory sidebar panel" in r.getMessage()
            for r in caplog.records
            if r.levelno == logging.WARNING
        )
        == 1
    )
