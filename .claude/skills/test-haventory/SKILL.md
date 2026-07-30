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

All paths are relative to the repo root. This is a **Windows host**: run `.sh`/`.py` through
Git Bash. Plain `uv run` works against the project `.venv` — the `--no-project` form below is
still correct and is what to fall back to if the venv is ever unusable again, but it is no
longer required. Canonical clean-Linux/CI commands live in the README ("The gate").

## Prerequisites

- **uv** (provisions CPython 3.14 automatically — the source uses PEP 758 syntax that does
  not parse on ≤3.13), **Node 22.13+**, **Docker** (for the online surfaces), **Git Bash**.
- `pre-commit` on PATH (the git hook needs it): `uv tool install pre-commit`.
- A `.env` at the repo root with `HA_BASE_URL` + `HA_TOKEN` (a long-lived token; per session,
  never committed). The online surfaces read it directly.
- For the browser smoke: Chromium for Playwright — `npx playwright install chromium` (cached
  at `~/AppData/Local/ms-playwright` on this host).

## The commit gate (offline — run before every commit)

Both halves must be green. Backend, from the repo root:

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run --no-project --python 3.14 \
  --with pytest --with pytest-asyncio --with voluptuous --with aiohttp \
  python -m pytest -q
# → 350 passed, 22 skipped

uv run --no-project --python 3.14 --with ruff==0.15.22 ruff check custom_components tests
# → All checks passed!

uv run --no-project --python 3.14 --with mypy --with voluptuous mypy
# → Success: no issues found in 13 source files
```

Frontend, from `cards/haventory-card`:

```bash
npm ci            # first run, or if node_modules is partial (missing rolldown binding)
npm run lint      # eslint  → clean
npm run typecheck # tsc --noEmit → clean
npm test          # vitest  → 812 passed across 42 files
npm run build     # vite → ../www/haventory/haventory-card.js (git-ignored)
```

Warm the hooks before committing (never `--no-verify`):

```bash
pre-commit run --files <changed paths>
```

## Deploy current code first (required for all online surfaces)

The online surfaces test the **running container**, so deploy the working tree into it first.
`docker cp` of host paths mangles under Git Bash, so use a tar pipe (verified this session):

```bash
tar -C custom_components -cf - haventory | MSYS_NO_PATHCONV=1 \
  docker exec -i home-assistant sh -lc \
  'cd /config/custom_components && tar -xf - && find haventory -type d -name __pycache__ -prune -exec rm -rf {} +'
npm --prefix cards/haventory-card run build >/dev/null
tar -C cards/www -cf - haventory | MSYS_NO_PATHCONV=1 \
  docker exec -i home-assistant sh -lc 'mkdir -p /config/www && cd /config/www && tar -xf -'
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
export PYTHONIOENCODING=utf-8   # unicode-safe output on Windows consoles
S=".claude/skills/test-haventory/stress.py"
RUN="uv run --no-project --with aiohttp python $S"

$RUN baseline      # health + version — proves the deployed code imported (PEP 758 needs 3.14)
$RUN fuzz          # malformed single-mutation inputs; asserts dataset untouched
$RUN bulkfuzz      # adversarial haventory/items/bulk
$RUN subteardown   # HA-core unsubscribe_events teardown (the card's path)
$RUN statsprobe    # stats broadcast: ~1 counts event per mutation
$RUN ratelimit     # enable a tight per-conn budget, hammer, disable, confirm recovery
$RUN races         # rename→version invalidation, concurrent rename, adjust serialization
$RUN bulk 1000     # create 250→500→1000 (latency curve) + delete; ~3½ min on a 2000-item store
MSYS_NO_PATHCONV=1 HA_CONTAINER=home-assistant $RUN restart   # DESTRUCTIVE, last
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
reflected live, zero console errors). Opt-in; from `cards/haventory-card` (ships with PR #96):

```bash
RUN_ONLINE=1 PLAYWRIGHT_BROWSERS_PATH="$HOME/AppData/Local/ms-playwright" \
  node e2e/live-updates.smoke.mjs
# → PASS: card reflects live create / rename / delete over the WS subscription
# (equivalently: RUN_ONLINE=1 npm run test:e2e)
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
# → 8 passed, 13 skipped
```

The full online gate (adds destructive + area-registry tests, double-gated by
`HAV_ONLINE_DESTRUCTIVE=1` / `HA_ALLOW_AREA_MUTATIONS=1`) and the in-process HA integration
suite (`scripts/test_integration.sh`, phacc, real HA core) are documented in the README —
not re-verified here.

## Gotchas

- **`--no-project` is the fallback, not the rule** — plain `uv run` works. If it ever fails with
  `failed to remove file .venv/lib64: Zugriff verweigert` (OneDrive refusing to delete the
  symlink), add `--no-project` and the `--with` list to run from an ephemeral env instead.
- **Offline suite needs Python 3.14** (PEP 758 source) and `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`;
  `--with aiohttp` is only so the `*_online.py` / stress modules import at collection time.
- **Frontend `node_modules` is often partial** (missing `@rolldown/binding-win32-x64-msvc` →
  vitest/vite crash on start). `npm ci` in `cards/haventory-card` fixes it.
- **`stress.py restart` needs `MSYS_NO_PATHCONV=1`** (or Git Bash rewrites the `/config/...`
  docker path) **and `HA_CONTAINER`**. It leaves the container restarted (disposable).
- **`ratelimit` rebuilds the limiter on save** (buckets refill, counters zero) — it samples
  `dropped_commands` before disabling and always resets rate limiting OFF, even on failure.
- **Expected non-bugs the layers surface — do NOT file as regressions** (tracked in
  `docs/open-items.md`): duplicate bulk `op_id` → silent last-wins loss (#22); a location
  rename invalidates every subtree item's `expected_version` → `conflict` (#23); bulk-create
  p50 grows superlinearly (O(N²) persist, #19) — a **WARN**, not a failure.
- **E2E: assert on the item NAME, not the quantity cell** — the card renders quantity only
  when that column is active, but the name always renders.
- **Log scan is part of the pass gate** — subscription/connection bugs can pass offline unit
  tests while real HA throws (`__slots__`, `subscribeMessage` frame shape). Grep the container
  logs after any online run.

## Troubleshooting

- **`failed to remove file .venv/lib64: Zugriff verweigert`** — the project venv is unusable
  again; re-run with `--no-project` plus the `--with` list.
- **`Cannot find module '@rolldown/binding-win32-x64-msvc'`** — `npm ci` in `cards/haventory-card`.
- **`No module named 'aiohttp'`** during pytest collection — add `--with aiohttp` to the uv run.
- **`GetFileAttributesEx C:\c:` on `docker cp`** — host-path mangling under Git Bash; use the
  tar-pipe deploy above instead.
- **`stress.py` baseline errors / `unknown command`** — check `.env` has `HA_BASE_URL`/`HA_TOKEN`
  and the container is up; run `baseline` first to confirm the integration imported.
- **E2E redirected to `/auth/authorize`** — `HA_TOKEN` is missing/expired.
- **`pre-commit` not found on commit** — `uv tool install pre-commit`.
