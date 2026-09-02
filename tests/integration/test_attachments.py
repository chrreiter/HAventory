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

import hashlib
import io
import shutil
import threading
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote

import pytest
from aiohttp import FormData
from custom_components.haventory import media
from custom_components.haventory.const import (
    DOMAIN,
    MEDIA_NAME_TOKEN_PARAM,
    MEDIA_SUBDIR,
    THUMBNAIL_MAX_EDGE,
    THUMBNAIL_SUFFIX,
)
from custom_components.haventory.runtime import find_runtime
from custom_components.haventory.storage import CURRENT_SCHEMA_VERSION, STORAGE_KEY
from homeassistant.core import HomeAssistant
from PIL import Image, ImageDraw
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


@pytest.fixture
def upload_teardowns(monkeypatch) -> list[tuple[int, Path]]:
    """Record every temp-directory teardown as (thread id, directory).

    Core's `file_upload` ends its context manager with a synchronous
    `shutil.rmtree`, and which thread pays for that walk is the whole question.
    Home Assistant's own blocking-call detector cannot answer it here: it skips
    the `os.scandir`, `os.listdir` and `open` protections whenever `unittest` is
    imported, which is every pytest run. A live instance is where that log line
    appears, so this records the thread directly instead.
    """

    calls: list[tuple[int, Path]] = []
    real_rmtree = shutil.rmtree

    def _record(path, *args, **kwargs):
        calls.append((threading.get_ident(), Path(path)))
        return real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(shutil, "rmtree", _record)
    return calls


# The picture `_photograph` builds, and how far the tile's aspect ratio may sit
# from it once both edges have been rounded to whole pixels.
PHOTO_SIZE = (1200, 800)
ASPECT_TOLERANCE = 0.01

# What one pixel of a transparent picture's tile has to look like. WebP stores
# alpha losslessly, so an opaque pixel comes back exactly opaque; the colour
# under it goes through a lossy pass and is only asked to still be red rather
# than the black a flattened tile would show.
OPAQUE_ALPHA = 255
RED_FLOOR = 200
OTHER_CHANNEL_CEILING = 80


def _photograph(size: tuple[int, int] = PHOTO_SIZE) -> bytes:
    """A PNG a decoder will actually open, the shape a phone camera produces.

    Built rather than embedded: the tile is checked for its dimensions and its
    size against the original, and a few-byte fixture can carry neither. Pillow
    is here because Home Assistant brings it — the same reason this file is
    where the encoder is exercised at all.
    """

    # Incompressible content, from a fixed seed so the run is repeatable. A
    # pattern would make the PNG a few KB and "the tile is a fraction of the
    # picture" true because the fixture was tiny rather than because the tile
    # is small — and noise is the worst case for the encoder, so the ratio a
    # real photograph gets is better than the one asserted here.
    wanted = size[0] * size[1] * 3
    raw = bytearray()
    digest = b"haventory"
    while len(raw) < wanted:
        digest = hashlib.sha256(digest).digest()
        raw += digest
    buffer = io.BytesIO()
    Image.frombytes("RGB", size, bytes(raw[:wanted])).save(buffer, format="PNG")
    return buffer.getvalue()


def _transparent_logo(size: tuple[int, int] = (600, 600)) -> bytes:
    """A PNG with a transparent background and one opaque shape in the middle.

    What a picture saved off a manufacturer's page looks like, as opposed to
    one taken with a camera — which is why the photograph above cannot show
    whether the encode keeps an alpha channel.
    """

    picture = Image.new("RGBA", size, (0, 0, 0, 0))
    inset = (size[0] // 4, size[1] // 4)
    ImageDraw.Draw(picture).ellipse(
        (inset[0], inset[1], size[0] - inset[0], size[1] - inset[1]),
        fill=(255, 0, 0, 255),
    )
    buffer = io.BytesIO()
    picture.save(buffer, format="PNG")
    return buffer.getvalue()


async def _create_item(ws_client, name: str = "Drill") -> dict:
    await ws_client.send_json({"id": 1, "type": "haventory/item/create", "name": name})
    result = await ws_client.receive_json()
    assert result["success"] is True, result
    return result["result"]


async def _attach(
    ws,
    client,
    item: dict,
    *,
    file: tuple[bytes, str] = (PNG_BYTES, "drill.png"),
    kind: str = "picture",
) -> dict:
    """Upload one file and hang it on `item`, returning the attachment."""

    content, filename = file
    file_id = await _upload(client, content=content, filename=filename)
    await ws.send_json(
        {
            "id": 90,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
            "filename": filename,
            "kind": kind,
        }
    )
    added = await ws.receive_json()
    assert added["success"] is True, added
    return added["result"]["attachments"][-1]


async def test_a_real_png_round_trips_through_upload_and_the_view(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """Upload, attach, then GET the same bytes back with an image content type."""

    await setup_entry()
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


async def test_size_thumb_serves_a_real_webp_tile_and_writes_it_once(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """The whole `?size=thumb` path against the real encoder.

    Only real here: Pillow is not a dependency of this integration and is not in
    the offline environment, but Home Assistant brings it, so this is where the
    bytes a row actually downloads can be looked at. The offline suite covers
    the logic around it — the once-only encode, the refusals, the sweep.
    """

    photo = _photograph()
    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    attachment = await _attach(ws, client, item, file=(photo, "shelf.png"))

    url = f"/api/haventory/media/{item['id']}/{attachment['id']}"
    served = await client.get(f"{url}?size=thumb")
    assert served.status == HTTPStatus.OK
    tile = await served.read()

    # A tile, not the picture: WebP whatever the original was, capped on its
    # longest edge, and a fraction of the bytes the full picture costs.
    assert served.headers["Content-Type"] == "image/webp"
    assert tile[:4] == b"RIFF" and tile[8:12] == b"WEBP"
    assert len(tile) < len(photo) / 4
    with Image.open(io.BytesIO(tile)) as decoded:
        assert decoded.format == "WEBP"
        assert max(decoded.size) == THUMBNAIL_MAX_EDGE
        # 1200x800 down to 256 on its longest edge, keeping the shape it had:
        # a tile that squared off a photograph would crop what the row shows.
        # Scaled to whole pixels, so the ratio lands within one of them.
        wide, high = decoded.size
        assert abs(wide / high - PHOTO_SIZE[0] / PHOTO_SIZE[1]) < ASPECT_TOLERANCE

    root = Path(hass.config.path(MEDIA_SUBDIR))
    on_disk = media.thumbnail_path(root, item["id"], attachment["id"])
    assert on_disk.is_file()
    assert on_disk.read_bytes() == tile
    # Written beside the original, which is still there and still itself.
    assert on_disk.parent.name == item["id"]
    original = await client.get(url)
    assert await original.read() == photo
    assert original.headers["Content-Type"].startswith("image/png")

    # Served from the file the first request wrote, not encoded again.
    mtime = on_disk.stat().st_mtime_ns
    again = await client.get(f"{url}?size=thumb")
    assert await again.read() == tile
    assert on_disk.stat().st_mtime_ns == mtime

    # Nothing is left behind mid-encode: the staging name never survives.
    assert not list(on_disk.parent.glob("*.part"))


async def test_a_transparent_picture_keeps_its_alpha_through_the_view(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """A logo or a screenshot saved as a transparent PNG keeps its background.

    Flattening it would leave the shape on the encoder's black, so the row and
    the opened item would show two different pictures — and against the light
    theme the row reads as a black square.
    """

    logo = _transparent_logo()
    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    attachment = await _attach(ws, client, item, file=(logo, "logo.png"))

    url = f"/api/haventory/media/{item['id']}/{attachment['id']}"
    served = await client.get(f"{url}?size=thumb")
    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"] == "image/webp"

    with Image.open(io.BytesIO(await served.read())) as tile:
        assert tile.mode == "RGBA"
        assert max(tile.size) == THUMBNAIL_MAX_EDGE
        # What was fully transparent still is.
        assert tile.getpixel((0, 0))[3] == 0
        centre = tile.getpixel((tile.width // 2, tile.height // 2))
        assert centre[3] == OPAQUE_ALPHA
        assert centre[0] > RED_FLOOR
        assert max(centre[1], centre[2]) < OTHER_CHANNEL_CEILING

    # The original is untouched, which is the picture the opened item shows.
    original = await client.get(url)
    assert await original.read() == logo


async def test_a_picture_the_decoder_refuses_serves_the_original(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """Fail open, with a file that really does defeat the decoder.

    `PNG_BYTES` carries a genuine PNG signature — which is all the upload
    allow-list reads — and Pillow cannot identify it, which is what a truncated
    or corrupt upload looks like. The row shows the picture the browser can
    still render, and the page is slower rather than broken.
    """

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    attachment = await _attach(ws, client, item)

    served = await client.get(f"/api/haventory/media/{item['id']}/{attachment['id']}?size=thumb")

    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"] == "image/png"
    assert await served.read() == PNG_BYTES
    root = Path(hass.config.path(MEDIA_SUBDIR))
    assert not media.thumbnail_path(root, item["id"], attachment["id"]).exists()


async def test_an_unknown_size_is_refused_rather_than_generated(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """One accepted value: the parameter selects a derived form, it does not let
    a caller ask the server to render whatever size it likes."""

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    attachment = await _attach(ws, client, item)

    url = f"/api/haventory/media/{item['id']}/{attachment['id']}"
    for size in ("2048", "large", "THUMB", ""):
        refused = await client.get(f"{url}?size={size}")
        assert refused.status == HTTPStatus.BAD_REQUEST, size


async def test_a_manual_asked_for_as_a_thumbnail_serves_the_pdf(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """Fail open: there is no tile of a PDF, and the answer is the document."""

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    attachment = await _attach(ws, client, item, file=(PDF_BYTES, "manual.pdf"), kind="manual")

    served = await client.get(f"/api/haventory/media/{item['id']}/{attachment['id']}?size=thumb")

    assert served.status == HTTPStatus.OK
    assert served.headers["Content-Type"] == "application/pdf"
    assert await served.read() == PDF_BYTES


async def test_the_upload_handle_is_consumed_off_the_event_loop(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    hass_ws_client,
    upload_teardowns: list[tuple[int, Path]],
    setup_entry,
) -> None:
    """Every byte of the temp directory's teardown is paid by a worker thread.

    On the loop it stalls every other connection for as long as the walk takes,
    and the stall grows with the file — worst on the phone burst-uploading
    photos, which is the case the feature exists for.
    """

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    file_id = await _upload(client)

    loop_thread = threading.get_ident()
    await ws.send_json(
        {
            "id": 2,
            "type": "haventory/item/attachment/add",
            "item_id": item["id"],
            "file_id": file_id,
        }
    )
    added = await ws.receive_json()

    assert added["success"] is True, added
    assert len(upload_teardowns) == 1
    torn_down_on, temp_dir = upload_teardowns[0]
    assert torn_down_on != loop_thread
    assert not temp_dir.exists()


async def test_a_consumed_handle_cannot_be_used_again(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """The upload is destroyed with the command, so the second call is a 404.

    The same envelope an expired handle gets: `file_upload` no longer knows the
    id, and the message tells the card to upload the bytes again rather than
    retry a handle that can never come back.
    """

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    file_id = await _upload(client)

    add = {
        "type": "haventory/item/attachment/add",
        "item_id": item["id"],
        "file_id": file_id,
    }
    await ws.send_json({"id": 2, **add})
    assert (await ws.receive_json())["success"] is True

    await ws.send_json({"id": 3, **add})
    refused = await ws.receive_json()

    assert refused["success"] is False
    assert refused["error"]["code"] == "not_found"
    assert refused["error"]["message"] == "uploaded file not found; upload it again"


async def test_the_media_view_refuses_an_unauthenticated_request(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    hass_client_no_auth: ClientSessionGenerator,
    hass_ws_client,
    setup_entry,
) -> None:
    """An inventory photo is as private as the inventory it belongs to."""

    await setup_entry()
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
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """The handler resolves files from stored metadata, never from the URL."""

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    missing = await client.get(
        f"/api/haventory/media/{item['id']}/11111111-1111-4111-8111-111111111111"
    )

    assert missing.status == HTTPStatus.NOT_FOUND


async def test_a_non_image_is_refused_and_leaves_nothing_behind(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    hass_ws_client,
    upload_teardowns: list[tuple[int, Path]],
    setup_entry,
) -> None:
    """SVG carries script and the view serves it from the Home Assistant origin."""

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)

    file_id = await _upload(
        client, b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', "drawing.svg"
    )
    loop_thread = threading.get_ident()
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
    assert find_runtime(hass).repository.get_item(item["id"]).attachments == []
    # Refused bytes are torn down on the same terms as accepted ones: off the
    # loop, and gone by the time the caller is told no.
    assert len(upload_teardowns) == 1
    torn_down_on, temp_dir = upload_teardowns[0]
    assert torn_down_on != loop_thread
    assert not temp_dir.exists()


async def test_deleting_the_item_deletes_its_files(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    await setup_entry()
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
    # The file was the last one in it, so the item's directory goes too.
    assert not path.parent.exists()
    assert media.media_root(hass).is_dir()


async def test_a_bulk_delete_deletes_the_item_files(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """The card's bulk bar and the organize dialog delete through `items/bulk`."""

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    attachment = await _attach(ws, client, item)
    path = media.attachment_path(
        media.media_root(hass), item["id"], attachment["id"], attachment["mime"]
    )
    assert path.is_file()

    await ws.send_json(
        {
            "id": 91,
            "type": "haventory/items/bulk",
            "operations": [
                {"op_id": "d", "kind": "item_delete", "payload": {"item_id": item["id"]}}
            ],
        }
    )
    deleted = await ws.receive_json()
    assert deleted["success"] is True, deleted
    assert deleted["result"]["results"]["d"]["success"] is True, deleted

    assert not path.exists()


async def test_the_item_delete_service_deletes_the_item_files(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """Only this mode dispatches a service: the offline stub has no registry."""

    await setup_entry()
    client = await hass_client()
    ws = await hass_ws_client(hass)
    item = await _create_item(ws)
    attachment = await _attach(ws, client, item)
    path = media.attachment_path(
        media.media_root(hass), item["id"], attachment["id"], attachment["mime"]
    )
    assert path.is_file()

    await hass.services.async_call(DOMAIN, "item_delete", {"item_id": item["id"]}, blocking=True)
    await hass.async_block_till_done()

    assert not path.exists()


async def test_setup_sweeps_a_file_no_metadata_references(
    hass: HomeAssistant, hass_storage: dict, setup_entry
) -> None:
    """A save that never landed, on a store that still holds the inventory."""

    item_id = "5c4b3a29-1d0e-4f8a-9b7c-6d5e4f3a2b1c"
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {
            "schema_version": CURRENT_SCHEMA_VERSION,
            "items": {item_id: {"id": item_id, "name": "Drill", "attachments": []}},
            "locations": {},
        },
    }
    root = Path(hass.config.path(MEDIA_SUBDIR))
    orphan = root / "some-item" / "some-attachment.png"
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(PNG_BYTES)

    await setup_entry()

    assert not orphan.exists()


async def test_setup_keeps_every_file_when_the_store_holds_no_items(
    hass: HomeAssistant, hass_storage: dict, setup_entry, caplog: pytest.LogCaptureFixture
) -> None:
    """A store that was lost, or restored without the inventory, references nothing.

    Every explicit delete removes its own files, so a repository holding no items
    has nothing a sweep could be protecting and the files are the only copy left.
    """

    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {"schema_version": CURRENT_SCHEMA_VERSION, "items": {}, "locations": {}},
    }
    root = Path(hass.config.path(MEDIA_SUBDIR))
    stranded = root / "some-item" / "some-attachment.png"
    stranded.parent.mkdir(parents=True, exist_ok=True)
    stranded.write_bytes(PNG_BYTES)

    await setup_entry()

    assert stranded.read_bytes() == PNG_BYTES
    kept = [r for r in caplog.records if "op=attachment_sweep" in r.getMessage()]
    assert [r.levelname for r in kept] == ["WARNING"]
    assert "files=1" in kept[0].getMessage()


async def test_setup_sweeps_a_tile_an_earlier_encoder_generation_wrote(
    hass: HomeAssistant, hass_storage: dict, setup_entry
) -> None:
    """An install upgraded across a change to the encode.

    A tile is written once and served from there, so nothing about the new
    encoder would reach a picture that already has one. The name carries the
    generation instead: the tile the old encoder wrote is named by no metadata
    and the sweep at setup takes it, leaving the picture it came from.
    """

    item_id = "5c4b3a29-1d0e-4f8a-9b7c-6d5e4f3a2b1c"
    attachment_id = "11111111-1111-4111-8111-111111111111"
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {
            "schema_version": CURRENT_SCHEMA_VERSION,
            "items": {
                item_id: {
                    "id": item_id,
                    "name": "Drill",
                    "attachments": [
                        {
                            "id": attachment_id,
                            "kind": "picture",
                            "filename": "drill.png",
                            "mime": "image/png",
                            "size": len(PNG_BYTES),
                            "uploaded_at": "2026-08-01T09:00:00Z",
                            "title": "",
                            "order": 0,
                        }
                    ],
                }
            },
            "locations": {},
        },
    }
    root = Path(hass.config.path(MEDIA_SUBDIR))
    original = media.attachment_path(root, item_id, attachment_id, "image/png")
    original.parent.mkdir(parents=True, exist_ok=True)
    original.write_bytes(PNG_BYTES)
    # Generation 1's name, which is what an install running 0.7.0 has on disk.
    stale = original.with_name(f"{attachment_id}.thumb.webp")
    stale.write_bytes(b"RIFF\x24\x00\x00\x00WEBP\x00\x00\x00\x00")

    await setup_entry()

    assert not stale.exists()
    assert original.read_bytes() == PNG_BYTES
    current = media.thumbnail_path(root, item_id, attachment_id)
    assert current.name.endswith(THUMBNAIL_SUFFIX)
    # Nothing pre-writes a tile: the next `?size=thumb` encodes it.
    assert not current.exists()


async def test_a_pdf_round_trips_as_a_manual_and_can_be_retitled(
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """The document half of the same path: kind, sniffed type, and the title.

    The retitle is asserted here rather than offline because only a real core
    writes the change back through ``Store`` and hands the card the item it
    then renders from — and because the served name follows the title, which is
    a response header no offline test has a transport for.
    """

    await setup_entry()
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
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """A retitle rewrites the served name for a URL that did not change.

    The card versions its URL by that name, so its responses can be held for as
    long as the bytes live. A URL without the token has no way to say which name
    it was fetched under, and a browser that stored one would keep saving the
    file under a title the user has already replaced — for the half hour a
    signature lives, which is not a window anyone waits out.
    """

    await setup_entry()
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
    hass: HomeAssistant, hass_client: ClientSessionGenerator, hass_ws_client, setup_entry
) -> None:
    """The allow-list is per kind, so the picture strip cannot fill with PDFs."""

    await setup_entry()
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
    assert find_runtime(hass).repository.get_item(item["id"]).attachments == []
