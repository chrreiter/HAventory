"""Attachment files on disk, and the authenticated view that serves them.

Only metadata is persisted in the HA ``Store`` (see ``models.AttachmentMeta``);
the bytes live under ``<config>/haventory/attachments/<item_id>/<attachment_id><ext>``.
The store is one JSON document rewritten in full on every mutation, so base64
content would multiply every save and every ``haventory/export`` result.

Three rules hold everything here together:

* **What a file is, is decided by its bytes.** The content type the browser
  declares is attacker-controlled; the allow-list is checked against the sniffed
  leading bytes instead, per attachment kind.
* **A path is built from metadata, never from a request.** Both ids are matched
  against a stored entry first, and every path built here is re-checked for
  containment in the media root before anything reads or unlinks it.
* **Every filesystem call blocks**, so it runs through
  ``hass.async_add_executor_job``.

A picture also has a derived form: ``?size=thumb`` serves a 256px WebP written
beside the original the first time a row asks for one. Pillow is imported for
that and is not a dependency — every reason it cannot be used falls back to the
original, so an install without it renders the same pages and only pays the
bytes.
"""

from __future__ import annotations

import asyncio
import shutil
from collections.abc import Iterable, Mapping
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import quote

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import (
    ATTACHMENT_MANUAL_MIME_TYPES,
    ATTACHMENT_PICTURE_MIME_TYPES,
    DOMAIN,
    MAX_ATTACHMENT_BYTES,
    MAX_MANUALS_PER_ITEM,
    MAX_PICTURES_PER_ITEM,
    MEDIA_NAME_TOKEN_PARAM,
    MEDIA_SIZE_PARAM,
    MEDIA_SIZE_THUMB,
    MEDIA_SUBDIR,
    MEDIA_URL_TEMPLATE,
    THUMBNAIL_MAX_EDGE,
    THUMBNAIL_QUALITY,
    THUMBNAIL_SUFFIX,
)
from .exceptions import ValidationError
from .logs import context_logger
from .models import AttachmentKind, AttachmentMeta, load_attachments
from .runtime import find_runtime

LOGGER = context_logger(__name__)

# Accepted types and the per-item cap, by attachment kind.
MIME_TYPES_BY_KIND: dict[str, tuple[str, ...]] = {
    "picture": ATTACHMENT_PICTURE_MIME_TYPES,
    "manual": ATTACHMENT_MANUAL_MIME_TYPES,
}
MAX_PER_ITEM_BY_KIND: dict[str, int] = {
    "picture": MAX_PICTURES_PER_ITEM,
    "manual": MAX_MANUALS_PER_ITEM,
}

# File extension per accepted type. The stored name is derived from the type, so
# nothing the client sent is ever used to build a filename.
_EXTENSION_BY_MIME: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
}

# Enough bytes for every signature below: WebP's marker ends at byte 12.
SNIFF_BYTES = 16

# How much of a served name reaches the response header. A filename carries no
# length limit of its own, and a client is entitled to refuse an oversized
# header line rather than the file behind it.
DISPOSITION_NAME_MAX_CHARS = 200

# Where the thumbnail encode locks and refusals live on `hass.data`.
_THUMBNAIL_STATE_KEY = f"{DOMAIN}_thumbnails"


def sniff_mime(head: bytes) -> str | None:
    """Identify a file from its leading bytes, or ``None`` for anything else.

    Deliberately not :mod:`mimetypes` or the declared content type: both answer
    from a *name* the uploader chose. Only the formats the allow-lists name are
    recognised, so an unknown or text-shaped file (SVG, HTML) has no answer here
    at all and is refused by the caller.
    """

    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    # RIFF containers carry their format at byte 8; only the WEBP one is an image.
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    return None


def validate_upload(*, kind: str, head: bytes, size: int) -> str:
    """Check an upload against its kind's allow-list and the byte cap.

    Returns the sniffed content type, which is what gets stored — never the one
    the client declared. Raises :class:`ValidationError` otherwise.
    """

    allowed = MIME_TYPES_BY_KIND.get(kind)
    if allowed is None:
        raise ValidationError(f"kind must be one of: {', '.join(sorted(MIME_TYPES_BY_KIND))}")
    if size > MAX_ATTACHMENT_BYTES:
        raise ValidationError(
            f"file is {size} bytes, over the {MAX_ATTACHMENT_BYTES}-byte limit for an attachment"
        )
    if size <= 0:
        raise ValidationError("file is empty")
    mime = sniff_mime(head)
    if mime is None or mime not in allowed:
        raise ValidationError(
            f"file content is not one of the accepted types for '{kind}': {', '.join(allowed)}"
        )
    return mime


def max_per_item(kind: str) -> int:
    """How many attachments of ``kind`` one item may carry."""

    return MAX_PER_ITEM_BY_KIND.get(kind, MAX_PICTURES_PER_ITEM)


def media_root(hass: HomeAssistant) -> Path:
    """The directory every attachment file lives under, for this install."""

    return Path(hass.config.path(MEDIA_SUBDIR))


def attachment_path(root: Path, item_id: str, attachment_id: str, mime: str) -> Path:
    """Where one attachment's bytes live, refusing anything outside ``root``.

    Both ids come from stored metadata by the time they reach here, so only a
    bug gets past the containment check — but this path is handed to ``unlink``
    and to a file response, and the config tree around it is the user's.
    """

    extension = _EXTENSION_BY_MIME.get(mime, "")
    resolved_root = root.resolve()
    candidate = (root / item_id / f"{attachment_id}{extension}").resolve()
    if resolved_root not in candidate.parents:
        raise ValidationError("attachment path resolves outside the media root")
    return candidate


def thumbnail_path(root: Path, item_id: str, attachment_id: str) -> Path:
    """Where one picture's row tile lives, beside the original it comes from.

    The suffix carries the encoder generation, so a tile an earlier generation
    wrote is named by nothing and is swept at the next setup.
    """

    resolved_root = root.resolve()
    candidate = (root / item_id / f"{attachment_id}{THUMBNAIL_SUFFIX}").resolve()
    if resolved_root not in candidate.parents:
        raise ValidationError("thumbnail path resolves outside the media root")
    return candidate


def _encode_thumbnail_blocking(source: Path, target: Path) -> bool:
    """Write ``source`` down to a row tile at ``target``. Blocks — executor only.

    False, never an exception, for every reason this cannot be done (no Pillow,
    an animated GIF, a corrupt file, an unwritable directory): the caller then
    serves the original. Staged and moved into place, so a reader never finds a
    half-written tile.
    """

    try:
        # Here, not at module scope: Pillow is not a requirement in the manifest.
        from PIL import Image, ImageOps  # noqa: PLC0415
    except ImportError:
        return False

    try:
        with Image.open(source) as image:
            if getattr(image, "is_animated", False):
                return False
            # EXIF orientation is a tag, not a rotation of the pixels, and
            # `thumbnail` drops the tag — so a phone photo would come out on
            # its side against an original the browser turns upright.
            oriented = ImageOps.exif_transpose(image) or image
            # Keep alpha, or a transparent PNG comes out as a shape on black. A
            # palette image carries its transparency in `info` rather than as a
            # band, and the premultiplied modes spell the band lowercase.
            bands = set(oriented.getbands())
            has_alpha = not bands.isdisjoint({"A", "a"}) or "transparency" in oriented.info
            oriented = oriented.convert("RGBA" if has_alpha else "RGB")
            oriented.thumbnail((THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE))
            target.parent.mkdir(parents=True, exist_ok=True)
            staging = target.with_name(f"{target.name}.part")
            oriented.save(staging, format="WEBP", quality=THUMBNAIL_QUALITY)
            staging.replace(target)
    except Exception:
        LOGGER.debug(
            "Serving the original: this picture could not be thumbnailed",
            extra={"domain": DOMAIN, "op": "attachment_thumbnail", "path": str(source)},
            exc_info=True,
        )
        return False
    return True


def _thumbnail_state(hass: HomeAssistant) -> tuple[dict[str, asyncio.Lock], set[str]]:
    """Per-attachment encode locks, and the ones that cannot be encoded at all.

    Neither survives a restart, so an install that gains Pillow gets its
    thumbnails on the next boot. The refusal set stops a file that will never
    decode from being decoded again on every render.
    """

    state: dict[str, Any] = hass.data.setdefault(_THUMBNAIL_STATE_KEY, {})
    locks: dict[str, asyncio.Lock] = state.setdefault("locks", {})
    refused: set[str] = state.setdefault("refused", set())
    return locks, refused


async def async_thumbnail(
    hass: HomeAssistant, *, root: Path, item_id: str, meta: AttachmentMeta
) -> Path | None:
    """The row tile for one picture, encoded once; ``None`` means serve the original."""

    if meta.kind != "picture":
        return None
    target = thumbnail_path(root, item_id, str(meta.id))

    locks, refused = _thumbnail_state(hass)
    key = str(target)
    # The check sits inside the lock for the tab that waited on the encode.
    async with locks.setdefault(key, asyncio.Lock()):
        if key in refused:
            return None
        if await hass.async_add_executor_job(target.is_file):
            return target
        source = attachment_path(root, item_id, str(meta.id), meta.mime)
        return await _async_encode_once(hass, source=source, target=target, refused=refused)


async def _async_encode_once(
    hass: HomeAssistant, *, source: Path, target: Path, refused: set[str]
) -> Path | None:
    """Make one tile, under the caller's lock, and remember a refusal."""

    if not await hass.async_add_executor_job(source.is_file):
        # No original either: the view is about to 404 on its own, and
        # remembering this would outlive the missing file being restored.
        return None
    if await hass.async_add_executor_job(_encode_thumbnail_blocking, source, target):
        return target
    refused.add(str(target))
    return None


def _store_blocking(target: Path, source: Path) -> int:
    """Move an uploaded file into place. Blocks — run it in the executor."""

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))
    return target.stat().st_size


def _read_head_blocking(source: Path) -> tuple[bytes, int]:
    """Read the sniffing prefix and the size. Blocks — run it in the executor."""

    size = source.stat().st_size
    with source.open("rb") as handle:
        return handle.read(SNIFF_BYTES), size


def _prune_emptied_blocking(root: Path, directories: Iterable[Path]) -> None:
    """Remove each directory the caller has just emptied. Blocks — executor only.

    ``rmdir`` refuses a directory still holding anything, and any refusal leaves
    the directory in place. Only directories resolving under ``root`` qualify.
    """

    resolved_root = root.resolve()
    for directory in directories:
        resolved = directory.resolve()
        if resolved_root not in resolved.parents:
            continue
        try:
            resolved.rmdir()
        except OSError:
            continue


def _delete_blocking(root: Path, targets: Iterable[Path]) -> None:
    """Unlink each path that is present, then drop what that empties.

    Blocks — run it in the executor.
    """

    emptied: set[Path] = set()
    for target in targets:
        emptied.add(target.parent)
        try:
            target.unlink()
        except FileNotFoundError:
            continue
        except OSError:
            LOGGER.warning(
                "Could not remove an attachment file",
                extra={"domain": DOMAIN, "op": "attachment_delete", "path": str(target)},
                exc_info=True,
            )
    _prune_emptied_blocking(root, emptied)


def _sweep_blocking(root: Path, referenced: frozenset[str]) -> list[str]:
    """Delete every file under ``root`` no metadata claims. Blocks — executor only.

    Only files resolving inside ``root``: ``rglob`` follows a symlinked
    directory. A directory the sweep itself emptied goes too; one that was
    already empty is left alone.
    """

    if not root.is_dir():
        return []

    resolved_root = root.resolve()
    removed: list[str] = []
    emptied: set[Path] = set()
    for candidate in root.rglob("*"):
        if not candidate.is_file():
            continue
        resolved = candidate.resolve()
        if resolved_root not in resolved.parents:
            LOGGER.warning(
                "Refusing to sweep a media path resolving outside the media root",
                extra={"domain": DOMAIN, "op": "attachment_sweep", "path": str(candidate)},
            )
            continue
        if str(resolved) in referenced:
            continue
        try:
            resolved.unlink()
        except OSError:  # pragma: no cover - defensive
            LOGGER.warning(
                "Could not remove an orphaned attachment file",
                extra={"domain": DOMAIN, "op": "attachment_sweep", "path": str(resolved)},
                exc_info=True,
            )
            continue
        removed.append(str(resolved))
        emptied.add(resolved.parent)
    _prune_emptied_blocking(root, emptied)
    return removed


def _count_files_blocking(root: Path) -> int:
    """How many files sit under ``root``. Blocks — executor only."""

    if not root.is_dir():
        return 0
    return sum(1 for candidate in root.rglob("*") if candidate.is_file())


async def async_report_unswept(hass: HomeAssistant) -> int:
    """Warn about the attachment files a skipped sweep left in place, if any."""

    root = media_root(hass)
    count = await hass.async_add_executor_job(_count_files_blocking, root)
    if count:
        LOGGER.warning(
            "Kept every attachment file: the inventory holds no items, so nothing here "
            "can be told apart from a file whose metadata was lost",
            extra={"domain": DOMAIN, "op": "attachment_sweep", "files": count},
        )
    return count


def referenced_paths(root: Path, pairs: Iterable[tuple[str, AttachmentMeta]]) -> frozenset[str]:
    """Resolve every (item, attachment) pair to the files it names, thumbnails included.

    An entry whose path would escape the media root is dropped rather than
    raised on, so one bad row cannot stop the whole sweep.
    """

    paths: set[str] = set()
    for item_id, meta in pairs:
        try:
            paths.add(str(attachment_path(root, item_id, str(meta.id), meta.mime)))
            if meta.kind == "picture":
                paths.add(str(thumbnail_path(root, item_id, str(meta.id))))
        except ValidationError:  # pragma: no cover - ids come from validated metadata
            LOGGER.warning(
                "Ignoring attachment metadata whose path escapes the media root",
                extra={"domain": DOMAIN, "op": "attachment_sweep", "item_id": item_id},
            )
    return frozenset(paths)


async def async_consume_upload(
    hass: HomeAssistant,
    *,
    source: Path,
    kind: AttachmentKind,
    item_id: str,
    attachment_id: str,
) -> tuple[str, int]:
    """Validate an uploaded file and move it into place; returns the sniffed mime and size."""

    head, size = await hass.async_add_executor_job(_read_head_blocking, source)
    mime = validate_upload(kind=kind, head=head, size=size)
    target = attachment_path(media_root(hass), item_id, attachment_id, mime)
    stored_size = await hass.async_add_executor_job(_store_blocking, target, source)
    return mime, stored_size


async def async_delete_attachments(
    hass: HomeAssistant, pairs: Iterable[tuple[str, AttachmentMeta]]
) -> None:
    """Delete the files named by each (item id, attachment) pair, thumbnails included."""

    root = media_root(hass)
    _, refused = _thumbnail_state(hass)
    targets: list[Path] = []
    for item_id, meta in pairs:
        try:
            targets.append(attachment_path(root, item_id, str(meta.id), meta.mime))
            if meta.kind == "picture":
                thumb = thumbnail_path(root, item_id, str(meta.id))
                targets.append(thumb)
                refused.discard(str(thumb))
        except ValidationError:  # pragma: no cover - ids come from validated metadata
            continue
    if targets:
        await hass.async_add_executor_job(_delete_blocking, root, targets)


async def async_delete_item_files(hass: HomeAssistant, items: Iterable[Mapping[str, Any]]) -> None:
    """Delete the attachment files of every deleted item body passed in.

    Callers run this **after** their save succeeded: an orphaned file is swept
    at the next setup, while a file deleted ahead of a failed save would leave
    stored metadata naming nothing.
    """

    pairs: list[tuple[str, AttachmentMeta]] = []
    for body in items:
        item_id = str(body.get("id") or "")
        if not item_id:
            continue
        pairs.extend((item_id, meta) for meta in load_attachments(body.get("attachments")))
    if pairs:
        await async_delete_attachments(hass, pairs)


async def async_sweep_orphans(
    hass: HomeAssistant, pairs: Iterable[tuple[str, AttachmentMeta]]
) -> tuple[str, ...]:
    """Remove media files no metadata references, and what that empties."""

    root = media_root(hass)
    keep = referenced_paths(root, pairs)
    removed = tuple(await hass.async_add_executor_job(_sweep_blocking, root, keep))
    if removed:
        LOGGER.info(
            "Removed orphaned attachment files",
            extra={"domain": DOMAIN, "op": "attachment_sweep", "removed": len(removed)},
        )
    return removed


def _content_disposition(meta: AttachmentMeta) -> str:
    """The ``Content-Disposition`` value one attachment is served under.

    ``inline``, so a document opens in a tab, named by the title or else the
    filename, as the card labels the row. The real name travels as RFC 5987
    ``filename*``; the quoted ``filename`` is cut to printable US-ASCII without
    quotes or backslashes, which also stops a CR or LF splitting the header.
    """

    name = (meta.title.strip() or meta.filename)[:DISPOSITION_NAME_MAX_CHARS]
    ascii_name = "".join(c for c in name if " " <= c <= "~" and c not in '"\\').strip()
    # A title entirely in a non-Latin script leaves nothing printable.
    fallback = ascii_name or str(meta.id)
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


def _cache_control(request: Any) -> str:
    """How long a client may hold this response without asking again.

    The bytes an id names never change, but a retitle changes the
    ``Content-Disposition``, so only a URL carrying the name token is immutable.
    """

    if request.query.get(MEDIA_NAME_TOKEN_PARAM):
        return "private, max-age=31536000, immutable"
    return "private, no-store"


class HaventoryMediaView(HomeAssistantView):  # type: ignore[misc, valid-type]
    """Serve one attachment, to an authenticated Home Assistant user.

    Not `/local` and not `/haventory_static`: both are served without
    authentication, and an inventory photo is as private as the inventory.
    """

    url = MEDIA_URL_TEMPLATE
    name = "api:haventory:media"
    requires_auth = True

    async def get(self, request: Any, item_id: str, attachment_id: str) -> Any:
        """Return the file the two ids name, or 404 if no metadata claims it.

        ``?size=thumb`` asks for the row tile; any other size is a 400.
        """

        hass: HomeAssistant = request.app["hass"]
        size = request.query.get(MEDIA_SIZE_PARAM)
        if size is not None and size != MEDIA_SIZE_THUMB:
            return web.Response(status=HTTPStatus.BAD_REQUEST)

        runtime = find_runtime(hass)
        if runtime is None:
            return web.Response(status=HTTPStatus.SERVICE_UNAVAILABLE)

        meta = runtime.repository.find_attachment(item_id, attachment_id)
        if meta is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)

        root = media_root(hass)
        path = attachment_path(root, item_id, str(meta.id), meta.mime)
        if not await hass.async_add_executor_job(path.is_file):
            # An imported export carries the references but not the bytes.
            return web.Response(status=HTTPStatus.NOT_FOUND)

        mime = meta.mime
        if size == MEDIA_SIZE_THUMB:
            thumb = await async_thumbnail(hass, root=root, item_id=item_id, meta=meta)
            if thumb is not None:
                path, mime = thumb, "image/webp"

        return web.FileResponse(
            path,
            headers={
                # The stored type is the sniffed one; `nosniff` keeps the
                # browser from deciding differently about user-supplied bytes.
                "Content-Type": mime,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": _cache_control(request),
                # Without this the browser names a saved file after the last
                # path segment, which is the attachment id.
                "Content-Disposition": _content_disposition(meta),
            },
        )
