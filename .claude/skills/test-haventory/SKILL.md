---
name: test-haventory
description: Run every HAventory test surface — offline unit gate (pytest/ruff/mypy), frontend gate (eslint/vitest/tsc/build), the adversarial online stress regimen (fuzz/bulk/races/rate-limit/restart), the live-update browser smoke, and the online WS pytest smokes. Use when asked to test HAventory, run the gate, lint/typecheck, or smoke / stress / load / fuzz / break-it test the running app.
---

HAventory has five test surfaces. Two are **offline** (no HA): the backend gate
(pytest/ruff/mypy) and the frontend gate (eslint/vitest/tsc/build). Three are **online**
and hit the real HA in Docker (container `home-assistant`, `http://localhost:8123`): the
adversarial **stress regimen** `.claude/skills/test-haventory/stress.py` (the primary
break-it driver), the **live-update browser smoke** `cards/haventory-card/e2e/live-updates.smoke.mjs`,
and the **online WS pytest smokes** (`-m online`).

All paths are relative to the repo root and every command below is **Linux/bash**, which is
the only development host the repo supports — CI runs `ubuntu-latest`, and on Windows the
supported path is WSL2 (`CONTRIBUTING.md`). A handful of notes are tagged
**[Windows/Git Bash]**: they are workarounds for driving a Windows host's Docker and
filesystem through Git Bash instead, and nothing else here depends on them. Plain `uv run`
works against the project `.venv` — the `--no-project` form below is still correct and is
what to fall back to if the venv is ever unusable, but it is no longer required. Canonical
clean-Linux/CI commands live in the README ("The gate").

## Prerequisites

- **uv** (provisions CPython 3.14 automatically — the source uses PEP 758 syntax that does
  not parse on ≤3.13), **Node 22.13+**, **Docker** (for the online surfaces). [Windows/Git
  Bash] **Git Bash** for the `.sh`/`.py` helpers.
- `pre-commit` on PATH (the git hook needs it): `uv tool install pre-commit`.
- A `.env` at the repo root with `HA_BASE_URL` + `HA_TOKEN` (a long-lived token; per session,
  never committed). The online surfaces read it directly.
- For the browser smoke: Chromium for Playwright — `npx playwright install chromium`. It
  caches under `~/.cache/ms-playwright`; [Windows/Git Bash] `~/AppData/Local/ms-playwright`.

## The commit gate (offline — run before every commit)

Both halves must be green. Backend, from the repo root:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run --no-project --python 3.14 \
  --with pytest --with pytest-asyncio --with voluptuous --with aiohttp \
  python -m pytest -q
# → 540 passed, 22 skipped

uv run --no-project --python 3.14 --with ruff==0.15.22 ruff check custom_components tests
# → All checks passed!

uv run --no-project --python 3.14 --with mypy --with voluptuous mypy
# → Success: no issues found in 14 source files
```

Frontend, from `cards/haventory-card`:

```bash
npm ci            # first run, or if node_modules is partial (missing rolldown binding)
npm run lint      # eslint  → clean
npm run typecheck # tsc --noEmit → clean
npm test          # vitest  → 1094 passed across 51 files
npm run build     # vite → ../../custom_components/haventory/www/ (git-ignored)
```

Those counts are **as of v0.3.1** and are a collection oracle, not a target: TDD means every
release adds tests, so a number *larger* than the one printed here is the normal result. A
number **smaller** than the last release's — fewer tests, fewer vitest files, fewer mypy
source files — means collection broke and half the suite silently did not run. Re-pin them
whenever a release moves them; a stale figure read as an exact expectation misdiagnoses a
healthy run.

Warm the hooks before committing (never `--no-verify`):

```bash
pre-commit run --files <changed paths>
```

## Deploy current code first (required for all online surfaces)

The online surfaces test the **running container**, so deploy the working tree into it first.
A tar pipe works on every host and sidesteps `docker cp`'s host-path mangling under Git Bash:

```bash
# Build first: the bundle lands in custom_components/haventory/www/ and ships
# with the component in the same tar.
npm --prefix cards/haventory-card run build >/dev/null
# [Windows/Git Bash] prefix the docker exec with MSYS_NO_PATHCONV=1 so /config survives.
tar -C custom_components -cf - haventory | \
  docker exec -i home-assistant sh -lc \
  'cd /config/custom_components && tar -xf - && find haventory -type d -name __pycache__ -prune -exec rm -rf {} +'
docker restart home-assistant
# then poll readiness (needs HA_TOKEN/HA_BASE_URL exported from .env):
for i in $(seq 1 45); do \
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $HA_TOKEN" "$HA_BASE_URL/api/")" = 200 ] \
  && { echo up; break; }; sleep 2; done
```

(Or use the sibling `/run-haventory` skill's deploy path.) Confirm it loaded with
`stress.py baseline` below before trusting any result.

## Run (agent path): the stress regimen

`stress.py` is the adversarial online driver. Each subcommand runs one layer, prefixes its
data with `stress_test_` (so `cleanup` sweeps it), and polls `haventory/health` as the pass
gate (`healthy: true`, `issues: []`). Run **one at a time, non-destructive first, `restart`
last**. Reads `HA_BASE_URL`/`HA_TOKEN` from `.env`.

```bash
export PYTHONIOENCODING=utf-8   # [Windows/Git Bash] only; a Linux terminal is UTF-8 already
S=".claude/skills/test-haventory/stress.py"
RUN="uv run --no-project --with aiohttp python $S"

$RUN baseline      # health + version — proves the deployed code imported (needs Python 3.14)
$RUN fuzz          # malformed single-mutation inputs; asserts dataset untouched
$RUN bulkfuzz      # adversarial haventory/items/bulk
$RUN subteardown   # HA-core unsubscribe_events teardown (the card's path)
$RUN statsprobe    # stats broadcast: ~1 counts event per mutation
$RUN ratelimit     # enable a tight per-conn budget, hammer, disable, confirm recovery
$RUN races         # rename vs. item versions, concurrent rename, adjust serialization
$RUN bulk 1000     # create 250→500→1000 (latency curve) + delete; ~3½ min on a 2000-item store
HA_CONTAINER=home-assistant $RUN restart   # DESTRUCTIVE, last
$RUN cleanup       # sweep any leftover stress_test_ data
```

| subcommand | what it exercises |
|---|---|
| `baseline` | health + version snapshot (pass gate reference) |
| `fuzz` | malformed inputs → typed error codes, no `unknown_error`, dataset untouched |
| `bulkfuzz` | whole-batch rejects, per-op errors, duplicate-op_id loss |
| `subteardown` | `unsubscribe_events` + dedicated unsubscribe both tear down cleanly |
| `statsprobe` | counts events broadcast on every mutation |
| `ratelimit` | per-conn token bucket enforced + full recovery on disable |
| `bulk [N]` | bulk create/delete scale; prints p50/p95/p99 latency curve |
| `races` | optimistic-concurrency + serialization under concurrent writers |
| `hammer [SECS]` | background mixed-op storm (drive the UI under load) |
| `restart` | mid-load `docker restart` + on-disk store vs API cross-check |
| `cleanup` | delete everything prefixed `stress_test_` |

**A run is not clean until you scan the server logs** — offline stubs can stay green while
real HA throws (that is how the `__slots__` bug #97 was found). The sibling skill's sweep
sorts the log by the taxonomy's severity policy instead of by keyword, so the fuzz layers'
hundreds of contract-defined WARNINGs do not bury the one line that matters:

```bash
uv run python .claude/skills/run-haventory/log_sweep.py --since 30m
# → BLOCKING: 0 ... verdict: PASS
```

## Run (agent path): live-update browser smoke

Drives the **real card** in headless Chromium and makes changes over a *separate* WS
connection, so the card can only learn of them via its subscription (create→rename→delete
reflected live, zero console errors). Opt-in; from `cards/haventory-card`:

```bash
RUN_ONLINE=1 node e2e/live-updates.smoke.mjs
# → PASS: card reflects live create / rename / delete over the WS subscription
# (equivalently: RUN_ONLINE=1 npm run test:e2e)
# [Windows/Git Bash] prepend PLAYWRIGHT_BROWSERS_PATH="$HOME/AppData/Local/ms-playwright"
```

Screenshot the card (e.g. while a `stress.py hammer 30` storm runs, to eyeball it under load)
via the sibling skill:

```bash
node .claude/skills/run-haventory/screenshot.mjs --out /tmp/card.png
```

## Run (agent path): online WS pytest smokes

Non-destructive WS client tests against the running instance, from the repo root:

```bash
set -a; source .env; set +a
RUN_ONLINE=1 uv run --no-project --python 3.14 \
  --with pytest --with pytest-asyncio --with aiohttp --with voluptuous \
  python -m pytest -q -m online -k "ws_smoke or ws_smoke_advanced"
# → 8 passed, 13 skipped (as of v0.3.1; the skips need the destructive/area gates)
```

The full online gate (adds destructive + area-registry tests, double-gated by
`HAV_ONLINE_DESTRUCTIVE=1` / `HA_ALLOW_AREA_MUTATIONS=1`) and the in-process HA integration
suite (`scripts/test_integration.sh`, phacc, real HA core) are documented in the README —
not re-verified here.

## Gotchas

- **`--no-project` is the fallback, not the rule** — plain `uv run` works. Add `--no-project`
  and the `--with` list to run from an ephemeral env whenever the project venv is unusable.
  [Windows/Git Bash] the way that shows up here is `failed to remove file .venv/lib64:
  Zugriff verweigert`, OneDrive refusing to delete the symlink.
- **Offline suite needs Python 3.14** (PEP 758 source) and `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`;
  `--with aiohttp` is only so the `*_online.py` / stress modules import at collection time.
- **Frontend `node_modules` is often partial** (missing the platform's `@rolldown/binding-*`
  → vitest/vite crash on start). `npm ci` in `cards/haventory-card` fixes it.
- **`stress.py restart` needs `HA_CONTAINER`**, and leaves the container restarted
  (disposable). [Windows/Git Bash] it also needs `MSYS_NO_PATHCONV=1`, or Git Bash rewrites
  the `/config/...` docker path.
- **`ratelimit` rebuilds the limiter on save** (buckets refill, counters zero) — it samples
  `dropped_commands` before disabling and always resets rate limiting OFF, even on failure.
- **Expected non-bugs the layers surface — do NOT file as regressions** (tracked as
  GitHub issues): duplicate bulk `op_id` → silent last-wins loss (issue #197); bulk-create
  p50 grows superlinearly (O(N²) persist, issue #200) — a **WARN**, not a failure.
- **E2E: assert on the item NAME, not the quantity cell** — the card renders quantity only
  when that column is active, but the name always renders.
- **Log scan is part of the pass gate** — subscription/connection bugs can pass offline unit
  tests while real HA throws (`__slots__`, `subscribeMessage` frame shape). Grep the container
  logs after any online run.

## Troubleshooting

- **`Cannot find module '@rolldown/binding-…'`** — `npm ci` in `cards/haventory-card`.
- **`No module named 'aiohttp'`** during pytest collection — add `--with aiohttp` to the uv run.
- [Windows/Git Bash] **`failed to remove file .venv/lib64: Zugriff verweigert`** — the project
  venv is unusable; re-run with `--no-project` plus the `--with` list.
- [Windows/Git Bash] **`GetFileAttributesEx C:\c:` on `docker cp`** — host-path mangling; use
  the tar-pipe deploy above instead.
- **`stress.py` baseline errors / `unknown command`** — check `.env` has `HA_BASE_URL`/`HA_TOKEN`
  and the container is up; run `baseline` first to confirm the integration imported.
- **E2E redirected to `/auth/authorize`** — `HA_TOKEN` is missing/expired.
- **`pre-commit` not found on commit** — `uv tool install pre-commit`.
