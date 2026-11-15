"""Integration: the shipped ``translations/`` directory, read by real Home Assistant.

The first half reads the documents the way Home Assistant resolves them: with a
profile set to a language, a screen comes back translated or falls back to
English. The second half compares the documents to each other, which would stay
green if Home Assistant could not find or parse them. hassfest validates the
*shape* in CI and says nothing about whether a given language resolves or whether
two files agree on their keys and placeholders.

So the claim under test is the one a German household makes: with a profile set
to Deutsch, the config flow, the options screen, the entity names, the
quick-filter options and the service catalog come back in German, and a
language nothing ships for falls back to English rather than to a key.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from custom_components.haventory.const import DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import translation

INTEGRATION = Path(__file__).resolve().parents[2] / "custom_components" / "haventory"


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


async def test_german_service_refusals_resolve(hass: HomeAssistant) -> None:
    """The sentence Home Assistant's frontend shows for a refused service call."""

    exceptions = await _catalog(hass, "de", "exceptions")
    key = f"component.{DOMAIN}.exceptions.location_has_items.message"
    assert exceptions[key] == (
        "An diesem Ort befinden sich noch Gegenstände. Verschiebe oder lösche sie zuerst."
    )


def _translation_files() -> list[Path]:
    """Every file Home Assistant reads a translated string out of."""

    return [INTEGRATION / "strings.json", *sorted((INTEGRATION / "translations").glob("*.json"))]


def _flatten(node: object, prefix: str = "") -> dict[str, str]:
    """A nested translation document as `a.b.c` -> value."""

    if not isinstance(node, dict):
        return {prefix: str(node)}
    out: dict[str, str] = {}
    for key, value in node.items():
        out.update(_flatten(value, f"{prefix}.{key}" if prefix else key))
    return out


def test_translation_strings_carry_no_urls() -> None:
    """hassfest fails the build on a URL in a translation string.

    It only runs in CI, so catch the mistake here: a link belongs in a
    `{placeholder}` the flow fills, never inline in the string.
    """

    for path in _translation_files():
        text = path.read_text(encoding="utf-8")
        assert "http://" not in text and "https://" not in text, f"{path.name} contains a URL"


def test_translations_mirror_the_strings_key_tree() -> None:
    """Every shipped language answers to exactly the keys `strings.json` declares.

    A key only one language carries is a screen that renders in English for
    everyone else with nothing to say so, and a key a language carries that
    `strings.json` has dropped is dead weight nothing reads.
    """

    expected = set(_flatten(json.loads((INTEGRATION / "strings.json").read_text(encoding="utf-8"))))
    for path in sorted((INTEGRATION / "translations").glob("*.json")):
        keys = set(_flatten(json.loads(path.read_text(encoding="utf-8"))))
        assert keys == expected, f"{path.name} does not mirror strings.json"


def test_translations_repeat_their_placeholders() -> None:
    """A `{placeholder}` renames or vanishes silently, and renders literally.

    Home Assistant fills these by name — `{docs_url}` on the options screen,
    `{error}` and `{storage_key}` on a repairs issue — so a German value that
    spells one differently prints the braces on the screen, and one that drops
    it loses the only concrete detail the sentence carried. Nothing else
    catches it: hassfest validates the shape of the file, not the insides of
    its strings.
    """

    english = _flatten(json.loads((INTEGRATION / "strings.json").read_text(encoding="utf-8")))
    placeholder = re.compile(r"\{(\w+)\}")
    for path in sorted((INTEGRATION / "translations").glob("*.json")):
        for key, value in _flatten(json.loads(path.read_text(encoding="utf-8"))).items():
            assert set(placeholder.findall(value)) == set(placeholder.findall(english[key])), (
                f"{path.name}: {key} does not carry the same placeholders as strings.json"
            )


def test_translation_flow_sections_match_strings() -> None:
    """`translations/en.json` must repeat every section `strings.json` declares.

    Home Assistant renders the config flow, the options flow and the service
    catalog from the translation file; `strings.json` is only the source
    hassfest validates. An edit that lands in one file but not the other ships a
    screen with the stale text and nothing fails.
    """

    strings = json.loads((INTEGRATION / "strings.json").read_text(encoding="utf-8"))
    en = json.loads((INTEGRATION / "translations" / "en.json").read_text(encoding="utf-8"))
    assert en == strings
