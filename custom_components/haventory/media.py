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
"""

from __future__ import annotations

import logging
import shutil
from collections.abc import Iterable
from http import HTTPStatus
from pathlib import Path
from typing import Any

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
    MEDIA_SUBDIR,
    MEDIA_URL_TEMPLATE,
)
from .exceptions import ValidationError
from .models import AttachmentKind, AttachmentMeta

LOGGER = logging.getLogger(__name__)

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
    """Resolve every (item, attachment) pair to the file it names.

    An entry whose path would escape the media root is dropped rather than
    raised on: it names no file the sweep could keep, and refusing the whole
    sweep over one bad row would leave every real orphan on disk.
    """

    paths: set[str] = set()
    for item_id, meta in pairs:
        try:
            paths.add(str(attachment_path(root, item_id, str(meta.id), meta.mime)))
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
    """Delete the files named by each (item id, attachment) pair."""

    root = media_root(hass)
    targets: list[Path] = []
    for item_id, meta in pairs:
        try:
            targets.append(attachment_path(root, item_id, str(meta.id), meta.mime))
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


class HaventoryMediaView(HomeAssistantView):  # type: ignore[misc, valid-type]
    """Serve one attachment, to an authenticated Home Assistant user.

    Not `/local` and not `/haventory_static`: both are served without
    authentication, and an inventory photo is as private as the inventory.
    """

    url = MEDIA_URL_TEMPLATE
    name = "api:haventory:media"
    requires_auth = True

    async def get(self, request: Any, item_id: str, attachment_id: str) -> Any:
        """Return the file the two ids name, or 404 if no metadata claims it."""

        hass: HomeAssistant = request.app["hass"]
        bucket = hass.data.get(DOMAIN) or {}
        repo = bucket.get("repository")
        if repo is None:
            # No config entry owns the data — an unload, a disable, or the first
            # half of a reload. Same refusal the WebSocket commands make.
            return web.Response(status=HTTPStatus.SERVICE_UNAVAILABLE)

        meta = repo.find_attachment(item_id, attachment_id)
        if meta is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)

        path = attachment_path(media_root(hass), item_id, str(meta.id), meta.mime)
        if not await hass.async_add_executor_job(path.is_file):
            # Metadata without its file: a JSON export imported onto a fresh
            # install carries the references and not the bytes.
            return web.Response(status=HTTPStatus.NOT_FOUND)

        return web.FileResponse(
            path,
            headers={
                # The stored type is the sniffed one; `nosniff` stops the
                # browser from deciding differently about user-supplied bytes.
                "Content-Type": meta.mime,
                "X-Content-Type-Options": "nosniff",
                # An attachment id addresses one immutable set of bytes: a
                # replacement is a new id, so this can never go stale.
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        )
