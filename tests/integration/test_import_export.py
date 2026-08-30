"""Integration: JSON import/export end-to-end through the real websocket_api.

Drives ``haventory/export`` and ``haventory/import/execute`` over a real Home
Assistant WebSocket connection (``hass_ws_client``). The round-trip test empties
the instance after exporting, then imports the document back and asserts the data
is reproduced — the real-HA counterpart to the offline round-trip unit test.
"""

from __future__ import annotations

from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
from homeassistant.core import HomeAssistant


async def test_export_then_import_into_emptied_instance(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """Export, empty the instance, import the document, and verify data returns."""

    await setup_entry()
    client = await hass_ws_client(hass)
    quantity = 3

    # Create a location and an item inside it.
    await client.send_json({"id": 1, "type": "haventory/location/create", "name": "Garage"})
    loc = await client.receive_json()
    assert loc["success"] is True, loc
    location_id = loc["result"]["id"]

    await client.send_json(
        {
            "id": 2,
            "type": "haventory/item/create",
            "name": "Hammer",
            "quantity": quantity,
            "location_id": location_id,
            "tags": ["tools"],
        }
    )
    created = await client.receive_json()
    assert created["success"] is True, created
    item_id = created["result"]["id"]

    # Export the full dataset.
    await client.send_json({"id": 3, "type": "haventory/export"})
    exported = await client.receive_json()
    assert exported["success"] is True, exported
    document = exported["result"]
    assert len(document["items"]) == 1
    assert len(document["locations"]) == 1

    # Empty the instance: delete the item, then its (now empty) location.
    await client.send_json({"id": 4, "type": "haventory/item/delete", "item_id": item_id})
    assert (await client.receive_json())["success"] is True
    await client.send_json(
        {"id": 5, "type": "haventory/location/delete", "location_id": location_id}
    )
    assert (await client.receive_json())["success"] is True

    await client.send_json({"id": 6, "type": "haventory/stats"})
    stats = await client.receive_json()
    assert stats["result"]["items_total"] == 0
    assert stats["result"]["locations_total"] == 0

    # Import the document back into the now-empty instance.
    await client.send_json(
        {"id": 7, "type": "haventory/import/execute", "document": document, "policy": "merge"}
    )
    applied = await client.receive_json()
    assert applied["success"] is True, applied
    assert applied["result"]["applied"] is True
    assert applied["result"]["totals"]["items_total"] == 1

    # The item is reproduced with its original id and fields.
    await client.send_json({"id": 8, "type": "haventory/item/get", "item_id": item_id})
    fetched = await client.receive_json()
    assert fetched["success"] is True, fetched
    assert fetched["result"]["name"] == "Hammer"
    assert fetched["result"]["quantity"] == quantity
    assert fetched["result"]["location_id"] == location_id
    assert fetched["result"]["location_path"]["display_path"] == "Garage"


async def test_import_preview_reports_errors_without_mutating(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """A structurally invalid document is reported, not applied."""

    await setup_entry()
    client = await hass_ws_client(hass)

    bad_document = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [{"id": "not-a-uuid", "name": ""}],
        "locations": [],
    }

    await client.send_json({"id": 1, "type": "haventory/import/preview", "document": bad_document})
    preview = await client.receive_json()
    assert preview["success"] is True, preview
    assert preview["result"]["valid"] is False
    assert preview["result"]["errors"]

    # Executing the same invalid document is a structured validation error.
    await client.send_json({"id": 2, "type": "haventory/import/execute", "document": bad_document})
    executed = await client.receive_json()
    assert executed["success"] is False, executed
    assert executed["error"]["code"] == "validation_error"

    # Nothing was written.
    await client.send_json({"id": 3, "type": "haventory/stats"})
    stats = await client.receive_json()
    assert stats["result"]["items_total"] == 0


async def test_import_preview_name_collision_survives_the_wire(
    hass: HomeAssistant, hass_ws_client, setup_entry
) -> None:
    """The warning entry serializes through the real result envelope.

    ``ws_import_preview`` passes the report to ``websocket_api.result_message``
    unmodified, so only the real command layer proves the payload survives it.
    """

    await setup_entry()
    client = await hass_ws_client(hass)

    await client.send_json({"id": 1, "type": "haventory/item/create", "name": "Hammer"})
    created = await client.receive_json()
    stored_id = created["result"]["id"]

    document = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        # A hand-rebuilt "Hammer": the same name under an id this install has
        # never seen, which import adds rather than merges.
        "items": [
            {
                "id": "44444444-4444-4444-8444-444444444444",
                "name": "Hammer",
                "quantity": 1,
                "tags": [],
                "custom_fields": {},
            }
        ],
        "locations": [],
    }

    await client.send_json({"id": 2, "type": "haventory/import/preview", "document": document})
    preview = await client.receive_json()

    assert preview["success"] is True, preview
    # A warning tells; it does not gate.
    assert preview["result"]["valid"] is True
    warnings = preview["result"]["warnings"]
    assert [w["code"] for w in warnings] == ["name_collision"]
    assert warnings[0]["existing_ids"] == [stored_id]
    assert warnings[0]["name"] == "Hammer"

    # And a document with nothing to flag reports the key as an empty list.
    await client.send_json(
        {
            "id": 3,
            "type": "haventory/import/preview",
            "document": {**document, "items": []},
        }
    )
    clean = await client.receive_json()
    assert clean["result"]["warnings"] == []
