# ruff: noqa
# Exploratory agent stress harness — deliberately NOT held to the product lint gate.
r"""HAventory online stress-test regimen (adversarial "break-it" driver).

Robust, connection-per-worker WS client (applies the scripts/stress_test.py review
guardrails: one connection per concurrent task; send_no_wait + dedup-by-id for
in-flight bursts; no count-tolerance oracles; every send wrapped). Every
scenario prefixes its data with `stress_test_` so `cleanup` can sweep it, and
polls `haventory/health` before/after as the pass gate.

Subcommands (run one at a time; non-destructive first, `restart` last):
  baseline     health + version snapshot
  fuzz         adversarial malformed single-mutation inputs (+ dataset-untouched oracle)
  bulkfuzz     adversarial haventory/items/bulk (whole-batch + per-op + dup op_id)
  subteardown  Fix #2: HA-core unsubscribe_events + dedicated unsubscribe teardown
  statsprobe   subscribe stats, mutate on another conn, count broadcast events
  ratelimit    enable a tight per-conn budget via the options flow, hammer, disable
  bulk [N]     bulk create scale 250->500->1000 (latency curve) + bulk delete (default 1000)
  races        rename->version invalidation, concurrent rename, adjust serialization
  hammer [SECS] background mixed-op storm for the UI-under-load layer (default 60s)
  restart      DESTRUCTIVE: mid-load storm + docker restart + on-disk store cross-check
  cleanup      delete everything with the stress_test_ prefix

Config from the .env beside this checkout (HA_BASE_URL, HA_TOKEN), which wins over
an inherited export -- a worktree's .env names the instance that worktree is for.
HAVENTORY_IGNORE_ENV_FILE=1 hands the decision back to the environment for one run.
Every command prints the resolved target and the store's counts before it acts, and
a command that writes says so and proceeds without prompting. HA_CONTAINER (default
"home-assistant") is only needed by `restart`. Set HAVENTORY_REPO to override which
checkout's .env is read (otherwise derived from this file's location).

Run:  uv run --no-project --with aiohttp python .claude/skills/test-haventory/stress.py <cmd> [args]
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import statistics
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import aiohttp

PREFIX = "stress_test_"
# This file's committed location is <repo>/.claude/skills/test-haventory/, so it
# always knows its own checkout -- that is where the shared target resolution
# lives, and it is read from there even when HAVENTORY_REPO points the .env
# lookup at a different tree.
CHECKOUT = Path(__file__).resolve().parents[3]
_env_repo = os.environ.get("HAVENTORY_REPO")
REPO_ROOT = Path(_env_repo) if _env_repo else CHECKOUT
sys.path.insert(0, str(CHECKOUT / "scripts"))

import dev_env

# Every command mutates the instance except these two: `baseline` reads health and
# version, `subteardown` only subscribes and unsubscribes. The rest create or delete
# stress_test_-prefixed fixtures, rewrite the rate-limit options through the config
# flow, or restart the container.
READ_ONLY_COMMANDS = frozenset({"baseline", "subteardown"})


class WSConn:
    """One authenticated HA WS connection, used by ONE task at a time."""

    def __init__(self, session: aiohttp.ClientSession, ws: aiohttp.ClientWebSocketResponse):
        self._session = session
        self._ws = ws
        self._next_id = 1

    def _id(self) -> int:
        i = self._next_id
        self._next_id += 1
        return i

    async def call(self, type_: str, timeout: float = 30.0, **payload: Any) -> dict:
        """Send one command; return its result frame (success or error). Skips events."""
        mid = self._id()
        msg = {"id": mid, "type": type_, **payload}
        await self._ws.send_json(msg)
        while True:
            frame = await asyncio.wait_for(self._ws.receive_json(), timeout=timeout)
            if isinstance(frame, dict) and frame.get("id") == mid and frame.get("type") == "result":
                return frame

    async def call_raw(self, msg: dict, timeout: float = 30.0) -> dict:
        """Send a raw message dict (id auto-filled); return its result frame."""
        mid = self._id()
        msg = {**msg, "id": mid}
        await self._ws.send_json(msg)
        while True:
            frame = await asyncio.wait_for(self._ws.receive_json(), timeout=timeout)
            if isinstance(frame, dict) and frame.get("id") == mid and frame.get("type") == "result":
                return frame

    async def send_no_wait(self, type_: str, **payload: Any) -> int:
        mid = self._id()
        await self._ws.send_json({"id": mid, "type": type_, **payload})
        return mid

    async def collect(self, ids: set[int], timeout: float = 60.0) -> dict[int, dict]:
        """Drain result frames until every id in `ids` is seen (dedup-by-id)."""
        out: dict[int, dict] = {}
        deadline = time.monotonic() + timeout
        while len(out) < len(ids):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            frame = await asyncio.wait_for(self._ws.receive_json(), timeout=remaining)
            if isinstance(frame, dict) and frame.get("type") == "result":
                fid = frame.get("id")
                if fid in ids and fid not in out:
                    out[fid] = frame
        return out

    async def close(self) -> None:
        try:
            await self._ws.close()
        finally:
            await self._session.close()


async def connect() -> WSConn:
    base = os.environ["HA_BASE_URL"]
    token = os.environ["HA_TOKEN"]
    session = aiohttp.ClientSession()
    # The session is this function's to own until a WSConn takes it: every failure
    # path has to close it. Callers legitimately retry connect() against an HA that
    # is down (the restart layer's ready-poll) and swallow the failure, so an
    # abandoned session there surfaces as an "Unclosed client session" warning — and
    # the log sweep is an oracle whose value is that a clean run is silent.
    try:
        ws = await session.ws_connect(
            dev_env.ws_url(base), timeout=aiohttp.ClientWSTimeout(ws_receive=20)
        )
        await asyncio.wait_for(ws.receive_json(), timeout=20)  # hello
        await ws.send_json({"type": "auth", "access_token": token})
        auth = await asyncio.wait_for(ws.receive_json(), timeout=20)
        if auth.get("type") != "auth_ok":
            raise RuntimeError(f"auth failed: {auth}")
    except BaseException:
        await session.close()
        raise
    return WSConn(session, ws)


# ----------------------------------------------------------------------------- helpers


@contextlib.asynccontextmanager
async def keepalive(conn: WSConn, interval: float = 30.0):
    """Keep an otherwise idle control connection alive across a long workload.

    aiohttp only answers the server's WebSocket pings while a receive() is in
    flight. Nothing awaits the control connection while the workers run, so HA
    closes it after ~90s and the post-run health check dies with
    ClientConnectionResetError("Cannot write to closing transport") — which reads
    as a backend fault and is not one. Pumping a cheap command keeps a receive()
    in flight.

    Nothing else may use `conn` for the duration: WSConn is single-task by
    design, and two callers interleaving on one socket would cross their frames.
    """

    async def _pump() -> None:
        while True:
            await asyncio.sleep(interval)
            await conn.call("haventory/ping")

    task = asyncio.create_task(_pump())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def health(conn: WSConn) -> dict:
    return (await conn.call("haventory/health"))["result"]


async def assert_healthy(conn: WSConn, phase: str) -> dict:
    h = await health(conn)
    ok = h.get("healthy") is True and h.get("issues") == []
    tag = "PASS" if ok else "**FAIL**"
    print(
        f"  [oracle {tag}] {phase}: healthy={h.get('healthy')} issues={h.get('issues')} "
        f"gen={h.get('generation')} counts={h.get('counts')}"
    )
    if not ok:
        raise SystemExit(f"HEALTH ORACLE FAILED at {phase}: {json.dumps(h)}")
    return h


async def list_all_items(conn: WSConn) -> list[dict]:
    items: list[dict] = []
    cursor = None
    while True:
        payload: dict[str, Any] = {"limit": 200}
        if cursor:
            payload["cursor"] = cursor
        r = (await conn.call("haventory/item/list", **payload))["result"]
        items.extend(r.get("items", []))
        cursor = r.get("next_cursor")
        if not cursor:
            break
    return items


async def list_all_locations(conn: WSConn) -> list[dict]:
    r = (await conn.call("haventory/location/list"))["result"]
    if isinstance(r, dict):
        return r.get("locations", r.get("items", []))
    return r


async def cleanup_prefix(conn: WSConn) -> tuple[int, int]:
    items = await list_all_items(conn)
    di = 0
    for it in items:
        if str(it.get("name", "")).startswith(PREFIX):
            fr = await conn.call("haventory/item/delete", item_id=it["id"])
            if fr.get("success"):
                di += 1
            else:
                print(f"  cleanup: item delete failed {it['id']}: {fr.get('error')}")
    locs = await list_all_locations(conn)

    # deepest-first: sort by id_path length desc
    def depth(loc: dict) -> int:
        p = loc.get("path", {})
        return len(p.get("id_path", [])) if isinstance(p, dict) else 0

    dl = 0
    for loc in sorted(locs, key=depth, reverse=True):
        if str(loc.get("name", "")).startswith(PREFIX):
            fr = await conn.call("haventory/location/delete", location_id=loc["id"])
            if fr.get("success"):
                dl += 1
            else:
                print(f"  cleanup: loc delete failed {loc['id']}: {fr.get('error')}")
    return di, dl


# ----------------------------------------------------------------------------- baseline


async def cmd_baseline() -> None:
    conn = await connect()
    try:
        v = (await conn.call("haventory/version"))["result"]
        print(f"version: {v}")
        await assert_healthy(conn, "baseline")
    finally:
        await conn.close()


# ----------------------------------------------------------------------------- fuzz


def _rand_uuid4() -> str:
    return str(uuid.uuid4())


async def cmd_fuzz() -> None:
    conn = await connect()
    results: list[tuple[str, str, str, str]] = []  # (case, expected, actual, verdict)
    try:
        print("== FUZZ: adversarial malformed inputs ==")
        before = await assert_healthy(conn, "fuzz/before")
        gen0 = before["generation"]
        counts0 = before["counts"]

        missing_uuid = _rand_uuid4()

        # (label, message, expected_codes_set)  -- negatives that must NOT mutate
        neg: list[tuple[str, dict, set[str]]] = [
            (
                "empty name",
                {"type": "haventory/item/create", "name": ""},
                {"validation_error", "invalid_format"},
            ),
            ("blank name", {"type": "haventory/item/create", "name": "   "}, {"validation_error"}),
            (
                "121-char name",
                {"type": "haventory/item/create", "name": "x" * 121},
                {"validation_error"},
            ),
            (
                "qty -1",
                {"type": "haventory/item/create", "name": PREFIX + "q", "quantity": -1},
                {"validation_error"},
            ),
            (
                "qty bool",
                {"type": "haventory/item/create", "name": PREFIX + "q", "quantity": True},
                {"validation_error", "invalid_format"},
            ),
            (
                "qty float",
                {"type": "haventory/item/create", "name": PREFIX + "q", "quantity": 1.5},
                {"validation_error", "invalid_format"},
            ),
            (
                "threshold -1",
                {"type": "haventory/item/create", "name": PREFIX + "t", "low_stock_threshold": -1},
                {"validation_error"},
            ),
            (
                "threshold 1.5",
                {"type": "haventory/item/create", "name": PREFIX + "t", "low_stock_threshold": 1.5},
                {"validation_error", "invalid_format"},
            ),
            (
                "date feb30",
                {
                    "type": "haventory/item/create",
                    "name": PREFIX + "d",
                    "checked_out": True,
                    "due_date": "2024-02-30",
                },
                {"validation_error"},
            ),
            (
                "date month13",
                {
                    "type": "haventory/item/create",
                    "name": PREFIX + "d",
                    "checked_out": True,
                    "due_date": "2024-13-01",
                },
                {"validation_error"},
            ),
            (
                "date badfmt",
                {
                    "type": "haventory/item/create",
                    "name": PREFIX + "d",
                    "checked_out": True,
                    "due_date": "20240101",
                },
                {"validation_error"},
            ),
            (
                "due without checkout",
                {"type": "haventory/item/create", "name": PREFIX + "d", "due_date": "2024-01-01"},
                {"validation_error"},
            ),
            (
                "cf empty key",
                {"type": "haventory/item/create", "name": PREFIX + "c", "custom_fields": {"": 1}},
                {"validation_error"},
            ),
            (
                "cf nonscalar",
                {
                    "type": "haventory/item/create",
                    "name": PREFIX + "c",
                    "custom_fields": {"k": [1, 2]},
                },
                {"validation_error", "invalid_format"},
            ),
            (
                "loc bad uuid",
                {
                    "type": "haventory/item/create",
                    "name": PREFIX + "l",
                    "location_id": "not-a-uuid",
                },
                {"validation_error"},
            ),
            (
                "loc missing uuid",
                {
                    "type": "haventory/item/create",
                    "name": PREFIX + "l",
                    "location_id": missing_uuid,
                },
                {"not_found", "validation_error"},
            ),
            (
                "name omitted (schema)",
                {"type": "haventory/item/create"},
                {"invalid_format", "validation_error"},
            ),
            (
                "get bad id",
                {"type": "haventory/item/get", "item_id": "not-a-uuid"},
                {"validation_error", "not_found"},
            ),
            (
                "get missing id",
                {"type": "haventory/item/get", "item_id": missing_uuid},
                {"not_found"},
            ),
            (
                "cursor garbage",
                {"type": "haventory/item/list", "cursor": "garbage"},
                {"validation_error", "OK"},
            ),
            (
                "cursor empty",
                {"type": "haventory/item/list", "cursor": ""},
                {"validation_error", "OK"},
            ),
            (
                "cursor b64 junk",
                {"type": "haventory/item/list", "cursor": "eyJmb28iOiJiYXIifQ=="},
                {"validation_error", "OK"},
            ),
            (
                "subscribe bad topic",
                {"type": "haventory/subscribe", "topic": "bogus"},
                {"validation_error"},
            ),
            (
                "update missing item",
                {"type": "haventory/item/update", "item_id": missing_uuid, "description": "x"},
                {"not_found"},
            ),
            (
                "adjust bad delta",
                {
                    "type": "haventory/item/adjust_quantity",
                    "item_id": missing_uuid,
                    "delta": "lots",
                },
                {"validation_error", "invalid_format", "not_found"},
            ),
        ]

        for label, msg, expected in neg:
            try:
                fr = await conn.call_raw(msg, timeout=20)
            except Exception as exc:  # noqa: BLE001
                results.append(
                    (label, "/".join(sorted(expected)), f"EXC:{type(exc).__name__}", "**FAIL**")
                )
                continue
            if fr.get("success"):
                # A create that unexpectedly succeeded: record + remember to clean up
                actual = "SUCCESS"
                verdict = "OK" if "OK" in expected else "**UNEXPECTED-SUCCESS**"
            else:
                actual = fr.get("error", {}).get("code", "?")
                if actual == "unknown_error":
                    verdict = "**UNKNOWN_ERROR**"
                elif actual in expected:
                    verdict = "PASS"
                else:
                    verdict = f"?? (got {actual})"
            results.append((label, "/".join(sorted(expected)), actual, verdict))

        # oversized payloads
        big_desc = "A" * 1_000_000
        fr = await conn.call(
            "haventory/item/create", name=PREFIX + "big", description=big_desc, timeout=40
        )
        big_code = "SUCCESS" if fr.get("success") else fr.get("error", {}).get("code", "?")
        big_verdict = "**UNKNOWN_ERROR**" if big_code == "unknown_error" else "OK(accept/reject)"
        results.append(("1MB description", "no-crash", big_code, big_verdict))
        big_id = fr["result"]["id"] if fr.get("success") else None

        many_cf = {f"k{i}": i for i in range(1000)}
        fr = await conn.call(
            "haventory/item/create", name=PREFIX + "manycf", custom_fields=many_cf, timeout=40
        )
        cf_code = "SUCCESS" if fr.get("success") else fr.get("error", {}).get("code", "?")
        cf_verdict = "**UNKNOWN_ERROR**" if cf_code == "unknown_error" else "OK(accept/reject)"
        results.append(("1000-key custom_fields", "no-crash", cf_code, cf_verdict))
        cf_id = fr["result"]["id"] if fr.get("success") else None

        # positive boundary: exactly 120 chars must succeed
        fr = await conn.call("haventory/item/create", name=PREFIX + "x" * (120 - len(PREFIX)))
        b_ok = fr.get("success")
        results.append(
            (
                "120-char name (boundary)",
                "SUCCESS",
                "SUCCESS" if b_ok else fr.get("error", {}).get("code", "?"),
                "PASS" if b_ok else "**FAIL**",
            )
        )
        b_id = fr["result"]["id"] if b_ok else None

        # clean up any items the positive/oversized cases created
        for iid in (big_id, cf_id, b_id):
            if iid:
                await conn.call("haventory/item/delete", item_id=iid)

        # dataset-untouched oracle: negatives must not have mutated anything
        after = await health(conn)
        gen1 = after["generation"]
        counts1 = after["counts"]
        # generation may move only due to the positive-case create+delete we did (b_id/big/cf); those were cleaned.
        # Assert item/location counts returned to baseline.
        counts_ok = counts1.get("items_total") == counts0.get("items_total") and counts1.get(
            "locations_total"
        ) == counts0.get("locations_total")

        print(
            "\n  case                         expected                         actual              verdict"
        )
        print("  " + "-" * 100)
        for label, exp, act, verd in results:
            print(f"  {label:<28} {exp:<32} {act:<19} {verd}")
        print(f"\n  generation: {gen0} -> {gen1}")
        print(
            f"  counts baseline vs after: {counts0} vs {counts1}  ({'MATCH' if counts_ok else '**MISMATCH**'})"
        )

        unknowns = [r for r in results if "UNKNOWN_ERROR" in r[3]]
        unexpected_success = [r for r in results if "UNEXPECTED-SUCCESS" in r[3]]
        fails = [r for r in results if "FAIL" in r[3]]
        print(
            f"\n  unknown_error cases: {len(unknowns)}  unexpected-success: {len(unexpected_success)}  hard-fails: {len(fails)}"
        )
        await assert_healthy(conn, "fuzz/after")
    finally:
        await cleanup_prefix(conn)
        await conn.close()


# ----------------------------------------------------------------------------- rate limit

RL_DEFAULTS = {
    "rate_limit_commands_per_second": 20.0,
    "rate_limit_commands_burst": 60.0,
    "rate_limit_global_commands_per_second": 100.0,
    "rate_limit_global_commands_burst": 200.0,
    "rate_limit_events_per_second": 50.0,
    "rate_limit_events_burst": 200.0,
    "rate_limit_global_events_per_second": 500.0,
    "rate_limit_global_events_burst": 1000.0,
}


async def _http(
    session: aiohttp.ClientSession, method: str, path: str, body: dict | None = None
) -> Any:
    base = os.environ["HA_BASE_URL"].rstrip("/")
    token = os.environ["HA_TOKEN"]
    headers = {"Authorization": f"Bearer {token}"}
    async with session.request(
        method, base + path, headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=20)
    ) as resp:
        text = await resp.text()
        try:
            return json.loads(text)
        except Exception:  # noqa: BLE001
            return {"_status": resp.status, "_text": text}


async def find_entry_id(session: aiohttp.ClientSession) -> str:
    entries = await _http(session, "GET", "/api/config/config_entries/entry")
    if isinstance(entries, dict) and "_status" in entries:
        raise RuntimeError(f"list entries failed: {entries}")
    for e in entries:
        if e.get("domain") == "haventory":
            return e["entry_id"]
    raise RuntimeError("no haventory config entry found")


async def set_rate_limit(
    session: aiohttp.ClientSession, *, enabled: bool, **overrides: float
) -> dict:
    entry_id = await find_entry_id(session)
    flow = await _http(
        session,
        "POST",
        "/api/config/config_entries/options/flow",
        {"handler": entry_id, "show_advanced_options": False},
    )
    flow_id = flow.get("flow_id")
    if not flow_id:
        raise RuntimeError(f"could not start options flow: {flow}")

    # The form groups the rate-limit knobs into a section, so they must be submitted nested
    # under that section's name rather than flat, and every top-level key is required — a
    # partial submit is rejected with "required key not provided". HA seeds each field's
    # `default` (or, for an optional field such as the to-do list entity, its
    # `suggested_value`) from the entry's current options, so echoing the returned schema
    # back preserves the settings this layer is not trying to change. The knobs go into
    # the one section that holds them: the form has other sections, and a key they do not
    # declare is rejected as "extra keys not allowed". A field with no value is left out
    # rather than sent as null — the flow reads an absent optional key as "unset".
    def _value(field: dict[str, Any]) -> Any:
        suggested = (field.get("description") or {}).get("suggested_value")
        return field.get("default") if suggested is None else suggested

    user_input: dict[str, Any] = {}
    for field in flow.get("data_schema", []):
        if field.get("type") == "expandable":
            section = {
                f["name"]: _value(f) for f in field.get("schema", []) if _value(f) is not None
            }
            if any(f["name"] == "rate_limit_enabled" for f in field.get("schema", [])):
                section.update({"rate_limit_enabled": enabled, **RL_DEFAULTS, **overrides})
            user_input[field["name"]] = section
        else:
            user_input[field["name"]] = _value(field)

    res = await _http(
        session, "POST", f"/api/config/config_entries/options/flow/{flow_id}", user_input
    )
    if res.get("errors"):
        raise RuntimeError(f"options flow rejected the submit: {res['errors']}")
    return res


async def wait_rl_state(want: bool, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            c = await connect()
            try:
                h = await health(c)
            finally:
                await c.close()
            if h.get("rate_limit", {}).get("enabled") is want:
                return True
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(1.5)
    return False


async def cmd_ratelimit() -> None:
    control = await connect()
    session = aiohttp.ClientSession()
    try:
        print("== RATE LIMIT: enable/disable ==")
        h0 = await health(control)
        print(f"  baseline rate_limit={h0.get('rate_limit')}")
        assert h0["rate_limit"]["enabled"] is False, "expected rate limiting OFF at baseline"

        # enable with a tight PER-CONNECTION command budget; keep globals generous
        print("\n  enabling: per-conn commands 5/s burst 5; globals 1000/2000 ...")
        res = await set_rate_limit(
            session,
            enabled=True,
            rate_limit_commands_per_second=5.0,
            rate_limit_commands_burst=5.0,
            rate_limit_global_commands_per_second=1000.0,
            rate_limit_global_commands_burst=2000.0,
        )
        print(f"  options-flow result type={res.get('type')}")
        ok = await wait_rl_state(True, 30)
        print(f"  rate_limit enabled now: {ok} {'PASS' if ok else '**FAIL**'}")
        # Everything below asserts on enforcement, which is vacuously satisfied when the
        # limiter never came up — so stop here rather than report a green run.
        assert ok, "rate limiting did not turn on; enforcement checks below would be vacuous"

        h_pre = await health(control)
        dropped_pre = h_pre["rate_limit"]["dropped_commands"]

        # hammer one connection well past the burst
        hammer = await connect()
        M = 40
        unique = f"{PREFIX}rl_create_{uuid.uuid4().hex[:8]}"
        ids: set[int] = set()
        # exhaust the per-conn bucket FIRST, then attempt the mutation so it is blocked
        for _ in range(M):
            ids.add(await hammer.send_no_wait("haventory/ping"))
        create_id = await hammer.send_no_wait("haventory/item/create", name=unique, quantity=1)
        ids.add(create_id)
        frames = await hammer.collect(ids, timeout=30)
        rate_limited = sum(
            1
            for f in frames.values()
            if not f.get("success") and f.get("error", {}).get("code") == "rate_limited"
        )
        succeeded = sum(1 for f in frames.values() if f.get("success"))
        # envelope shape check on one rate_limited frame
        sample = next(
            (
                f
                for f in frames.values()
                if not f.get("success") and f.get("error", {}).get("code") == "rate_limited"
            ),
            None,
        )
        print(f"\n  hammer {M + 1} commands: succeeded={succeeded} rate_limited={rate_limited}")
        print(
            f"  sample rate_limited envelope: {json.dumps(sample.get('error')) if sample else 'NONE'}"
        )

        # did the rate-limited create actually NOT mutate?
        create_frame = frames.get(create_id, {})
        create_blocked = (not create_frame.get("success")) and create_frame.get("error", {}).get(
            "code"
        ) == "rate_limited"
        listed = (await control.call("haventory/item/list", filter={"q": unique}))["result"][
            "items"
        ]
        created_item = next((it for it in listed if it.get("name") == unique), None)
        if create_blocked:
            print(
                f"  rate-limited create left no item: {'PASS' if created_item is None else '**FAIL (item exists!)**'}"
            )
        else:
            print(f"  (create was not blocked; cleaning up) exists={created_item is not None}")
            if created_item:
                await control.call("haventory/item/delete", item_id=created_item["id"])

        # drop counter increased while still enabled
        h_mid = await health(control)
        dropped_mid = h_mid["rate_limit"]["dropped_commands"]
        print(
            f"  dropped_commands {dropped_pre} -> {dropped_mid} (delta {dropped_mid - dropped_pre}) "
            f"{'PASS' if dropped_mid - dropped_pre >= rate_limited else '**MISMATCH**'}"
        )
        await hammer.close()

        # disable and confirm recovery
        print("\n  disabling ...")
        res = await set_rate_limit(session, enabled=False)
        print(f"  options-flow result type={res.get('type')}")
        ok = await wait_rl_state(False, 30)
        print(f"  rate_limit disabled now: {ok} {'PASS' if ok else '**FAIL**'}")

        hammer2 = await connect()
        ids2: set[int] = set()
        for _ in range(M):
            ids2.add(await hammer2.send_no_wait("haventory/ping"))
        frames2 = await hammer2.collect(ids2, timeout=30)
        rl2 = sum(
            1
            for f in frames2.values()
            if not f.get("success") and f.get("error", {}).get("code") == "rate_limited"
        )
        print(
            f"  post-disable hammer {M} pings: rate_limited={rl2} "
            f"{'PASS (full recovery)' if rl2 == 0 else '**STILL LIMITED**'}"
        )
        await hammer2.close()
        await assert_healthy(control, "ratelimit/after")
    finally:
        # ensure rate limiting is left OFF even on failure
        try:
            await set_rate_limit(session, enabled=False)
        except Exception as exc:  # noqa: BLE001
            print(f"  WARN: could not reset rate limit off: {exc}")
        await session.close()
        await cleanup_prefix(control)
        await control.close()


# ----------------------------------------------------------------------------- bulk fuzz


async def cmd_bulkfuzz() -> None:
    conn = await connect()
    try:
        print("== BULK FUZZ: haventory/items/bulk adversarial ==")
        await assert_healthy(conn, "bulkfuzz/before")
        # three real targets
        ids = []
        for i in range(3):
            it = (await conn.call("haventory/item/create", name=f"{PREFIX}bf_{i}", quantity=5))[
                "result"
            ]
            ids.append((it["id"], it["version"]))
        missing = _rand_uuid4()

        print("\n  -- whole-batch rejects (expect success:false, nothing applied) --")
        whole_batch = [
            ("operations not a list", {"type": "haventory/items/bulk", "operations": "nope"}),
            (
                "op missing op_id",
                {
                    "type": "haventory/items/bulk",
                    "operations": [{"kind": "item_delete", "payload": {"item_id": ids[0][0]}}],
                },
            ),
            (
                "op_id not str/int",
                {
                    "type": "haventory/items/bulk",
                    "operations": [
                        {"op_id": [1], "kind": "item_delete", "payload": {"item_id": ids[0][0]}}
                    ],
                },
            ),
            (
                "kind not string",
                {
                    "type": "haventory/items/bulk",
                    "operations": [{"op_id": "a", "kind": 5, "payload": {}}],
                },
            ),
            (
                "payload not object",
                {
                    "type": "haventory/items/bulk",
                    "operations": [{"op_id": "a", "kind": "item_delete", "payload": "x"}],
                },
            ),
        ]
        for label, msg in whole_batch:
            fr = await conn.call_raw(msg, timeout=20)
            code = "SUCCESS" if fr.get("success") else fr.get("error", {}).get("code", "?")
            verdict = (
                "PASS"
                if code in ("validation_error", "invalid_format")
                else ("**UNKNOWN_ERROR**" if code == "unknown_error" else f"?? {code}")
            )
            print(f"  {label:<24} -> {code:<18} {verdict}")

        print("\n  -- per-op failures (expect batch success:true, per-op errors, others apply) --")
        ops = [
            {
                "op_id": "ok1",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": ids[0][0], "delta": 1},
            },
            {"op_id": "unknown_kind", "kind": "item_create", "payload": {"name": "x"}},
            {"op_id": "frob", "kind": "frobnicate", "payload": {}},
            {"op_id": "badid", "kind": "item_delete", "payload": {"item_id": missing}},
            {
                "op_id": "conflict",
                "kind": "item_update",
                "payload": {"item_id": ids[1][0], "expected_version": 999, "description": "z"},
            },
            {
                "op_id": "ok2",
                "kind": "item_set_quantity",
                "payload": {"item_id": ids[2][0], "quantity": 10},
            },
        ]
        fr = await conn.call("haventory/items/bulk", operations=ops, timeout=30)
        print(f"  batch success={fr.get('success')}")
        res = fr.get("result", {}).get("results", {}) if fr.get("success") else {}
        for op_id, outcome in res.items():
            if outcome.get("success"):
                print(f"    {op_id:<14} OK")
            else:
                print(f"    {op_id:<14} error={outcome.get('error', {}).get('code')}")
        # verify the OK ops actually applied
        it0 = (await conn.call("haventory/item/get", item_id=ids[0][0]))["result"]
        it2 = (await conn.call("haventory/item/get", item_id=ids[2][0]))["result"]
        print(
            f"  ok1 applied (qty 5->6): {it0['quantity']}  ok2 applied (qty->10): {it2['quantity']}"
        )

        print("\n  -- duplicate op_ids (results dict -> last-wins, silent loss) --")
        dup = [
            {
                "op_id": "same",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": ids[0][0], "delta": 1},
            },
            {
                "op_id": "same",
                "kind": "item_adjust_quantity",
                "payload": {"item_id": ids[0][0], "delta": 1},
            },
            {"op_id": "same", "kind": "item_delete", "payload": {"item_id": missing}},
        ]
        fr = await conn.call("haventory/items/bulk", operations=dup, timeout=30)
        res = fr.get("result", {}).get("results", {}) if fr.get("success") else {}
        print(
            f"  sent 3 ops with same op_id; results entries={len(res)} "
            f"({'DOCUMENTED silent per-op loss' if len(res) < 3 else 'all present'})"
        )
        print(f"  result for 'same': {res.get('same')}")

        # cleanup targets
        for iid, _ in ids:
            await conn.call("haventory/item/delete", item_id=iid)
        await assert_healthy(conn, "bulkfuzz/after")
    finally:
        await cleanup_prefix(conn)
        await conn.close()


# ----------------------------------------------------------------------------- bulk


async def _create_worker(
    conn: WSConn,
    names: list[str],
    loc_id: str | None,
    latencies: list[float],
    ids: list[str],
    errors: list[dict],
) -> None:
    for nm in names:
        t0 = time.monotonic()
        try:
            payload: dict[str, Any] = {"name": nm, "quantity": 1}
            if loc_id:
                payload["location_id"] = loc_id
            fr = await conn.call("haventory/item/create", timeout=45, **payload)
        except Exception as exc:  # noqa: BLE001
            errors.append({"name": nm, "exc": f"{type(exc).__name__}: {exc}"})
            continue
        dt = (time.monotonic() - t0) * 1000.0
        latencies.append(dt)
        if fr.get("success"):
            ids.append(fr["result"]["id"])
        else:
            errors.append({"name": nm, "error": fr.get("error")})


def _pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    xs2 = sorted(xs)
    k = min(len(xs2) - 1, int(round((p / 100.0) * (len(xs2) - 1))))
    return xs2[k]


async def cmd_bulk(target: int = 1000, conns: int = 8) -> None:
    control = await connect()
    pool: list[WSConn] = []
    try:
        print(f"== BULK: create scale to {target} across {conns} connections ==")
        before = await assert_healthy(control, "bulk/before")
        gen0 = before["generation"]
        items0 = before["counts"]["items_total"]

        pool = [await connect() for _ in range(conns)]

        checkpoints = [c for c in (250, 500, 1000, 2000) if c <= target]
        if target not in checkpoints:
            checkpoints.append(target)
        created_total: list[str] = []
        all_latencies: list[float] = []
        prev = 0
        for cp in checkpoints:
            n = cp - prev
            prev = cp
            names = [f"{PREFIX}bulk_{i:05d}_{uuid.uuid4().hex[:8]}" for i in range(cp - n, cp)]
            # shard names across connections
            shards: list[list[str]] = [[] for _ in range(conns)]
            for idx, nm in enumerate(names):
                shards[idx % conns].append(nm)
            lat: list[float] = []
            ids: list[str] = []
            errs: list[dict] = []
            t0 = time.monotonic()
            async with keepalive(control):
                await asyncio.gather(
                    *[
                        _create_worker(pool[i], shards[i], None, lat, ids, errs)
                        for i in range(conns)
                    ]
                )
            wall = time.monotonic() - t0
            created_total.extend(ids)
            all_latencies.extend(lat)
            print(
                f"  [{cp:>4} items] +{n} created={len(ids)} errors={len(errs)} "
                f"wall={wall:6.2f}s  p50={_pct(lat, 50):7.1f}ms p95={_pct(lat, 95):7.1f}ms "
                f"p99={_pct(lat, 99):7.1f}ms max={max(lat) if lat else 0:7.1f}ms"
            )
            if errs:
                print(f"    first errors: {errs[:3]}")

        # uniqueness + generation oracle
        uniq = len(set(created_total))
        after = await health(control)
        gen1 = after["generation"]
        items1 = after["counts"]["items_total"]
        print(
            f"\n  created={len(created_total)} unique={uniq} "
            f"({'OK' if uniq == len(created_total) else '**DUP IDS**'})"
        )
        print(
            f"  items_total {items0} -> {items1} (delta {items1 - items0}, expected {len(created_total)}) "
            f"{'OK' if items1 - items0 == len(created_total) else '**MISMATCH**'}"
        )
        print(f"  generation {gen0} -> {gen1} (delta {gen1 - gen0})")
        # scaling-cliff signal
        print(f"  latency growth (cliff signal): p95 first-250 vs last bucket printed above")
        await assert_healthy(control, "bulk/after-create")

        # bulk delete
        print("\n== BULK: delete all created across connections ==")
        del_shards: list[list[str]] = [[] for _ in range(conns)]
        for idx, iid in enumerate(created_total):
            del_shards[idx % conns].append(iid)
        del_ok = [0]
        del_err: list[dict] = []

        async def _del_worker(conn: WSConn, ids: list[str]) -> None:
            for iid in ids:
                try:
                    fr = await conn.call("haventory/item/delete", timeout=45, item_id=iid)
                except Exception as exc:  # noqa: BLE001
                    del_err.append({"id": iid, "exc": str(exc)})
                    continue
                if fr.get("success"):
                    del_ok[0] += 1
                else:
                    del_err.append({"id": iid, "error": fr.get("error")})

        t0 = time.monotonic()
        async with keepalive(control):
            await asyncio.gather(*[_del_worker(pool[i], del_shards[i]) for i in range(conns)])
        wall = time.monotonic() - t0
        after2 = await health(control)
        print(f"  deleted={del_ok[0]} errors={len(del_err)} wall={wall:.2f}s")
        print(
            f"  items_total now {after2['counts']['items_total']} (baseline {items0}) "
            f"{'OK' if after2['counts']['items_total'] == items0 else '**LEFTOVER**'}"
        )
        if del_err:
            print(f"    first delete errors: {del_err[:3]}")
        await assert_healthy(control, "bulk/after-delete")
    finally:
        for c in pool:
            await c.close()
        await cleanup_prefix(control)
        await control.close()


# ----------------------------------------------------------------------------- races


async def cmd_races() -> None:
    control = await connect()
    a = await connect()
    b = await connect()
    try:
        print("== RACE 1: location rename leaves subtree item versions valid ==")
        await assert_healthy(control, "races/before")
        loc = (await control.call("haventory/location/create", name=PREFIX + "race_loc"))["result"]
        loc_id = loc["id"]
        item_versions: dict[str, int] = {}
        for i in range(20):
            it = (
                await control.call(
                    "haventory/item/create",
                    name=f"{PREFIX}race_it_{i}",
                    location_id=loc_id,
                    quantity=1,
                )
            )["result"]
            item_versions[it["id"]] = it["version"]
        first_id = next(iter(item_versions))
        held_v = item_versions[first_id]

        # rename the location on conn A
        ren = await a.call(
            "haventory/location/update", location_id=loc_id, name=PREFIX + "race_loc_renamed"
        )
        print(f"  rename success={ren.get('success')}")

        # conn B updates an item with the version it read before the rename
        upd = await b.call(
            "haventory/item/update",
            item_id=first_id,
            expected_version=held_v,
            description="post-rename",
        )
        code = upd.get("error", {}).get("code") if not upd.get("success") else "SUCCESS"
        print(
            f"  item/update with pre-rename expected_version -> {code} "
            f"({'OK, token survived the rename' if code == 'SUCCESS' else '**INVALIDATED**'})"
        )

        # The path rewrite is derived data: every subtree item keeps the version
        # it had before the rename. The one just updated is the exception —
        # that was a real mutation — and every path must carry the new name.
        held = 0
        repathed = 0
        for iid, v0 in item_versions.items():
            cur = (await control.call("haventory/item/get", item_id=iid))["result"]
            expected = v0 + 1 if iid == first_id and code == "SUCCESS" else v0
            if cur["version"] == expected:
                held += 1
            if "race_loc_renamed" in cur["location_path"]["display_path"]:
                repathed += 1
        print(
            f"  subtree items keeping their version: {held}/{len(item_versions)} "
            f"{'OK' if held == len(item_versions) else '**BUMPED**'}"
        )
        print(
            f"  subtree items carrying the new path: {repathed}/{len(item_versions)} "
            f"{'OK' if repathed == len(item_versions) else '**STALE PATH**'}"
        )
        await assert_healthy(control, "races/after-rename")

        print("\n== RACE 2: concurrent rename of same location (no locking -> last-writer-wins) ==")
        r1, r2 = await asyncio.gather(
            a.call("haventory/location/update", location_id=loc_id, name=PREFIX + "concurrent_A"),
            b.call("haventory/location/update", location_id=loc_id, name=PREFIX + "concurrent_B"),
        )
        final = (await control.call("haventory/location/get", location_id=loc_id))["result"]
        print(
            f"  both success: {r1.get('success')},{r2.get('success')}  final name={final.get('name')!r} "
            f"({'OK last-writer-wins' if final.get('name') in (PREFIX + 'concurrent_A', PREFIX + 'concurrent_B') else '**LOST**'})"
        )
        await assert_healthy(control, "races/after-concurrent-rename")

        print("\n== RACE 3: concurrent adjust_quantity serialization ==")
        item = (
            await control.call("haventory/item/create", name=PREFIX + "adjust_target", quantity=0)
        )["result"]
        iid = item["id"]
        n_adj = 50
        adj_conns = [await connect() for _ in range(8)]
        try:

            async def _adj(conn: WSConn, count: int, results: list) -> None:
                for _ in range(count):
                    try:
                        fr = await conn.call("haventory/item/adjust_quantity", item_id=iid, delta=1)
                        results.append(fr.get("success"))
                    except Exception as exc:  # noqa: BLE001
                        results.append(f"exc:{exc}")

            per = [n_adj // len(adj_conns)] * len(adj_conns)
            for i in range(n_adj % len(adj_conns)):
                per[i] += 1
            res: list = []
            await asyncio.gather(*[_adj(adj_conns[i], per[i], res) for i in range(len(adj_conns))])
            final_item = (await control.call("haventory/item/get", item_id=iid))["result"]
            succ = sum(1 for r in res if r is True)
            print(
                f"  {n_adj} concurrent +1 adjusts: successes={succ} final_qty={final_item['quantity']} "
                f"(expected {succ}) {'OK serialized' if final_item['quantity'] == succ else '**LOST UPDATE**'}"
            )
        finally:
            for c in adj_conns:
                await c.close()
        await assert_healthy(control, "races/after-adjust")
    finally:
        await a.close()
        await b.close()
        await cleanup_prefix(control)
        await control.close()


# ----------------------------------------------------------------------------- hammer


async def cmd_hammer(secs: float = 60.0, conns: int = 6) -> None:
    """Background mixed-op storm for the UI-under-load layer. Prints periodic counts."""
    pool = [await connect() for _ in range(conns)]
    stop_at = time.monotonic() + secs
    counters = {"create": 0, "update": 0, "delete": 0, "adjust": 0, "err": 0}
    live_ids: list[str] = []
    lock = asyncio.Lock()

    async def worker(conn: WSConn, wid: int) -> None:
        n = 0
        while time.monotonic() < stop_at:
            n += 1
            try:
                # bias toward create so the count visibly grows in the UI
                if not live_ids or n % 3 != 0:
                    fr = await conn.call(
                        "haventory/item/create", name=f"{PREFIX}hammer_{wid}_{n}", quantity=1
                    )
                    if fr.get("success"):
                        async with lock:
                            live_ids.append(fr["result"]["id"])
                        counters["create"] += 1
                    else:
                        counters["err"] += 1
                else:
                    async with lock:
                        iid = live_ids.pop() if live_ids else None
                    if iid:
                        fr = await conn.call("haventory/item/adjust_quantity", item_id=iid, delta=1)
                        counters["adjust"] += 1 if fr.get("success") else 0
                        # occasionally delete
                        if n % 9 == 0:
                            await conn.call("haventory/item/delete", item_id=iid)
                            counters["delete"] += 1
                        else:
                            async with lock:
                                live_ids.append(iid)
            except Exception:  # noqa: BLE001
                counters["err"] += 1
            await asyncio.sleep(0.01)

    async def reporter() -> None:
        while time.monotonic() < stop_at:
            await asyncio.sleep(5)
            print(
                f"  hammer t-{stop_at - time.monotonic():4.0f}s {dict(counters)} live={len(live_ids)}",
                flush=True,
            )

    try:
        print(f"== HAMMER: {secs:.0f}s mixed storm on {conns} conns ==", flush=True)
        await asyncio.gather(reporter(), *[worker(pool[i], i) for i in range(conns)])
        print(f"  hammer done: {dict(counters)}")
    finally:
        # clean up all hammer items
        c = await connect()
        di, dl = await cleanup_prefix(c)
        print(f"  hammer cleanup removed {di} items {dl} locations")
        await c.close()
        for p in pool:
            await p.close()


# ----------------------------------------------------------------------------- persistence / mid-load restart

import subprocess  # noqa: E402


def _container() -> str:
    return os.environ.get("HA_CONTAINER", "home-assistant")


async def _pull_store_counts() -> dict:
    """docker exec cat the HA Store file; return on-disk item/location counts."""
    proc = await asyncio.to_thread(
        subprocess.run,
        ["docker", "exec", _container(), "cat", "/config/.storage/haventory_store"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return {"error": proc.stderr.strip()[:200]}
    try:
        doc = json.loads(proc.stdout)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"parse: {exc}"}
    data = doc.get("data", {})
    items = data.get("items", {})
    locations = data.get("locations", {})
    return {
        "schema_version": data.get("schema_version"),
        "disk_items": len(items) if isinstance(items, (dict, list)) else None,
        "disk_locations": len(locations) if isinstance(locations, (dict, list)) else None,
    }


async def cmd_restart() -> None:
    control = await connect()
    try:
        print("== PERSISTENCE: mid-load restart + on-disk cross-check ==")
        await cleanup_prefix(control)
        await assert_healthy(control, "restart/before")

        # seed a known, stable set
        N = 200
        sample: list[tuple[str, str, int]] = []
        pool = [await connect() for _ in range(6)]
        names = [f"{PREFIX}persist_{i:04d}" for i in range(N)]
        shards: list[list[str]] = [[] for _ in range(6)]
        for i, nm in enumerate(names):
            shards[i % 6].append(nm)
        lat: list[float] = []
        ids: list[str] = []
        errs: list[dict] = []
        await asyncio.gather(
            *[_create_worker(pool[i], shards[i], None, lat, ids, errs) for i in range(6)]
        )
        print(f"  seeded {len(ids)} items (errors={len(errs)})")
        # capture samples
        for iid in ids[:5]:
            it = (await control.call("haventory/item/get", item_id=iid))["result"]
            sample.append((it["id"], it["name"], it["quantity"]))

        h_before = await health(control)
        cnt_before = h_before["counts"]["items_total"]
        gen_before = h_before["generation"]
        disk_before = await _pull_store_counts()
        print(f"  API items_total={cnt_before} gen={gen_before}")
        print(f"  ON-DISK store: {disk_before}")
        disk_ok_before = disk_before.get("disk_items") == cnt_before
        print(
            f"  on-disk == API (pre-restart): {'PASS' if disk_ok_before else '**MISMATCH**'} "
            f"(disk {disk_before.get('disk_items')} vs api {cnt_before})"
        )

        # --- start a create-storm and restart mid-flight ---
        print("\n  starting mid-load storm + docker restart ...")
        storm_ids: list[str] = []
        storm_err: list[dict] = []
        stop = time.monotonic() + 12

        async def storm(conn: WSConn, wid: int) -> None:
            n = 0
            while time.monotonic() < stop:
                n += 1
                try:
                    fr = await conn.call(
                        "haventory/item/create",
                        timeout=10,
                        name=f"{PREFIX}storm_{wid}_{n}",
                        quantity=1,
                    )
                    if fr.get("success"):
                        storm_ids.append(fr["result"]["id"])
                except Exception as exc:  # noqa: BLE001
                    storm_err.append({"exc": f"{type(exc).__name__}"})
                    return  # connection died (expected at restart)

        storm_tasks = [asyncio.create_task(storm(pool[i], i)) for i in range(6)]
        await asyncio.sleep(2.0)
        t0 = time.monotonic()
        rc = await asyncio.to_thread(
            subprocess.run, ["docker", "restart", _container()], capture_output=True, text=True
        )
        print(f"  docker restart issued (rc={rc.returncode}, {time.monotonic() - t0:.1f}s)")
        for t in storm_tasks:
            t.cancel()
        await asyncio.gather(*storm_tasks, return_exceptions=True)
        print(
            f"  storm created ~{len(storm_ids)} before restart; interrupted workers={len(storm_err)} "
            f"(storage_error/conn-drop mid-restart is EXPECTED)"
        )
        for p in pool:
            await p.close()
        await control.close()

        # --- reconnect + ready-poll ---
        print("\n  waiting for HA to come back ...")
        control = None
        ready = False
        for _ in range(30):
            await asyncio.sleep(3)
            try:
                c = await connect()
            except Exception:  # noqa: BLE001
                continue
            # Past this point the connection is ours: it is either adopted as the new
            # control connection or closed here, including when health() fails on a
            # half-booted HA.
            try:
                ready = (await health(c)).get("healthy") is not None
            except Exception:  # noqa: BLE001
                ready = False
            if ready:
                control = c
                break
            with contextlib.suppress(Exception):
                await c.close()
        if not ready:
            print("  **FAIL: HA did not become ready within timeout**")
            return
        print("  reconnected.")

        # --- post-restart invariants ---
        h_after = await health(control)
        stats_after = (await control.call("haventory/stats"))["result"]
        issues = h_after.get("issues")
        healthy = h_after.get("healthy")
        cnt_after = h_after["counts"]["items_total"]
        internal_ok = h_after["counts"]["items_total"] == stats_after["items_total"]
        disk_after = await _pull_store_counts()
        disk_match = disk_after.get("disk_items") == cnt_after
        print(f"  healthy={healthy} issues={issues}")
        print(
            f"  API items_total={cnt_after} (was {cnt_before} + up to {len(storm_ids)} storm survivors) gen={h_after['generation']}"
        )
        print(f"  health.counts == stats: {'PASS' if internal_ok else '**MISMATCH**'}")
        print(f"  ON-DISK store: {disk_after}")
        print(
            f"  on-disk == API (post-restart): {'PASS' if disk_match else '**MISMATCH**'} "
            f"(disk {disk_after.get('disk_items')} vs api {cnt_after})"
        )
        # index drift oracle
        drift_ok = healthy is True and issues == []
        print(f"  index-drift oracle: {'PASS (no drift)' if drift_ok else '**INDEX DRIFT**'}")
        # known seed survived?
        survived = 0
        for iid, nm, qty in sample:
            fr = await control.call("haventory/item/get", item_id=iid)
            if fr.get("success") and fr["result"]["name"] == nm:
                survived += 1
        print(
            f"  known seed items survived restart: {survived}/{len(sample)} "
            f"{'PASS' if survived == len(sample) else '**LOST**'}"
        )
        di, dl = await cleanup_prefix(control)
        print(f"  cleanup removed {di} items {dl} locations")
        await assert_healthy(control, "restart/after-cleanup")
    finally:
        if control is not None:
            try:
                await control.close()
            except Exception:  # noqa: BLE001
                pass


# ----------------------------------------------------------------------------- stats subscription probe


async def cmd_statsprobe() -> None:
    """Does the backend actually broadcast stats 'counts' events on each mutation?"""
    sub = await connect()
    mut = await connect()
    events: list[dict] = []
    try:
        print("== STATS PROBE: subscribe stats, then mutate on another conn ==")
        # subscribe on `sub` (id becomes the subscription id)
        sub_id = await sub.send_no_wait("haventory/subscribe", topic="stats")
        # drain the subscribe ack
        await asyncio.sleep(0.5)

        async def drain() -> None:
            try:
                while True:
                    frame = await asyncio.wait_for(sub._ws.receive_json(), timeout=8)
                    if isinstance(frame, dict) and frame.get("type") == "event":
                        ev = frame.get("event", {})
                        events.append(ev)
            except TimeoutError, Exception:  # noqa: BLE001
                pass

        drain_task = asyncio.create_task(drain())
        created = []
        for i in range(15):
            fr = await mut.call("haventory/item/create", name=f"{PREFIX}sp_{i}", quantity=1)
            if fr.get("success"):
                created.append(fr["result"]["id"])
            await asyncio.sleep(0.15)
        # a few deletes
        for iid in created[:5]:
            await mut.call("haventory/item/delete", item_id=iid)
            await asyncio.sleep(0.15)
        await asyncio.sleep(2)
        drain_task.cancel()
        try:
            await drain_task
        except asyncio.CancelledError:
            pass

        stats_events = [
            e for e in events if e.get("topic") == "stats" or e.get("action") == "counts"
        ]
        item_events = [e for e in events if e.get("topic") == "items"]
        print(f"  mutations: 15 creates + 5 deletes = 20")
        print(f"  total events received on stats subscription: {len(events)}")
        print(
            f"  stats/counts events: {len(stats_events)}   (items events leaking in: {len(item_events)})"
        )
        if stats_events:
            first = stats_events[0]
            last = stats_events[-1]
            print(
                f"  first stats event: action={first.get('action')} payload keys={list(first.keys())}"
            )
            print(f"  first counts: {first.get('counts', first)}")
            print(f"  last  counts: {last.get('counts', last)}")
            print(
                f"  VERDICT: backend DOES broadcast stats events "
                f"({'~1 per mutation' if len(stats_events) >= 15 else 'FEWER than mutations -> coalesced/dropped'})"
            )
        else:
            print("  VERDICT: **backend broadcast NO stats/counts events** to the subscriber")
        # cleanup
        for iid in created[5:]:
            await mut.call("haventory/item/delete", item_id=iid)
    finally:
        await sub.close()
        await mut.close()


# ----------------------------------------------------------------------------- subscription teardown (Fix #2)


async def cmd_subteardown() -> None:
    """Fix #2 (PR #94): a subscription must be torn down cleanly via HA's generic
    `unsubscribe_events` — the exact path the card's subscribeMessage uses — with no
    'Subscription not found' rejection. Pre-fix, the backend tracked subs only in its
    own bucket, never in `ActiveConnection.subscriptions`, so core could not find them.
    """
    conn = await connect()
    try:
        print("== SUB TEARDOWN (Fix #2): core unsubscribe_events + dedicated unsubscribe ==")
        await assert_healthy(conn, "subteardown/before")

        # (a) subscribe, then tear down via CORE unsubscribe_events (the frontend path)
        sub_id = await conn.send_no_wait("haventory/subscribe", topic="items")
        ack = (await conn.collect({sub_id}, timeout=10)).get(sub_id, {})
        print(f"  subscribe id={sub_id} ack success={ack.get('success')}")
        teardown = await conn.call("unsubscribe_events", subscription=sub_id, timeout=10)
        code = "SUCCESS" if teardown.get("success") else teardown.get("error", {}).get("code")
        ok = teardown.get("success") is True
        print(
            f"  unsubscribe_events(sub={sub_id}) -> {code} "
            f"{'PASS (core found + tore down the sub)' if ok else '**FAIL (not registered in conn.subscriptions)**'}"
        )

        # (b) dedicated haventory/unsubscribe still works and unregisters
        sub_id2 = await conn.send_no_wait("haventory/subscribe", topic="stats")
        await conn.collect({sub_id2}, timeout=10)
        dedicated = await conn.call("haventory/unsubscribe", subscription=sub_id2, timeout=10)
        print(
            f"  haventory/unsubscribe(sub={sub_id2}) -> "
            f"{'SUCCESS PASS' if dedicated.get('success') else str(dedicated.get('error')) + ' **FAIL**'}"
        )
        # after dedicated unsubscribe, core teardown of the same id is a benign no-op
        again = await conn.call("unsubscribe_events", subscription=sub_id2, timeout=10)
        again_code = "SUCCESS" if again.get("success") else again.get("error", {}).get("code")
        print(
            f"  unsubscribe_events after dedicated unsub -> {again_code} (benign either way, must not crash)"
        )
        await assert_healthy(conn, "subteardown/after")
    finally:
        await conn.close()


# ----------------------------------------------------------------------------- main


async def cmd_cleanup() -> None:
    conn = await connect()
    try:
        di, dl = await cleanup_prefix(conn)
        print(f"cleanup removed {di} items, {dl} locations")
        await assert_healthy(conn, "cleanup/after")
    finally:
        await conn.close()


COMMANDS = READ_ONLY_COMMANDS | {
    "fuzz",
    "bulkfuzz",
    "ratelimit",
    "bulk",
    "races",
    "hammer",
    "restart",
    "statsprobe",
    "cleanup",
}


def announce_target(cmd: str) -> None:
    """Name the instance -- and what is in it -- before the command touches it."""
    target = dev_env.load_env(REPO_ROOT)
    if not target.token:
        print("Missing HA_TOKEN", file=sys.stderr)
        sys.exit(2)
    os.environ["HA_BASE_URL"] = target.base_url
    counts, why = asyncio.run(dev_env.probe_counts(target.base_url, target.token))
    writes = counts is not None and cmd not in READ_ONLY_COMMANDS
    dev_env.announce(
        target,
        counts=counts,
        unavailable=why,
        action=f"'{cmd}'" if writes else None,
        stream=sys.stdout,
    )
    if counts is None:
        # Every layer needs a loaded integration; failing here beats failing three
        # minutes into a bulk run against an instance that was never the target.
        print(f"cannot read the store at {target.base_url}: {why}", file=sys.stderr)
        sys.exit(2)


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    cmd = args[0]
    if cmd not in COMMANDS:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(2)
    announce_target(cmd)
    if cmd == "baseline":
        asyncio.run(cmd_baseline())
    elif cmd == "fuzz":
        asyncio.run(cmd_fuzz())
    elif cmd == "bulkfuzz":
        asyncio.run(cmd_bulkfuzz())
    elif cmd == "ratelimit":
        asyncio.run(cmd_ratelimit())
    elif cmd == "bulk":
        target = int(args[1]) if len(args) > 1 else 1000
        asyncio.run(cmd_bulk(target=target))
    elif cmd == "races":
        asyncio.run(cmd_races())
    elif cmd == "hammer":
        secs = float(args[1]) if len(args) > 1 else 60.0
        asyncio.run(cmd_hammer(secs=secs))
    elif cmd == "restart":
        asyncio.run(cmd_restart())
    elif cmd == "statsprobe":
        asyncio.run(cmd_statsprobe())
    elif cmd == "subteardown":
        asyncio.run(cmd_subteardown())
    elif cmd == "cleanup":
        asyncio.run(cmd_cleanup())


if __name__ == "__main__":
    main()
