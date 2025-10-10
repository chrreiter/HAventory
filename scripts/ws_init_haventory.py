r"""Initialize HAventory config entry via Home Assistant WebSocket API.

Usage (PowerShell):
  $env:HA_BASE_URL = 'http://localhost:8123'
  $env:HA_TOKEN = '<your-long-lived-token>'
  python .\scripts\ws_init_haventory.py

Behavior:
- Starts the HAventory config flow (domain "haventory").
- Submits empty user input (flow is single-step) to create the entry.
- If already configured (single instance), exits successfully.
- Verifies integration by calling the "haventory/version" WS command.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import aiohttp


def _ws_url_from_base(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://') :]}/api/websocket"
    return f"ws://{base_url}/api/websocket"


async def _recv_json(ws: aiohttp.ClientWebSocketResponse) -> dict[str, Any]:
    msg = await ws.receive_json()
    if not isinstance(msg, dict):
        raise RuntimeError("unexpected WS message shape")
    return msg


async def _expect_result(ws: aiohttp.ClientWebSocketResponse, expect_id: int) -> dict[str, Any]:
    while True:
        msg = await _recv_json(ws)
        if msg.get("id") != expect_id:
            # Drain unrelated event messages
            continue
        if msg.get("type") != "result":
            raise RuntimeError(f"unexpected WS type: {msg.get('type')}")
        if not bool(msg.get("success", False)):
            raise RuntimeError(f"WS command failed: {msg}")
        result = msg.get("result")
        if not isinstance(result, dict):
            # Some result payloads are not objects; normalize
            return {"_raw": result}
        return result


async def _expect_raw_result(ws: aiohttp.ClientWebSocketResponse, expect_id: int) -> dict[str, Any]:
    """Wait for a result frame with the given id and return the full message.

    Unlike _expect_result, this does not raise on success=false, allowing callers to
    inspect error codes (e.g., unknown_command) and implement graceful fallbacks.
    """
    while True:
        msg = await _recv_json(ws)
        if msg.get("id") != expect_id:
            continue
        if msg.get("type") != "result":
            raise RuntimeError(f"unexpected WS type: {msg.get('type')}")
        return msg


HTTP_ERROR_MIN_STATUS: int = 400


async def run() -> int:  # noqa: PLR0912, PLR0915
    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")
    if not token:
        print("Missing HA_TOKEN in environment", file=sys.stderr)
        return 2

    ws_url = _ws_url_from_base(base)

    async with aiohttp.ClientSession() as session:
        async with session.ws_connect(ws_url) as ws:
            # Hello
            _ = await _recv_json(ws)
            # Auth
            await ws.send_json({"type": "auth", "access_token": token})
            _ = await _recv_json(ws)

            # 1) Start config flow for domain "haventory"
            msg_id = 1
            payload = {
                "id": msg_id,
                "type": "config_entries/flow/create",
                "handler": "haventory",
                "show_advanced_options": False,
            }
            await ws.send_json(payload)
            frame = await _expect_raw_result(ws, msg_id)
            used_transport = "ws"
            if not bool(frame.get("success")):
                err = frame.get("error") or {}
                if err.get("code") == "unknown_command":
                    # Try legacy WS namespace
                    msg_id = 11
                    payload["id"] = msg_id
                    payload["type"] = "config/flow/create"
                    await ws.send_json(payload)
                    frame = await _expect_raw_result(ws, msg_id)
                    if (
                        not bool(frame.get("success"))
                        and (frame.get("error") or {}).get("code") == "unknown_command"
                    ):
                        # Fall back to HTTP REST config flow API when WS config
                        # commands are unavailable
                        used_transport = "http"
                        start_url = f"{base.rstrip('/')}/api/config/config_entries/flow"
                        headers = {
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                        }
                        async with session.post(
                            start_url,
                            headers=headers,
                            json={"handler": "haventory", "show_advanced_options": False},
                        ) as resp:
                            if resp.status >= HTTP_ERROR_MIN_STATUS:
                                raise RuntimeError(f"HTTP {resp.status} starting config flow")
                            result = await resp.json()

                if used_transport == "ws":
                    if not bool(frame.get("success")):
                        raise RuntimeError(f"WS command failed: {frame}")
                    result = frame.get("result") or {}

            flow_type = result.get("type")
            flow_id = result.get("flow_id")
            # If the flow already completes here (rare), continue gracefully
            if flow_type == "abort":
                reason = result.get("reason")
                if reason in {"single_instance_allowed", "already_configured"}:
                    # Treat as success; proceed to verification
                    pass
                else:
                    print(f"Config flow aborted: {reason}", file=sys.stderr)
                    return 2
            elif flow_type == "form":
                # 2) Submit empty user input (single-step integration)
                if used_transport == "ws":
                    msg_id = 2
                    payload2 = {
                        "id": msg_id,
                        "type": "config_entries/flow/configure",
                        "flow_id": flow_id,
                        "user_input": {},
                    }
                    await ws.send_json(payload2)
                    frame2 = await _expect_raw_result(ws, msg_id)
                    if not bool(frame2.get("success")):
                        err = frame2.get("error") or {}
                        if err.get("code") == "unknown_command":
                            # Fallback for older cores
                            msg_id = 12
                            payload2["id"] = msg_id
                            payload2["type"] = "config/flow/configure"
                            await ws.send_json(payload2)
                            frame2 = await _expect_raw_result(ws, msg_id)
                        if not bool(frame2.get("success")):
                            raise RuntimeError(f"WS command failed: {frame2}")
                    result2 = frame2.get("result") or {}
                else:
                    # HTTP configure step
                    step_url = f"{base.rstrip('/')}/api/config/config_entries/flow/{flow_id}"
                    headers = {
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    }
                    async with session.post(
                        step_url, headers=headers, json={"user_input": {}}
                    ) as resp:
                        if resp.status >= HTTP_ERROR_MIN_STATUS:
                            raise RuntimeError(f"HTTP {resp.status} configuring flow")
                        result2 = await resp.json()
                # Accept create_entry or abort(single_instance_allowed)
                rtype = result2.get("type")
                if rtype == "abort":
                    reason = result2.get("reason")
                    if reason not in {"single_instance_allowed", "already_configured"}:
                        print(f"Config flow aborted: {reason}", file=sys.stderr)
                        return 2
                elif rtype not in {"create_entry", "form"}:
                    # Some cores return the created entry info directly
                    pass
            # else: other types are unexpected; continue to verification

            # 3) Verify by calling haventory/version
            msg_id = 99
            await ws.send_json({"id": msg_id, "type": "haventory/version"})
            version_msg = await _expect_result(ws, msg_id)
            print(json.dumps({"ok": True, "version": version_msg}, indent=2))
            return 0


def main() -> None:
    try:
        code = asyncio.run(run())
    except KeyboardInterrupt:
        code = 130
    except Exception as exc:  # pragma: no cover - CLI convenience
        print(f"Error: {exc}", file=sys.stderr)
        code = 1
    sys.exit(code)


if __name__ == "__main__":
    main()
