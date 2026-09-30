r"""Initialize HAventory config entry via Home Assistant WebSocket API.

Usage:
  uv run python scripts/ws_init_haventory.py

Target:
  Resolved by `dev_env`, which decides between the .env beside this checkout and an
  inherited export and names the instance on stderr before anything is written.

Behavior:
- Starts the HAventory config flow (domain "haventory") over REST.
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


HTTP_ERROR_MIN_STATUS: int = 400

# The flow is single-step; anything past a handful of forms is a loop between
# this script and a step it cannot answer, not a longer setup.
MAX_FORM_STEPS: int = 5


def build_user_input(data_schema: object) -> dict[str, Any]:
    """Build a form submission from the defaults the form itself offers.

    ``data_schema`` is the serialized schema of a config-flow form: field
    descriptors with ``name``, ``required`` and, where prefilled, ``default`` (or
    a suggested value under ``description``). A required field with no default is
    refused by name rather than submitted blank for the flow to reject.
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


async def run() -> int:
    target = dev_env.load_env(REPO_ROOT)
    base = target.base_url.rstrip("/")
    token = target.token
    # The config entry this creates is what loads the integration, so the store is
    # routinely unreadable here -- the banner says so and the run continues.
    await dev_env.announce_store(target, action="creating the haventory config entry")
    if not token:
        print("Missing HA_TOKEN in environment", file=sys.stderr)
        return 2

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    flow_url = f"{base}/api/config/config_entries/flow"

    async with aiohttp.ClientSession() as session:
        # Home Assistant creates and answers config flows over REST only.
        async with session.post(
            flow_url, headers=headers, json={"handler": "haventory", "show_advanced_options": False}
        ) as resp:
            if resp.status >= HTTP_ERROR_MIN_STATUS:
                raise RuntimeError(f"HTTP {resp.status} starting config flow")
            result: dict[str, Any] = await resp.json()

        # Answer each presented form with its own defaults.
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
            # The body is the user input itself; a "user_input" wrapper fails validation.
            async with session.post(
                f"{flow_url}/{result.get('flow_id')}", headers=headers, json=user_input
            ) as resp:
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

        # Verify by calling haventory/version
        async with session.ws_connect(dev_env.ws_url(base)) as ws:
            _ = await _recv_json(ws)  # hello
            await ws.send_json({"type": "auth", "access_token": token})
            _ = await _recv_json(ws)
            await ws.send_json({"id": 1, "type": "haventory/version"})
            version_msg = await _expect_result(ws, 1)
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
