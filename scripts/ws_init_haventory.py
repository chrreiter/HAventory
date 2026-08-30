r"""Initialize HAventory config entry via Home Assistant WebSocket API.

Usage:
  uv run python scripts/ws_init_haventory.py

Target:
  Resolved by `dev_env`, which decides between the .env beside this checkout and an
  inherited export and names the instance on stderr before anything is written.

Behavior:
- Starts the HAventory config flow (domain "haventory").
- Answers each form with the defaults its returned schema offers, so setup asks
  no questions and keeps working when the flow gains a field or a step.
- If already configured (single instance), exits successfully.
- Verifies integration by calling the "haventory/version" WS command.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import aiohttp

import dev_env

REPO_ROOT = Path(__file__).resolve().parents[1]


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

# The flow is single-step; anything past a handful of forms is a loop between
# this script and a step it cannot answer, not a longer setup.
MAX_FORM_STEPS: int = 5


def build_user_input(data_schema: object) -> dict[str, Any]:
    """Build a form submission from the defaults the form itself offers.

    ``data_schema`` is the serialized schema a config-flow form result carries:
    a list of field descriptors with ``name``, ``required``, and — for every
    field the flow prefills — ``default`` (or a suggested value under
    ``description``). Answering with those keeps this script's contract of "a
    working instance, no questions asked" without hard-coding values a later
    release would silently drift from. A required field that offers no default
    cannot be invented here, so it is refused by name rather than submitted
    blank for the flow to 400 on.
    """
    payload: dict[str, Any] = {}
    if not isinstance(data_schema, list):
        return payload
    for field in data_schema:
        if not isinstance(field, dict):
            continue
        name = field.get("name")
        if not isinstance(name, str):
            continue
        # A section serializes as an "expandable" wrapper around its own field
        # list and is submitted as a nested object under the section's name.
        if field.get("type") == "expandable":
            payload[name] = build_user_input(field.get("schema"))
            continue
        if "default" in field:
            payload[name] = field["default"]
            continue
        description = field.get("description")
        if isinstance(description, dict) and "suggested_value" in description:
            payload[name] = description["suggested_value"]
            continue
        if field.get("required"):
            raise RuntimeError(
                f"config flow field {name!r} is required but offers no default; "
                "cannot set up without asking"
            )
    return payload


async def run() -> int:  # noqa: PLR0912, PLR0915
    target = dev_env.load_env(REPO_ROOT)
    base = target.base_url
    token = target.token
    # The config entry this creates is what loads the integration, so the store is
    # routinely unreadable here -- the banner says so and the run continues.
    await dev_env.announce_store(target, action="creating the haventory config entry")
    if not token:
        print("Missing HA_TOKEN in environment", file=sys.stderr)
        return 2

    ws_url = dev_env.ws_url(base)

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
            result: dict[str, Any] = frame.get("result") or {}
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

            # 2) Answer each presented form with its own defaults.
            form_steps = 0
            while result.get("type") == "form":
                form_steps += 1
                if form_steps > MAX_FORM_STEPS:
                    raise RuntimeError(
                        f"config flow still presents forms after {MAX_FORM_STEPS} submissions"
                    )
                errors = result.get("errors")
                if errors:
                    step = result.get("step_id")
                    raise RuntimeError(
                        f"config flow step {step!r} rejected the submitted defaults: {errors}"
                    )
                user_input = build_user_input(result.get("data_schema"))
                flow_id = result.get("flow_id")
                if used_transport == "ws":
                    msg_id += 1
                    payload2 = {
                        "id": msg_id,
                        "type": "config_entries/flow/configure",
                        "flow_id": flow_id,
                        "user_input": user_input,
                    }
                    await ws.send_json(payload2)
                    frame2 = await _expect_raw_result(ws, msg_id)
                    if not bool(frame2.get("success")):
                        err = frame2.get("error") or {}
                        if err.get("code") == "unknown_command":
                            # Fallback for older cores
                            msg_id += 1
                            payload2["id"] = msg_id
                            payload2["type"] = "config/flow/configure"
                            await ws.send_json(payload2)
                            frame2 = await _expect_raw_result(ws, msg_id)
                        if not bool(frame2.get("success")):
                            raise RuntimeError(f"WS command failed: {frame2}")
                    result = frame2.get("result") or {}
                else:
                    # The REST configure endpoint takes the user input as the
                    # request body itself; wrapping it under a "user_input" key
                    # reads as an unknown extra field and fails validation.
                    step_url = f"{base.rstrip('/')}/api/config/config_entries/flow/{flow_id}"
                    headers = {
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json",
                    }
                    async with session.post(step_url, headers=headers, json=user_input) as resp:
                        if resp.status >= HTTP_ERROR_MIN_STATUS:
                            body = await resp.text()
                            raise RuntimeError(f"HTTP {resp.status} configuring flow: {body}")
                        result = await resp.json()

            # A completed flow reports create_entry; an instance that already
            # has its entry aborts, which is this script's job done as well.
            if result.get("type") == "abort":
                reason = result.get("reason")
                if reason not in {"single_instance_allowed", "already_configured"}:
                    print(f"Config flow aborted: {reason}", file=sys.stderr)
                    return 2

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
