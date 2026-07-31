# Card shipping plan — HACS install with zero manual card steps

Status: **PR-1 implemented; PR-2 outstanding**. This document is the implementation contract for
closing the release blocker recorded in the release-automation PR: a HACS install of
v0.1.0 would ship no card at all, silently. It supersedes both fix shapes sketched
there ("copy into `www/` at setup" and "serve from the integration directory") with a
researched third shape, and stages the work so `main` stays in a running state after
every merge.

## Decision

Ship the built card **inside** `custom_components/haventory/` (the only tree HACS
copies for an integration-category repo), serve it from there over a registered
static path, and load it through **two** mechanisms with one identical URL:

1. the existing Lovelace resource registration (kept — covers Cast and safe mode,
   storage-mode only), and
2. `homeassistant.components.frontend.add_extra_js_url` (added — public API whose
   docstring names custom integrations as the caller; covers YAML resource mode and
   needs no persisted state).

Package the bundle via HACS `zip_release`: CI builds the card and attaches
`haventory.zip` to each GitHub release; the repo keeps zero build artifacts in git.

### Why not the two shapes considered before

- **Copy into config `www/` at setup** has a fatal flaw verified in core source at the
  2026.6.0 floor (`frontend/__init__.py:553-555`): `/local` is only routed if
  `<config>/www` exists **when the frontend sets up**. On a fresh HA install the
  integration would create `www/haventory/` after that check, and `/local/**` 404s for
  the entire session — the exact silent-no-card failure this work exists to remove.
  It also leaves a permanent orphan in `www/` on uninstall and has no control over
  `/local`'s forced 31-day `Cache-Control`.
- **A single loader** is strictly worse than two: the Lovelace resource collection is
  internal API (`lovelace` is `quality_scale: internal`) and cannot work in YAML
  resource mode (`ResourceYAMLCollection` has no `async_create_item`); `add_extra_js_url`
  is skipped in safe mode and not honored by HA Cast. Together they cover everything.
  Registering the **same URL string** twice is safe — the browser module map dedupes;
  two *different* URLs for the same element throw `customElements.define` errors.

### Precedent (verified against source, 2026-07-30)

| Project | Bundle in git | Packaging | Card loader |
|---|---|---|---|
| frenck/home-assistant-doom (HA core lead) | no — git-ignored | `zip_release` | `add_extra_js_url` |
| piitaya/ha95 (HA frontend lead) | yes | — | `add_extra_js_url` |
| thomasloven/hass-browser_mod | yes (release bot only) | — | `add_extra_js_url` + Lovelace resource |
| AlexxIT/WebRTC | yes | — | Lovelace resource + `add_extra_js_url` |
| hacs/integration | no — git-ignored | `zip_release` | `add_extra_js_url` (iconset) + panel |

Neither HACS nor HA documents an official route; the above is the observable state of
the art. One HACS repo can hold exactly one category (registry keyed by repo id), so
"publish the card as a plugin too" is structurally unavailable — which is fine, since
a second repo would mean the second install step this plan exists to avoid.

## Target end state

- Vite builds to `custom_components/haventory/www/haventory-card.js` (git-ignored).
- `async_setup_entry` registers
  `StaticPathConfig("/haventory_static", <integration dir>/www, cache_headers=False)`
  once per HA run, guarded by a flag in `hass.data[DOMAIN]` (the bucket survives
  unload; aiohttp has no route unregister, and re-registering a *file* path raises
  order-dependently — registering the *directory* under a guard avoids both).
- One URL builder produces `/haventory_static/haventory-card.js?v=<manifest version>`
  and both loaders receive that exact string.
- `cache_headers=False` (no `Cache-Control`; ETag/Last-Modified revalidation) **and**
  the `?v=` query are both kept: without `Cache-Control`, browsers apply *heuristic*
  freshness (~10% of file age), so a long-unchanged bundle could stay stale for days
  after an upgrade — the version bump in the URL closes that; revalidation covers dev
  rebuilds where the version does not change. It also makes the companion-app
  stale-index problem moot: even a cached index importing last week's `?v=` URL gets
  current bytes, because the path serves the current file after revalidation.
- `manifest.json` `dependencies`: `["http", "frontend", "lovelace"]`.
- Legacy migration: a Lovelace resource whose URL path is
  `/local/haventory/haventory-card.js` is rewritten in place to the new URL (existing
  dev installs must not end up with two resources defining the same element).
- Missing bundle (dev checkout before a build) keeps the graceful DEBUG skip.
- `hacs.json`: `zip_release: true`, `filename: "haventory.zip"`,
  `hide_default_branch: true`; the inert `"filename": "haventory-card.js"` is gone.
- The release workflow builds the card from the tag checkout and attaches
  `haventory.zip` **inside the existing release-please job** — an `on: release`
  workflow would never fire, because release-please publishes with `GITHUB_TOKEN` and
  GitHub does not start workflows for events raised by that token (the same trap the
  tag-check already documents). Release is created as a **draft**, the asset is
  uploaded, then the draft is published — HACS skips drafts, so the release only
  becomes installable once its asset exists (no race window).

## Staged delivery — main stays running after every merge

**PR-1 — the card lives in the integration** (backend + build + dev loop + tests + docs).
After merge: offline suite and CI green; the dev docker loop deploys the card as part
of the component copy; a HACS install from `main` still ships no card — exactly as
today, no worse (bundle is git-ignored either way).

**PR-2 — release packaging** (hacs.json + release workflow + CONTRIBUTING/README).
After merge: everything inert until a release is cut; release-please behavior for
version bumps unchanged.

**Gate:** the open `chore(main): release 0.1.0` PR is merged only after PR-2. That
ordering is the existing rule from the release-automation PR; this plan discharges it.

`zip_release` permanently breaks HACS installs from a branch (upstream closed as
not-planned: hacs/integration#3513, #5009) — `hide_default_branch: true` hides that
option, and nothing in the dogfood plan installs via HACS-from-branch (the dev loop is
`scripts/reload_addon.sh`; plan item A1 is a fresh install of a *release*).

## Regression register

| # | Risk | Mitigation | Verified how |
|---|---|---|---|
| R1 | Two loaders → double module eval → `customElements.define` throws | Byte-identical URL from a single builder; browser module map dedupes | offline test asserts both loaders get the same string |
| R2 | Existing installs keep a stale `/local/...` resource → duplicate define | Migration rewrites the legacy resource in place | offline test with a pre-seeded legacy resource |
| R3 | Entry reload re-registers the static path → `RuntimeError` (file paths, order-dependent) | Register the directory, once, behind a `hass.data[DOMAIN]` flag that survives unload | offline test: set up → unload → set up again |
| R4 | `add_extra_js_url` requires frontend's UrlManager; minimal harnesses (offline stubs, phacc) may lack it | Manifest `dependencies` order real setups; code degrades to DEBUG log when the import/state is missing, mirroring the existing lovelace guards | offline test + run the phacc suite — **which found a harder failure than the graceful one**: a hard `dependencies` entry means HA refuses to set up HAventory *at all* when `frontend` cannot set up, and phacc installs no `home-assistant-frontend` wheel (a real HA installs component requirements at startup; the harness does not), so every integration test failed with `ModuleNotFoundError: hass_frontend`. Fixed by pinning the wheel in `requirements-integration.txt`, guarded against drift by `tests/integration/test_frontend.py` |
| R5 | Dev deploys ship no/stale card once the bundle moves | `reload_addon.sh` builds **before** `docker cp` of the component (bundle rides along); `develop.sh` cp path updated; separate `www/` copy removed | live check via the run-haventory skill |
| R6 | Heuristic caching serves a stale bundle after upgrade | Keep `?v=<manifest version>` on the URL | header check with `curl -I` |
| R7 | Companion app caches the index embedding old URLs | Path-stable URL + revalidation serves current bytes anyway | reasoning above; live check optional |
| R8 | `zip_release` 404s branch installs | `hide_default_branch: true` + README states releases-only | HACS source (`async_install_repository` takes the zip branch unconditionally) |
| R9 | User installs in the window between release creation and asset upload | Draft release → upload asset → publish, all in one job | release workflow review |
| R10 | `on: release` workflow never fires (GITHUB_TOKEN) | Build/upload inside the release-please job, gated on `release_created` | same class of fix as the existing tag check |
| R11 | Safe mode drops `extra_module_url`s | Lovelace resource loader still present | design |
| R12 | HA Cast ignores `extra_module_url`s | Lovelace resource loader still present | design |
| R13 | Wrong zip nesting (extractall does no prefix stripping) | Zip from **inside** `custom_components/haventory`; workflow asserts `manifest.json` and `www/haventory-card.js` at zip root | workflow step |
| R14 | Old dev installs keep an orphan `www/haventory/` | README keeps a one-line legacy cleanup note; new installs write nothing to `www/` | docs |
| R15 | Stray release asset named `haventory-card.js` would bind HACS's download counter | The inert `filename` key is removed in PR-1 | hacs.json diff |

Out-of-scope follow-up (record in `docs/open-items.md` when implementing): the manual
`resources.async_load()` in `_async_lovelace_resources` is redundant at the 2026.6.0
floor (collection methods self-ensure-loaded) and can be dropped in a later cleanup.

## Touchpoint inventory

PR-1: `custom_components/haventory/__init__.py`, `custom_components/haventory/manifest.json`,
`cards/haventory-card/vite.config.ts`, `.gitignore` (line 242), `.pre-commit-config.yaml`
(three `cards/www/` excludes), `scripts/reload_addon.sh`, `scripts/build_frontend.sh`,
`.devcontainer/develop.sh`, `.claude/skills/run-haventory/SKILL.md`,
`.claude/skills/run-haventory/pin_resource.py`, `.claude/skills/test-haventory/SKILL.md`,
`tests/test_frontend_registration.py`, `tests/test_entry_removal_offline.py`,
`tests/conftest.py` (stubs for `homeassistant.components.http` / `frontend`),
`README.md`, `CLAUDE.md`, `docs/frontend_architecture.md`, `docs/release_testing_plan.md` (E5).

PR-2: `hacs.json`, `release-please-config.json`, `.github/workflows/release-please.yml`,
`CONTRIBUTING.md`, `README.md` (install section).

---

## Appendix A — implementation prompt for PR-1

> Read `docs/card_shipping_plan.md` first; it is the contract for this change. Implement
> **PR-1 only** ("the card lives in the integration") on a fresh branch off `main`.
>
> Scope:
> 1. Move the card build target: `cards/haventory-card/vite.config.ts` `outDir` →
>    `../../custom_components/haventory/www`. Update `.gitignore` (replace the
>    `cards/www/` entry with `custom_components/haventory/www/`) and the three
>    `cards/www/` excludes in `.pre-commit-config.yaml`.
> 2. Rework frontend registration in `custom_components/haventory/__init__.py`:
>    - Serve the bundle via
>      `hass.http.async_register_static_paths([StaticPathConfig("/haventory_static", str(Path(__file__).parent / "www"), cache_headers=False)])`.
>      Register the **directory**, exactly once per HA run, guarded by a flag in
>      `hass.data[DOMAIN]` (the bucket survives unload). Import `StaticPathConfig`
>      defensively like the existing `LOVELACE_DATA` import, so offline stubs work.
>    - Build the card URL once: `/haventory_static/haventory-card.js?v=<manifest version>`
>      (keep the existing manifest-version reader and `quote()` escaping). Both loaders
>      below must receive this exact string.
>    - Keep the existing Lovelace-resource registration/rewrite/unregister logic, on the
>      new URL. Extend the matcher so a resource at the legacy path
>      `/local/haventory/haventory-card.js` is recognized as ours and rewritten in place
>      to the new URL (migration for existing installs).
>    - Add `frontend.add_extra_js_url(hass, url)` on setup and `remove_extra_js_url` on
>      unload, with the same defensive-import/graceful-degradation pattern as the
>      lovelace path (missing frontend → DEBUG log, never a setup failure). Store the
>      registered URL in `hass.data[DOMAIN]` so unload removes the exact string.
>    - A missing bundle file keeps the current graceful DEBUG skip. Update the
>      YAML-mode log messages: YAML resource mode is now *covered* by the extra-JS
>      loader, so the "manual resource configuration required" wording is wrong.
> 3. `manifest.json`: `dependencies` → `["http", "frontend", "lovelace"]`.
> 4. Dev loop: in `scripts/reload_addon.sh` build the card **before** the `docker cp` of
>    the component and delete the separate `www/` copy block; update
>    `.devcontainer/develop.sh` (the `cp -r .../cards/www/haventory` line); update the
>    `build_frontend.sh` header comment. In `.claude/skills/run-haventory/`, repoint or
>    retire `pin_resource.py` (its two documented traps — 31-day `/local` cache and
>    duplicate resources — no longer exist under `cache_headers=False` + in-place
>    rewrite; prefer retiring it and simplifying SKILL.md accordingly). Update the stale
>    path references in `.claude/skills/test-haventory/SKILL.md`, `README.md`,
>    `CLAUDE.md`, `docs/frontend_architecture.md`, and `docs/release_testing_plan.md` E5.
> 5. Tests (TDD; happy path + edge cases per repo convention):
>    - Rewrite `tests/test_frontend_registration.py` for the new URL/serving model, and
>      add: static path registered once across setup→unload→setup; both loaders receive
>      the identical URL; legacy `/local` resource migrated in place; YAML resource mode
>      still registers extra-JS; missing frontend degrades gracefully; missing bundle
>      skips gracefully. Update `tests/test_entry_removal_offline.py` (removal must also
>      call `remove_extra_js_url`).
>    - Extend the offline stubs in `tests/conftest.py` with
>      `homeassistant.components.http.StaticPathConfig` and
>      `homeassistant.components.frontend.add_extra_js_url`/`remove_extra_js_url`.
> 6. Gates before every commit (both must be green):
>    backend `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`, `uv run ruff check .`,
>    `uv run ruff format --check .`, `uv run mypy`; frontend (in `cards/haventory-card`)
>    `npx eslint .`, `npm run typecheck`, `npx vitest run`, `npm run build`. Also run
>    `scripts/test_integration.sh` once — the new manifest dependencies must not break
>    the phacc suite.
> 7. Verify live with the run-haventory skill: deploy, confirm
>    `curl -I <HA>/haventory_static/haventory-card.js` returns 200 **without** a
>    `Cache-Control` header, the card renders, and the Lovelace resource list contains
>    exactly one haventory entry pointing at the new URL. Screenshot the card.
>
> Non-goals: no `hacs.json` changes, no release workflow changes (PR-2), no cleanup of
> the redundant `resources.async_load()` (record it in `docs/open-items.md`).
> Conventional Commits; keep `docs/backend_api_contract.md` untouched (no WS change).

## Appendix B — implementation prompt for PR-2

> Read `docs/card_shipping_plan.md` first. PR-1 (card served from the integration
> directory) must already be merged; verify `custom_components/haventory/www/` is the
> build target before starting. Implement **PR-2 only** (release packaging) on a fresh
> branch off `main`.
>
> Scope:
> 1. `hacs.json`: add `"zip_release": true`, `"filename": "haventory.zip"`,
>    `"hide_default_branch": true`. Keep `homeassistant: "2026.6.0"` (guarded by
>    `tests/test_min_ha_version.py` — do not touch declaration sites).
> 2. Release workflow (`.github/workflows/release-please.yml`): the asset must be built
>    in the **same job**, gated on `release_created == 'true'` — a separate
>    `on: release` workflow never fires for GITHUB_TOKEN-created releases (see the
>    existing comment about the tag check; same rule). After the existing
>    tag-consistency step: setup Node 22 (SHA-pinned action, matching repo convention) →
>    `npm ci` + `npm run build` in `cards/haventory-card` →
>    `cd custom_components/haventory && zip -r ../../haventory.zip . -x '*__pycache__*'`
>    → assert layout (`unzip -l` shows `manifest.json` and `www/haventory-card.js` at
>    the zip root — extraction does no prefix stripping, wrong nesting is a silent
>    total failure) → upload with `gh release upload "$TAG" haventory.zip`.
> 3. Close the asset race: configure release-please to create the release as a
>    **draft**, then publish it from the workflow after the asset upload
>    (`gh release edit "$TAG" --draft=false`). Verify the current release-please
>    config key and action outputs against the release-please docs rather than from
>    memory (repo precedent: the bump-flag audit in the release-automation PR); if
>    draft mode changes what `release_created`/`tag_name` report, adapt and document.
>    HACS skips draft releases, so the release only becomes installable with its asset.
> 4. Docs: CONTRIBUTING "Releases" — add the zip asset to the release flow description;
>    README install section — HACS custom-repository install, releases only (the
>    default branch is hidden and carries no bundle).
> 5. Gates: full backend + frontend gates as in PR-1. Workflow files re-parsed
>    (actionlint runs in CI). If a workflow-local test of the zip layout is cheap
>    (e.g. a script invoked by both the workflow and a unit test), prefer it.
> 6. After merge, the standing rule holds: merge the release-please
>    `chore(main): release 0.1.0` PR only once this is on `main`; the first cut must be
>    verified by installing v0.1.0 through HACS (custom repository) on a clean HA and
>    confirming the card appears in the picker with no manual step — that is release
>    testing plan item A1.
>
> Non-goals: no changes to `custom_components/`, no version bumps, no
> `bump-patch-for-minor-pre-major` reintroduction.
