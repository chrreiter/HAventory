r"""Onboard a blank Home Assistant and put the HAventory card on a dashboard.

For the scheduled card smoke, which boots
``ghcr.io/home-assistant/home-assistant:{stable,beta}`` in the CI runner and then
needs everything a browser harness normally gets from a dev instance somebody set
up by hand: an owner account, a long-lived token, and a dashboard view holding a
``custom:haventory-card``.

None of it needs a browser. Onboarding is plain REST — create the owner, trade
the returned code for a token, tick the three remaining steps — and the rest is
the WebSocket API. The one thing this script does **not** do is create the config
entry: ``scripts/ws_init_haventory.py`` already answers that flow from its own
schema, so it runs afterwards with the token printed here.

Writes ``HA_TOKEN=<token>`` to the file named by ``GITHUB_OUTPUT`` when that is
set, and prints the token on stdout otherwise. Everything else goes to stderr, so
the token is the only thing a caller has to parse.

Usage:
  uv run python scripts/ci_provision_ha.py --base-url http://localhost:8123

Deliberately for a **blank** instance: onboarding answers once and refuses
afterwards, so pointing this at an instance somebody uses would fail rather than
change it.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import sys
import time
from typing import Any

import aiohttp

# Home Assistant's own frontend uses its origin as the OAuth client id, and the
# token endpoint checks the two agree.
CLIENT_ID_SUFFIX = "/"

OWNER_USERNAME = "ci"
OWNER_NAME = "CI Runner"

# The dashboard the smoke drives. A plain masonry view, never `type: panel`: the
# card picks its layout from its own rendered width, and the smoke asserts on
# `hv-list-row` — the narrow branch, which is what a normal column produces and a
# panel view does not.
DASHBOARD_URL_PATH = "haventory-smoke"
CARD_VIEW_PATH = "cards"

CLIENT_NAME = "HAventory card smoke"
TOKEN_LIFESPAN_DAYS = 1

BOOT_TIMEOUT_S = 300.0
BOOT_POLL_INTERVAL_S = 3.0
HTTP_OK = 200


def log(message: str) -> None:
    """Progress goes to stderr; stdout carries the token and nothing else."""
    print(message, file=sys.stderr, flush=True)


async def wait_for_http(session: aiohttp.ClientSession, base_url: str) -> None:
    """Block until Home Assistant answers, or give up with what it last said.

    A cold container takes a minute or two to reach this point, and the port is
    open well before the app behind it is.
    """
    deadline = time.monotonic() + BOOT_TIMEOUT_S
    last = "no response yet"
    while time.monotonic() < deadline:
        try:
            async with session.get(f"{base_url}/manifest.json") as response:
                if response.status == HTTP_OK:
                    log(f"Home Assistant is answering at {base_url}")
                    return
                last = f"HTTP {response.status}"
        except aiohttp.ClientError as exc:
            last = type(exc).__name__
        await asyncio.sleep(BOOT_POLL_INTERVAL_S)
    raise RuntimeError(f"Home Assistant did not come up within {BOOT_TIMEOUT_S:.0f}s ({last})")


async def _post_json(
    session: aiohttp.ClientSession, url: str, payload: dict[str, Any], **kwargs: Any
) -> dict[str, Any]:
    async with session.post(url, json=payload, **kwargs) as response:
        body = await response.text()
        if response.status != HTTP_OK:
            raise RuntimeError(f"POST {url} answered HTTP {response.status}: {body}")
        return json.loads(body)


async def onboard(session: aiohttp.ClientSession, base_url: str) -> str:
    """Walk Home Assistant's onboarding steps, returning an access token.

    The first step is what mints the owner; the code it hands back is traded for
    a bearer at the token endpoint, and the three remaining steps only flip their
    own done-flags — but an instance with any of them outstanding shows the
    onboarding screen instead of a dashboard, so all of them are answered.
    """
    client_id = base_url + CLIENT_ID_SUFFIX
    # The account lives as long as the container does and nobody ever signs in to
    # it, but a fresh secret costs one call and leaves nothing quotable behind.
    password = secrets.token_urlsafe(24)

    created = await _post_json(
        session,
        f"{base_url}/api/onboarding/users",
        {
            "client_id": client_id,
            "name": OWNER_NAME,
            "username": OWNER_USERNAME,
            "password": password,
            "language": "en",
        },
    )
    log("Owner account created")

    # Form-encoded, not JSON: this is the OAuth token endpoint, not an HA API.
    async with session.post(
        f"{base_url}/auth/token",
        data={
            "grant_type": "authorization_code",
            "code": created["auth_code"],
            "client_id": client_id,
        },
    ) as response:
        body = await response.text()
        if response.status != HTTP_OK:
            raise RuntimeError(f"token exchange answered HTTP {response.status}: {body}")
        access_token = json.loads(body)["access_token"]

    headers = {"Authorization": f"Bearer {access_token}"}
    for step, payload in (
        ("core_config", {}),
        ("analytics", {}),
        ("integration", {"client_id": client_id, "redirect_uri": base_url}),
    ):
        await _post_json(session, f"{base_url}/api/onboarding/{step}", payload, headers=headers)
    log("Onboarding steps answered")

    return str(access_token)


class WSClient:
    """A minimal authenticated WebSocket caller, since only a few commands are needed."""

    def __init__(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        self._ws = ws
        self._next_id = 0

    async def call(self, command: dict[str, Any]) -> Any:
        self._next_id += 1
        message_id = self._next_id
        await self._ws.send_json({"id": message_id, **command})
        while True:
            message = await self._ws.receive_json()
            if message.get("id") != message_id or message.get("type") != "result":
                continue
            if not message.get("success"):
                raise RuntimeError(f"{command['type']} failed: {message.get('error')}")
            return message.get("result")


async def _connect(
    session: aiohttp.ClientSession, base_url: str, access_token: str
) -> tuple[aiohttp.ClientWebSocketResponse, WSClient]:
    ws = await session.ws_connect(base_url.replace("http", "ws", 1) + "/api/websocket")
    while True:
        message = await ws.receive_json()
        if message.get("type") == "auth_required":
            await ws.send_json({"type": "auth", "access_token": access_token})
        elif message.get("type") == "auth_ok":
            return ws, WSClient(ws)
        elif message.get("type") == "auth_invalid":
            raise RuntimeError(f"WebSocket auth refused: {message.get('message')}")


async def mint_long_lived_token(client: WSClient) -> str:
    """A refresh token that outlives the session the onboarding bearer belongs to."""
    token = await client.call(
        {
            "type": "auth/long_lived_access_token",
            "client_name": CLIENT_NAME,
            "lifespan": TOKEN_LIFESPAN_DAYS,
        }
    )
    log("Long-lived token minted")
    return str(token)


async def create_dashboard(client: WSClient) -> str:
    """A dashboard holding one HAventory card, and the path the smoke is pointed at.

    Storage-mode dashboards are two commands: register the dashboard, then save a
    config into it. The view carries nothing else — an empty column is what the
    card's narrow branch renders in.
    """
    await client.call(
        {
            "type": "lovelace/dashboards/create",
            "url_path": DASHBOARD_URL_PATH,
            "title": "HAventory smoke",
            "require_admin": False,
            "show_in_sidebar": True,
        }
    )
    await client.call(
        {
            "type": "lovelace/config/save",
            "url_path": DASHBOARD_URL_PATH,
            "config": {
                "views": [
                    {
                        "title": "Cards",
                        "path": CARD_VIEW_PATH,
                        "cards": [{"type": "custom:haventory-card"}],
                    }
                ]
            },
        }
    )
    path = f"/{DASHBOARD_URL_PATH}/{CARD_VIEW_PATH}"
    log(f"Dashboard created, card at {path}")
    return path


def emit(token: str, card_path: str) -> None:
    """Hand the results back the way the caller asked for them."""
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as handle:
            handle.write(f"token={token}\n")
            handle.write(f"card-path={card_path}\n")
    else:
        print(token)


async def run(base_url: str) -> None:
    async with aiohttp.ClientSession() as session:
        await wait_for_http(session, base_url)
        access_token = await onboard(session, base_url)
        ws, client = await _connect(session, base_url, access_token)
        try:
            token = await mint_long_lived_token(client)
            card_path = await create_dashboard(client)
        finally:
            await ws.close()
    emit(token, card_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("HA_BASE_URL", "http://localhost:8123"),
        help="the blank Home Assistant to onboard",
    )
    args = parser.parse_args()
    asyncio.run(run(args.base_url.rstrip("/")))


if __name__ == "__main__":
    main()
