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
from collections.abc import Iterable
from http import HTTPStatus
from pathlib import Path
from typing import Any
from urllib.parse import quote

from homeassistant.core import HomeAssistant

try:
    from aiohttp import web
except ImportError:  # pragma: no cover - aiohttp ships with Home Assistant
    web = None  # type: ignore[assignment]

try:
    from homeassistant.components.http import HomeAssistantView
except ImportError:  # pragma: no cover - offline harness without the http component
    HomeAssistantView = object  # type: ignore[assignment, misc]

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
from .models import AttachmentKind, AttachmentMeta
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

    Named from the attachment id and not from the stored mime, because the
    derived file is always WebP whatever the original is — and because the
    sweep has to be able to name it from metadata alone.
    """

    resolved_root = root.resolve()
    candidate = (root / item_id / f"{attachment_id}{THUMBNAIL_SUFFIX}").resolve()
    if resolved_root not in candidate.parents:
        raise ValidationError("thumbnail path resolves outside the media root")
    return candidate


def _encode_thumbnail_blocking(source: Path, target: Path) -> bool:
    """Write ``source`` down to a row tile at ``target``. Blocks — executor only.

    False, never an exception, for every reason this cannot be done: Pillow is
    not a dependency of this integration, an animated GIF has no single frame
    worth standing in for the picture, a file may be corrupt, and the config
    tree is the user's and may refuse a write. Each of those means "serve the
    original", which is a slower page and not a broken one.

    Written to a neighbouring temporary file and moved into place, so a reader
    arriving mid-encode finds either no thumbnail or a whole one, never a
    half-written image.
    """

    try:
        # Deliberately here and not at module scope: this is the whole reason
        # `manifest.json` can keep declaring no requirements, and an install
        # without Pillow has to import this module and serve its pictures.
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
            oriented = oriented.convert("RGB")
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

    Kept on ``hass.data`` rather than on the runtime: neither survives a
    restart, and neither should — an install that gains Pillow gets its
    thumbnails on the next boot with nothing to clear.

    The refusal set is what stops an 8 MB file that will never decode from
    being decoded again on every render of every row that shows it. Both are
    bounded by the number of picture attachments, and a replacement picture is
    a new id rather than the same one with new bytes.
    """

    state: dict[str, Any] = hass.data.setdefault(_THUMBNAIL_STATE_KEY, {})
    locks: dict[str, asyncio.Lock] = state.setdefault("locks", {})
    refused: set[str] = state.setdefault("refused", set())
    return locks, refused


async def async_thumbnail(
    hass: HomeAssistant, *, root: Path, item_id: str, meta: AttachmentMeta
) -> Path | None:
    """The row tile for one picture, encoding it once if it is not there yet.

    ``None`` means "serve the original" — the caller never has to know which of
    the reasons applied.
    """

    if meta.kind != "picture":
        return None
    try:
        target = thumbnail_path(root, item_id, str(meta.id))
    except ValidationError:  # pragma: no cover - ids come from validated metadata
        return None

    locks, refused = _thumbnail_state(hass)
    key = str(target)
    # Under the lock even on the hot path, where the file is already there:
    # acquiring an uncontended `asyncio.Lock` does not suspend, and the check
    # has to be inside it anyway for the tab that waited on the encode.
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


def _delete_blocking(targets: Iterable[Path]) -> None:
    """Unlink each path that is present. Blocks — run it in the executor."""

    for target in targets:
        try:
            target.unlink()
        except FileNotFoundError:
            # Already gone: a half-applied earlier delete, or a restored backup
            # holding metadata whose files did not come with it.
            continue
        except OSError:
            LOGGER.warning(
                "Could not remove an attachment file",
                extra={"domain": DOMAIN, "op": "attachment_delete", "path": str(target)},
                exc_info=True,
            )


def _sweep_blocking(root: Path, referenced: frozenset[str]) -> list[str]:
    """Delete every file under ``root`` no metadata claims. Blocks — executor only.

    Files only, and only ones resolving inside ``root``: ``rglob`` follows a
    symlinked directory, so an unchecked candidate could name a file anywhere in
    the config tree. Empty directories are left behind — they are inert, and an
    operator's own file may sit in one.
    """

    if not root.is_dir():
        return []

    resolved_root = root.resolve()
    removed: list[str] = []
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
    return removed


def referenced_paths(root: Path, pairs: Iterable[tuple[str, AttachmentMeta]]) -> frozenset[str]:
    """Resolve every (item, attachment) pair to the files it names.

    Both files, for a picture: the sweep deletes everything it is not handed, so
    a thumbnail left out of this list is removed on the next sweep and encoded
    again on the next page that shows the row. A thumbnail is named whether or
    not it exists — the sweep only ever removes, so naming one that was never
    made costs nothing.

    An entry whose path would escape the media root is dropped rather than
    raised on: it names no file the sweep could keep, and refusing the whole
    sweep over one bad row would leave every real orphan on disk.
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
    """Validate an uploaded file and move it into place.

    Returns ``(mime, size)``. The mime is the sniffed one, so it is what the
    metadata records and what the view later serves the bytes as.
    """

    head, size = await hass.async_add_executor_job(_read_head_blocking, source)
    mime = validate_upload(kind=kind, head=head, size=size)
    target = attachment_path(media_root(hass), item_id, attachment_id, mime)
    stored_size = await hass.async_add_executor_job(_store_blocking, target, source)
    return mime, stored_size


async def async_delete_attachments(
    hass: HomeAssistant, pairs: Iterable[tuple[str, AttachmentMeta]]
) -> None:
    """Delete the files named by each (item id, attachment) pair.

    A removed picture takes its row tile with it; `_delete_blocking` passes over
    one that was never made.
    """

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
        await hass.async_add_executor_job(_delete_blocking, targets)


async def async_sweep_orphans(
    hass: HomeAssistant, pairs: Iterable[tuple[str, AttachmentMeta]]
) -> tuple[str, ...]:
    """Remove media files no metadata references.

    Its own module rather than ``stale_files``: that one is deliberately
    confined to the integration package directory and refuses anything resolving
    outside it, which is every path here.
    """

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

    ``inline``, never ``attachment``: a document opens in a tab, and the header
    exists to name the file the browser saves from there — not to turn the
    click into a download. The name is the title the user gave the file, or the
    name it arrived under, which is the precedence the card labels the row with,
    so a saved file matches the row that was clicked.

    Both halves are user-supplied text under no charset restriction, and this
    value becomes a response header. The real name travels percent-encoded in
    the RFC 5987 ``filename*`` form; the quoted ``filename`` a client without
    that support reads is reduced to printable US-ASCII minus the two
    characters the quoting itself uses, which is also what stops a CR or LF in
    a title from splitting the header.
    """

    name = (meta.title.strip() or meta.filename)[:DISPOSITION_NAME_MAX_CHARS]
    ascii_name = "".join(c for c in name if " " <= c <= "~" and c not in '"\\').strip()
    # Nothing printable survived — a title written entirely in a non-Latin
    # script. The attachment id is what such a client would have taken from the
    # URL anyway, and `filename*` still carries the real name.
    fallback = ascii_name or str(meta.id)
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


def _cache_control(request: Any) -> str:
    """How long a client may hold this response without asking again.

    The bytes an attachment id names never change — a replacement is a new id —
    but the name they are served under does: a retitle rewrites
    ``Content-Disposition`` for that same id. Storing the response forever is
    therefore only safe for a client whose URL changes when the name does, and
    the card's carries the name token this looks for. Without it the response
    must not be reused, or a retitle would keep saving the file under its old
    name for as long as the entry lived — and a signed URL lives half an hour,
    so that is not a window a user would wait out.
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

        ``?size=thumb`` asks for the row tile instead of the original. One
        accepted value, and anything else is a 400 rather than an invitation to
        have the server generate arbitrary sizes on demand.
        """

        hass: HomeAssistant = request.app["hass"]
        size = request.query.get(MEDIA_SIZE_PARAM)
        if size is not None and size != MEDIA_SIZE_THUMB:
            return web.Response(status=HTTPStatus.BAD_REQUEST)

        runtime = find_runtime(hass)
        if runtime is None:
            # No config entry owns the data — an unload, a disable, or the first
            # half of a reload. Same refusal the WebSocket commands make.
            return web.Response(status=HTTPStatus.SERVICE_UNAVAILABLE)

        meta = runtime.repository.find_attachment(item_id, attachment_id)
        if meta is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)

        root = media_root(hass)
        path = attachment_path(root, item_id, str(meta.id), meta.mime)
        if not await hass.async_add_executor_job(path.is_file):
            # Metadata without its file: a JSON export imported onto a fresh
            # install carries the references and not the bytes.
            return web.Response(status=HTTPStatus.NOT_FOUND)

        mime = meta.mime
        if size == MEDIA_SIZE_THUMB:
            thumb = await async_thumbnail(hass, root=root, item_id=item_id, meta=meta)
            if thumb is not None:
                path, mime = thumb, "image/webp"

        return web.FileResponse(
            path,
            headers={
                # The stored type is the sniffed one; `nosniff` stops the
                # browser from deciding differently about user-supplied bytes.
                # A tile is always WebP, whatever the picture behind it is.
                "Content-Type": mime,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": _cache_control(request),
                # Without this the browser names a saved file after the last
                # path segment, which is the attachment id.
                "Content-Disposition": _content_disposition(meta),
            },
        )
