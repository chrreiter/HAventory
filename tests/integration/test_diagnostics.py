"""Integration: the diagnostics platform, downloaded the way a user downloads it.

This goes through the real HTTP endpoint the ⋮ menu links to, so it shows that
Home Assistant finds the diagnostics platform without a manifest entry and that
the payload survives Home Assistant's own JSON encoder.
"""

from __future__ import annotations

import json
import uuid

from custom_components.haventory import diagnostics
from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_TODO_ENTITY_ID,
    DOMAIN,
    INTEGRATION_VERSION,
)
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)

ITEM_ID = str(uuid.uuid4())
LOCATION_ID = str(uuid.uuid4())
CARD_TITLE = "Haus Hoffmann Vorratskammer"
ITEM_NAME = "Zdrojova kniha 1987"
LOCATION_NAME = "Kellerregal hinter der Heizung"
# A status a household typed itself, stored the way a real one is, and the list
# it mirrors low stock onto.
CUSTOM_STATUS = "lent_to_alice"
TODO_LIST = "todo.alices_einkaufsliste"
FIELD_VALUE = "Rechnung 44-2019"


def _store_data() -> dict:
    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": {
            ITEM_ID: {
                "id": ITEM_ID,
                "name": ITEM_NAME,
                "quantity": 1,
                "location_id": LOCATION_ID,
                "status": CUSTOM_STATUS,
                "custom_fields": {"invoice": FIELD_VALUE},
            }
        },
        "locations": {LOCATION_ID: {"id": LOCATION_ID, "name": LOCATION_NAME}},
        "statuses": [
            {"slug": "ok", "label": "OK", "order": 0},
            {"slug": CUSTOM_STATUS, "label": "Lent to Alice", "order": 1},
        ],
    }


async def test_the_download_reports_shape_and_never_content(
    hass: HomeAssistant, hass_storage: dict, hass_client
) -> None:
    """Counts, versions, health and bundle state — and not one stored name."""

    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": _store_data()}

    entry = MockConfigEntry(
        domain=DOMAIN,
        data={},
        options={CONF_CARD_TITLE: CARD_TITLE, CONF_TODO_ENTITY_ID: TODO_LIST},
        title="HAventory",
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    payload = await get_diagnostics_for_config_entry(hass, hass_client, entry)

    assert payload["integration"]["version"] == INTEGRATION_VERSION
    assert payload["storage"]["supported_schema_version"] == CURRENT_SCHEMA_VERSION
    assert payload["storage"]["store_schema_version"] == CURRENT_SCHEMA_VERSION
    assert payload["repository"]["loaded"] is True
    assert payload["repository"]["counts"]["items_total"] == 1
    assert payload["repository"]["health_issues"] == []
    assert "repository" in payload["runtime"]["data_keys"]
    bundle = diagnostics._CARD_BUNDLE_PATH
    if bundle.is_file():
        # A zero-byte or truncated bundle looks the same as a missing one to a browser.
        assert payload["frontend_bundle"] == {
            "filename": bundle.name,
            "exists": True,
            "size_bytes": bundle.stat().st_size,
        }

    # The household's own status vocabulary is reported as a spread, not by name.
    assert payload["repository"]["counts"]["status_counts"]["custom_1"] == 1

    # Redacted rather than dropped: whether each is set is a shape question.
    assert {CONF_CARD_TITLE, CONF_TODO_ENTITY_ID} <= set(payload["options"])

    document = json.dumps(payload)
    for secret in (ITEM_NAME, LOCATION_NAME, CARD_TITLE, CUSTOM_STATUS, TODO_LIST, FIELD_VALUE):
        assert secret not in document, secret


async def test_an_entry_whose_setup_failed_still_downloads(
    hass: HomeAssistant, hass_storage: dict, hass_client, monkeypatch, tmp_path
) -> None:
    """Home Assistant offers the download on a failed entry, which is when it is wanted most.

    A missing card bundle is the first answer to "the card will not render".
    """

    data = {**_store_data(), "schema_version": CURRENT_SCHEMA_VERSION + 1}
    hass_storage[STORAGE_KEY] = {"version": 1, "key": STORAGE_KEY, "data": data}
    monkeypatch.setattr(diagnostics, "_CARD_BUNDLE_PATH", tmp_path / "haventory-card.js")
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR

    payload = await get_diagnostics_for_config_entry(hass, hass_client, entry)

    assert payload["repository"] == {"loaded": False, "counts": None, "health_issues": None}
    assert payload["storage"] == {
        "key": STORAGE_KEY,
        "supported_schema_version": CURRENT_SCHEMA_VERSION,
        "store_schema_version": None,
    }
    assert payload["runtime"]["data_keys"] == []
    assert payload["frontend_bundle"] == {
        "filename": "haventory-card.js",
        "exists": False,
        "size_bytes": None,
    }
