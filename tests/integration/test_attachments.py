"""Integration: attachment upload and serving, against a real Home Assistant core.

The offline `HomeAssistant` stub has no HTTP layer and no `file_upload`
component, so nothing there can observe an upload crossing core's
`/api/file_upload`, an authenticated GET on the media view, or the refusal an
unauthenticated one gets. This file is the only place any of that is asserted.

The validation itself — the sniffed allow-list, the caps, the path containment
and the orphan sweep — is covered offline in `tests/test_media_offline.py`; what
is here is the transport and the view around it.
"""

from __future__ import annotations

from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote

from aiohttp import FormData
from custom_components.haventory import media
from custom_components.haventory.const import DOMAIN, MEDIA_NAME_TOKEN_PARAM, MEDIA_SUBDIR
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

# A real, if minimal, PNG: an 8x8 greyscale image. The backend sniffs the
# leading bytes, so the signature has to be genuine.
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000080000000808000000"
    "00e6a2a4b0000000114944415408d76360604000000400010001a5f3"
    "0f9e0000000049454e44ae426082"
)

# A minimal but genuine PDF: the backend sniffs the leading %PDF- marker, so a
# file that merely claimed the type would be refused.
PDF_BYTES = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, title="HAventory")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def _upload(client, content: bytes = PNG_BYTES, filename: str = "drill.png") -> str:
    """POST bytes to core's file_upload and return the handle it hands back.

    A real `FormData`, not a plain dict: `file_upload` reads the request with
    `request.multipart()`, which needs a `multipart/form-data` body and a part
    that carries both the field name `file` and a filename.

    The part declares `application/octet-stream` on purpose. Every accepted type
    the backend records is one it sniffed out of the bytes, so a test that
    declared `image/png` here could not tell the two apart.
    """

    form = FormData()
    form.add_field("file", content, filename=filename, content_type="application/octet-stream")
    response = await client.post("/api/file_upload", data=form)
    assert response.status == HTTPStatus.OK, await response.text()
    return (await response.json())["file_id"]


def _rfc5987_filename(disposition: str) -> str:
    """Decode the ``filename*=UTF-8''…`` half of a Content-Disposition value.

    The half a current browser reads, and the only one that can carry a name
    outside US-ASCII.
    """

    marker = "filename*=UTF-8''"
    assert marker in disposition, disposition
    return unquote(disposition.split(marker, 1)[1])


async def _create_item(ws_client, name: str = "Drill") -> dict:
    await ws_client.send_json({"id": 1, "type": "haventory/item/create", "name": name})
    result = await ws_client.receive_json()
    assert result["success"] is True, result
    return result["result"]


async def test_a_real_png_round_trips_through_upload_and_the_view(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client
) -> None:
    """Upload, attach, then GET the same bytes back with an image content type."""

    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    file_id = await _upload(client)
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
            "filename": "drill.png",
        }
    )
    added = await ws.receive_json()
    assert added["success"] is True, added
    attachment = added["result"]["attachments"][0]
    # The stored type is the sniffed one, not what the multipart part declared.
    assert attachment["mime"] == "image/png"
    assert attachment["size"] == len(PNG_BYTES)
    # Attaching a file is an item edit, unlike the derived location path.
    assert added["result"]["version"] == item["version"] + 1

    url = f"/api/haventory/media/{item['id']}/{attachment['id']}"
    served = await client.get(url)
    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"].startswith("image/png")
    # The bytes are user-supplied, so the browser must not decide otherwise.
    assert served.headers["X-Content-Type-Options"] == "nosniff"
    # Without a disposition the browser saves the file under the last path
    # segment, which is the attachment id. `inline` keeps the click opening it.
    disposition = served.headers["Content-Disposition"]
    assert disposition.startswith("inline;")
    assert 'filename="drill.png"' in disposition
    assert await served.read() == PNG_BYTES


async def test_the_media_view_refuses_an_unauthenticated_request(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    hass_client_no_auth: ClientSessionGenerator,
    hass_ws_client,
) -> None:
    """An inventory photo is as private as the inventory it belongs to."""

    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    file_id = await _upload(client)
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
        }
    )
    added = await ws.receive_json()
    attachment = added["result"]["attachments"][0]

    anonymous = await hass_client_no_auth()
    refused = await anonymous.get(f"/api/haventory/media/{item['id']}/{attachment['id']}")

    assert refused.status == HTTPStatus.UNAUTHORIZED


async def test_an_id_no_metadata_claims_is_a_404(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client
) -> None:
    """The handler resolves files from stored metadata, never from the URL."""

    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    missing = await client.get(
        f"/api/haventory/media/{item['id']}/11111111-1111-4111-8111-111111111111"
    )

    assert missing.status == HTTPStatus.NOT_FOUND


async def test_a_non_image_is_refused_and_leaves_nothing_behind(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client
) -> None:
    """SVG carries script and the view serves it from the Home Assistant origin."""

    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    file_id = await _upload(
        client, b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', "drawing.svg"
    )
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
        }
    )
    refused = await ws.receive_json()

    assert refused["success"] is False
    assert refused["error"]["code"] == "validation_error"
    assert hass.data[DOMAIN]["repository"].get_item(item["id"]).attachments == []


async def test_deleting_the_item_deletes_its_files(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client
) -> None:
    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    file_id = await _upload(client)
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
        }
    )
    added = await ws.receive_json()
    attachment = added["result"]["attachments"][0]
    path = media.attachment_path(
        media.media_root(hass), item["id"], attachment["id"], attachment["mime"]
    )
    assert path.is_file()

    await ws.send_json({"id": 3, "type": "haventory/item/delete", "item_id": item["id"]})
    deleted = await ws.receive_json()
    assert deleted["success"] is True, deleted

    assert not path.exists()


async def test_setup_sweeps_a_file_no_metadata_references(
    hass: HomeAssistant, hass_storage: dict
) -> None:
    """A store restored without its media, or a save that never landed."""

    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}},
    }
    root = Path(hass.config.path(MEDIA_SUBDIR))
    orphan = root / "some-item" / "some-attachment.png"
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(PNG_BYTES)

    await _setup(hass)

    assert not orphan.exists()


async def test_a_v5_store_boots_to_v6_with_both_backfills(
    hass: HomeAssistant, hass_storage: dict, hass_ws_client
) -> None:
    """One step for the milestone: statuses seeded, attachments backfilled.

    The write-back to the real ``Store`` is only observable here — and so is the
    fact that a custom status survives the loader, which coerces every unknown
    one to ``ok``.
    """

    item_id = "3f0c6d2a-1b4e-4a9c-9f3d-2a7b8c1d0e5f"
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {
            "schema_version": 5,
            "items": {item_id: {"id": item_id, "name": "Ladder", "status": "lent_out"}},
            "locations": {},
            "statuses": {"lent_out": {"slug": "lent_out", "label": "Lent out", "order": 9}},
        },
    }

    await _setup(hass)

    persisted = hass_storage[STORAGE_KEY]["data"]
    assert persisted["schema_version"] == CURRENT_SCHEMA_VERSION
    assert persisted["items"][item_id]["attachments"] == []
    assert set(persisted["statuses"]) == {"lent_out", "ok", "missing", "needs_repair"}
    # The definition loaded before the item loop, so the slug was not coerced.
    assert hass.data[DOMAIN]["repository"].get_item(item_id).status == "lent_out"

    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "haventory/config"})
    config = await ws.receive_json()
    assert {s["slug"] for s in config["result"]["statuses"]} == {
        "ok",
        "missing",
        "needs_repair",
        "lent_out",
    }


async def test_a_pdf_round_trips_as_a_manual_and_can_be_retitled(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client
) -> None:
    """The document half of the same path: kind, sniffed type, and the title.

    The retitle is asserted here rather than offline because only a real core
    writes the change back through ``Store`` and hands the card the item it
    then renders from — and because the served name follows the title, which is
    a response header no offline test has a transport for.
    """

    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws, "Dishwasher")

    file_id = await _upload(client, PDF_BYTES, "scan_0142.pdf")
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
            "kind": "manual",
            "filename": "scan_0142.pdf",
        }
    )
    added = await ws.receive_json()
    assert added["success"] is True, added
    attachment = added["result"]["attachments"][0]
    assert attachment["kind"] == "manual"
    assert attachment["mime"] == "application/pdf"
    # Untitled on arrival: the card falls back to the filename until asked.
    assert attachment["title"] == ""
    assert attachment["order"] == 0

    url = f"/api/haventory/media/{item['id']}/{attachment['id']}"
    untitled = await client.get(url)
    assert _rfc5987_filename(untitled.headers["Content-Disposition"]) == "scan_0142.pdf"

    await ws.send_json(
        {
            "id": 3,
            "type": "haventory/item/attachment/update",
            "item_id": item["id"],
            "attachment_id": attachment["id"],
            "title": "Dishwasher manual (EN)",
        }
    )
    retitled = await ws.receive_json()
    assert retitled["success"] is True, retitled
    assert retitled["result"]["attachments"][0]["title"] == "Dishwasher manual (EN)"
    # The filename is what the bytes arrived as and is never rewritten.
    assert retitled["result"]["attachments"][0]["filename"] == "scan_0142.pdf"

    served = await client.get(url)
    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"].startswith("application/pdf")
    disposition = served.headers["Content-Disposition"]
    assert disposition.startswith("inline;")
    assert _rfc5987_filename(disposition) == "Dishwasher manual (EN)"
    assert await served.read() == PDF_BYTES

    # A title outside US-ASCII is the case the quoted `filename` cannot carry.
    await ws.send_json(
        {
            "id": 4,
            "type": "haventory/item/attachment/update",
            "item_id": item["id"],
            "attachment_id": attachment["id"],
            "title": "Spülmaschine - Anleitung (DE)",
        }
    )
    assert (await ws.receive_json())["success"] is True

    non_ascii = await client.get(url)
    served = _rfc5987_filename(non_ascii.headers["Content-Disposition"])
    assert served == "Spülmaschine - Anleitung (DE)"


async def test_only_a_name_versioned_url_may_be_cached(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client
) -> None:
    """A retitle rewrites the served name for a URL that did not change.

    The card versions its URL by that name, so its responses can be held for as
    long as the bytes live. A URL without the token has no way to say which name
    it was fetched under, and a browser that stored one would keep saving the
    file under a title the user has already replaced — for the half hour a
    signature lives, which is not a window anyone waits out.
    """

    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    file_id = await _upload(client, PDF_BYTES, "scan_0142.pdf")
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
            "filename": "scan_0142.pdf",
            "kind": "manual",
        }
    )
    added = await ws.receive_json()
    assert added["success"] is True, added
    attachment = added["result"]["attachments"][0]

    url = f"/api/haventory/media/{item['id']}/{attachment['id']}"
    plain = await client.get(url)
    assert plain.status == HTTPStatus.OK
    assert plain.headers["Cache-Control"] == "private, no-store"

    versioned = await client.get(f"{url}?{MEDIA_NAME_TOKEN_PARAM}=abc123")
    assert versioned.status == HTTPStatus.OK
    assert "immutable" in versioned.headers["Cache-Control"]
    # The token is a cache key, never a lookup: the file it names is the one the
    # two path segments name, whatever the token says.
    assert await versioned.read() == PDF_BYTES


async def test_a_pdf_is_refused_as_a_picture(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client
) -> None:
    """The allow-list is per kind, so the picture strip cannot fill with PDFs."""

    await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    file_id = await _upload(client, PDF_BYTES, "manual.pdf")
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
            "kind": "picture",
        }
    )
    refused = await ws.receive_json()

    assert refused["success"] is False
    assert refused["error"]["code"] == "validation_error"
    assert hass.data[DOMAIN]["repository"].get_item(item["id"]).attachments == []
