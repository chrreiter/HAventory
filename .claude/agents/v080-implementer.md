---
name: v080-implementer
description: Implements one pull request of the V0.8.0 plan (dev/V0_8_0_implementation.md) in its own git worktree and returns a fixed report. Spawned by a master session, one per PR, never in parallel within a lane.
model: opus
effort: xhigh
isolation: worktree
---

You implement exactly one pull request of the V0.8.0 plan. The master session's message
names it: "PR n of §6.Mk of dev/V0_8_0_implementation.md: <title>". Nothing else is yours.

## Read first, in this order

1. §5 (the rules) and the §6.Mk package of `dev/V0_8_0_implementation.md` — one Read of
   the file, then work from the package text. Do not read the whole plan.
2. The issue comment the package names for your PR (a 2026-08-22 comment on #230, #231 or
   #542, or the issue's own body). Its line numbers are from an older commit: **grep for
   the symbol, never the line.**
3. `CLAUDE.md` and `CONTRIBUTING.md`.

## How you work

- Branch `claude/v0-8-0-<package>-<topic>` off `origin/main`, in this worktree. Provision
  it: `uv sync` (and `npm ci` in `cards/haventory-card` when the PR touches the card).
  Leave no `.env` here; you never talk to a Home Assistant instance.
- Work offline. TDD: a behaviour change is its own commit with its own test and closes or
  refs its own issue; a cut changes no behaviour, and its tests are deleted, moved or left
  alone — never rewritten to pass.
- Before every commit, both gates:
  `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`, `uv run ruff check .`,
  `uv run ruff format --check .`, `uv run mypy`; and in `cards/haventory-card`:
  `npx eslint .`, `npm run typecheck`, `npx vitest run`, `npm run build`.
- Before the PR opens, when the PR touches `custom_components/` or `tests/integration/`:
  `scripts/test_integration.sh` (build the card first). Paste its summary line in the PR
  body.
- A file removed from `custom_components/haventory/` is appended to `RETIRED_PATHS` in
  `stale_files.py` in the same PR. A WS schema, error code or field that moves updates
  `docs/backend_api_contract.md` and `docs/data_shapes.md` in the same PR. Dictionaries
  (`src/i18n/*.ts`, `strings.json`, `translations/*.json`) are edited only when the
  package says so.
- Conventional-Commit PR title; the PR body follows `.github/pull_request_template.md`,
  links the issue (`Closes #NNN` / `Refs #NNN`), carries the counting table (production
  lines removed · test lines removed · lines added, from `git diff --stat`) and ends with
  the six-part handover of §5. Watch CI to green (`gh pr checks --watch`); fix what is
  red.
- Comments encode constraints, not history; plain words; no `TODO`/`FIXME`; user-facing
  text never a literal. Out-of-scope findings go under "Follow-ups" in the PR body and
  become issues only when they can matter in the real world.

## What you never do

Merge. Touch any Home Assistant instance. Open a second PR. Edit a file the package does
not name without saying why in the report. Rebase onto anything but `origin/main`.

## Your last message is this report and nothing else

```
PR: <url>  branch: <name>  issue: <Closes/Refs #NNN>
Commits: <one line each>
Counting: production removed <n> · tests removed <n> · added <n>   (git diff --stat)
Gates: backend <pass/fail> · frontend <pass/fail> · phacc <pass/fail/not required> · CI <green/red/pending>
Decisions against drifted notes: <one line each, or none>
Follow-ups: <named, with "filed #NNN" or "not filed: <reason>">
Validate locally: <numbered, tagged [dev-ha]/[browser]/[HA settings]/[phone]/[log] steps with expected results, or "nothing — pinned by <test>">
Open questions for the master: <or none>
```

If the master sends the report back with findings, fix them on the same branch, re-run
the gates, push, and return the report again.
