"""Offline tests for attachment media: sniffing, caps, paths and the sweep.

The offline Home Assistant stub has no HTTP layer, so the authenticated view
itself is only observable in the phacc integration mode
(``tests/integration/test_attachments.py``). Everything here is the part that
decides *what* the view would be allowed to serve and *where* it would find it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

import pytest
from custom_components.haventory import media
from custom_components.haventory.const import (
    MAX_ATTACHMENT_BYTES,
    MAX_PICTURES_PER_ITEM,
    MEDIA_NAME_TOKEN_PARAM,
    THUMBNAIL_GENERATION,
    THUMBNAIL_MAX_EDGE,
    THUMBNAIL_SUFFIX,
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


def _disposition(*, filename: str = "photo.png", title: str = "") -> str:
    meta = _meta()
    meta.filename = filename
    meta.title = title
    return media._content_disposition(meta)


def test_the_disposition_is_inline_and_names_the_uploaded_file() -> None:
    """Saving is named; opening stays opening — `attachment` would download."""

    value = _disposition(filename="bosch_smsec.pdf")

    assert value.startswith("inline;")
    assert 'filename="bosch_smsec.pdf"' in value
    assert "filename*=UTF-8''bosch_smsec.pdf" in value


def test_a_title_wins_over_the_filename_and_blank_space_does_not() -> None:
    assert 'filename="Dishwasher manual"' in _disposition(
        filename="scan_0142.pdf", title="Dishwasher manual"
    )
    assert 'filename="scan_0142.pdf"' in _disposition(filename="scan_0142.pdf", title="   ")


def test_a_non_ascii_title_survives_in_the_rfc_5987_form() -> None:
    """The percent-encoded half is the one a current browser reads."""

    value = _disposition(title="Bedienungsanleitung Kühlschrank")

    assert "filename*=UTF-8''Bedienungsanleitung%20K%C3%BChlschrank" in value
    # The quoted fallback is ASCII-only, so the umlaut is dropped there.
    assert 'filename="Bedienungsanleitung Khlschrank"' in value


def test_a_title_of_only_non_ascii_characters_falls_back_to_the_attachment_id() -> None:
    meta = _meta()
    meta.title = "説明書"

    value = media._content_disposition(meta)

    assert f'filename="{meta.id}"' in value
    assert "filename*=UTF-8''%E8%AA%AC%E6%98%8E%E6%9B%B8" in value


@pytest.mark.parametrize(
    "title",
    [
        'evil"; filename="owned.exe',
        "line\r\nX-Injected: yes",
        "back\\slash",
    ],
)
def test_the_header_value_cannot_be_broken_out_of(title: str) -> None:
    """A stored title is user text and this value is a response header."""

    value = _disposition(title=title)
    _, quoted = value.split('filename="', 1)
    quoted_name, rest = quoted.split('"', 1)

    assert "\r" not in value
    assert "\n" not in value
    assert '"' not in quoted_name
    assert "\\" not in quoted_name
    # Nothing after the quoted name opens a parameter, or a header, of its own.
    assert '"' not in rest


def test_an_untitled_upload_with_no_filename_is_named_by_its_id() -> None:
    """`item/attachment/add` stores the attachment id when the client sent no name."""

    meta = _meta()
    meta.filename = str(meta.id)

    assert f'filename="{meta.id}"' in media._content_disposition(meta)


def test_an_overlong_name_is_truncated_rather_than_sent_whole() -> None:
    value = _disposition(title="x" * 500)

    assert f'filename="{"x" * media.DISPOSITION_NAME_MAX_CHARS}"' in value


class _Request:
    """Just the query mapping ``_cache_control`` reads off a real request."""

    def __init__(self, **query: str) -> None:
        self.query = query


def test_a_url_versioned_by_name_may_be_held_indefinitely() -> None:
    """The bytes never change, and this URL says which name they were fetched under."""

    value = media._cache_control(_Request(**{MEDIA_NAME_TOKEN_PARAM: "1x2y3z"}))

    assert "immutable" in value
    assert "max-age=31536000" in value


def test_a_url_not_versioned_by_name_is_not_stored_at_all() -> None:
    """A retitle rewrites `Content-Disposition` for a URL that did not change.

    Reusing such a response is what makes a retitled file save under its old
    name, and a signed URL outlives the retitle by half an hour — so the answer
    cannot be kept at all rather than merely revalidated.
    """

    value = media._cache_control(_Request())

    assert value == "private, no-store"
    assert "immutable" not in value


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
async def test_the_unswept_report_counts_the_files_it_left_alone(caplog) -> None:
    """What setup writes instead of sweeping an inventory that holds no items."""

    hass = HomeAssistant()
    item_dir = media.media_root(hass) / "11111111-1111-4111-8111-111111111111"
    item_dir.mkdir(parents=True)
    stored = [item_dir / "one.png", item_dir / "two.pdf"]
    for path, content in zip(stored, (PNG_BYTES, PDF_BYTES), strict=True):
        path.write_bytes(content)
    caplog.set_level(logging.DEBUG)

    assert await media.async_report_unswept(hass) == len(stored)

    warnings = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert f"files={len(stored)}" in warnings[0].getMessage()
    assert "op=attachment_sweep" in warnings[0].getMessage()


@pytest.mark.asyncio
async def test_the_unswept_report_says_nothing_when_there_are_no_files(caplog) -> None:
    """A new household attaches nothing on its first boot and hears nothing about it."""

    hass = HomeAssistant()
    caplog.set_level(logging.DEBUG)

    assert await media.async_report_unswept(hass) == 0

    # And the same once the directory exists but holds nothing, which is what an
    # install left after every attachment was deleted looks like.
    media.media_root(hass).mkdir(parents=True)

    assert await media.async_report_unswept(hass) == 0
    assert caplog.records == []


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


# -----------------------------
# Row thumbnails
#
# The encoder itself needs Pillow, which is not a dependency of this
# integration and is not in the offline environment. These stub it out to check
# everything around it: that it is asked once, that every refusal serves the
# original, and that the two places which delete files know about the new one.
# The encode's own output is looked at further down, where Pillow is present,
# and in `tests/integration/test_attachments.py`, which runs the whole view
# against it in an environment Home Assistant brought Pillow to.
# -----------------------------


def _stub_encoder(calls: list[tuple[Path, Path]], *, succeed: bool = True):
    """Stand in for the Pillow encode, recording what it was asked to make."""

    def encode(source: Path, target: Path) -> bool:
        calls.append((source, target))
        if not succeed:
            return False
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(WEBP_BYTES)
        return True

    return encode


async def _stored_picture(hass: HomeAssistant) -> tuple[Repository, object, AttachmentMeta]:
    repo = Repository()
    item = repo.create_item({"name": "Drill"})
    meta = _meta()
    repo.add_attachment(item.id, meta)
    original = media.attachment_path(media.media_root(hass), str(item.id), str(meta.id), meta.mime)
    original.parent.mkdir(parents=True, exist_ok=True)
    original.write_bytes(PNG_BYTES)
    return repo, item, meta


@pytest.mark.asyncio
async def test_a_thumbnail_is_encoded_once_and_reused(monkeypatch) -> None:
    """The second row asking for the same picture reads what the first wrote."""

    hass = HomeAssistant()
    _, item, meta = await _stored_picture(hass)
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder(calls))

    root = media.media_root(hass)
    first = await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta)
    second = await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta)

    assert first is not None and first.is_file()
    assert second == first
    assert len(calls) == 1
    assert first.name.endswith(THUMBNAIL_SUFFIX)


@pytest.mark.asyncio
async def test_two_requests_at_once_encode_once(monkeypatch) -> None:
    """Two tabs opening the same page must not both decode the same file."""

    hass = HomeAssistant()
    _, item, meta = await _stored_picture(hass)
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder(calls))

    root = media.media_root(hass)
    results = await asyncio.gather(
        *(media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta) for _ in range(4))
    )

    assert len({str(path) for path in results}) == 1
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_an_encode_that_cannot_be_done_is_not_retried(monkeypatch) -> None:
    """No Pillow, an animated GIF, a corrupt file: the answer is the original,
    and asking again must not decode the same bytes a second time."""

    hass = HomeAssistant()
    _, item, meta = await _stored_picture(hass)
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder(calls, succeed=False))

    root = media.media_root(hass)
    assert await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta) is None
    assert await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta) is None
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_a_manual_has_no_thumbnail_and_is_not_decoded(monkeypatch) -> None:
    hass = HomeAssistant()
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder(calls))
    meta = _meta(mime="application/pdf", kind="manual")

    result = await media.async_thumbnail(
        hass, root=media.media_root(hass), item_id=str(new_uuid4()), meta=meta
    )

    assert result is None
    assert calls == []


@pytest.mark.asyncio
async def test_a_picture_whose_file_is_missing_gets_no_thumbnail(monkeypatch) -> None:
    """Metadata outlives its bytes; the view 404s on its own right after."""

    hass = HomeAssistant()
    calls: list[tuple[Path, Path]] = []
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder(calls))

    result = await media.async_thumbnail(
        hass, root=media.media_root(hass), item_id=str(new_uuid4()), meta=_meta()
    )

    assert result is None
    assert calls == []


def test_a_thumbnail_path_escaping_the_media_root_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        media.thumbnail_path(tmp_path / "root", "..", "..")


@pytest.mark.asyncio
async def test_the_sweep_keeps_a_live_thumbnail_and_removes_an_orphaned_one(
    monkeypatch,
) -> None:
    """The sweep deletes every file it is not handed, so a thumbnail left out
    of `referenced_paths` is deleted and re-encoded on every page."""

    hass = HomeAssistant()
    repo, item, meta = await _stored_picture(hass)
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder([]))
    root = media.media_root(hass)
    kept = await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta)
    assert kept is not None

    orphan = media.thumbnail_path(root, str(item.id), "00000000-0000-4000-8000-000000000000")
    orphan.write_bytes(WEBP_BYTES)

    removed = await media.async_sweep_orphans(hass, repo.iter_attachments())

    assert removed == (str(orphan.resolve()),)
    assert kept.is_file()
    assert not orphan.exists()


# What the first generation of the encoder named its tiles — the one that
# flattened a transparent picture onto black. Written out rather than derived,
# because the point of these two tests is that the name changed.
FIRST_GENERATION_SUFFIX = ".thumb.webp"


def test_a_tile_is_named_for_the_encoder_generation_that_wrote_it() -> None:
    """A tile is written once and read from then on, so a change to the encode
    only reaches an existing install if the file it wrote stops being named."""

    root = media.media_root(HomeAssistant())
    item_id = str(new_uuid4())
    attachment_id = str(new_uuid4())

    path = media.thumbnail_path(root, item_id, attachment_id)

    assert THUMBNAIL_GENERATION > 1
    assert THUMBNAIL_SUFFIX == f".thumb{THUMBNAIL_GENERATION}.webp"
    assert path.name == f"{attachment_id}{THUMBNAIL_SUFFIX}"
    assert not path.name.endswith(FIRST_GENERATION_SUFFIX)


@pytest.mark.asyncio
async def test_the_sweep_removes_a_tile_an_earlier_generation_wrote(monkeypatch) -> None:
    """The upgrade path: an install carrying tiles from the previous encoder
    loses them on the next setup, keeping the picture they came from."""

    hass = HomeAssistant()
    repo, item, meta = await _stored_picture(hass)
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder([]))
    root = media.media_root(hass)
    current = await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta)
    assert current is not None
    original = media.attachment_path(root, str(item.id), str(meta.id), meta.mime)
    stale = current.with_name(f"{meta.id}{FIRST_GENERATION_SUFFIX}")
    stale.write_bytes(WEBP_BYTES)

    removed = await media.async_sweep_orphans(hass, repo.iter_attachments())

    assert removed == (str(stale.resolve()),)
    assert not stale.exists()
    assert current.is_file()
    assert original.is_file()


@pytest.mark.asyncio
async def test_deleting_an_attachment_takes_its_thumbnail_with_it(monkeypatch) -> None:
    hass = HomeAssistant()
    _, item, meta = await _stored_picture(hass)
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder([]))
    root = media.media_root(hass)
    thumb = await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta)
    assert thumb is not None and thumb.is_file()

    await media.async_delete_attachments(hass, [(str(item.id), meta)])

    assert not thumb.exists()
    assert not media.attachment_path(root, str(item.id), str(meta.id), meta.mime).exists()


@pytest.mark.asyncio
async def test_deleting_the_last_attachment_takes_the_item_directory(monkeypatch) -> None:
    """A picture is two files, and the directory goes when the second one does."""

    hass = HomeAssistant()
    _, item, meta = await _stored_picture(hass)
    monkeypatch.setattr(media, "_encode_thumbnail_blocking", _stub_encoder([]))
    root = media.media_root(hass)
    thumb = await media.async_thumbnail(hass, root=root, item_id=str(item.id), meta=meta)
    assert thumb is not None and thumb.is_file()
    directory = thumb.parent

    await media.async_delete_attachments(hass, [(str(item.id), meta)])

    assert not directory.exists()
    assert root.is_dir()


@pytest.mark.asyncio
async def test_a_directory_that_still_holds_an_attachment_is_kept() -> None:
    """Removing one of two attachments empties nothing."""

    hass = HomeAssistant()
    item_id = str(new_uuid4())
    root = media.media_root(hass)
    going, staying = _meta(), _meta()
    going_path = media.attachment_path(root, item_id, str(going.id), going.mime)
    staying_path = media.attachment_path(root, item_id, str(staying.id), staying.mime)
    going_path.parent.mkdir(parents=True, exist_ok=True)
    going_path.write_bytes(PNG_BYTES)
    staying_path.write_bytes(PNG_BYTES)

    await media.async_delete_attachments(hass, [(item_id, going)])

    assert not going_path.exists()
    assert staying_path.is_file()
    assert staying_path.parent.is_dir()


@pytest.mark.asyncio
async def test_a_directory_holding_a_file_of_the_operators_own_is_kept() -> None:
    """`rmdir` is the whole check: a directory that still holds something
    refuses to go, so nothing has to recognise the file first."""

    hass = HomeAssistant()
    item_id = str(new_uuid4())
    meta = _meta()
    root = media.media_root(hass)
    path = media.attachment_path(root, item_id, str(meta.id), meta.mime)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG_BYTES)
    theirs = path.parent / "where-the-receipt-is.txt"
    theirs.write_text("filing cabinet, second drawer", encoding="utf-8")

    await media.async_delete_attachments(hass, [(item_id, meta)])

    assert not path.exists()
    assert theirs.is_file()
    assert path.parent.is_dir()


@pytest.mark.asyncio
async def test_the_sweep_takes_a_directory_it_emptied_of_an_old_generation_tile() -> None:
    """A tile the current encoder cannot name outlives the delete that emptied
    the directory around it, so the next setup takes the pair."""

    hass = HomeAssistant()
    root = media.media_root(hass)
    directory = root / str(new_uuid4())
    directory.mkdir(parents=True)
    stale = directory / f"{new_uuid4()}{FIRST_GENERATION_SUFFIX}"
    stale.write_bytes(WEBP_BYTES)

    removed = await media.async_sweep_orphans(hass, [])

    assert removed == (str(stale.resolve()),)
    assert not directory.exists()
    assert root.is_dir()


@pytest.mark.asyncio
async def test_the_sweep_leaves_the_media_root_itself_where_it_is() -> None:
    """The root is where the next upload is written, and an orphan sitting
    directly in it is not an item's directory."""

    hass = HomeAssistant()
    root = media.media_root(hass)
    root.mkdir(parents=True, exist_ok=True)
    orphan = root / "loose.png"
    orphan.write_bytes(PNG_BYTES)

    removed = await media.async_sweep_orphans(hass, [])

    assert removed == (str(orphan.resolve()),)
    assert root.is_dir()


def test_referenced_paths_names_both_files_for_a_picture_and_one_for_a_manual() -> None:
    root = media.media_root(HomeAssistant())
    item_id = str(new_uuid4())
    picture = _meta()
    manual = _meta(mime="application/pdf", kind="manual")

    named = media.referenced_paths(root, [(item_id, picture), (item_id, manual)])

    # A picture names two files and a manual one: there is no tile of a PDF, and
    # naming one would keep a path the sweep can never be asked to remove.
    assert named == frozenset(
        {
            str(media.attachment_path(root, item_id, str(picture.id), picture.mime)),
            str(media.thumbnail_path(root, item_id, str(picture.id))),
            str(media.attachment_path(root, item_id, str(manual.id), manual.mime)),
        }
    )


# -----------------------------
# The encode itself
#
# These need a decoder, so they run only where something else brought Pillow:
# `uv sync --group probes` locally, Home Assistant in the phacc mode. What they
# pin is the one thing a stub encoder cannot — which channels of the source
# survive into the tile a row downloads.
#
# Alpha is stored losslessly by the WebP encoder, so an opaque pixel comes back
# exactly opaque; the colour under it goes through a lossy pass and is only
# asked to still be red rather than the black a flattened tile would show.
# -----------------------------

OPAQUE_ALPHA = 255
RED_FLOOR = 200
OTHER_CHANNEL_CEILING = 80


def test_a_transparent_png_keeps_its_alpha_in_the_tile(tmp_path: Path) -> None:
    """A logo or a screenshot saved with a transparent background is the common
    case. Flattening it puts the shape on black, so the row and the opened item
    would show two different pictures."""

    image_module = pytest.importorskip("PIL.Image")
    draw_module = pytest.importorskip("PIL.ImageDraw")
    source = tmp_path / "logo.png"
    picture = image_module.new("RGBA", (300, 300), (0, 0, 0, 0))
    draw_module.Draw(picture).ellipse((100, 100, 199, 199), fill=(255, 0, 0, 255))
    picture.save(source, format="PNG")
    target = tmp_path / f"logo{media.THUMBNAIL_SUFFIX}"

    assert media._encode_thumbnail_blocking(source, target) is True

    with image_module.open(target) as tile:
        assert tile.format == "WEBP"
        assert tile.mode == "RGBA"
        assert max(tile.size) == THUMBNAIL_MAX_EDGE
        # A source pixel nothing was drawn on comes out fully transparent
        # rather than nearly so.
        assert tile.getpixel((0, 0))[3] == 0
        centre = tile.getpixel((tile.width // 2, tile.height // 2))
        assert centre[3] == OPAQUE_ALPHA
        assert centre[0] > RED_FLOOR
        assert max(centre[1], centre[2]) < OTHER_CHANNEL_CEILING


def test_a_palette_png_with_a_transparent_index_keeps_it(tmp_path: Path) -> None:
    """Here transparency is a palette index and not a band, so the mode alone
    does not say whether the picture has one."""

    image_module = pytest.importorskip("PIL.Image")
    source = tmp_path / "sprite.png"
    picture = image_module.new("P", (300, 300), 1)
    picture.paste(0, (100, 100, 200, 200))
    picture.putpalette([255, 0, 0] + [0, 0, 255] * 255)
    picture.save(source, format="PNG", transparency=1)
    target = tmp_path / f"sprite{media.THUMBNAIL_SUFFIX}"

    assert media._encode_thumbnail_blocking(source, target) is True

    with image_module.open(target) as tile:
        assert tile.mode == "RGBA"
        assert tile.getpixel((0, 0))[3] == 0
        assert tile.getpixel((tile.width // 2, tile.height // 2))[3] == OPAQUE_ALPHA


def test_a_photograph_without_an_alpha_channel_gets_none(tmp_path: Path) -> None:
    """Nothing to keep, nothing to pay for: a camera photo's tile stays three
    channels."""

    image_module = pytest.importorskip("PIL.Image")
    source = tmp_path / "shelf.jpg"
    image_module.new("RGB", (300, 300), (12, 120, 200)).save(source, format="JPEG")
    target = tmp_path / f"shelf{media.THUMBNAIL_SUFFIX}"

    assert media._encode_thumbnail_blocking(source, target) is True

    with image_module.open(target) as tile:
        assert tile.mode == "RGB"
        assert tile.size == (THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)


def test_an_exif_rotated_photograph_still_comes_out_upright(tmp_path: Path) -> None:
    """Deciding the mode must not cost the rotation: the orientation tag is
    applied first, and `thumbnail` drops the tag."""

    image_module = pytest.importorskip("PIL.Image")
    source = tmp_path / "portrait.jpg"
    picture = image_module.new("RGB", (400, 200), (12, 120, 200))
    exif = picture.getexif()
    # 274 is Orientation; 6 is the quarter turn a browser applies on its own.
    exif[274] = 6
    picture.save(source, format="JPEG", exif=exif)
    target = tmp_path / f"portrait{media.THUMBNAIL_SUFFIX}"

    assert media._encode_thumbnail_blocking(source, target) is True

    with image_module.open(target) as tile:
        # Landscape on disk, portrait once the tag is honoured.
        assert tile.size == (THUMBNAIL_MAX_EDGE // 2, THUMBNAIL_MAX_EDGE)
