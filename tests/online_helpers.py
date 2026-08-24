"""What every online smoke needs before it can say anything about HAventory.

The smokes (``tests/*_online.py``) talk to a real Home Assistant over its own
WebSocket API rather than to a stub, so each of them has to open a socket,
authenticate, send frames under ids of its own making and pick its answer out of
a stream that also carries events. That is the same four helpers every time.

`HA_BASE_URL` and `HA_TOKEN` come from the environment — see
``docs/developing.md``; a smoke runs only with ``RUN_ONLINE=1``, so nothing here
is reached by the offline suite.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

import aiohttp

if TYPE_CHECKING:
    from collections.abc import Callable


def ws_url_from_base(base_url: str) -> str:
    """The WebSocket endpoint for an instance given by its HTTP base URL."""

    base_url = base_url.rstrip("/")
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://') :]}/api/websocket"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://') :]}/api/websocket"
    return f"ws://{base_url}/api/websocket"


async def open_ws() -> tuple[aiohttp.ClientSession, aiohttp.ClientWebSocketResponse]:
    """Connect and authenticate, leaving the socket ready for the first command.

    Home Assistant greets a new connection with ``auth_required`` and answers
    the token with ``auth_ok``; both are read here so a caller's first
    :func:`expect_result` is not handed one of them. The session comes back with
    the socket because closing the socket alone leaks the connector.
    """

    base = os.environ.get("HA_BASE_URL", "http://localhost:8123")
    token = os.environ.get("HA_TOKEN")
    session = aiohttp.ClientSession()
    ws = await session.ws_connect(ws_url_from_base(base))
    _ = await ws.receive_json()
    await ws.send_json({"type": "auth", "access_token": token})
    _ = await ws.receive_json()
    return session, ws


async def expect_result(ws: aiohttp.ClientWebSocketResponse, expect_id: int) -> dict[str, Any]:
    """Read until the ``result`` for one command id arrives, skipping everything else.

    A connection that has subscribed carries event frames between the command
    and its answer, and they are not this caller's.
    """

    while True:
        msg = await ws.receive_json()
        if isinstance(msg, dict) and msg.get("id") == expect_id and msg.get("type") == "result":
            return msg


def id_counter(start: int = 0) -> Callable[[], int]:
    """A source of the strictly increasing message ids one connection needs."""

    value = start

    def _next() -> int:
        nonlocal value
        value += 1
        return value

    return _next
