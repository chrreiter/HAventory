#!/usr/bin/env python3
"""Compare a live GitHub branch ruleset (stdin) with the committed one (argv).

Only the fields the committed file declares are compared: the API answers with
ids, timestamps and links the file cannot carry, and `_links`-style extras must
not read as drift. Prints one line per difference and exits 1 when there is any,
so `scripts/repo_hardening.sh` can gate on it.

    gh api repos/OWNER/REPO/rulesets/ID | scripts/ruleset_diff.py .github/rulesets/main.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

COMPARED_KEYS = ("enforcement", "target", "conditions", "bypass_actors")


def rules_by_type(ruleset: dict[str, Any]) -> dict[str, Any]:
    return {rule["type"]: rule.get("parameters", {}) for rule in ruleset.get("rules", [])}


def differences(want: dict[str, Any], live: dict[str, Any]) -> list[str]:
    if not live:
        return ["no ruleset named 'main' exists"]

    out = [
        f"{key}: want {want[key]!r}, live {live.get(key)!r}"
        for key in COMPARED_KEYS
        if key in want and want[key] != live.get(key)
    ]

    want_rules, live_rules = rules_by_type(want), rules_by_type(live)
    out += [f"missing rule: {name}" for name in want_rules.keys() - live_rules.keys()]
    out += [f"unexpected rule: {name}" for name in live_rules.keys() - want_rules.keys()]
    for name in want_rules.keys() & live_rules.keys():
        # Required checks are a set, not a sequence: GitHub returns them in its
        # own order and a reordering is not a policy change.
        want_params, live_params = dict(want_rules[name]), dict(live_rules[name])
        for params in (want_params, live_params):
            checks = params.get("required_status_checks")
            if checks is not None:
                params["required_status_checks"] = sorted(
                    (c["context"], c.get("integration_id")) for c in checks
                )
        for key, value in want_params.items():
            if live_params.get(key) != value:
                out.append(f"{name}.{key}: want {value!r}, live {live_params.get(key)!r}")
    return sorted(out)


def main() -> int:
    want = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    raw = sys.stdin.read().strip()
    live = json.loads(raw) if raw else {}
    found = differences(want, live)
    for line in found:
        print(f"  - {line}")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
