"""JSON import and export over a real WebSocket connection.

Covers a backup restored into an emptied instance, the commands' refusals, the missing-file
caveat of a metadata-only export, and what an import does to attachment files.
"""

from __future__ import annotations

import shutil
from typing import Any

import pytest
from custom_components.haventory import media
from custom_components.haventory.models import validate_attachment_meta
from custom_components.haventory.repository import Repository
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION
from homeassistant.core import HomeAssistant

PICTURE = {
    "id": "3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f",
    "kind": "picture",
    "filename": "photo.png",
    "mime": "image/png",
    "size": 8,
    "uploaded_at": "2026-08-05T10:00:00Z",
}


def _store_with_a_picture() -> tuple[Repository, str]:
    """A store whose one item names a picture; no file is written."""

    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    repo.add_attachment(item.id, validate_attachment_meta(PICTURE))
    return repo, str(item.id)


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


@pytest.mark.parametrize(
    ("command", "payload", "fragment"),
    [
        ("haventory/export", {"filter": "not-an-object"}, ""),
        ("haventory/export", {"filter": {"search": "hammer"}}, "search"),
        ("haventory/import/preview", {"policy": "bogus"}, ""),
        ("haventory/import/execute", {"policy": "bogus"}, ""),
    ],
)
async def test_a_bad_filter_or_policy_is_refused_and_nothing_is_written(
    setup_entry, ws_connect, command: str, payload: dict[str, Any], fragment: str
) -> None:
    await setup_entry()
    ws = await ws_connect()
    document = {
        "haventory_export_version": 1,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "items": [{"id": "44444444-4444-4444-8444-444444444444", "name": "Screwdriver"}],
        "locations": [],
    }
    if command.startswith("haventory/import"):
        payload = {**payload, "document": document}

    res = await ws.send(command, **payload)

    assert res["success"] is False, res
    assert res["error"]["code"] == "validation_error"
    assert fragment in res["error"]["message"]
    assert (await ws.send("haventory/stats"))["result"]["items_total"] == 0


async def test_import_preview_reports_references_with_no_file_on_this_install(
    setup_entry, ws_connect
) -> None:
    """A JSON export carries metadata and not bytes, so this is a caveat, not an error."""

    repo, _ = _store_with_a_picture()
    await setup_entry(stored=repo)
    ws = await ws_connect()
    document = (await ws.send("haventory/export"))["result"]

    res = await ws.send("haventory/import/preview", document=document, policy="merge")

    assert res["success"] is True, res
    assert res["result"]["attachments"] == {"referenced": 1, "missing": 1}


@pytest.mark.parametrize(
    ("policy", "file_kept", "attachment_ids"),
    [("replace", False, []), ("merge", True, [PICTURE["id"]])],
)
async def test_import_and_an_attachment_file_the_document_does_not_carry(  # noqa: PLR0913, PLR0917 - one fixture per step
    hass: HomeAssistant,
    setup_entry,
    ws_connect,
    policy: str,
    file_kept: bool,
    attachment_ids: list[str],
) -> None:
    """`replace` overwrites an item's attachment list, so the bytes of an entry it drops go too;
    `merge` unions the lists, so nothing is orphaned."""

    repo, item_id = _store_with_a_picture()
    await setup_entry(stored=repo)
    ws = await ws_connect()
    path = media.attachment_path(media.media_root(hass), item_id, PICTURE["id"], "image/png")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n")
    try:
        document = (await ws.send("haventory/export"))["result"]
        document["items"][0]["attachments"] = []
        document["items"][0]["name"] = "Drill (restored)"

        res = await ws.send("haventory/import/execute", document=document, policy=policy)

        assert res["success"] is True, res
        item = (await ws.send("haventory/item/get", item_id=item_id))["result"]
        assert item["name"] == "Drill (restored)"
        assert [a["id"] for a in item["attachments"]] == attachment_ids
        assert path.exists() is file_kept
    finally:
        shutil.rmtree(media.media_root(hass), ignore_errors=True)
