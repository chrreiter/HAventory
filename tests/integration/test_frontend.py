"""Integration: the card is served and loaded, against a real Home Assistant core.

The offline suite asserts this against stubs of ``hass.http`` and the frontend's
URL manager. Here the aiohttp route, the real ``StaticPathConfig`` and the real
``UrlManager`` do the work, which is the only way to catch a stub that has
drifted from the API it stands in for.
"""

from __future__ import annotations

import json
from importlib.metadata import version
from pathlib import Path

import pytest
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_SIDEBAR_PANEL_ENABLED,
    DEFAULT_CARD_TITLE,
    PANEL_ELEMENT_NAME,
    PANEL_ICON,
    PANEL_URL_PATH,
)
from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntryDisabler
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

CARD_PATH = "/haventory_static/haventory-card.js"
HTTP_OK = 200
BUNDLE = (
    Path(__file__).resolve().parents[2]
    / "custom_components"
    / "haventory"
    / "www"
    / "haventory-card.js"
)

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
    """The static route serves the real bytes, and leaves revalidation on.

    A `Cache-Control` header here is the old `/local` failure mode: the browser
    keeps a stale card for as long as the header says, whatever the server has.
    """
    await setup_entry()

    response = await (await hass_client_no_auth()).get(CARD_PATH)

    assert response.status == HTTP_OK
    assert "Cache-Control" not in response.headers
    assert response.headers.get("ETag")
    assert await response.read() == BUNDLE.read_bytes()


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

    assert len(card_resources) == 1
    assert set(module_urls) == {card_resources[0]["url"]}
    assert card_resources[0]["url"].startswith(f"{CARD_PATH}?v=")


@needs_bundle
async def test_reload_registers_the_static_route_once(
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator, setup_entry
) -> None:
    """aiohttp rejects a duplicate route, so a reload must not attempt one.

    The failure this guards is not cosmetic: an unguarded second registration
    raises out of `async_setup_entry` and leaves the entry in a retry loop.
    """
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


@needs_bundle
async def test_removal_deletes_the_card_resource_and_module_url(
    hass: HomeAssistant, setup_entry
) -> None:
    """Removal takes both loaders back through the real resource collection.

    The offline suite asserts this against a mock collection; only the real
    `ResourceStorageCollection.async_delete_item` proves the id we hand it is
    the one it stores.
    """
    entry = await setup_entry()
    resources = hass.data["lovelace"].resources
    assert [r for r in resources.async_items() if r["url"].startswith(CARD_PATH)]

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()

    assert [r for r in resources.async_items() if r["url"].startswith(CARD_PATH)] == []
    assert set(hass.data[frontend.DATA_EXTRA_MODULE_URL].urls) == set()


@needs_bundle
async def test_removal_leaves_the_static_route_serving(
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator, setup_entry
) -> None:
    """aiohttp cannot drop a route, so a re-add must not register a second one.

    The flag recording the route is the one piece of domain state removal keeps;
    losing it turns the next setup into the duplicate registration that leaves
    the entry in a retry loop.
    """
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

    The offline suite asserts this against a stub of `async_register_panel`;
    only the real helper proves the `_panel_custom` block HA's frontend reads is
    the one we asked for, module URL and element name included.

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
async def test_a_reload_leaves_the_same_panel_object_in_place(
    hass: HomeAssistant, setup_entry
) -> None:
    """A browser standing on `/haventory` is sent away the moment the panel goes.

    Identity rather than presence: a remove-then-register inside the reload
    would put a different `Panel` in the registry, and would already have fired
    the panel-update event that moves the browser. Only the real `frontend`
    component has that registry, so the offline suite cannot see this.
    """
    entry = await setup_entry()
    panel = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]

    assert await hass.config_entries.async_reload(entry.entry_id)
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
    the unload path reads, and it is real-core behaviour a stub cannot vouch for.
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
