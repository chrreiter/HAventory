"""Offline tests for attachment media: sniffing, caps, paths and the sweep.

The offline Home Assistant stub has no HTTP layer, so the authenticated view
itself is only observable in the phacc integration mode
(``tests/integration/test_attachments.py``). Everything here is the part that
decides *what* the view would be allowed to serve and *where* it would find it.

Scenarios:
- a non-image file is refused for the picture kind
- a file whose bytes are not what it claims is refused
- SVG is refused outright — it carries script and is served from the HA origin
- a file over the byte cap is refused, and an empty one too
- the 11th picture on an item is refused
- an id no metadata claims resolves to nothing
- the sweep deletes an unreferenced file and keeps a referenced one
- the sweep refuses a path resolving outside the media root
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from custom_components.haventory import media
from custom_components.haventory.const import (
    MAX_ATTACHMENT_BYTES,
    MAX_PICTURES_PER_ITEM,
)
from custom_components.haventory.exceptions import ValidationError
from custom_components.haventory.models import (
    AttachmentMeta,
    iso_utc_now,
    new_uuid4,
)
from custom_components.haventory.repository import Repository
from homeassistant.core import HomeAssistant

# Smallest byte strings that identify each accepted format, plus the ones that
# must not be accepted. Only the leading bytes matter to the sniffer.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 12
GIF_BYTES = b"GIF89a" + b"\x00" * 10
WEBP_BYTES = b"RIFF\x24\x00\x00\x00WEBP" + b"\x00" * 4
PDF_BYTES = b"%PDF-1.7\n" + b"\x00" * 8
SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'


def _meta(mime: str = "image/png", kind: str = "picture") -> AttachmentMeta:
    return AttachmentMeta(
        id=new_uuid4(),
        kind=kind,  # type: ignore[arg-type]
        filename="photo.png",
        mime=mime,
        size=len(PNG_BYTES),
        uploaded_at=iso_utc_now(),
    )


# -----------------------------
# Sniffing and the allow-list
# -----------------------------


@pytest.mark.parametrize(
    ("head", "expected"),
    [
        (PNG_BYTES, "image/png"),
        (JPEG_BYTES, "image/jpeg"),
        (GIF_BYTES, "image/gif"),
        (WEBP_BYTES, "image/webp"),
        (PDF_BYTES, "application/pdf"),
    ],
)
def test_sniff_identifies_each_accepted_format(head: bytes, expected: str) -> None:
    assert media.sniff_mime(head) == expected


@pytest.mark.parametrize("head", [SVG_BYTES, b"plain text", b"", b"RIFF\x00\x00\x00\x00WAVE"])
def test_sniff_has_no_answer_for_anything_else(head: bytes) -> None:
    """An unrecognised file has no type here at all, so the caller refuses it."""

    assert media.sniff_mime(head) is None


def test_picture_upload_refuses_a_non_image() -> None:
    with pytest.raises(ValidationError, match="not one of the accepted types"):
        media.validate_upload(kind="picture", head=PDF_BYTES, size=len(PDF_BYTES))


def test_picture_upload_refuses_bytes_that_are_not_what_they_claim() -> None:
    """The declared content type comes from the browser, so it is never consulted.

    A file POSTed as `image/png` whose bytes are anything else is refused on the
    bytes alone.
    """

    with pytest.raises(ValidationError, match="not one of the accepted types"):
        media.validate_upload(kind="picture", head=b"not a png at all", size=32)


def test_svg_is_refused_outright() -> None:
    """SVG carries script and the media view serves from the HA origin."""

    with pytest.raises(ValidationError, match="not one of the accepted types"):
        media.validate_upload(kind="picture", head=SVG_BYTES, size=len(SVG_BYTES))


def test_a_file_over_the_byte_cap_is_refused() -> None:
    with pytest.raises(ValidationError, match="over the"):
        media.validate_upload(kind="picture", head=PNG_BYTES, size=MAX_ATTACHMENT_BYTES + 1)


def test_an_empty_file_is_refused() -> None:
    with pytest.raises(ValidationError, match="empty"):
        media.validate_upload(kind="picture", head=b"", size=0)


def test_an_unknown_kind_is_refused() -> None:
    with pytest.raises(ValidationError, match="kind must be one of"):
        media.validate_upload(kind="video", head=PNG_BYTES, size=len(PNG_BYTES))


def test_a_manual_accepts_pdf_and_refuses_an_image() -> None:
    assert media.validate_upload(kind="manual", head=PDF_BYTES, size=32) == "application/pdf"
    with pytest.raises(ValidationError, match="not one of the accepted types"):
        media.validate_upload(kind="manual", head=PNG_BYTES, size=32)


# -----------------------------
# Per-item caps
# -----------------------------


def test_the_eleventh_picture_on_an_item_is_refused() -> None:
    """Enforced by the repository regardless of what the card checked first."""

    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    for _ in range(MAX_PICTURES_PER_ITEM):
        repo.add_attachment(item.id, _meta(), max_per_kind=MAX_PICTURES_PER_ITEM)

    with pytest.raises(ValidationError, match="already has 10 attachment"):
        repo.add_attachment(item.id, _meta(), max_per_kind=MAX_PICTURES_PER_ITEM)

    assert len(repo.get_item(item.id).attachments) == MAX_PICTURES_PER_ITEM


def test_the_cap_is_per_kind() -> None:
    """A full picture list does not stop a manual from being attached."""

    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    for _ in range(MAX_PICTURES_PER_ITEM):
        repo.add_attachment(item.id, _meta(), max_per_kind=MAX_PICTURES_PER_ITEM)

    manual = _meta(mime="application/pdf", kind="manual")
    updated = repo.add_attachment(item.id, manual, max_per_kind=media.max_per_item("manual"))

    assert [a.kind for a in updated.attachments].count("manual") == 1


# -----------------------------
# Path resolution
# -----------------------------


def test_an_id_no_metadata_claims_resolves_to_nothing() -> None:
    """The view looks a file up through metadata, never from the request path."""

    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    meta = _meta()
    repo.add_attachment(item.id, meta)

    found = repo.find_attachment(str(item.id), str(meta.id))
    assert found is not None and found.id == meta.id
    assert repo.find_attachment(str(item.id), str(new_uuid4())) is None
    assert repo.find_attachment(str(new_uuid4()), str(meta.id)) is None


def test_a_path_escaping_the_media_root_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="outside the media root"):
        media.attachment_path(tmp_path / "media", "..", "escape", "image/png")


def test_the_stored_extension_comes_from_the_sniffed_type(tmp_path: Path) -> None:
    """Nothing the client sent is used to build a filename."""

    path = media.attachment_path(tmp_path, "item", "att", "image/jpeg")

    assert path.name == "att.jpg"
    assert path.parent.name == "item"


# -----------------------------
# The orphan sweep
# -----------------------------


@pytest.mark.asyncio
async def test_the_sweep_deletes_an_unreferenced_file_and_keeps_a_referenced_one() -> None:
    hass = HomeAssistant()
    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    meta = _meta()
    repo.add_attachment(item.id, meta)

    root = media.media_root(hass)
    kept = media.attachment_path(root, str(item.id), str(meta.id), meta.mime)
    kept.parent.mkdir(parents=True, exist_ok=True)
    kept.write_bytes(PNG_BYTES)
    orphan = root / str(item.id) / "00000000-0000-4000-8000-000000000000.png"
    orphan.write_bytes(PNG_BYTES)

    removed = await media.async_sweep_orphans(hass, repo.iter_attachments())

    assert removed == (str(orphan.resolve()),)
    assert kept.is_file()
    assert not orphan.exists()


@pytest.mark.asyncio
async def test_the_sweep_refuses_a_path_resolving_outside_the_media_root(
    tmp_path: Path,
) -> None:
    """`rglob` follows a symlinked directory, so containment is re-checked per file."""

    hass = HomeAssistant()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    precious = outside / "not-ours.png"
    precious.write_bytes(PNG_BYTES)

    root = media.media_root(hass)
    root.mkdir(parents=True, exist_ok=True)
    os.symlink(outside, root / "linked")

    removed = await media.async_sweep_orphans(hass, [])

    assert removed == ()
    assert precious.is_file()


@pytest.mark.asyncio
async def test_the_sweep_is_a_no_op_when_nothing_was_ever_stored() -> None:
    """A fresh install has no media directory at all; that is not an error."""

    hass = HomeAssistant()

    assert await media.async_sweep_orphans(hass, []) == ()


@pytest.mark.asyncio
async def test_deleting_an_attachment_removes_its_file() -> None:
    hass = HomeAssistant()
    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    meta = _meta()
    repo.add_attachment(item.id, meta)

    path = media.attachment_path(media.media_root(hass), str(item.id), str(meta.id), meta.mime)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG_BYTES)

    await media.async_delete_attachments(hass, [(str(item.id), meta)])

    assert not path.exists()


@pytest.mark.asyncio
async def test_deleting_a_file_that_is_already_gone_is_not_an_error() -> None:
    """A restored backup can hold metadata whose files did not come with it."""

    hass = HomeAssistant()
    meta = _meta()

    await media.async_delete_attachments(hass, [(str(new_uuid4()), meta)])
