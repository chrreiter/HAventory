r"""HAventory dev-instance driver: status / send / watch / smoke over the HA WebSocket API.

Agent harness for driving a running Home Assistant instance that has the
haventory integration loaded. It holds ONE authenticated connection for a whole
command sequence, so ids and item versions flow between steps and a subscription
stays open while another window mutates.

Config: HA_BASE_URL / HA_TOKEN are resolved by `dev_env`, which decides between the
`.env` beside this checkout and an inherited export and names the instance on stderr
before every command acts; `smoke` (which creates and deletes) says that it writes.

Usage (from repo root):
  uv run python .claude/skills/run-haventory/driver.py status
  uv run python .claude/skills/run-haventory/driver.py send '{"type":"haventory/ping"}' ...
  uv run python .claude/skills/run-haventory/driver.py watch --count 3
  uv run python .claude/skills/run-haventory/driver.py watch items stats --timeout 60
  uv run python .claude/skills/run-haventory/driver.py smoke

`send` auto-assigns ids and prints one JSON result frame per message.
`watch` subscribes to the four topics — or to the ones named — and prints every
event frame as it arrives. It runs until interrupted; `--count N` stops after N
events and `--timeout SECONDS` after that much wall clock, so a recipe can bound
it. A refused subscribe is printed and exits non-zero, because a watch that
silently subscribed to nothing looks exactly like a backend that broadcasts
nothing.
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
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp

REPO_ROOT = Path(__file__).resolve().parents[3]
RECV_TIMEOUT_S = 20.0
COMMANDS = ("status", "send", "watch", "smoke")
#: Every topic `haventory/subscribe` accepts. `watch` with no topic named takes
#: all of them, so a recipe watching for "anything at all" cannot miss one.
WATCH_TOPICS = ("items", "locations", "stats", "statuses")
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
        message_id = await self.send_only(message)
        while True:
            async with asyncio.timeout(RECV_TIMEOUT_S):
                frame = await self.receive()
            if frame.get("id") == message_id and frame.get("type") == "result":
                return frame
            # Drain unrelated frames (events for other subscriptions etc.)

    async def send_only(self, message: dict[str, Any]) -> int:
        """Send one command frame and answer with its id, waiting for nothing.

        A watcher subscribes to several topics at once: waiting for each result
        in turn would drop any event that arrived for an earlier topic while a
        later subscribe was still outstanding.
        """
        message = dict(message)
        message.setdefault("id", self._next_id)
        message_id = int(message["id"])
        self._next_id = max(self._next_id, message_id) + 1
        await self._ws.send_json(message)
        return message_id

    async def receive(self) -> dict[str, Any]:
        """The next frame on the connection, whatever it is about.

        Unbounded: how long a caller is willing to wait is the caller's, and a
        watch waits as long as it was told to.
        """
        frame = await self._ws.receive_json()
        return frame if isinstance(frame, dict) else {"raw": frame}


async def connect(
    session: aiohttp.ClientSession, base: str, token: str, *, receive_timeout: float | None = 15
) -> HaWs:
    ws = await session.ws_connect(
        dev_env.ws_url(base), timeout=aiohttp.ClientWSTimeout(ws_receive=receive_timeout)
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


@dataclass(frozen=True)
class Watch:
    """What a `watch` run subscribes to and what makes it stop."""

    topics: tuple[str, ...]
    count: int | None
    timeout: float | None


class WatchArgumentError(ValueError):
    """A `watch` invocation this driver cannot act on."""


def parse_watch(args: list[str]) -> Watch:
    """Read `[topic ...] [--count N] [--timeout SECONDS]`.

    Naming no topic means all four rather than none: the mistake worth guarding
    against is a watch that quietly listens to nothing, which is indistinguishable
    from a backend that broadcasts nothing. An unknown topic is refused here
    rather than by the backend, so a typo does not cost a round trip and a
    partially-subscribed connection.
    """

    topics: list[str] = []
    count: int | None = None
    timeout: float | None = None
    remaining = list(args)
    while remaining:
        word = remaining.pop(0)
        if word in {"--count", "--timeout"}:
            if not remaining:
                raise WatchArgumentError(f"{word} needs a value")
            raw = remaining.pop(0)
            try:
                value = float(raw)
            except ValueError:
                raise WatchArgumentError(f"{word} takes a number, not {raw!r}") from None
            if value <= 0:
                raise WatchArgumentError(f"{word} must be positive, not {raw!r}")
            if word == "--count":
                count = int(value)
            else:
                timeout = value
        elif word in WATCH_TOPICS:
            if word not in topics:
                topics.append(word)
        else:
            raise WatchArgumentError(
                f"unknown topic or flag {word!r}; topics are {', '.join(WATCH_TOPICS)}"
            )
    return Watch(tuple(topics) or WATCH_TOPICS, count, timeout)


async def cmd_watch(base: str, token: str, watch: Watch) -> int:
    """Subscribe, then print every event until a bound is reached or Ctrl-C."""

    deadline = None if watch.timeout is None else time.monotonic() + watch.timeout
    pending: dict[int, str] = {}
    seen = 0
    # No per-receive budget: an idle inventory is the normal state of a watch,
    # and aiohttp's default would end the run rather than report quiet.
    async with aiohttp.ClientSession() as session:
        ha = await connect(session, base, token, receive_timeout=None)
        for topic in watch.topics:
            pending[await ha.send_only({"type": "haventory/subscribe", "topic": topic})] = topic
        while pending or watch.count is None or seen < watch.count:
            remaining_s = None if deadline is None else deadline - time.monotonic()
            if remaining_s is not None and remaining_s <= 0:
                break
            try:
                async with asyncio.timeout(remaining_s):
                    frame = await ha.receive()
            except TimeoutError:
                break
            answered = frame.get("id") if frame.get("type") == "result" else None
            topic = pending.pop(answered, None) if isinstance(answered, int) else None
            if topic is not None:
                if not frame.get("success", False):
                    print(json.dumps(frame, indent=2))
                    print(f"[FAIL] subscribe {topic}", file=sys.stderr)
                    return 1
                print(f"[SUB] {topic}", file=sys.stderr)
                continue
            print(json.dumps(frame, indent=2), flush=True)
            if frame.get("type") == "event":
                seen += 1
    print(f"[WATCH] {seen} event(s)", file=sys.stderr)
    return 0


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
    if not args or args[0] not in COMMANDS:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    try:
        watch = parse_watch(args[1:]) if args[0] == "watch" else None
    except WatchArgumentError as exc:
        print(f"watch: {exc}", file=sys.stderr)
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
        elif watch is not None:
            code = asyncio.run(cmd_watch(base, token, watch))
        else:
            code = asyncio.run(cmd_smoke(base, token))
    except SmokeFailure:
        code = 1
    except KeyboardInterrupt:
        code = 130
    except (TimeoutError, aiohttp.ClientError) as exc:
        print(f"Connection error: {exc} (is HA up at {base}?)", file=sys.stderr)
        code = 3
    sys.exit(code)


if __name__ == "__main__":
    main()
