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
from custom_components.haventory.const import DOMAIN
from homeassistant.components import frontend
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
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


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


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
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator
) -> None:
    """The static route serves the real bytes, and leaves revalidation on.

    A `Cache-Control` header here is the old `/local` failure mode: the browser
    keeps a stale card for as long as the header says, whatever the server has.
    """
    await _setup(hass)

    response = await (await hass_client_no_auth()).get(CARD_PATH)

    assert response.status == HTTP_OK
    assert "Cache-Control" not in response.headers
    assert response.headers.get("ETag")
    assert await response.read() == BUNDLE.read_bytes()


@needs_bundle
async def test_both_loaders_get_the_same_url(hass: HomeAssistant) -> None:
    """One URL string, registered twice — the browser module map dedupes it.

    Two *different* URLs for the same module evaluate it twice, and the second
    `customElements.define("haventory-card", ...)` throws.
    """
    await _setup(hass)

    module_urls = hass.data[frontend.DATA_EXTRA_MODULE_URL].urls
    resources = hass.data["lovelace"].resources.async_items()
    card_resources = [r for r in resources if r["url"].startswith(CARD_PATH)]

    assert len(card_resources) == 1
    assert set(module_urls) == {card_resources[0]["url"]}
    assert card_resources[0]["url"].startswith(f"{CARD_PATH}?v=")


@needs_bundle
async def test_reload_registers_the_static_route_once(
    hass: HomeAssistant, hass_client_no_auth: ClientSessionGenerator
) -> None:
    """aiohttp rejects a duplicate route, so a reload must not attempt one.

    The failure this guards is not cosmetic: an unguarded second registration
    raises out of `async_setup_entry` and leaves the entry in a retry loop.
    """
    entry = await _setup(hass)

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()

    assert (await (await hass_client_no_auth()).get(CARD_PATH)).status == HTTP_OK


@needs_bundle
async def test_unload_hands_back_the_module_url(hass: HomeAssistant) -> None:
    """Unload takes the module URL out of the frontend's set; the route stays."""
    entry = await _setup(hass)
    assert hass.data[frontend.DATA_EXTRA_MODULE_URL].urls

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert set(hass.data[frontend.DATA_EXTRA_MODULE_URL].urls) == set()
