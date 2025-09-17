r"""WebSocket subscription helper for HAventory topics.

Environment variables (PowerShell examples):
  $env:HA_BASE_URL = 'http://localhost:8123'
  $env:HA_TOKEN = '<your-long-lived-token>'
  $env:HAV_TOPIC = 'items'   # or 'locations' or 'stats'
  $env:HAV_LOCATION_ID = ''  # for topic 'locations' (optional)
  $env:HAV_INCLUDE_SUBTREE = 'true'  # for topic 'locations' (optional)
  $env:HAV_MAX_EVENTS = '5'  # stop after receiving N events (default: 5)

Optional mutations after subscribe:
  $env:HAV_MUTATIONS = '[{"id": 2001, "type": "haventory/item/create", "name": "Hammer"}]'

Run:
  python .\scripts\ws_subscribe.py | cat

Notes:
- Converts http(s) base URL into ws(s) automatically.
- Prints subscribe result and then events/results until HAV_MAX_EVENTS is reached.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from itertools import count
from typing import Any

import aiohttp


def _ws_url_from_base(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://') :]}/api/websocket"
    return f"ws://{base_url}/api/websocket"


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y"}


def _parse_mutations() -> list[dict[str, Any]]:
    raw = os.environ.get("HAV_MUTATIONS")
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as err:
        raise SystemExit(f"HAV_MUTATIONS is not valid JSON: {err}") from err
    if not isinstance(value, list):
        raise SystemExit("HAV_MUTATIONS must be a JSON array of messages")
    return [m for m in value if isinstance(m, dict)]


async def _drain_until(ws: aiohttp.ClientWebSocketResponse, predicate, limit: int) -> None:
    received = 0
    while received < limit:
        msg = await ws.receive_json()
        print(json.dumps(msg, indent=2))
        if predicate(msg):
            received += 1


async def run_subscriber() -> int:
    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")
    topic = os.environ.get("HAV_TOPIC", "items").strip().lower()
    location_id = os.environ.get("HAV_LOCATION_ID")
    include_subtree = _env_bool("HAV_INCLUDE_SUBTREE", True)
    max_events = int(os.environ.get("HAV_MAX_EVENTS", "5"))
    connect_timeout_s = float(os.environ.get("HAV_CONNECT_TIMEOUT", "10"))
    recv_timeout_s = float(os.environ.get("HAV_RECV_TIMEOUT", "20"))
    mutations = _parse_mutations()

    if not token:
        print("Missing HA_TOKEN in environment", file=sys.stderr)
        return 2
    if topic not in {"items", "locations", "stats"}:
        print("HAV_TOPIC must be one of: items, locations, stats", file=sys.stderr)
        return 2

    id_counter = count(start=1002)

    def next_id() -> int:
        return next(id_counter)

    subscribe_payload: dict[str, Any] = {"id": 1001, "type": "haventory/subscribe", "topic": topic}
    if topic == "locations":
        if location_id:
            subscribe_payload["location_id"] = location_id
        subscribe_payload["include_subtree"] = include_subtree

    ws_url = _ws_url_from_base(base)

    async with aiohttp.ClientSession() as session:
        timeout = aiohttp.ClientTimeout(total=connect_timeout_s)
        async with session.ws_connect(ws_url, timeout=timeout) as ws:
            try:
                _hello = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)
                await ws.send_json({"type": "auth", "access_token": token})
                _auth_ok = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)

                # Subscribe
                await ws.send_json(subscribe_payload)
                sub_ack = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)
                print(json.dumps(sub_ack, indent=2))
                if not (
                    isinstance(sub_ack, dict)
                    and sub_ack.get("type") == "result"
                    and bool(sub_ack.get("success", False))
                ):
                    # Exit early if subscribe failed
                    return 2

                # Optional set of mutations to trigger events
                for cmd in mutations:
                    # Ensure monotonic ids to satisfy HA WebSocket requirement
                    if isinstance(cmd, dict):
                        if (
                            "id" not in cmd
                            or not isinstance(cmd.get("id"), int)
                            or cmd.get("id") <= subscribe_payload["id"]
                        ):
                            cmd["id"] = next_id()
                    await ws.send_json(cmd)
                    # Print each result message for mutation commands
                    ack = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)
                    print(json.dumps(ack, indent=2))

                # Drain events/results until we hit max_events
                def is_event_or_result(obj: Any) -> bool:
                    return isinstance(obj, dict) and obj.get("type") in {"event", "result"}

                # Use the same timeout per receive; wrap the draining loop
                received = 0
                while received < max_events:
                    msg = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)
                    print(json.dumps(msg, indent=2))
                    if is_event_or_result(msg):
                        received += 1
            except TimeoutError:
                err = {
                    "id": int(subscribe_payload.get("id", 0)),
                    "type": "result",
                    "success": False,
                    "error": {
                        "code": "timeout",
                        "message": f"WebSocket receive timed out after {int(recv_timeout_s)}s",
                    },
                }
                print(json.dumps(err, indent=2))
                return 3

    return 0


def main() -> None:
    try:
        code = asyncio.run(run_subscriber())
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)


if __name__ == "__main__":
    main()
