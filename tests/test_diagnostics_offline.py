"""Offline tests for the config-entry diagnostics payload.

The point of the module is what it does *not* carry: a diagnostics JSON is
pasted into public bug reports, and an inventory is full of names, notes and
custom fields nobody meant to publish. One test here walks the whole serialized
payload looking for seeded content, which is what stops a future contributor
from adding the dataset "just for debugging".
"""

from __future__ import annotations

import json

import pytest
from custom_components.haventory import diagnostics
from custom_components.haventory.const import CONF_CARD_TITLE, DOMAIN
from custom_components.haventory.models import ItemCreate
from custom_components.haventory.rate_limit import RateLimitConfig, RateLimiter
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY, DomainStore
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

STORED_TITLE = "Haus Hoffmann Vorratskammer"
STORED_ITEM = "Zdrojova kniha 1987"
STORED_LOCATION = "Kellerregal hinter der Heizung"
STORED_FIELD_VALUE = "Rechnung 44-2019"


def _loaded_hass() -> tuple[HomeAssistant, ConfigEntry]:
    """A domain bucket in the shape a set-up entry leaves it in."""

    hass = HomeAssistant()
    repo = Repository()
    where = repo.create_location(name=STORED_LOCATION)
    repo.create_item(
        ItemCreate(
            name=STORED_ITEM,
            location_id=str(where.id),
            custom_fields={"invoice": STORED_FIELD_VALUE},
        )
    )
    hass.data[DOMAIN] = {
        "store": DomainStore(hass, key=STORAGE_KEY, version=CURRENT_SCHEMA_VERSION),
        "repository": repo,
        "card_title": STORED_TITLE,
        "rate_limiter": RateLimiter(RateLimitConfig.from_options(None)),
    }
    entry = ConfigEntry(options={CONF_CARD_TITLE: STORED_TITLE})
    return hass, entry


@pytest.mark.asyncio
async def test_the_payload_answers_shape_questions() -> None:
    """Counts, both schema numbers, the generation, the health verdict, the bucket's keys."""

    hass, entry = _loaded_hass()

    payload = await diagnostics.async_get_config_entry_diagnostics(hass, entry)

    assert payload["storage"] == {
        "key": STORAGE_KEY,
        "supported_schema_version": CURRENT_SCHEMA_VERSION,
        "store_schema_version": CURRENT_SCHEMA_VERSION,
    }
    repository = payload["repository"]
    assert repository["loaded"] is True
    assert repository["counts"]["items_total"] == 1
    assert repository["counts"]["locations_total"] == 1
    assert repository["health_issues"] == []
    assert repository["generation"] == hass.data[DOMAIN]["repository"].generation
    assert payload["runtime"]["data_keys"] == [
        "card_title",
        "rate_limiter",
        "repository",
        "store",
    ]
    assert payload["runtime"]["rate_limit"] == {
        "enabled": False,
        "dropped_commands": 0,
        "dropped_events": 0,
    }


@pytest.mark.asyncio
async def test_no_stored_content_reaches_the_payload() -> None:
    """Not an item name, not a location name, not a custom-field value, at any depth.

    Asserted over the serialized document rather than key by key: the risk is a
    block added later, and only a whole-payload search sees one.
    """

    hass, entry = _loaded_hass()

    payload = await diagnostics.async_get_config_entry_diagnostics(hass, entry)

    document = json.dumps(payload, default=str)
    for stored in (STORED_ITEM, STORED_LOCATION, STORED_FIELD_VALUE, STORED_TITLE):
        assert stored not in document, stored


@pytest.mark.asyncio
async def test_the_card_title_is_redacted_rather_than_dropped() -> None:
    """The option has to still be visible as set; only its text is withheld."""

    hass, entry = _loaded_hass()

    payload = await diagnostics.async_get_config_entry_diagnostics(hass, entry)

    assert CONF_CARD_TITLE in payload["options"]
    assert payload["options"][CONF_CARD_TITLE] != STORED_TITLE


@pytest.mark.asyncio
async def test_an_unloaded_entry_still_produces_a_payload() -> None:
    """Home Assistant offers the download on an entry whose setup failed.

    That is exactly when it is worth having, so the repository block reports
    that there is nothing loaded instead of the whole call raising.
    """

    hass = HomeAssistant()
    hass.data[DOMAIN] = {}
    entry = ConfigEntry()

    payload = await diagnostics.async_get_config_entry_diagnostics(hass, entry)

    assert payload["repository"] == {
        "loaded": False,
        "counts": None,
        "generation": None,
        "health_issues": None,
    }
    assert payload["storage"]["store_schema_version"] is None
    assert payload["storage"]["key"] == STORAGE_KEY
    assert payload["runtime"]["data_keys"] == []
    assert payload["runtime"]["rate_limit"] is None
    assert payload["options"] == {}


@pytest.mark.asyncio
async def test_a_missing_card_bundle_is_reported_as_missing(monkeypatch, tmp_path) -> None:
    """A missing bundle is the first answer to "the card will not render"."""

    hass, entry = _loaded_hass()
    monkeypatch.setattr(diagnostics, "_CARD_BUNDLE_PATH", tmp_path / "haventory-card.js")

    payload = await diagnostics.async_get_config_entry_diagnostics(hass, entry)

    assert payload["frontend_bundle"] == {
        "filename": "haventory-card.js",
        "exists": False,
        "size_bytes": None,
    }


@pytest.mark.asyncio
async def test_a_deployed_card_bundle_reports_its_size(monkeypatch, tmp_path) -> None:
    """A zero-byte or truncated bundle looks the same as a missing one to a browser."""

    hass, entry = _loaded_hass()
    bundle = tmp_path / "haventory-card.js"
    bundle.write_text("console.log('hi')\n", encoding="utf-8")
    monkeypatch.setattr(diagnostics, "_CARD_BUNDLE_PATH", bundle)

    payload = await diagnostics.async_get_config_entry_diagnostics(hass, entry)

    assert payload["frontend_bundle"]["exists"] is True
    assert payload["frontend_bundle"]["size_bytes"] == bundle.stat().st_size
