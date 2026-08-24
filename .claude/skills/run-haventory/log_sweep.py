#!/usr/bin/env python3
"""Audit the dev container's Home Assistant log against HAventory's severity policy.

An online run is not clean until the server's own log agrees. Offline tests stub
Home Assistant, so a path that raises only against the real thing stays green in
the suite and shows up here — and the taxonomy makes a second, quieter promise
that no test asserts at all: a rejection the caller can fix and resend
(``validation_error``, ``not_found``, ``conflict``) is logged
at WARNING, and only ``storage_error`` / ``unknown_error`` — the codes an
operator has to act on — reach ERROR with a traceback. A support burden hides in
the difference.

Three findings are reported separately, because they mean different things:

  BLOCKING    an HAventory traceback, an ERROR carrying a client-recoverable
              code, or an ``unknown_error`` — an unmapped exception reaching the
              boundary, which is what the taxonomy exists to prevent.
  EXPECTED    contract-defined WARNING rejections. Fuzz layers produce these by
              the hundred; they are the policy working.
  KNOWN       ERROR lines HA core writes on its own account for a rejection
              this integration already logged at WARNING: type-loose frames
              rejected by core's schema check before ``ws_guard`` runs (open
              item 53), a ``haventory.*`` service call the handler refused (the
              WebSocket ``call_service`` command logs every ``HomeAssistantError``
              at ERROR, core's own ``ServiceValidationError`` included), and the
              REST ``/api/services`` view's 500 for the same refusal. Surfaced
              without failing the sweep, because no change here can quiet them.

Usage (from the repo root):
  uv run python .claude/skills/run-haventory/log_sweep.py                 # last 30m
  uv run python .claude/skills/run-haventory/log_sweep.py --since 2h
  uv run python .claude/skills/run-haventory/log_sweep.py --all           # whole log
  uv run python .claude/skills/run-haventory/log_sweep.py --file run.log  # a saved capture
  uv run python .claude/skills/run-haventory/log_sweep.py --show 20       # more samples

Exit code is 1 when anything BLOCKING was found, 0 otherwise. Reads
HA_CONTAINER from the environment (default "home-assistant"); nothing else is
needed, and it never writes to the container.
"""
# Dev/agent harness script. It shells out to `docker logs` by design (S603), and
# classify() is a chain of guards whose readability is the point (PLR0911).
# ruff: noqa: S603, PLR0911

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

# Codes the caller can fix and resend. The taxonomy logs these at WARNING; an
# ERROR carrying one is the finding.
RECOVERABLE_CODES = ("validation_error", "not_found", "conflict")
# The exceptions those codes are mapped from, as they appear on a traceback's
# last line. A traceback ending in one of these is a rejection; a traceback
# ending in anything else is a fault.
RECOVERABLE_EXCEPTIONS = ("ValidationError", "NotFoundError", "ConflictError")
# The operator-actionable half of the taxonomy. ERROR *with* a traceback is what
# the policy prescribes for these, so finding one means the policy held — the
# schema-downgrade refusal is the case that provokes it on purpose.
ACTIONABLE_EXCEPTIONS = ("SchemaDowngradeError", "StorageError")

# HA colours its log by level, so every line arrives wrapped in SGR escapes and
# nothing anchored to the start of a line matches until they are stripped.
ANSI = re.compile(r"\x1b\[[0-9;]*m")
# A log line starts with a timestamp; a traceback's continuation lines do not.
LINE_START = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")
LEVEL = re.compile(r"\b(DEBUG|INFO|WARNING|ERROR|CRITICAL)\b")
HAVENTORY = re.compile(r"haventory", re.IGNORECASE)
# HA core rejects a type-loose frame before ws_guard can map it (open item 53).
CORE_SCHEMA_REJECT = re.compile(
    r"websocket_api\.http\.connection.*(expected |invalid |required key|extra keys)", re.IGNORECASE
)
# HA core's own ERROR for a `haventory.*` service call the handler refused: the
# WebSocket `call_service` command logs every `HomeAssistantError` at ERROR —
# its own `ServiceValidationError` included — and the script engine logs every
# failed action the same way, so the line is core's severity policy, not this
# integration's. The integration's own WARNING for the same rejection sits
# beside it; that one is what the taxonomy judges.
CORE_SERVICE_CALL_REJECT = re.compile(
    r"websocket_api\.http\.connection.*Error during service call to haventory\."
)
# The REST `/api/services` view maps only `vol.Invalid` and `ServiceNotFound`
# to 400 and lets every other `HomeAssistantError` reach aiohttp as a 500 with a
# traceback — for core's services as much as for these. A traceback under
# `aiohttp.server` that ends on a recoverable HAventory exception is that view.
CORE_REST_SERVICE_REJECT = re.compile(r"\[aiohttp\.server\] Error handling request")
# HA prints this for every custom integration at every startup.
LOADER_NOTICE = re.compile(r"homeassistant\.loader\].*custom integration")
# The storage layer only ever raises StorageError and its subclasses, so ERROR is
# the severity the taxonomy prescribes for everything it logs. It reports the
# refusal before raising, on its own line and without a traceback, so the
# exception name that exempts the setup half of the same event is not in this
# half — the module is.
STORAGE_LOGGER = re.compile(r"custom_components\.haventory\.storage\]")


def read_log(args: argparse.Namespace) -> str:
    if args.file:
        return Path(args.file).read_text(encoding="utf-8", errors="replace")
    cmd = ["docker", "logs", args.container]
    if not args.all:
        cmd += ["--since", args.since]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace", check=False)
    if proc.returncode != 0:
        print(f"docker logs failed: {proc.stderr.strip()}", file=sys.stderr)
        raise SystemExit(2)
    return proc.stdout + proc.stderr


def to_records(text: str) -> list[list[str]]:
    """Group physical lines into records so a traceback stays with its header."""
    records: list[list[str]] = []
    for raw in text.splitlines():
        line = ANSI.sub("", raw)
        if LINE_START.match(line) or not records:
            records.append([line])
        else:
            records[-1].append(line)
    return records


def classify(record: list[str]) -> tuple[str, str]:
    """Return (bucket, reason) for one log record.

    Severity is judged against the taxonomy, not against the mere presence of a
    traceback: a rejection the caller can fix and resend belongs at WARNING, and
    the same rejection at ERROR is the finding. What decides which one a record
    is, is the exception a traceback ends on — the header text alone cannot tell
    a rejected quantity from a broken store.
    """
    head = record[0]
    body = "\n".join(record)
    level_match = LEVEL.search(head)
    level = level_match.group(1) if level_match else "?"
    tail = record[-1] if len(record) > 1 else ""
    has_traceback = any(line.startswith("Traceback (most recent call last)") for line in record[1:])
    recoverable = any(name in tail for name in RECOVERABLE_EXCEPTIONS) or any(
        code in body for code in RECOVERABLE_CODES
    )
    mentions_haventory = bool(HAVENTORY.search(body))
    loud = level in {"ERROR", "CRITICAL"}

    if LOADER_NOTICE.search(head):
        return "IGNORED", ""  # HA says this about every custom integration
    if "unknown_error" in body:
        return "BLOCKING", "unknown_error reached the boundary"
    if loud and CORE_SCHEMA_REJECT.search(body):
        return "KNOWN", "HA core schema rejection before ws_guard (item 53)"
    if loud and CORE_SERVICE_CALL_REJECT.search(head) and not has_traceback:
        return "KNOWN", "HA core logs a refused service call at ERROR (core's own severity)"
    if loud and CORE_REST_SERVICE_REJECT.search(head) and recoverable:
        return "KNOWN", "HA core's REST services view answers a refused call with a 500"
    if loud and (
        any(name in body for name in ACTIONABLE_EXCEPTIONS) or STORAGE_LOGGER.search(head)
    ):
        return "EXPECTED", "operator-actionable storage error at ERROR (policy-correct)"
    if loud and recoverable:
        return "BLOCKING", "client-recoverable rejection logged at ERROR"
    if has_traceback and mentions_haventory and not recoverable:
        return "BLOCKING", "unhandled traceback in an HAventory path"
    if loud and mentions_haventory:
        return "BLOCKING", "HAventory ERROR"
    if level == "WARNING" and mentions_haventory:
        # exc_info is reserved for the operator-actionable codes, so a traceback
        # under a WARNING is the older behaviour rather than the current policy.
        if has_traceback:
            return "EXPECTED", "WARNING rejection, but carrying a traceback"
        return "EXPECTED", "contract-defined WARNING rejection"
    return "IGNORED", ""


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--container", default=None, help="container name (default $HA_CONTAINER or home-assistant)"
    )
    parser.add_argument("--since", default="30m", help="docker logs --since window (default 30m)")
    parser.add_argument("--all", action="store_true", help="sweep the whole log, ignoring --since")
    parser.add_argument(
        "--file", default=None, help="sweep a saved log capture instead of the container"
    )
    parser.add_argument(
        "--show", type=int, default=5, help="sample lines to print per bucket (default 5)"
    )
    args = parser.parse_args()

    if args.container is None:
        args.container = os.environ.get("HA_CONTAINER", "home-assistant")

    text = read_log(args)
    records = to_records(text)
    buckets: dict[str, list[list[str]]] = {"BLOCKING": [], "EXPECTED": [], "KNOWN": []}
    reasons: Counter[str] = Counter()
    for record in records:
        bucket, reason = classify(record)
        if bucket in buckets:
            buckets[bucket].append(record)
            reasons[f"{bucket}: {reason}"] += 1

    scope = "whole log" if args.all or args.file else f"last {args.since}"
    source = args.file or f"container {args.container}"
    print(f"== log sweep: {source}, {scope} - {len(records)} records ==\n")

    for bucket in ("BLOCKING", "KNOWN", "EXPECTED"):
        found = buckets[bucket]
        print(f"{bucket}: {len(found)}")
        for record in found[: args.show]:
            print(f"  {record[0][:200]}")
            # The last line of a traceback names the exception; that is the part
            # worth showing next to the header.
            if any(line.startswith("Traceback") for line in record[1:]):
                print(f"      ...{record[-1][:160]}")
        if len(found) > args.show:
            print(f"  ... and {len(found) - args.show} more")
        print()

    if reasons:
        print("breakdown:")
        for reason, count in reasons.most_common():
            print(f"  {count:5d}  {reason}")

    verdict = "FAIL" if buckets["BLOCKING"] else "PASS"
    print(f"\nverdict: {verdict} (blocking={len(buckets['BLOCKING'])})")
    return 1 if buckets["BLOCKING"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
