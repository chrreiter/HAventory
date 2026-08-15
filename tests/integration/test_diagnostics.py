"""Integration: the diagnostics platform, downloaded the way a user downloads it.

The offline suite can call `async_get_config_entry_diagnostics` directly, which
proves the payload and nothing about whether Home Assistant ever finds it. This
goes through the real HTTP endpoint the ⋮ menu links to, so it also settles what
the offline checkout cannot: that a diagnostics platform needs no manifest entry
and that the payload survives Home Assistant's own JSON encoder.
"""

from __future__ import annotations

import json
import uuid

from custom_components.haventory.const import (
    CONF_CARD_TITLE,
    CONF_TODO_ENTITY_ID,
    DOMAIN,
    INTEGRATION_VERSION,
)
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
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
    assert "frontend_bundle" in payload

    # The household's own status vocabulary is reported as a spread, not by name.
    assert payload["repository"]["counts"]["status_counts"]["custom_1"] == 1

    document = json.dumps(payload)
    for secret in (ITEM_NAME, LOCATION_NAME, CARD_TITLE, CUSTOM_STATUS, TODO_LIST):
        assert secret not in document, secret
