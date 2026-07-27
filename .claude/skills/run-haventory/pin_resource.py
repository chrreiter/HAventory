#!/usr/bin/env python3
"""Point the Lovelace resource at the *current* card build — cache-bust included.

Run this after every `scripts/reload_addon.sh`. It fixes two dev-loop traps:

1. **Stale card in the browser.** HA serves `/local/` with
   `Cache-Control: public, max-age=2678400` (31 days) and no revalidation, so a
   plain reload keeps running a month-old build. Registering the resource as
   `haventory-card.js?v=<content-hash>` makes every new build a new URL, which
   no cache can satisfy. (Same trick HACS uses with `?hacstag=`.)
2. **Duplicate resources.** The integration re-adds the un-versioned URL on each
   HA restart (its "already registered?" test is an exact string match), and two
   resources loading the same module means a second `customElements.define()`
   and a console error. This deletes every haventory resource, then creates one.

Usage (from the repo root):
  uv run python .claude/skills/run-haventory/pin_resource.py

Reads HA_BASE_URL / HA_TOKEN from the environment or the repo-root `.env`,
exactly like driver.py.
"""
# Dev/agent harness script; mirrors driver.py's .env loader verbatim.
# ruff: noqa: PLW2901

from __future__ import annotations

import asyncio
import hashlib
import os
import sys
from pathlib import Path
from typing import Any

import aiohttp

REPO_ROOT = Path(__file__).resolve().parents[3]
CARD_BUILD = REPO_ROOT / "cards" / "www" / "haventory" / "haventory-card.js"
RECV_TIMEOUT_S = 30.0


def load_env() -> None:
    """Populate os.environ from repo-root .env (existing env vars win)."""
    env_file = REPO_ROOT / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def ws_url(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    return f"ws://{base_url.removeprefix('http://')}/api/websocket"


async def main() -> int:
    load_env()
    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")
    if not token:
        print("Missing HA_TOKEN (env or repo-root .env)", file=sys.stderr)
        return 2
    if not CARD_BUILD.is_file():
        print(f"Card build not found: {CARD_BUILD}\nRun `npm run build` first.", file=sys.stderr)
        return 1

    digest = hashlib.sha256(CARD_BUILD.read_bytes()).hexdigest()[:12]
    url = f"/local/haventory/haventory-card.js?v={digest}"

    timeout = aiohttp.ClientWSTimeout(ws_receive=RECV_TIMEOUT_S)
    async with (
        aiohttp.ClientSession() as session,
        session.ws_connect(ws_url(base), timeout=timeout) as ws,
    ):
        await ws.receive_json()  # auth_required
        await ws.send_json({"type": "auth", "access_token": token})
        authed = await ws.receive_json()
        if authed.get("type") != "auth_ok":
            print(f"Auth failed: {authed}", file=sys.stderr)
            return 1

        msg_id = 0

        async def cmd(payload: dict[str, Any]) -> Any:
            nonlocal msg_id
            msg_id += 1
            await ws.send_json({"id": msg_id, **payload})
            while True:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=RECV_TIMEOUT_S)
                if msg.get("id") != msg_id:
                    continue  # event frame
                if not msg.get("success"):
                    raise RuntimeError(f"{payload['type']}: {msg.get('error')}")
                return msg.get("result")

        for item in await cmd({"type": "lovelace/resources"}) or []:
            if "haventory" in item.get("url", ""):
                await cmd({"type": "lovelace/resources/delete", "resource_id": item["id"]})
                print(f"removed {item['url']}")

        await cmd({"type": "lovelace/resources/create", "res_type": "module", "url": url})
        print(f"pinned  {url}")
        final = [i["url"] for i in await cmd({"type": "lovelace/resources"}) or []]
        print(f"resources now: {final}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
