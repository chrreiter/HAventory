"""Which Home Assistant a dev helper is about to talk to, and saying so out loud.

The helpers in ``scripts/`` and in ``.claude/skills/`` are run from whichever
checkout the operator is standing in, while ``HA_BASE_URL`` / ``HA_TOKEN`` are
commonly exported once by a shell profile. Two rules keep a run from answering
for an instance nobody meant to touch:

1. **The ``.env`` beside the checkout wins over an inherited export.** It is the
   more specific statement of intent: a worktree carrying its own ``.env`` names
   the instance that worktree is for. Set ``HAVENTORY_IGNORE_ENV_FILE=1`` to hand
   the decision back to the environment for one run -- that is how a recipe
   points a helper at a remote instance while a dev ``.env`` sits in the tree.
2. **Every helper names its target before it acts** -- the base URL, where that
   value came from, and the store's counts. A run against the wrong inventory is
   then visible in the first line of output instead of being inferred later from
   a number that looks off.

Parsing matches what ``set -a; source .env; set +a`` does with the same file:
``KEY=VALUE`` per line, ``#`` comments and blanks skipped, no quote stripping.

The banner is ASCII only: it prints on consoles that are not UTF-8.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import MutableMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

import aiohttp

DEFAULT_BASE_URL = "http://localhost:8123"
IGNORE_FLAG = "HAVENTORY_IGNORE_ENV_FILE"
BANNER_PREFIX = "[target]"
# The banner answers "which inventory is this?", so it carries the two totals that
# tell one instance from another and leaves the rest of `haventory/health` to the
# commands that assert on it.
HEADLINE_COUNTS = ("items_total", "locations_total")


@dataclass(frozen=True)
class Target:
    """The instance a helper resolved, and how it got there."""

    base_url: str
    token: str | None
    source: str
    env_file: Path | None
    overrode: tuple[str, ...]
    displaced_base_url: str | None
    ignored: bool


def parse_env_file(text: str) -> dict[str, str]:
    """Read ``KEY=VALUE`` lines the way ``source`` would, minus shell expansion."""
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def load_env(root: Path, environ: MutableMapping[str, str] | None = None) -> Target:
    """Apply ``<root>/.env`` over ``environ`` and report the resolved target.

    Keys the file declares replace what the environment carried; keys it does not
    declare are left alone, so a per-command ``HA_CONTAINER=...`` still reaches
    the helper.
    """
    env = os.environ if environ is None else environ
    env_file = root / ".env"
    present = env_file.is_file()
    ignored = env.get(IGNORE_FLAG, "").strip().lower() not in {"", "0", "false", "no"}
    overrode: list[str] = []
    displaced_base_url: str | None = None

    if present and not ignored:
        for key, value in parse_env_file(env_file.read_text(encoding="utf-8")).items():
            if key in env and env[key] != value:
                overrode.append(key)
                if key == "HA_BASE_URL":
                    displaced_base_url = env[key]
            env[key] = value

    if present and not ignored:
        source = str(env_file)
    elif present:
        source = f"the environment; {env_file} ignored via {IGNORE_FLAG}"
    elif "HA_BASE_URL" in env:
        source = "the environment; no .env beside the checkout"
    else:
        source = "the built-in default; nothing set HA_BASE_URL"

    return Target(
        base_url=env.get("HA_BASE_URL") or DEFAULT_BASE_URL,
        token=env.get("HA_TOKEN") or None,
        source=source,
        env_file=env_file if present else None,
        overrode=tuple(overrode),
        displaced_base_url=displaced_base_url,
        ignored=ignored,
    )


def target_lines(
    target: Target,
    *,
    counts: dict[str, Any] | None = None,
    unavailable: str | None = None,
    action: str | None = None,
) -> list[str]:
    """The banner every helper prints before it acts."""
    lines = [f"{BANNER_PREFIX} HA_BASE_URL={target.base_url} (from {target.source})"]

    if target.overrode:
        # The displaced URL is the whole point of the line -- it is the instance
        # the run would have gone to. No other displaced value is printed: one of
        # them is the token.
        displaced = ", ".join(
            f"{key}={target.displaced_base_url}" if key == "HA_BASE_URL" else key
            for key in sorted(target.overrode)
        )
        lines.append(f"{BANNER_PREFIX} the .env overrode the environment's {displaced}")

    if counts is None:
        lines.append(f"{BANNER_PREFIX} store: unavailable ({unavailable or 'not probed'})")
    else:
        totals = " ".join(f"{k}={counts[k]}" for k in HEADLINE_COUNTS if k in counts)
        totals = totals or "reachable, but reported no totals"
        lines.append(f"{BANNER_PREFIX} store: {totals}")

    if action:
        lines.append(f"{BANNER_PREFIX} {action} writes to this instance; proceeding")
    return lines


def announce(
    target: Target,
    *,
    counts: dict[str, Any] | None = None,
    unavailable: str | None = None,
    action: str | None = None,
    stream: TextIO = sys.stderr,
) -> None:
    """Print the banner. Defaults to stderr, which the JSON-printing helpers need."""
    for line in target_lines(target, counts=counts, unavailable=unavailable, action=action):
        print(line, file=stream, flush=True)


async def announce_store(
    target: Target,
    *,
    action: str | None = None,
    stream: TextIO = sys.stderr,
) -> tuple[dict[str, Any] | None, str | None]:
    """Probe the resolved instance and print the banner -- one call per helper."""
    if target.token is None:
        counts, why = None, f"HA_TOKEN is unset (looked in {target.source})"
    else:
        counts, why = await probe_counts(target.base_url, target.token)
    announce(target, counts=counts, unavailable=why, action=action, stream=stream)
    return counts, why


def ws_url(base_url: str) -> str:
    """Convert an HTTP(S) base URL to the Home Assistant WebSocket endpoint."""
    base = base_url.rstrip("/")
    if base.startswith("https://"):
        return f"wss://{base[len('https://') :]}/api/websocket"
    if base.startswith("http://"):
        return f"ws://{base[len('http://') :]}/api/websocket"
    return f"ws://{base}/api/websocket"


async def probe_counts(
    base_url: str, token: str, *, timeout_s: float = 10.0
) -> tuple[dict[str, Any] | None, str | None]:
    """Ask ``haventory/health`` for the store's counts.

    Returns ``(counts, None)`` or ``(None, reason)``. Every failure is a reason
    rather than an exception: the banner is a courtesy, and a helper that can
    still do its job -- ``ws_init_haventory.py`` runs before the integration is
    loaded -- must not be stopped by it.
    """
    try:
        async with aiohttp.ClientSession() as session:
            ws = await asyncio.wait_for(
                session.ws_connect(
                    ws_url(base_url), timeout=aiohttp.ClientWSTimeout(ws_receive=timeout_s)
                ),
                timeout=timeout_s,
            )
            async with ws:
                await asyncio.wait_for(ws.receive_json(), timeout=timeout_s)  # hello
                await ws.send_json({"type": "auth", "access_token": token})
                auth = await asyncio.wait_for(ws.receive_json(), timeout=timeout_s)
                if auth.get("type") != "auth_ok":
                    return None, f"auth refused ({auth.get('message') or auth.get('type')})"
                await ws.send_json({"id": 1, "type": "haventory/health"})
                while True:
                    frame = await asyncio.wait_for(ws.receive_json(), timeout=timeout_s)
                    if not isinstance(frame, dict) or frame.get("id") != 1:
                        continue
                    if not frame.get("success"):
                        err = frame.get("error") or {}
                        code = err.get("code", "error")
                        return None, f"{code}: {err.get('message', '')}".strip()
                    result = frame.get("result") or {}
                    return dict(result.get("counts") or {}), None
    except Exception as err:
        # A banner failure must not mask the helper's own error handling, so every
        # exception becomes a printed reason.
        return None, f"{type(err).__name__}: {err}"
