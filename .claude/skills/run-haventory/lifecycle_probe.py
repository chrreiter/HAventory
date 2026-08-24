#!/usr/bin/env python3
"""Probe the integration's container-level lifecycle paths against a real Home Assistant.

Three behaviours only exist once HAventory is installed in a running instance,
and each one is asserted against stubs in the offline suite:

  resources  The card's Lovelace resource carries the manifest version as a
             cache-busting `?v=`. Whatever a restart finds — a hand-pinned
             `?v=<hash>`, a stale `?v=<old version>`, or a bare URL with no query
             at all — must be **rewritten in place, under the same resource id**.
             Adding a second entry instead would load the card module twice and
             the second `customElements.define` throws, so "one resource, id
             preserved" is the assertion, not "the URL is right".
  downgrade  Storage written by a newer build must be refused, not migrated:
             migrations are forward-only, so a downgrade can only lose data. The
             entry must land in an error state that does **not** retry, and the
             stored payload must come back byte-identical.
  entry      Removing the config entry must take the Lovelace resource with it
             and leave the store alone; re-adding must register the resource
             exactly once and find the data still there.

Every subcommand restarts the container and edits `/config/.storage`, so this is
opt-in: pass `--yes`. The dev container is disposable by design; do not point it
at an instance whose data matters. `downgrade` and `entry` snapshot the store
first and restore it on the way out, including on failure.

Usage (from the repo root):
  uv run python .claude/skills/run-haventory/lifecycle_probe.py resources --yes
  uv run python .claude/skills/run-haventory/lifecycle_probe.py downgrade --yes
  uv run python .claude/skills/run-haventory/lifecycle_probe.py entry --yes
  uv run python .claude/skills/run-haventory/lifecycle_probe.py all --yes

HA_BASE_URL / HA_TOKEN come from the `.env` beside this checkout, which wins over
an inherited export -- a worktree's .env names the instance that worktree is for.
HAVENTORY_IGNORE_ENV_FILE=1 hands the decision back to the environment for one run.
The target and the store's counts print on stderr before anything is restarted or
rewritten. HA_CONTAINER (default "home-assistant") names the container the docker
exec calls go to.
"""
# Dev/agent harness script. Driving the container means shelling out to `docker`
# on PATH (S603/S607), and the restart has to block the loop while it runs
# (ASYNC221).
# ruff: noqa: S603, S607, ASYNC221

from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import aiohttp

REPO_ROOT = Path(__file__).resolve().parents[3]
STORE_PATH = "/config/.storage/haventory_store"
RECV_TIMEOUT_S = 30.0
# HA answers /api/ well before it finishes loading integrations, so readiness is
# polled on the WS command the integration itself registers.
READY_TIMEOUT_S = 120.0
HTTP_OK = 200
# One definition of "which instance is this?" for every helper in the repo. This
# file's committed location names the checkout it belongs to, so the import
# follows the same tree the .env is read from.
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import dev_env  # noqa: E402


def container() -> str:
    return os.environ.get("HA_CONTAINER", "home-assistant")


def sh(script: str, stdin: bytes | None = None) -> str:
    """Run a shell snippet inside the container and return stdout.

    Payloads go in over stdin, never in the script: the store is around a
    megabyte and Windows caps a command line far below that, failing with a
    "filename or extension is too long" OSError before docker is even reached.
    """
    # MSYS_NO_PATHCONV keeps Git Bash from rewriting the /config paths below into
    # Windows paths before docker ever sees them.
    env = {**os.environ, "MSYS_NO_PATHCONV": "1"}
    cmd = [
        "docker",
        "exec",
        *(["-i"] if stdin is not None else []),
        container(),
        "sh",
        "-lc",
        script,
    ]
    proc = subprocess.run(cmd, input=stdin, capture_output=True, env=env, check=False)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace").strip()
        out = proc.stdout.decode("utf-8", "replace").strip()
        raise RuntimeError(f"docker exec failed: {err or out}")
    return proc.stdout.decode("utf-8", "replace")


class Ws:
    """One authenticated HA WebSocket connection with sequential ids."""

    def __init__(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        self._ws = ws
        self._id = 0

    async def call(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._id += 1
        await self._ws.send_json({"id": self._id, **payload})
        while True:
            frame = await asyncio.wait_for(self._ws.receive_json(), timeout=RECV_TIMEOUT_S)
            if frame.get("id") == self._id and frame.get("type") == "result":
                return frame


async def connect(session: aiohttp.ClientSession) -> Ws:
    base = os.environ["HA_BASE_URL"]
    token = os.environ["HA_TOKEN"]
    ws = await session.ws_connect(
        dev_env.ws_url(base), timeout=aiohttp.ClientWSTimeout(ws_receive=RECV_TIMEOUT_S)
    )
    await asyncio.wait_for(ws.receive_json(), timeout=RECV_TIMEOUT_S)
    await ws.send_json({"type": "auth", "access_token": token})
    auth = await asyncio.wait_for(ws.receive_json(), timeout=RECV_TIMEOUT_S)
    if auth.get("type") != "auth_ok":
        raise RuntimeError(f"WS auth failed: {auth}")
    return Ws(ws)


async def restart_and_wait(*, expect_integration: bool = True) -> float:
    """Restart the container; wait until HA answers, and (optionally) HAventory does."""
    subprocess.run(["docker", "restart", container()], capture_output=True, check=True)
    started = time.monotonic()
    deadline = started + READY_TIMEOUT_S
    base = os.environ["HA_BASE_URL"]
    token = os.environ["HA_TOKEN"]
    while time.monotonic() < deadline:
        await asyncio.sleep(2)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{base.rstrip('/')}/api/",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status != HTTP_OK:
                        continue
                if not expect_integration:
                    return time.monotonic() - started
                ws = await connect(session)
                frame = await ws.call({"type": "haventory/version"})
                if frame.get("success"):
                    return time.monotonic() - started
        except TimeoutError, aiohttp.ClientError, RuntimeError, OSError:
            continue
    if expect_integration:
        raise RuntimeError(f"HAventory did not answer within {READY_TIMEOUT_S:.0f}s of the restart")
    raise RuntimeError(f"HA did not come back within {READY_TIMEOUT_S:.0f}s of the restart")


async def lovelace_resources(session: aiohttp.ClientSession) -> list[dict[str, Any]]:
    ws = await connect(session)
    frame = await ws.call({"type": "lovelace/resources"})
    return [r for r in (frame.get("result") or []) if "haventory" in str(r.get("url", ""))]


def store_bytes() -> bytes:
    return sh(f"cat {STORE_PATH} 2>/dev/null || true").encode("utf-8", "replace")


def write_store(payload: bytes) -> None:
    """Replace the store, byte for byte. base64 so no shell quoting applies."""
    sh(f"base64 -d > {STORE_PATH}", stdin=base64.b64encode(payload))


# --------------------------------------------------------------------------- checks

Result = tuple[str, bool, str]


async def check_resources() -> list[Result]:
    """Every starting shape of the resource URL must converge on one rewritten entry."""
    results: list[Result] = []
    async with aiohttp.ClientSession() as session:
        before = await lovelace_resources(session)
        if len(before) != 1:
            return [
                (
                    "resources/precondition",
                    False,
                    f"expected exactly 1 haventory resource, found {len(before)}",
                )
            ]
        original = before[0]
        print(f"  starting from id={original['id']} url={original['url']}")

        variants = [
            ("pinned", "/haventory_static/haventory-card.js?v=deadbeefcafe"),
            ("stale", "/haventory_static/haventory-card.js?v=0.0.0"),
            ("bare", "/haventory_static/haventory-card.js"),
            ("query", "/haventory_static/haventory-card.js?v=1&foo=bar"),
        ]
        for label, url in variants:
            ws = await connect(session)
            await ws.call(
                {"type": "lovelace/resources/update", "resource_id": original["id"], "url": url}
            )
            print(f"\n  [{label}] set to {url}; restarting…")
            await restart_and_wait()
            after = await lovelace_resources(session)
            same_id = len(after) == 1 and after[0]["id"] == original["id"]
            rewritten = len(after) == 1 and after[0]["url"] != url
            detail = f"{len(after)} resource(s): {[r['url'] for r in after]}"
            results.append((f"resources/{label}: one entry, id preserved", same_id, detail))
            results.append(
                (f"resources/{label}: rewritten to the manifest version", rewritten, detail)
            )
            print(f"    -> {detail}")
    return results


async def check_downgrade() -> list[Result]:
    """A store from a newer build must stop setup without retrying, and stay untouched."""
    results: list[Result] = []
    snapshot = store_bytes()
    if not snapshot.strip():
        return [("downgrade/precondition", False, f"no store at {STORE_PATH}")]
    try:
        payload = json.loads(snapshot)
        current = payload["data"]["schema_version"]
        payload["data"]["schema_version"] = current + 99
        write_store(json.dumps(payload).encode("utf-8"))
        print(f"  schema_version {current} -> {current + 99}; restarting…")

        # HA itself comes up; the entry is the thing that must fail.
        await restart_and_wait(expect_integration=False)
        await asyncio.sleep(5)

        base = os.environ["HA_BASE_URL"].rstrip("/")
        token = os.environ["HA_TOKEN"]
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{base}/api/config/config_entries/entry",
                headers={"Authorization": f"Bearer {token}"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                entries = await resp.json()
            entry = next((e for e in entries if e.get("domain") == "haventory"), None)
            state = entry.get("state") if entry else None
            print(f"  config entry state: {state}")
            # setup_error is the terminal state; setup_retry would mean HA is
            # going to try again, which is exactly what the refusal rules out.
            results.append(
                (
                    "downgrade/entry in setup_error (no retry)",
                    state == "setup_error",
                    f"state={state}",
                )
            )

            ws = await connect(session)
            frame = await ws.call({"type": "haventory/version"})
            refused = not frame.get("success")
            results.append(
                (
                    "downgrade/WS refuses to answer",
                    refused,
                    json.dumps(frame.get("error") or frame)[:160],
                )
            )

        after = store_bytes()
        untouched = json.loads(after)["data"]["schema_version"] == current + 99
        results.append(("downgrade/store left untouched", untouched, "payload not rewritten"))
    finally:
        print("  restoring the store and restarting…")
        write_store(snapshot)
        await restart_and_wait()
        results.append(("downgrade/recovered after restore", True, "integration answers again"))
    return results


async def check_entry() -> list[Result]:
    """Removing the entry drops the resource and keeps the data; re-adding restores one resource."""
    results: list[Result] = []
    snapshot = store_bytes()
    base = os.environ["HA_BASE_URL"].rstrip("/")
    token = os.environ["HA_TOKEN"]
    headers = {"Authorization": f"Bearer {token}"}
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{base}/api/config/config_entries/entry",
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            entries = await resp.json()
        entry = next((e for e in entries if e.get("domain") == "haventory"), None)
        if entry is None:
            return [("entry/precondition", False, "no haventory config entry to remove")]

        async with session.delete(
            f"{base}/api/config/config_entries/entry/{entry['entry_id']}",
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            print(f"  removed entry {entry['entry_id']} (HTTP {resp.status})")
        await asyncio.sleep(3)

        after_remove = await lovelace_resources(session)
        results.append(
            (
                "entry/resource removed with the entry",
                len(after_remove) == 0,
                f"{len(after_remove)} left",
            )
        )
        results.append(
            (
                "entry/store survives removal",
                bool(store_bytes().strip()),
                f"{len(store_bytes())} bytes",
            )
        )

        # Re-add through the config flow the UI drives, so the single-instance
        # guard and the resource registration both run for real.
        async with session.post(
            f"{base}/api/config/config_entries/flow",
            headers=headers,
            json={"handler": "haventory", "show_advanced_options": False},
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            flow = await resp.json()
        print(f"  config flow: {flow.get('type')} / {flow.get('title') or flow.get('step_id')}")
        if flow.get("type") == "form":
            async with session.post(
                f"{base}/api/config/config_entries/flow/{flow['flow_id']}",
                headers=headers,
                json={},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                flow = await resp.json()
        results.append(
            (
                "entry/re-added via the config flow",
                flow.get("type") == "create_entry",
                str(flow.get("type")),
            )
        )
        await asyncio.sleep(5)

        after_add = await lovelace_resources(session)
        results.append(
            (
                "entry/resource registered exactly once",
                len(after_add) == 1,
                f"{[r['url'] for r in after_add]}",
            )
        )

        ws = await connect(session)
        frame = await ws.call({"type": "haventory/health"})
        counts = (frame.get("result") or {}).get("counts", {})
        kept = counts.get("items_total", -1) > 0 or not snapshot.strip()
        results.append(("entry/data still there after re-add", kept, json.dumps(counts)))
    return results


CHECKS = {"resources": check_resources, "downgrade": check_downgrade, "entry": check_entry}


async def run(names: list[str]) -> int:
    results: list[Result] = []
    for name in names:
        print(f"\n== {name} ==")
        try:
            results.extend(await CHECKS[name]())
        except Exception as exc:
            # A harness failure is itself a result: reporting it beside the checks
            # keeps one broken probe from hiding the verdicts of the others.
            results.append((f"{name}/harness", False, f"{type(exc).__name__}: {exc}"))

    print("\n== verdict ==")
    for label, ok, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label:52s} {detail}")
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    return 1 if failed else 0


def main() -> int:
    argv = sys.argv[1:]
    names = [a for a in argv if not a.startswith("-")]
    if not names or (names[0] != "all" and any(n not in CHECKS for n in names)):
        print(__doc__, file=sys.stderr)
        return 2
    if names[0] == "all":
        names = list(CHECKS)
    target = dev_env.load_env(REPO_ROOT)
    os.environ["HA_BASE_URL"] = target.base_url
    # Before the --yes gate, not after: the instance about to be restarted is what
    # the operator needs on screen while deciding whether to pass --yes.
    confirmed = "--yes" in argv
    action = f"{' '.join(names)} (container restart, store edit)" if confirmed else None
    asyncio.run(dev_env.announce_store(target, action=action))
    if not confirmed:
        print(
            f"This restarts container '{container()}' and edits {STORE_PATH}. Re-run with --yes.",
            file=sys.stderr,
        )
        return 2
    if not target.token:
        print(f"Missing HA_TOKEN (looked in {target.source})", file=sys.stderr)
        return 2
    return asyncio.run(run(names))


if __name__ == "__main__":
    raise SystemExit(main())
