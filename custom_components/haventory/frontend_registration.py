"""The card bundle's two frontend loaders, and the sidebar panel.

The bundle is served from ``www/`` inside the package at ``/haventory_static/``,
and one versioned URL goes to both loaders (the extra module URL and the Lovelace
resource) and to the panel: two URLs for one bundle define the custom element
twice, and the second definition throws. aiohttp cannot unregister a route, so
the static path is registered once per Home Assistant run and its flag in
``hass.data[DOMAIN]`` outlives the entry. ``LOVELACE_DATA`` is bound at import.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from homeassistant.components.frontend import (
    add_extra_js_url,
    async_remove_panel,
    remove_extra_js_url,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace import LOVELACE_DATA
from homeassistant.components.panel_custom import async_register_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .config_flow import clean_card_title
from .const import (
    CONF_CARD_TITLE,
    CONF_SIDEBAR_PANEL_ENABLED,
    DEFAULT_SIDEBAR_PANEL_ENABLED,
    DOMAIN,
    INTEGRATION_VERSION,
    PANEL_ELEMENT_NAME,
    PANEL_ICON,
    PANEL_URL_PATH,
)
from .logs import context_logger

LOGGER = context_logger(__name__)

# The card bundle ships inside the integration package — the only tree HACS
# copies for an integration-category repo — and is served from there.
_CARD_FILENAME = "haventory-card.js"
_WWW_DIR = Path(__file__).parent / "www"
_CARD_BUNDLE_PATH = _WWW_DIR / _CARD_FILENAME
_STATIC_URL_PATH = "/haventory_static"
_CARD_URL_PATH = f"{_STATIC_URL_PATH}/{_CARD_FILENAME}"

# hass.data[DOMAIN] keys that outlive a config entry. aiohttp cannot unregister a
# route, so a reload must not add the static path twice; the module URL has to be
# removed as the exact string it was registered under.
_STATIC_PATH_KEY = "static_path_registered"
_EXTRA_JS_URL_KEY = "extra_js_url"

# The (title, module URL) the sidebar panel is registered with, or absent. It
# outlives a plain unload because a reload passes through one, and a browser on
# `/haventory` is sent to the default dashboard once the panel leaves `hass.panels`.
_PANEL_STATE_KEY = "panel_state"


def _card_url() -> str:
    """The one URL both frontend loaders receive, versioned as `?v=`.

    The bundle is served without `Cache-Control`, so a browser falls back to
    heuristic freshness and may hold an old bundle for days after an update; a
    version bump is a new URL no cache can satisfy.
    """
    return f"{_CARD_URL_PATH}?v={quote(INTEGRATION_VERSION, safe='')}"


def _points_at_card(resource_url: Any) -> bool:
    """Does an already-registered Lovelace resource serve the HAventory card?

    Paths, not whole URLs: matching the `?v=` too would register a second entry
    for the same module, and the second `customElements.define` throws.
    """
    if not isinstance(resource_url, str):
        return False
    return urlsplit(resource_url).path == _CARD_URL_PATH


async def _async_lovelace_resources(hass: HomeAssistant, *, op: str) -> Any:
    """Return the loaded Lovelace resource collection, or None if out of reach."""
    lovelace_data = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace_data, "resources", None) if lovelace_data else None
    if resources is None:
        LOGGER.debug(
            "Lovelace not initialized or resources unavailable",
            extra={"op": op},
        )
        return None

    # `async_items` is sync and reports nothing until the collection is loaded.
    # `async_load` leaves `loaded` False, and the next write would then load and
    # re-add every item, so the flag is set here too.
    if not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True

    return resources


async def _async_register_static_path(hass: HomeAssistant) -> bool:
    """Serve the card directory over HTTP, at most once per Home Assistant run."""
    bucket = hass.data.setdefault(DOMAIN, {})
    if bucket.get(_STATIC_PATH_KEY):
        return True

    try:
        # No Cache-Control, so a rebuild that kept the version is revalidated.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(_STATIC_URL_PATH, str(_WWW_DIR), cache_headers=False)]
        )
    except OSError, RuntimeError, ValueError:
        # What aiohttp raises building and routing a static resource.
        # ERROR: without the route neither card loader has anything to load.
        LOGGER.error(
            "Failed to serve the HAventory card directory; the card cannot load",
            extra={"op": "frontend_register", "path": str(_WWW_DIR)},
            exc_info=True,
        )
        return False

    bucket[_STATIC_PATH_KEY] = True
    LOGGER.debug(
        "Serving the HAventory card bundle",
        extra={
            "op": "frontend_register",
            "url": _STATIC_URL_PATH,
            "path": str(_WWW_DIR),
        },
    )
    return True


def _register_extra_js_url(hass: HomeAssistant, url: str) -> None:
    """Have the frontend load the card as an extra module on every dashboard.

    This loader reaches YAML resource mode; HA Cast ignores it, which is what the
    Lovelace resource is for.
    """
    try:
        add_extra_js_url(hass, url)
    except KeyError:
        # The frontend has not set up its URL manager.
        LOGGER.debug(
            "Frontend not ready for an extra module URL; the card relies on the Lovelace resource",
            extra={"op": "frontend_register", "url": url},
            exc_info=True,
        )
        return

    hass.data.setdefault(DOMAIN, {})[_EXTRA_JS_URL_KEY] = url
    LOGGER.debug(
        "Registered the HAventory card as a frontend module URL",
        extra={"op": "frontend_register", "url": url},
    )


def release_extra_js_url(hass: HomeAssistant, fallback_url: str | None = None) -> None:
    """Hand back the module URL registered at setup.

    The stored string wins: it carries the version the card was registered
    under, which an update may have moved on from.
    """
    url = hass.data.setdefault(DOMAIN, {}).pop(_EXTRA_JS_URL_KEY, None) or fallback_url
    if url is None:
        return

    try:
        remove_extra_js_url(hass, url)
    except KeyError:
        # The frontend has not set up its URL manager.
        LOGGER.debug(
            "Could not remove the frontend module URL",
            extra={"op": "frontend_unregister", "url": url},
            exc_info=True,
        )
        return

    LOGGER.debug(
        "Removed the HAventory card frontend module URL",
        extra={"op": "frontend_unregister", "url": url},
    )


def _sidebar_panel_enabled(entry: ConfigEntry) -> bool:
    """Whether the config entry asks for a sidebar entry; an unset option reads as on."""
    return bool(entry.options.get(CONF_SIDEBAR_PANEL_ENABLED, DEFAULT_SIDEBAR_PANEL_ENABLED))


def remove_sidebar_panel(hass: HomeAssistant) -> None:
    """Take the sidebar entry back, whether or not one is registered."""
    hass.data.setdefault(DOMAIN, {}).pop(_PANEL_STATE_KEY, None)
    async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)


async def async_apply_sidebar_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Converge the sidebar entry on what the options and the build ask for.

    A registration already in place is left as it is. Changing one means removing
    it first, because `panel_custom.async_register_panel` does not forward
    `update` and raises `Overwriting panel`, and while the panel is gone the
    frontend sends whoever is on its page back to the default dashboard. So only
    the sidebar toggle and a rename pay that cost.
    """
    bucket = hass.data.setdefault(DOMAIN, {})

    def give_back() -> None:
        """Drop the panel if there is one; say nothing when there never was."""
        if bucket.get(_PANEL_STATE_KEY) is not None:
            remove_sidebar_panel(hass)

    if not _sidebar_panel_enabled(entry):
        give_back()
        LOGGER.debug(
            "Sidebar panel disabled in the options; not registering",
            extra={"op": "panel_register"},
        )
        return

    # The panel element lives in the card bundle.
    if not os.path.isfile(_CARD_BUNDLE_PATH):  # noqa: ASYNC240
        give_back()
        LOGGER.debug(
            "Card bundle not built; skipping sidebar panel registration",
            extra={
                "op": "panel_register",
                "path": str(_CARD_BUNDLE_PATH),
            },
        )
        return

    title = clean_card_title(entry.options.get(CONF_CARD_TITLE))
    # The exact string both card loaders receive, or the element is defined twice.
    url = _card_url()
    wanted = (title, url)

    if bucket.get(_PANEL_STATE_KEY) == wanted:
        LOGGER.debug(
            "Sidebar panel already registered as asked; leaving it in place",
            extra={
                "op": "panel_register",
                "url": PANEL_URL_PATH,
                "module_url": url,
            },
        )
        return

    give_back()

    try:
        await async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_ELEMENT_NAME,
            sidebar_title=title,
            sidebar_icon=PANEL_ICON,
            module_url=url,
            embed_iframe=False,
            trust_external=False,
            config={"title": title},
            require_admin=False,
        )
    except ValueError:
        # "Overwriting panel": something other than this integration holds the path.
        LOGGER.warning(
            "Failed to register the HAventory sidebar panel",
            extra={"op": "panel_register", "url": PANEL_URL_PATH},
            exc_info=True,
        )
        return

    bucket[_PANEL_STATE_KEY] = wanted
    LOGGER.debug(
        "Registered the HAventory sidebar panel",
        extra={
            "op": "panel_register",
            "url": PANEL_URL_PATH,
            "module_url": url,
        },
    )


async def _rewrite_card_resource(resources: Any, stale: dict[str, Any], url: str) -> None:
    """Point an existing card entry at the current URL, rather than adding a second."""
    stale_id = stale.get("id")
    # No update API means YAML mode, where resources are user-managed; no id means
    # the entry cannot be addressed. Either way, leave it as it stands.
    if stale_id is None or not hasattr(resources, "async_update_item"):
        LOGGER.debug(
            "Cannot rewrite the registered card resource; leaving it as-is",
            extra={"op": "frontend_register", "url": stale.get("url")},
        )
        return

    # The three resource writes below catch everything: the collection loads its
    # store on first use, so it can raise whatever reading that file raises
    # (HomeAssistantError, a migration's error) besides ItemNotFound, ValueError
    # and vol.Invalid. A refused resource is a warning, not a failed setup.
    try:
        await resources.async_update_item(stale_id, {"res_type": "module", "url": url})
        LOGGER.info(
            "Updated HAventory card Lovelace resource to the current version",
            extra={
                "op": "frontend_register",
                "url": url,
                "previous_url": stale.get("url"),
            },
        )
    except Exception:
        LOGGER.warning(
            "Failed to update frontend resource",
            extra={"op": "frontend_register", "url": url},
            exc_info=True,
        )


async def _create_card_resource(resources: Any, url: str) -> None:
    """Add the card to the Lovelace resource list, where that list is writable."""
    if not hasattr(resources, "async_create_item"):
        LOGGER.debug(
            "Lovelace in YAML mode; the card loads through the frontend module URL instead",
            extra={"op": "frontend_register", "url": url},
        )
        return

    try:
        await resources.async_create_item({"res_type": "module", "url": url})
        LOGGER.info(
            "Registered HAventory card as Lovelace resource",
            extra={"op": "frontend_register", "url": url},
        )
    except Exception:  # Same reasons as in `_rewrite_card_resource`.
        LOGGER.warning(
            "Failed to register frontend resource",
            extra={"op": "frontend_register", "url": url},
            exc_info=True,
        )


async def _delete_card_resource(resources: Any, item: dict[str, Any], *, op: str) -> None:
    """Remove one Lovelace resource entry for the card."""
    item_id = item.get("id")
    # YAML mode: the collection is read-only and its entries carry no id.
    if item_id is None or not hasattr(resources, "async_delete_item"):
        return

    try:
        await resources.async_delete_item(item_id)
        LOGGER.info(
            "Removed HAventory card Lovelace resource",
            extra={
                "op": op,
                "url": item.get("url"),
                "resource_id": item_id,
            },
        )
    except Exception:  # Same reasons as in `_rewrite_card_resource`.
        LOGGER.warning(
            "Failed to remove frontend resource",
            extra={
                "op": op,
                "url": item.get("url"),
                "resource_id": item_id,
            },
            exc_info=True,
        )


async def _async_register_lovelace_resource(hass: HomeAssistant, url: str) -> None:
    """Leave exactly one Lovelace resource for the card, pointing at `url`."""
    resources = await _async_lovelace_resources(hass, op="frontend_register")
    if resources is None:
        return

    ours = [item for item in (resources.async_items() or []) if _points_at_card(item.get("url"))]
    if not ours:
        await _create_card_resource(resources, url)
        return

    keep, *duplicates = ours
    if keep.get("url") == url:
        LOGGER.debug(
            "HAventory card resource already registered at the current version",
            extra={"op": "frontend_register", "url": url},
        )
    else:
        await _rewrite_card_resource(resources, keep, url)

    # Anything beyond the first entry defines the same element a second time.
    for item in duplicates:
        await _delete_card_resource(resources, item, op="frontend_register")


async def async_register_frontend_module(hass: HomeAssistant) -> None:
    """Serve the built card and hand the same URL to both frontend loaders."""
    # A single stat at setup is not worth an executor round-trip.
    if not os.path.isfile(_CARD_BUNDLE_PATH):  # noqa: ASYNC240
        LOGGER.debug(
            "Card bundle not built; skipping frontend registration",
            extra={
                "op": "frontend_register",
                "path": str(_CARD_BUNDLE_PATH),
            },
        )
        return

    if not await _async_register_static_path(hass):
        return

    url = _card_url()
    _register_extra_js_url(hass, url)
    await _async_register_lovelace_resource(hass, url)


async def async_unregister_frontend_module(hass: HomeAssistant) -> None:
    """Take back both frontend registrations for the card."""
    release_extra_js_url(hass, _card_url())

    resources = await _async_lovelace_resources(hass, op="frontend_unregister")
    if resources is None:
        return

    # YAML mode: resources come from configuration.yaml and the collection is
    # read-only, so an entry there is the user's to remove.
    if not hasattr(resources, "async_delete_item"):
        LOGGER.info(
            "Lovelace in YAML mode; remove any HAventory card resource from configuration.yaml",
            extra={"op": "frontend_unregister", "url": _CARD_URL_PATH},
        )
        return

    # Snapshot the collection: deleting mutates what async_items() reflects.
    for item in list(resources.async_items() or []):
        if _points_at_card(item.get("url")):
            await _delete_card_resource(resources, item, op="frontend_unregister")
