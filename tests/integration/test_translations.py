"""Integration: the shipped ``translations/`` directory, read by real Home Assistant.

Nothing offline reads these files the way a browser gets them. The offline
``HomeAssistant`` stub has no translation machinery at all, and the offline
tests in ``tests/test_config_flow_offline.py`` only compare the documents to
each other — which would stay green if Home Assistant could not find, parse or
serve them. hassfest validates the *shape* in CI and says nothing about whether
a given language actually resolves.

So the claim under test is the one a German household makes: with a profile set
to Deutsch, the config flow, the options screen, the entity names, the
quick-filter options and the service catalog come back in German, and a
language nothing ships for falls back to English rather than to a key.
"""

from __future__ import annotations

from custom_components.haventory.const import DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import translation


async def _catalog(hass: HomeAssistant, language: str, category: str) -> dict[str, str]:
    return await translation.async_get_translations(hass, language, category, {DOMAIN})


async def test_german_config_and_options_screens_resolve(hass: HomeAssistant) -> None:
    """The two screens a household sees before anything else, in German."""

    config = await _catalog(hass, "de", "config")
    assert config[f"component.{DOMAIN}.config.step.user.data.card_title"] == "Kartentitel"

    options = await _catalog(hass, "de", "options")
    assert options[f"component.{DOMAIN}.options.step.init.title"] == "HAventory-Optionen"
    # A section's own text, which is nested two levels deeper than anything else
    # in the document.
    section = f"component.{DOMAIN}.options.step.init.sections.todo"
    assert options[f"{section}.name"] == "Einkaufsliste"


async def test_german_entities_selectors_and_services_resolve(hass: HomeAssistant) -> None:
    """Everything else Home Assistant renders from a translation file."""

    entity = await _catalog(hass, "de", "entity")
    assert entity[f"component.{DOMAIN}.entity.sensor.items_total.name"] == "Anzahl Gegenstände"

    selector = await _catalog(hass, "de", "selector")
    key = f"component.{DOMAIN}.selector.quick_filters.options.checked_out"
    assert selector[key] == "Ausgeliehen"

    services = await _catalog(hass, "de", "services")
    assert services[f"component.{DOMAIN}.services.item_check_out.name"] == "Gegenstand ausleihen"


async def test_a_language_nothing_ships_falls_back_to_english(hass: HomeAssistant) -> None:
    """No dictionary, no keys on the screen — the English string stands in.

    Home Assistant does this itself; the test is here because it is the whole
    reason a partial set of languages is safe to ship.
    """

    swedish = await _catalog(hass, "sv", "config")
    assert swedish[f"component.{DOMAIN}.config.step.user.data.card_title"] == "Card title"
