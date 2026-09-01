"""What every online smoke needs before it can say anything about HAventory.

The smokes (``tests/*_online.py``) talk to a real Home Assistant over its own
WebSocket API rather than to a stub, so each of them has to open a socket,
authenticate, send frames under ids of its own making and pick its answer out of
a stream that also carries events. That is the same handful of helpers every
time.

`HA_BASE_URL` and `HA_TOKEN` come from the environment — see
``docs/developing.md``. :data:`requires_online` is what keeps the offline suite
out: a smoke without an instance to talk to would hang on a socket rather than
fail, so every online module applies it through its ``pytestmark``.
:data:`destructive` guards the ones that empty the target instance first.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

import aiohttp
import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

requires_online = pytest.mark.skipif(
    os.environ.get("RUN_ONLINE") != "1" or not os.environ.get("HA_TOKEN"),
    reason="RUN_ONLINE!=1 or HA_TOKEN missing",
)

destructive = pytest.mark.skipif(
    os.environ.get("HAV_ONLINE_DESTRUCTIVE") != "1",
    reason=(
        "destructive online test (purges ALL HAventory data on the target HA); "
        "set HAV_ONLINE_DESTRUCTIVE=1 only against a disposable instance"
    ),
)


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


async def purge_items(ws: aiohttp.ClientWebSocketResponse, next_id: Callable[[], int]) -> None:
    """Delete every item on the instance, for a test that counts what it created."""

    qid = next_id()
    await ws.send_json({"id": qid, "type": "haventory/item/list"})
    lst = await expect_result(ws, qid)
    items = (lst.get("result") or {}).get("items") or []
    for it in items:
        did = next_id()
        await ws.send_json(
            {
                "id": did,
                "type": "haventory/item/delete",
                "item_id": it.get("id"),
                "expected_version": int(it.get("version", 1)),
            }
        )
        _ = await expect_result(ws, did)


async def purge_locations(ws: aiohttp.ClientWebSocketResponse, next_id: Callable[[], int]) -> None:
    """Delete every location, deepest first — a parent with children refuses."""

    qid = next_id()
    await ws.send_json({"id": qid, "type": "haventory/location/list"})
    lst = await expect_result(ws, qid)
    locs = lst.get("result") or []
    locs_sorted = sorted(
        [loc for loc in locs if isinstance(loc, dict)],
        key=lambda loc: len((loc.get("path") or {}).get("name_path") or []),
        reverse=True,
    )
    for loc in locs_sorted:
        did = next_id()
        await ws.send_json(
            {"id": did, "type": "haventory/location/delete", "location_id": loc.get("id")}
        )
        _ = await expect_result(ws, did)


def find_in_tree(nodes: list[dict[str, Any]], target_id: str) -> dict[str, Any] | None:
    """The node with this id anywhere in a `location/tree` forest."""

    for node in nodes:
        if node.get("id") == target_id:
            return node
        child = find_in_tree(node.get("children") or [], target_id)
        if child:
            return child
    return None
