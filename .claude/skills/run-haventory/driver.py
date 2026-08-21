r"""HAventory dev-instance driver: status / send / smoke over the HA WebSocket API.

Agent harness for driving a running Home Assistant instance that has the
haventory integration loaded. Complements scripts/ws_probe.py (single message)
by holding ONE authenticated connection for a whole command sequence, so ids
and item versions can flow between steps.

Config: HA_BASE_URL / HA_TOKEN come from the `.env` beside this checkout, which
wins over an inherited export -- a worktree's .env names the instance that worktree
is for. HAVENTORY_IGNORE_ENV_FILE=1 hands the decision back to the environment for
one run. Every command prints the resolved target and the store's counts on stderr
before it acts, and `smoke` (which creates and deletes) says that it writes.

Usage (from repo root):
  uv run python .claude/skills/run-haventory/driver.py status
  uv run python .claude/skills/run-haventory/driver.py send '{"type":"haventory/ping"}' ...
  uv run python .claude/skills/run-haventory/driver.py smoke

`send` auto-assigns ids and prints one JSON result frame per message.
`smoke` runs a full CRUD user flow (location -> item -> search -> optimistic
concurrency -> quantity -> cleanup) and exits non-zero on the first failure.
It only touches objects it creates (unique suffix), so it is safe on a dev
instance holding existing data.
"""
# Dev/agent harness script — magic numbers in assertions are fine here.
# ruff: noqa: PLR2004

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

import aiohttp

REPO_ROOT = Path(__file__).resolve().parents[3]
RECV_TIMEOUT_S = 20.0
# One definition of "which instance is this?" for every helper in the repo. This
# file's committed location names the checkout it belongs to, so the import
# follows the same tree the .env is read from.
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import dev_env  # noqa: E402


class HaWs:
    """One authenticated HA WebSocket connection with sequential ids."""

    def __init__(self, session: aiohttp.ClientSession, ws: aiohttp.ClientWebSocketResponse):
        self._ws = ws
        self._next_id = 1

    async def send(self, message: dict[str, Any]) -> dict[str, Any]:
        """Send one command frame; return its full result frame (success or not)."""
        message = dict(message)
        message.setdefault("id", self._next_id)
        self._next_id = max(self._next_id, int(message["id"])) + 1
        await self._ws.send_json(message)
        while True:
            frame = await asyncio.wait_for(self._ws.receive_json(), timeout=RECV_TIMEOUT_S)
            if (
                isinstance(frame, dict)
                and frame.get("id") == message["id"]
                and frame.get("type") == "result"
            ):
                return frame
            # Drain unrelated frames (events for other subscriptions etc.)


async def connect(session: aiohttp.ClientSession, base: str, token: str) -> HaWs:
    ws = await session.ws_connect(
        dev_env.ws_url(base), timeout=aiohttp.ClientWSTimeout(ws_receive=15)
    )
    await asyncio.wait_for(ws.receive_json(), timeout=RECV_TIMEOUT_S)  # hello
    await ws.send_json({"type": "auth", "access_token": token})
    auth = await asyncio.wait_for(ws.receive_json(), timeout=RECV_TIMEOUT_S)
    if auth.get("type") != "auth_ok":
        raise RuntimeError(f"WS auth failed: {auth}")
    return HaWs(session, ws)


async def cmd_status(base: str, token: str) -> int:
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{base.rstrip('/')}/api/config",
            headers={"Authorization": f"Bearer {token}"},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            cfg = await resp.json()
        ha = await connect(session, base, token)
        version = await ha.send({"type": "haventory/version"})
        health = await ha.send({"type": "haventory/health"})
        stats = await ha.send({"type": "haventory/stats"})
    print(
        json.dumps(
            {
                "ha_version": cfg.get("version"),
                "ha_state": cfg.get("state"),
                "haventory_version": version.get("result"),
                "health": health.get("result"),
                "stats": stats.get("result"),
            },
            indent=2,
        )
    )
    return 0


async def cmd_send(base: str, token: str, raw_messages: list[str]) -> int:
    payloads = [json.loads(raw) for raw in raw_messages]
    rc = 0
    async with aiohttp.ClientSession() as session:
        ha = await connect(session, base, token)
        for payload in payloads:
            frame = await ha.send(payload)
            print(json.dumps(frame, indent=2))
            if not frame.get("success", False):
                rc = 1
    return rc


class SmokeFailure(RuntimeError):
    pass


def _check(step: str, condition: bool, detail: Any = "") -> None:
    if condition:
        print(f"[PASS] {step}")
    else:
        print(f"[FAIL] {step}: {detail}")
        raise SmokeFailure(step)


async def cmd_smoke(base: str, token: str) -> int:
    suffix = f"{int(time.time()):x}"
    loc_name = f"Smoke Shelf {suffix}"
    item_name = f"Smoke Widget {suffix}"
    loc_id: str | None = None
    item_id: str | None = None
    async with aiohttp.ClientSession() as session:
        ha = await connect(session, base, token)
        try:
            frame = await ha.send({"type": "haventory/location/create", "name": loc_name})
            _check("location/create", frame.get("success"), frame.get("error"))
            loc_id = frame["result"]["id"]

            frame = await ha.send(
                {
                    "type": "haventory/item/create",
                    "name": item_name,
                    "location_id": loc_id,
                    "quantity": 2,
                    "tags": ["smoke-test"],
                }
            )
            _check("item/create", frame.get("success"), frame.get("error"))
            item = frame["result"]
            item_id = item["id"]
            _check(
                "item has denormalized location_path",
                item["location_path"]["name_path"] == [loc_name],
                item["location_path"],
            )
            version = item["version"]

            # Search is case-insensitive, so a lowercase query has to find a mixed-case
            # name. The filter key is `q`; any other key is refused as a validation_error.
            frame = await ha.send(
                {"type": "haventory/item/list", "filter": {"q": item_name.lower()}}
            )
            _check(
                "item/list case-insensitive search",
                frame.get("success") and [i["id"] for i in frame["result"]["items"]] == [item_id],
                frame,
            )

            frame = await ha.send(
                {
                    "type": "haventory/item/update",
                    "item_id": item_id,
                    "expected_version": version,
                    "description": "updated by smoke driver",
                }
            )
            _check(
                "item/update with expected_version",
                frame.get("success") and frame["result"]["version"] == version + 1,
                frame,
            )

            frame = await ha.send(
                {
                    "type": "haventory/item/update",
                    "item_id": item_id,
                    "expected_version": version,  # stale on purpose
                    "description": "should conflict",
                }
            )
            _check(
                "stale expected_version raises conflict",
                (not frame.get("success")) and frame["error"]["code"] == "conflict",
                frame,
            )

            frame = await ha.send(
                {"type": "haventory/item/adjust_quantity", "item_id": item_id, "delta": 3}
            )
            _check(
                "item/adjust_quantity",
                frame.get("success") and frame["result"]["quantity"] == 5,
                frame,
            )
        finally:
            # Cleanup is part of the flow: the smoke leaves no trace behind.
            if item_id is not None:
                frame = await ha.send({"type": "haventory/item/delete", "item_id": item_id})
                print(f"[{'PASS' if frame.get('success') else 'FAIL'}] item/delete (cleanup)")
            if loc_id is not None:
                frame = await ha.send({"type": "haventory/location/delete", "location_id": loc_id})
                print(f"[{'PASS' if frame.get('success') else 'FAIL'}] location/delete (cleanup)")
        frame = await ha.send({"type": "haventory/stats"})
        print(f"[INFO] stats after smoke: {json.dumps(frame.get('result'))}")
    print("SMOKE OK")
    return 0


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] not in {"status", "send", "smoke"}:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    target = dev_env.load_env(REPO_ROOT)
    base = target.base_url
    token = target.token
    # `send` carries whatever frames the caller hands it, so only `smoke` is known
    # to write here; the base URL and counts are what name the target either way.
    asyncio.run(dev_env.announce_store(target, action="smoke" if args[0] == "smoke" else None))
    if not token:
        print(f"Missing HA_TOKEN (looked in {target.source})", file=sys.stderr)
        sys.exit(2)
    try:
        if args[0] == "status":
            code = asyncio.run(cmd_status(base, token))
        elif args[0] == "send":
            code = asyncio.run(cmd_send(base, token, args[1:]))
        else:
            code = asyncio.run(cmd_smoke(base, token))
    except SmokeFailure:
        code = 1
    except (TimeoutError, aiohttp.ClientError) as exc:
        print(f"Connection error: {exc} (is HA up at {base}?)", file=sys.stderr)
        code = 3
    sys.exit(code)


if __name__ == "__main__":
    main()
