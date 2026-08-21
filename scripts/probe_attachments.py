r"""Online probes for the HAventory attachment path, against a live dev instance.

Usage:
  export RUN_ONLINE=1
  export HA_CONTAINER='home-assistant'          # or HA_CONFIG_DIR, see below
  uv sync --group probes
  uv run --group probes python scripts/probe_attachments.py

Options:
  --fixtures-dir DIR   reuse (or write) the generated fixtures here
  --keep-fixtures      do not delete a temporary fixture directory afterwards
  --no-cleanup         leave the probe's item and attachments in the inventory

Environment variables:
- RUN_ONLINE: must be `1`. Nothing here mocks anything and it writes to a real
  inventory, so it never runs by accident.
- HA_BASE_URL / HA_TOKEN: taken from the `.env` beside this checkout, which wins
  over an inherited export; HAVENTORY_IGNORE_ENV_FILE=1 hands the decision back
  to the environment. The resolved target and the store's counts print on stderr
  before the first upload. A token is required.
- HA_CONFIG_DIR: the Home Assistant config directory as this host sees it. Set
  it when the config lives on a bind mount; leave it unset to read the stored
  bytes through `docker exec`.
- HA_CONTAINER: container to read stored bytes from. Default: home-assistant
- HA_CONTAINER_CONFIG: config directory inside that container. Default: /config
- HAV_UNREACHABLE_URL: a base URL that must refuse to connect, for the
  presence-probe case. Default: http://127.0.0.1:9

What this covers that no automated test can: the bytes that end up on Home
Assistant's disk. Every scenario uploads through the real path — core's
`/api/file_upload` handle consumed by `haventory/item/attachment/add` — and then
reads the stored file back out of the config directory rather than trusting what
the command reported.

The preparation the card does in a canvas before uploading is mirrored here in
Pillow, from the constants in `cards/haventory-card/src/ui/downscale.ts`. That
mirror is part of the subject: if it and the card disagree about what should be
sent, one of the two is wrong and this run is where that shows. What the
browser's own canvas produces is the browser smoke's business; what survives the
trip to disk is this file's.

Type-checked manually — `scripts/` sits outside mypy's `files`:
  uv run --group probes mypy scripts/probe_attachments.py

Exit codes: 0 all probes passed, 1 a probe failed, 2 missing configuration,
3 the instance stopped answering.
"""

# PLR2004: image dimensions, frame counts and HTTP statuses are the subject
#   matter; naming each one would hide what a scenario asserts.
# S603, S607: the stored bytes are read with `docker exec`, found on PATH, with
#   a container name the operator supplied.
# ruff: noqa: PLR2004, S603, S607

from __future__ import annotations

import argparse
import asyncio
import io
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from itertools import count
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import aiohttp

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - the group is opt-in
    print("Pillow is missing. Install the probes group: uv sync --group probes", file=sys.stderr)
    sys.exit(2)

# Both helpers live in `scripts/`, which is the interpreter's own directory when
# this file is run as a script.
import dev_env
from probe_fixtures import generate as generate_fixtures

REPO_ROOT = Path(__file__).resolve().parents[1]

# -----------------------------------------------------------------------------
# Mirrors of what the card decides before an upload starts.
# `cards/haventory-card/src/ui/downscale.ts` is the original; a divergence
# between the two is a finding, because the card is what the backend ever sees.
# -----------------------------------------------------------------------------

DOWNSCALE_THRESHOLD_BYTES = 2 * 1024 * 1024
MAX_IMAGE_EDGE = 2048
# 0.85 through the canvas API, which takes a fraction where Pillow takes a
# percentage.
DOWNSCALE_QUALITY = 85
# GIF is absent on purpose: a canvas holds one frame, so re-encoding an animated
# GIF would keep the first and throw the rest away.
RECODABLE: tuple[str, ...] = ("image/jpeg", "image/png", "image/webp")

# Mirrors `media.py`: the stored name is derived from the sniffed type, which is
# how a probe finds the file it just uploaded.
MEDIA_SUBDIR = "haventory/attachments"
EXTENSION_BY_MIME: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
}

CONNECT_TIMEOUT_S = 10.0
RECV_TIMEOUT_S = 30.0
UNREACHABLE_TIMEOUT_S = 5.0

# A minimal but genuine PDF. The backend sniffs the leading `%PDF-` marker, so a
# file that merely claimed the type would be refused before it reached disk.
PDF_BYTES = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)

GREEN = "\033[92m"
RED = "\033[91m"
DIM = "\033[2m"
RESET = "\033[0m"


class ProbeError(RuntimeError):
    """A probe could not reach a verdict — setup, transport or the instance."""


@dataclass
class ProbeResult:
    """One scenario's verdict, plus the numbers it reached it from."""

    name: str
    passed: bool
    detail: str = ""
    notes: list[str] = field(default_factory=list)


# -----------------------------------------------------------------------------
# Preparation — the card's re-encode rules, in Pillow
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Prepared:
    """The file the card would actually upload for a given source file."""

    data: bytes
    filename: str
    mime: str
    recoded: bool


def sniff_mime(head: bytes) -> str:
    """Identify a fixture from its leading bytes, the way the backend does."""

    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    raise ProbeError("fixture is not one of the types the backend accepts")


def scaled_size(width: int, height: int) -> tuple[int, int]:
    """The box the frame fits into, capped at `MAX_IMAGE_EDGE`, aspect kept."""

    longest = max(width, height)
    if longest <= MAX_IMAGE_EDGE:
        return width, height
    ratio = MAX_IMAGE_EDGE / longest
    return max(1, round(width * ratio)), max(1, round(height * ratio))


def target_type(source_mime: str) -> str:
    """A JPEG stays a JPEG; anything else becomes WebP so alpha survives."""

    return "image/jpeg" if source_mime == "image/jpeg" else "image/webp"


def rename_for(filename: str, mime: str) -> str:
    """Same base name, extension swapped to match what was encoded."""

    extension = ".jpg" if mime == "image/jpeg" else ".webp"
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    return f"{base or 'photo'}{extension}"


def prepare_for_upload(path: Path) -> Prepared:
    """What the card would send for this file.

    Fails open exactly as the card does: anything that cannot be re-encoded, or
    that came out no smaller, is uploaded untouched.
    """

    data = path.read_bytes()
    mime = sniff_mime(data[:16])
    if mime not in RECODABLE or len(data) <= DOWNSCALE_THRESHOLD_BYTES:
        return Prepared(data, path.name, mime, recoded=False)

    encoded = target_type(mime)
    buffer = io.BytesIO()
    with Image.open(io.BytesIO(data)) as source:
        # The counterpart of the card's
        # `createImageBitmap(file, {imageOrientation: 'from-image'})`: the
        # re-encode drops the source's EXIF, so a frame not rotated before it is
        # written is stored permanently on its side.
        upright = ImageOps.exif_transpose(source)
        if upright is None:  # pragma: no cover - only for an unreadable frame
            raise ProbeError(f"could not decode {path.name}")
        width, height = scaled_size(upright.width, upright.height)
        resized = upright.resize((width, height), Image.Resampling.LANCZOS)
        if encoded == "image/jpeg":
            resized.convert("RGB").save(buffer, "JPEG", quality=DOWNSCALE_QUALITY)
        else:
            resized.convert("RGBA").save(buffer, "WEBP", quality=DOWNSCALE_QUALITY)

    if buffer.tell() >= len(data):
        return Prepared(data, path.name, mime, recoded=False)
    return Prepared(buffer.getvalue(), rename_for(path.name, encoded), encoded, recoded=True)


# -----------------------------------------------------------------------------
# Talking to the instance
# -----------------------------------------------------------------------------


def _ws_url_from_base(base_url: str) -> str:
    """Convert an HTTP(S) base URL to a WS(S) endpoint."""

    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://') :]}/api/websocket"
    return f"ws://{base_url}/api/websocket"


class WsClient:
    """Authenticated WebSocket connection that sends one command at a time."""

    def __init__(self, session: aiohttp.ClientSession, base_url: str, token: str) -> None:
        self._session = session
        self._url = _ws_url_from_base(base_url)
        self._token = token
        self._ids = count(1)
        self._ws: aiohttp.ClientWebSocketResponse | None = None

    async def connect(self) -> None:
        self._ws = await asyncio.wait_for(
            self._session.ws_connect(
                self._url, timeout=aiohttp.ClientWSTimeout(ws_receive=RECV_TIMEOUT_S)
            ),
            timeout=CONNECT_TIMEOUT_S,
        )
        await self._receive()
        await self._ws.send_json({"type": "auth", "access_token": self._token})
        auth = await self._receive()
        if auth.get("type") != "auth_ok":
            raise ProbeError(f"authentication refused: {auth}")

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def _receive(self) -> dict[str, Any]:
        if self._ws is None:  # pragma: no cover - defensive
            raise ProbeError("websocket is not connected")
        message: Any = await asyncio.wait_for(self._ws.receive_json(), timeout=RECV_TIMEOUT_S)
        if not isinstance(message, dict):  # pragma: no cover - HA always sends objects
            raise ProbeError(f"unexpected websocket frame: {message!r}")
        return message

    async def command(self, command_type: str, **payload: Any) -> dict[str, Any]:
        """Send one command and return its result, raising on a refusal."""

        if self._ws is None:  # pragma: no cover - defensive
            raise ProbeError("websocket is not connected")
        message_id = next(self._ids)
        await self._ws.send_json({"id": message_id, "type": command_type, **payload})
        while True:
            reply = await self._receive()
            if reply.get("id") != message_id or reply.get("type") != "result":
                continue
            if not reply.get("success"):
                raise ProbeError(f"{command_type} refused: {reply.get('error')}")
            result: Any = reply.get("result")
            return result if isinstance(result, dict) else {}


class StoredBytes:
    """Reads an attachment back out of Home Assistant's config directory.

    A bind-mounted config is read directly; otherwise the file comes out of the
    container through `docker exec`. Either way the point is the same: assert
    against the bytes on disk, not against what the command reported.
    """

    def __init__(self) -> None:
        self.host_config = os.environ.get("HA_CONFIG_DIR")
        self.container = os.environ.get("HA_CONTAINER", "home-assistant")
        self.container_config = os.environ.get("HA_CONTAINER_CONFIG", "/config")

    def describe(self) -> str:
        if self.host_config:
            return f"{self.host_config}/{MEDIA_SUBDIR}"
        return f"{self.container_config}/{MEDIA_SUBDIR} in container {self.container}"

    def read(self, item_id: str, attachment_id: str, mime: str) -> bytes:
        relative = f"{MEDIA_SUBDIR}/{item_id}/{attachment_id}{EXTENSION_BY_MIME.get(mime, '')}"
        if self.host_config:
            path = Path(self.host_config) / relative
            if not path.is_file():
                raise ProbeError(f"no stored file at {path}")
            return path.read_bytes()
        completed = subprocess.run(
            ["docker", "exec", self.container, "cat", f"{self.container_config}/{relative}"],
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            raise ProbeError(
                f"could not read {relative} from container {self.container}: "
                f"{completed.stderr.decode(errors='replace').strip()}"
            )
        return completed.stdout


@dataclass
class Probe:
    """Everything a scenario needs, and the one item they all attach to."""

    ws: WsClient
    session: aiohttp.ClientSession
    base: str
    token: str
    stored: StoredBytes
    fixtures: Path
    item_id: str = ""
    seen: set[str] = field(default_factory=set)

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def media_url(self, attachment_id: str) -> str:
        return f"{self.base.rstrip('/')}/api/haventory/media/{self.item_id}/{attachment_id}"

    async def attach(self, *, data: bytes, filename: str, kind: str) -> dict[str, Any]:
        """Upload one file the way the card does and return its metadata.

        The bytes ride core's `/api/file_upload`, which hands back a handle the
        WebSocket command then consumes — they never cross the WebSocket itself.
        The part declares `application/octet-stream` on purpose: every type the
        backend records is one it sniffed, so declaring the real one here would
        leave a probe unable to tell the two apart.
        """

        form = aiohttp.FormData()
        form.add_field("file", data, filename=filename, content_type="application/octet-stream")
        async with self.session.post(
            f"{self.base.rstrip('/')}/api/file_upload", data=form, headers=self.auth
        ) as response:
            if response.status != 200:
                raise ProbeError(f"file_upload answered {response.status}: {await response.text()}")
            file_id = (await response.json())["file_id"]

        item = await self.ws.command(
            "haventory/item/attachment/add",
            item_id=self.item_id,
            file_id=file_id,
            kind=kind,
            filename=filename,
        )
        attachments: list[dict[str, Any]] = item["attachments"]
        fresh = [entry for entry in attachments if entry["id"] not in self.seen]
        self.seen.update(entry["id"] for entry in attachments)
        if len(fresh) != 1:
            raise ProbeError(f"expected one new attachment, the item reports {len(fresh)}")
        return fresh[0]


# -----------------------------------------------------------------------------
# Scenarios
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class UploadCase:
    """One fixture and the shape its stored file has to have."""

    name: str
    fixture: str
    recoded: bool
    mime: str
    size: tuple[int, int]
    alpha: bool
    frames: int
    why: str


UPLOAD_CASES: tuple[UploadCase, ...] = (
    UploadCase(
        name="oversized JPEG is downscaled to the 2048 cap",
        fixture="photo_large.jpg",
        recoded=True,
        mime="image/jpeg",
        size=(2048, 1536),
        alpha=False,
        frames=1,
        why="a current phone writes 4-12 MB a frame, over the backend's 8 MB per-file cap",
    ),
    UploadCase(
        name="EXIF Orientation=6 is applied before the re-encode",
        fixture="photo_large_exif6.jpg",
        recoded=True,
        mime="image/jpeg",
        # Upright: a 4032x3024 frame tagged 6 displays as 3024x4032, so the
        # capped result is portrait. Landscape here means the tag was dropped
        # rather than applied — which every automated test still calls a success.
        size=(1536, 2048),
        alpha=False,
        frames=1,
        why="the one defect here that looks correct in every test and wrong on every phone",
    ),
    UploadCase(
        name="oversized PNG becomes WebP and keeps its transparency",
        fixture="transparent_large.png",
        recoded=True,
        mime="image/webp",
        size=(2048, 1536),
        alpha=True,
        frames=1,
        why="flattening alpha onto an opaque canvas changes the picture, not just its size",
    ),
    UploadCase(
        name="animated GIF is uploaded untouched, every frame intact",
        fixture="animated.gif",
        recoded=False,
        mime="image/gif",
        size=(240, 180),
        alpha=False,
        frames=24,
        why="a canvas holds one frame, so re-encoding would keep the first and drop the rest",
    ),
    UploadCase(
        name="sub-threshold JPEG round-trips byte-identical",
        fixture="photo_small.jpg",
        recoded=False,
        mime="image/jpeg",
        size=(800, 600),
        alpha=False,
        frames=1,
        why="re-encoding is lossy and a file this size costs little to send as it is",
    ),
)


def _frame_shape(data: bytes) -> tuple[tuple[int, int], bool, int]:
    """Dimensions, whether the image carries alpha, and how many frames."""

    with Image.open(io.BytesIO(data)) as image:
        size = (image.width, image.height)
        alpha = "A" in image.getbands() or "transparency" in image.info
        frames = int(getattr(image, "n_frames", 1))
    return size, alpha, frames


async def probe_upload(probe: Probe, case: UploadCase) -> ProbeResult:  # noqa: PLR0911
    """Upload one fixture and check what actually landed on disk."""

    notes: list[str] = [case.why]
    try:
        source = probe.fixtures / case.fixture
        original = source.read_bytes()
        prepared = prepare_for_upload(source)
        notes.append(
            f"{case.fixture}: {len(original) / 1024 / 1024:.1f} MB -> "
            f"{len(prepared.data) / 1024 / 1024:.2f} MB as {prepared.mime}"
        )
        if prepared.recoded != case.recoded:
            verb = "re-encoded" if prepared.recoded else "passed through"
            return ProbeResult(case.name, False, f"the card would have {verb} this file", notes)

        attachment = await probe.attach(
            data=prepared.data, filename=prepared.filename, kind="picture"
        )
        if attachment["mime"] != case.mime:
            return ProbeResult(
                case.name, False, f"stored as {attachment['mime']}, expected {case.mime}", notes
            )

        on_disk = probe.stored.read(probe.item_id, attachment["id"], attachment["mime"])
        if on_disk != prepared.data:
            return ProbeResult(
                case.name,
                False,
                f"{len(on_disk)} bytes on disk against the {len(prepared.data)} uploaded",
                notes,
            )
        if attachment["size"] != len(on_disk):
            return ProbeResult(
                case.name,
                False,
                f"reported {attachment['size']} bytes, {len(on_disk)} on disk",
                notes,
            )
        if not case.recoded and on_disk != original:
            return ProbeResult(case.name, False, "the untouched file did not arrive intact", notes)

        size, alpha, frames = _frame_shape(on_disk)
        notes.append(f"on disk: {size[0]}x{size[1]}, alpha={alpha}, frames={frames}")
        if size != case.size:
            return ProbeResult(
                case.name, False, f"stored {size[0]}x{size[1]}, expected {case.size}", notes
            )
        if alpha != case.alpha:
            return ProbeResult(case.name, False, f"alpha={alpha}, expected {case.alpha}", notes)
        if frames != case.frames:
            return ProbeResult(case.name, False, f"{frames} frames, expected {case.frames}", notes)
        return ProbeResult(case.name, True, f"{len(on_disk)} bytes verified on disk", notes)
    except TimeoutError:
        # `TimeoutError` is an `OSError`, and an instance that stopped answering
        # is a run that ended, not a probe with a verdict.
        raise
    except (ProbeError, OSError, KeyError) as err:
        return ProbeResult(case.name, False, str(err), notes)


async def probe_presence(probe: Probe) -> ProbeResult:
    """The three answers the card's presence check has to tell apart.

    A one-byte range settles whether a file is really there without pulling the
    document down to ask. Only a 404 proves absence: a request that never
    arrived must leave a document that opens perfectly well alone.
    """

    name = "presence probe answers 206 / 404 / nothing"
    notes: list[str] = []
    headers = {**probe.auth, "Range": "bytes=0-0"}
    try:
        attachment = await probe.attach(data=PDF_BYTES, filename="presence.pdf", kind="manual")
        url = probe.media_url(attachment["id"])

        async with probe.session.get(url, headers=headers) as live:
            length = live.headers.get("Content-Length")
            notes.append(f"live file: {live.status}, Content-Length {length}")
            if live.status != 206 or length != "1":
                return ProbeResult(
                    name, False, "a live file did not answer 206 with one byte", notes
                )

        await probe.ws.command(
            "haventory/item/attachment/remove",
            item_id=probe.item_id,
            attachment_id=attachment["id"],
        )
        async with probe.session.get(url, headers=headers) as gone:
            notes.append(f"deleted file: {gone.status}")
            if gone.status != 404:
                return ProbeResult(name, False, f"a deleted file answered {gone.status}", notes)

        unreachable = os.environ.get("HAV_UNREACHABLE_URL", "http://127.0.0.1:9").rstrip("/")
        target = f"{unreachable}/api/haventory/media/{probe.item_id}/{attachment['id']}"
        try:
            async with probe.session.get(
                target, headers=headers, timeout=aiohttp.ClientTimeout(total=UNREACHABLE_TIMEOUT_S)
            ) as answered:
                return ProbeResult(
                    name, False, f"the unreachable host answered {answered.status}", notes
                )
        except aiohttp.ClientError, TimeoutError:
            notes.append(f"unreachable host ({unreachable}): no status at all")
        return ProbeResult(name, True, "206 live, 404 deleted, no answer unreachable", notes)
    except TimeoutError:
        raise
    except (ProbeError, OSError, KeyError) as err:
        return ProbeResult(name, False, str(err), notes)


async def probe_content_disposition(probe: Probe) -> ProbeResult:
    """A saved manual is named after the row that was clicked, and still opens.

    Without the header a browser names the saved file after the last path
    segment, which is the attachment id; `attachment` in place of `inline` would
    turn the click into a download instead of opening the document in a tab.
    """

    name = "manuals are served inline under their title"
    notes: list[str] = []
    title = "Spülmaschine - Anleitung (DE)"
    try:
        attachment = await probe.attach(data=PDF_BYTES, filename="scan_0142.pdf", kind="manual")
        url = probe.media_url(attachment["id"])

        async with probe.session.get(url, headers=probe.auth) as untitled:
            disposition = untitled.headers.get("Content-Disposition", "")
        notes.append(f"untitled: {disposition}")
        if not disposition.startswith("inline"):
            return ProbeResult(name, False, "the response is not inline", notes)
        if _rfc5987_filename(disposition) != "scan_0142.pdf":
            return ProbeResult(name, False, "an untitled manual is not named after its file", notes)

        await probe.ws.command(
            "haventory/item/attachment/update",
            item_id=probe.item_id,
            attachment_id=attachment["id"],
            title=title,
        )
        async with probe.session.get(url, headers=probe.auth) as titled:
            disposition = titled.headers.get("Content-Disposition", "")
        notes.append(f"titled: {disposition}")
        if not disposition.startswith("inline"):
            return ProbeResult(name, False, "the retitled response is not inline", notes)
        served = _rfc5987_filename(disposition)
        if served != title:
            return ProbeResult(name, False, f"served as {served!r}, expected {title!r}", notes)
        return ProbeResult(name, True, "the name follows the title, non-ASCII intact", notes)
    except TimeoutError:
        raise
    except (ProbeError, OSError, KeyError) as err:
        return ProbeResult(name, False, str(err), notes)


def _rfc5987_filename(disposition: str) -> str:
    """Decode the `filename*=UTF-8''…` half — the one a browser reads."""

    marker = "filename*=UTF-8''"
    if marker not in disposition:
        raise ProbeError(f"no RFC 5987 filename in {disposition!r}")
    return unquote(disposition.split(marker, 1)[1])


# -----------------------------------------------------------------------------
# Run
# -----------------------------------------------------------------------------


def print_results(results: list[ProbeResult]) -> None:
    print()
    for result in results:
        mark = f"{GREEN}PASS{RESET}" if result.passed else f"{RED}FAIL{RESET}"
        print(f"[{mark}] {result.name}")
        for note in result.notes:
            print(f"       {DIM}{note}{RESET}")
        if result.detail:
            print(f"       {result.detail}")
    passed = sum(1 for result in results if result.passed)
    print(f"\n{passed}/{len(results)} probes passed")


async def _run_scenarios(probe: Probe) -> list[ProbeResult]:
    results = [await probe_upload(probe, case) for case in UPLOAD_CASES]
    results.append(await probe_presence(probe))
    results.append(await probe_content_disposition(probe))
    return results


async def run_probes(args: argparse.Namespace) -> int:
    if os.environ.get("RUN_ONLINE") != "1":
        print("Set RUN_ONLINE=1: this writes to a real inventory.", file=sys.stderr)
        return 2
    target = dev_env.load_env(REPO_ROOT)
    token = target.token
    base = target.base_url
    await dev_env.announce_store(target, action="the attachment probes")
    if not token:
        print(f"Missing HA_TOKEN (looked in {target.source})", file=sys.stderr)
        return 2

    temporary = args.fixtures_dir is None
    fixtures = (
        Path(args.fixtures_dir) if args.fixtures_dir else Path(tempfile.mkdtemp("-haventory"))
    )
    stored = StoredBytes()
    results: list[ProbeResult] = []

    try:
        print(f"Generating fixtures in {fixtures} ...")
        generate_fixtures(fixtures)
        print(f"Reading stored bytes from {stored.describe()}")

        async with aiohttp.ClientSession() as session:
            ws = WsClient(session, base, token)
            await ws.connect()
            probe = Probe(
                ws=ws, session=session, base=base, token=token, stored=stored, fixtures=fixtures
            )
            item = await ws.command("haventory/item/create", name="probe_attachments")
            probe.item_id = str(item["id"])
            print(f"Probing against item {probe.item_id}")
            try:
                results = await _run_scenarios(probe)
            finally:
                if args.no_cleanup:
                    print(f"Leaving item {probe.item_id} in place (--no-cleanup)")
                else:
                    await ws.command("haventory/item/delete", item_id=probe.item_id)
                await ws.close()
    except TimeoutError:
        print("The instance stopped answering", file=sys.stderr)
        return 3
    except ProbeError as err:
        print(f"Could not run the probes: {err}", file=sys.stderr)
        return 2
    except aiohttp.ClientError as err:
        print(f"Could not reach {base}: {err}", file=sys.stderr)
        return 2
    finally:
        if temporary and not args.keep_fixtures:
            shutil.rmtree(fixtures, ignore_errors=True)
        elif temporary:
            print(f"Fixtures kept in {fixtures}")

    print_results(results)
    return 0 if all(result.passed for result in results) else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="HAventory attachment probes (online)")
    parser.add_argument("--fixtures-dir", help="reuse or write the generated fixtures here")
    parser.add_argument(
        "--keep-fixtures", action="store_true", help="keep a temporary fixture directory"
    )
    parser.add_argument(
        "--no-cleanup", action="store_true", help="leave the probe item in the inventory"
    )
    args = parser.parse_args()
    try:
        code = asyncio.run(run_probes(args))
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)


if __name__ == "__main__":
    main()
