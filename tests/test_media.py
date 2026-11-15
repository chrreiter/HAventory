"""What the media module accepts and where it puts a file, with no Home Assistant."""

from __future__ import annotations

from pathlib import Path

import pytest
from custom_components.haventory import media
from custom_components.haventory.const import MAX_ATTACHMENT_BYTES
from custom_components.haventory.exceptions import ValidationError

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 12
GIF = b"GIF89a" + b"\x00" * 10
WEBP = b"RIFF\x24\x00\x00\x00WEBP" + b"\x00" * 4
PDF = b"%PDF-1.7\n" + b"\x00" * 8
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'
NOT_ACCEPTED = "not one of the accepted types"


@pytest.mark.parametrize(
    ("kind", "head", "size", "result"),
    [
        ("picture", PNG, 32, "image/png"),
        ("picture", JPEG, 32, "image/jpeg"),
        ("picture", GIF, 32, "image/gif"),
        ("picture", WEBP, 32, "image/webp"),
        ("manual", PDF, 32, "application/pdf"),
        ("picture", PDF, 32, NOT_ACCEPTED),
        ("picture", b"not a png at all", 32, NOT_ACCEPTED),
        ("picture", SVG, len(SVG), NOT_ACCEPTED),
        ("picture", b"RIFF\x00\x00\x00\x00WAVE", 32, NOT_ACCEPTED),
        ("picture", b"plain text", 32, NOT_ACCEPTED),
        ("manual", PNG, 32, NOT_ACCEPTED),
        ("picture", PNG, MAX_ATTACHMENT_BYTES + 1, "over the"),
        ("picture", b"", 0, "empty"),
        ("video", PNG, 32, "kind must be one of"),
    ],
)
def test_an_upload_is_judged_by_its_leading_bytes_and_kind(
    kind: str, head: bytes, size: int, result: str
) -> None:
    """The declared content type is never consulted, so only the bytes decide."""

    if "/" in result:
        assert media.validate_upload(kind=kind, head=head, size=size) == result
    else:
        with pytest.raises(ValidationError, match=result):
            media.validate_upload(kind=kind, head=head, size=size)


def test_a_path_is_refused_when_it_resolves_outside_the_media_root(tmp_path: Path) -> None:
    root = tmp_path / "media"
    with pytest.raises(ValidationError, match="outside the media root"):
        media.attachment_path(root, "..", "escape", "image/png")
    with pytest.raises(ValidationError, match="outside the media root"):
        media.thumbnail_path(root, "..", "..")


def test_the_stored_extension_comes_from_the_sniffed_type(tmp_path: Path) -> None:
    path = media.attachment_path(tmp_path, "item", "att", "image/jpeg")

    assert path.name == "att.jpg"
    assert path.parent.name == "item"
