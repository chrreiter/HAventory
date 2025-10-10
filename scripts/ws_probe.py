r"""WebSocket probe for HAventory commands.

Usage (PowerShell examples):
  $env:HA_BASE_URL = 'http://localhost:8123'
  $env:HA_TOKEN = '<your-long-lived-token>'
  $env:HAV_MSG = '{"id":1, "type":"haventory/ping", "echo":"hi"}'
  python .\scripts\ws_probe.py | cat

Environment variables:
- HA_BASE_URL: Home Assistant base URL (http/https). Default: http://localhost:8123
- HA_TOKEN: Long-lived access token (required)
- HAV_MSG: JSON message to send (required). Example: {"id":1, "type":"haventory/version"}

Notes:
- This is intended for quick, repeatable online checks. It does not mock anything.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import aiohttp


def _ws_url_from_base(base_url: str) -> str:
    """Convert an HTTP(S) base URL to a WS(S) endpoint."""
    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://') :]}/api/websocket"
    # Fallback: assume it's a bare host:port
    return f"ws://{base_url}/api/websocket"


async def run_probe() -> int:
    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")
    raw_msg = os.environ.get("HAV_MSG")
    connect_timeout_s = float(os.environ.get("HAV_CONNECT_TIMEOUT", "10"))
    recv_timeout_s = float(os.environ.get("HAV_RECV_TIMEOUT", "20"))

    if not token:
        print("Missing HA_TOKEN in environment", file=sys.stderr)
        return 2
    if not raw_msg:
        print("Missing HAV_MSG in environment", file=sys.stderr)
        return 2

    try:
        payload: dict[str, Any] = json.loads(raw_msg)
    except json.JSONDecodeError as err:
        print(f"HAV_MSG is not valid JSON: {err}", file=sys.stderr)
        return 2

    ws_url = _ws_url_from_base(base)

    async with aiohttp.ClientSession() as session:
        # Connection timeout for initial websocket upgrade
        timeout = aiohttp.ClientTimeout(total=connect_timeout_s)
        async with session.ws_connect(ws_url, timeout=timeout) as ws:
            try:
                # Receive hello
                _hello = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)
                # Authenticate
                await ws.send_json({"type": "auth", "access_token": token})
                _auth_ok = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)

                # Send the user's message
                await ws.send_json(payload)

                # Print the first result/event message and exit
                while True:
                    msg: Any = await asyncio.wait_for(ws.receive_json(), timeout=recv_timeout_s)
                    print(json.dumps(msg, indent=2))
                    if isinstance(msg, dict) and msg.get("type") in {"result", "event"}:
                        break
            except TimeoutError:
                # Emit a structured error envelope compatible with HA result format
                err = {
                    "id": int(payload.get("id", 0)) if isinstance(payload, dict) else 0,
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
        code = asyncio.run(run_probe())
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)


if __name__ == "__main__":
    main()
