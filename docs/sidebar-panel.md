# Sidebar panel plan — a first-class place in the post-Overview-redesign frontend

Status: **delivered** — PR-1 (frontend) and PR-2 (registration + options toggle) are both
on `main`; item 58 is closed in [`open-items.md`](open-items.md). This document is the
implementation contract it was built to: research findings, the two feasibility questions
answered with evidence, the design, a regression register, and the staged Opus 5
implementation prompts in the appendices.

## Why — the new Overview has no card surface (findings, 2026-08-01)

HA's redesigned Overview — the default landing page for new installations since the
2026.6 dashboard overhaul — is the built-in **`home` panel**, not a Lovelace
dashboard. Verified against HA 2026.7.4 (core source + shipped frontend bundle in the
dev container):

- The panel is registered unconditionally in core `frontend/__init__.py` alongside the
  summary panels (`light`, `security`, `climate`, `maintenance`), `show_in_sidebar=False`.
- Its editor ("Edit Overview page") offers exactly: a welcome-message toggle, favorite
  entities, suggested entities, the fixed summaries, and **shortcuts**. A shortcut is a
  navigation tile `{path, label, icon, color}`; the "Add shortcut" button opens
  `ha-navigation-picker`, whose `_loadNavigationItems` enumerates **all of
  `hass.panels`** (minus a small core blocklist and `app`-type panels) plus the views
  of Lovelace dashboards. There is no card picker and no "take control" — **no card,
  core or custom, can be placed on this page**.
- The page's configuration is saved **per user** via `frontend/set_user_data`, so
  there is no supported server-side write path either: an integration cannot inject a
  shortcut, a summary, or anything else.

Consequence: `window.customCards` registration still puts the card in every normal
dashboard's picker (unchanged, works), but on a fresh install nobody sees HAventory
until they create a dashboard by hand. The one first-class integration point the new
Overview offers is **a navigation path worth adding as a shortcut** — which means a
**sidebar panel**.

## Decision

Register a **HAventory sidebar panel** at `/haventory` that renders the card's
extended view (`hv-full-view`) as a full page, served from the existing card bundle.
Expose a **"Show HAventory in the sidebar" toggle in the options flow** (default on)
that registers/removes the panel live. This yields:

- HAventory in the sidebar automatically on install — zero-config discoverability,
  for every user of the instance.
- An entry in the Overview's "Add shortcut" picker, so users can pin an HAventory
  tile onto the new Overview page — the closest thing to "being on the Overview"
  the new architecture allows.

## Feasibility — the two questions asked

### Q1: Can the panel open in extended mode (or at least full-screen card mode)? — Yes, extended mode

`hv-full-view` is already the extended experience, but today it is a modal takeover:
`.backdrop` + `.shell` are `position: fixed; inset: 0`, the shell is
`role="dialog" aria-modal="true"` with Escape-to-close and focus-trap sentinels, and
`render()` returns nothing until `open` is set (`hv-full-view.ts`). None of that
blocks embedding — it needs an **`embedded` variant**, not a rewrite:

- host sized by the parent (`:host` is `display: contents` today; embedded mode makes
  it a `display: block; height: 100%` box and the shell `position: relative` filling
  it, no backdrop, no overlay shadow, no z-index dance);
- dialog semantics off (no `aria-modal`, no Escape-close, no sentinels, no close
  button — a panel has nowhere to close to);
- a menu button in the app bar when HA is in narrow mode, dispatching the standard
  `hass-toggle-menu` event, because a custom panel owns the whole content area and
  must offer the sidebar-open affordance itself.

A `haventory-panel` element (same bundle) receives `hass` / `narrow` / `route` /
`panel` from HA's custom-panel loader, owns a `Store` exactly as `HAventoryCard`
does, and renders `<hv-full-view embedded open …>`. The "full-screen card mode"
fallback the owner offered is strictly worse (a card floating in a page-sized void)
and is not needed — the extended mode is the plan.

### Q2: Can the sidebar be toggled from the config flow via a normal supported HA route? — Yes

The whole path is standard HA machinery, no private frontend state involved:

- **Register:** `panel_custom.async_register_panel(hass, frontend_url_path,
  webcomponent_name, sidebar_title, sidebar_icon, module_url, embed_iframe,
  trust_external, config, require_admin, config_panel_domain)` — the documented
  developer API for integration-provided panels (HACS ships its panel through the
  same call). Internally it is `frontend.async_register_built_in_panel(
  component_name="custom", config={"_panel_custom": {...}})`.
- **Remove:** `frontend.async_remove_panel(hass, frontend_url_path, *,
  warn_if_unknown=True)`.
- **Live toggle:** both calls fire `EVENT_PANELS_UPDATED`, which the frontend
  subscribes to — the sidebar entry appears/disappears **without a restart**. The
  options flow feeds the existing update listener (`__init__.py` registers
  `_async_options_updated` via `entry.add_update_listener`, on `main` today), which
  already applies option changes without a reload; the panel toggle slots in beside
  the rate-limiter rebuild.

Caveats, none blocking:

- `panel_custom` is `quality_scale: internal` (like `lovelace`, which HAventory
  already rides) — treat it with the same defensive-import / graceful-degradation
  pattern, and add `"panel_custom"` to `manifest.json` `dependencies` so setup
  ordering is guaranteed.
- `async_register_built_in_panel` raises `ValueError("Overwriting panel …")` when the
  URL path is already registered and `update=False` — the registration helper must be
  idempotent (tracked flag, remove-before-register).
- Per-user hiding needs no code at all: HA natively lets each user hide any sidebar
  item (sidebar edit mode). The option is the **instance-wide** switch; the README
  should say both exist.

## API verification

Every symbol was verified twice: against the **2026.6.0 floor** (core git tag — the
version `requirements-integration.txt` pins, so the phacc suite re-verifies it in CI
forever) and against **2026.7.4 current stable** (installed wheel in the dev
container). Signatures are identical at both ends.

| Symbol | 2026.6.0 (floor) | 2026.7.4 (stable) |
|---|---|---|
| `panel_custom.async_register_panel(...)` | present, same params/defaults | present |
| `frontend.async_register_built_in_panel(..., *, update=False, show_in_sidebar=True)` | present; raises on duplicate unless `update=True` | present, same |
| `frontend.async_remove_panel(hass, url_path, *, warn_if_unknown=True)` | present | present |
| `EVENT_PANELS_UPDATED` fired on register + remove | yes | yes |
| Custom panel loader passes `hass`/`narrow`/`route`/`panel` props; `config` param lands in `panel.config` | yes | yes |

## Design

### Backend — registration lifecycle (`__init__.py`)

- **URL:** reuse `_async_card_url(hass)` verbatim — the panel's `module_url` is the
  same `/haventory_static/haventory-card.js?v=<version>` string both existing loaders
  get. The browser module map dedupes, so the bundle still evaluates exactly once;
  `defineCardElement` covers the registry-swap timing for the panel element the same
  way it does for the card.
- **Register on setup** (after `_register_frontend_module`), when the option is on
  and the bundle exists (missing bundle keeps the graceful DEBUG skip):
  `frontend_url_path="haventory"`, `webcomponent_name="haventory-panel"`,
  `sidebar_title=<card title option>`, `sidebar_icon="haventory:logo"`,
  `module_url=<card URL>`, `embed_iframe=False`, `trust_external=False`,
  `require_admin=False`, `config={"title": <card title option>}` (the panel element
  reads `panel.config.title` for its heading, mirroring `haventory/config` for the
  card).
- **Idempotence:** a `hass.data[DOMAIN]["panel_registered"]` flag; the register
  helper removes any stale `haventory` panel first (`warn_if_unknown=False`), so
  reload and toggle paths cannot hit the `ValueError`.
- **Unload:** remove the panel and clear the flag (alongside `_remove_extra_js_url`).
- **Options update** (`_async_options_updated`): recompute desired state from
  `CONF_SIDEBAR_PANEL_ENABLED` + card title; remove-then-register when on (this also
  applies a title change), remove when off. No entry reload needed — consistent with
  how the rate limiter and card title already apply.
- **Defensive imports:** `panel_custom` / `frontend.async_remove_panel` imported
  like `add_extra_js_url` is today — absence degrades to a DEBUG log, never a setup
  failure, and the offline stubs keep working.

### Frontend — `embedded` full view + `haventory-panel`

- `hv-full-view` gains `@property({ type: Boolean, reflect: true }) embedded = false`:
  skips the backdrop and sentinels, drops `role="dialog"`/`aria-modal`/Escape-close,
  hides the close button, and switches the shell from viewport-fixed to filling the
  host. Everything else — app bar, sidebar facets, table, editors, selection — is
  untouched and shared with the card's overlay use.
- New `narrow` + menu-button affordance: when `embedded` and narrow, the app bar
  leads with a hamburger dispatching `hass-toggle-menu` (bubbles, composed).
- New `src/haventory-panel.ts`: registered via `defineCardElement`; `hass` setter
  creates the `Store` once (same lifecycle as `HAventoryCard`); renders
  `<hv-full-view embedded open .store .heading .columns .menuEntries>` plus the
  host-owned surfaces. Heading: `panel?.config?.title`, falling back to the default.
  Imported from `index.ts` so it ships in the same bundle.
- **Full surface parity via `src/host-surfaces.ts`.** `hv-full-view` raises actions it
  cannot answer itself — the column picker, the export download, the item editor's
  Delete (`request-delete`), the sidebar's "+" beside Categories/Tags (`menu-action`
  `organize` with a tab), the empty state's "Import backup" offer, Diagnostics,
  Refresh. Every one of them is host-agnostic, so the `HostSurfaces` class owns them
  all: the column picker + export download, a confirm surface (the delete
  confirmation, plus the generic prompt the card's discard-changes check reuses), the
  organize dialog, the import sheet (preview/execute state included), the diagnostics
  panel together with the refresh busy/timestamp it displays, and the shared ⋮
  menu-entry builder — so the two hosts cannot drift apart on what the menu offers.
  An instance lives in each element that directly hosts the inventory UI:
  `hv-card-shell` for the card and `haventory-panel` for the panel (`haventory-card`
  itself is a thin store-owning wrapper). Host-specific behaviour enters through
  constructor hooks: `isMobile` (the shell's measured width; the panel's
  `NARROW_QUERY` viewport match), `onItemDeleted` (the shell closes editors pointing
  at the item), `onBrowse` (the card opens its full view; the panel's is always
  open). The only action that stays host-specific is `select-items`, which is about
  *where* selection happens rather than a dialog.
- `hv-full-view` closes its inline editor when the item being edited disappears from
  the store — a confirmed delete (or another client's) would otherwise leave the
  editor rendering a null item, which is the create form. On the panel there is no
  shell to clean up after the editor, so the view has to do it; the card gets the
  same fix.

### Options flow + strings

- `const.py`: `CONF_SIDEBAR_PANEL_ENABLED = "sidebar_panel_enabled"`,
  `DEFAULT_SIDEBAR_PANEL_ENABLED = True`, panel path/name constants.
- Options schema: one boolean, default from stored options. Entries created before
  the option existed have no value → treated as on (the discoverability is the
  point; an explicit off is respected forever).
- `strings.json` + `translations/en.json`: label "Show HAventory in the sidebar",
  description covering: applies to all users; individual users can still hide it via
  the sidebar's own edit mode; the Overview "Add shortcut" tip.
- **Coexistence note:** an options-flow rework (sectioned rate-limit UI) is in flight
  on another branch — implement against whatever `main` has at implementation time
  and place the toggle at the top level of the init step, not inside the rate-limit
  section.

## Regression register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Duplicate panel registration on entry reload → `ValueError: Overwriting panel haventory` | Remove-before-register + `hass.data[DOMAIN]` flag; offline test: setup → unload → setup, and a double-setup |
| R2 | Panel left behind after unload/removal → dead sidebar entry pointing at a torn-down backend | Unload removes the panel; `async_remove_entry` path re-checked; offline tests assert removal |
| R3 | A user is **on** `/haventory` when the toggle turns it off | Acceptable: HA shows panel-not-found on next navigation; nothing crashes. Documented in README |
| R4 | Second module evaluation via `module_url` → `customElements.define` throws | Same URL string as both existing loaders — module map dedupes; unit test asserts the panel registration receives the identical URL |
| R5 | Registry swap strands `haventory-panel` like it did the card | `defineCardElement` (already shipped) registers the panel element; register.test.ts pattern extended to it |
| R6 | Offline stubs lack `panel_custom` → suite breaks | Extend `tests/conftest.py` stubs; defensive import degrades to DEBUG |
| R7 | phacc harness lacks the frontend wheel → panel test fails like R4 in the card-shipping plan | Wheel already pinned in `requirements-integration.txt` (`test_frontend.py` guards it); panel integration test rides the same install |
| R8 | Floor drift — a future HA changes the panel APIs | phacc suite runs at the pinned floor in CI; `tests/integration/` gains a real registration test |
| R9 | Deprecation risk on the update-listener path (the 2026.6 config-entry deprecations were checked when HAventory had **no** listener) | Live-check step: grep the container log for deprecation warnings naming haventory after exercising the toggle |
| R10 | Narrow mode leaves no way to open the sidebar from the panel | `hass-toggle-menu` menu button, asserted in a vitest case; live check at a phone viewport |
| R11 | `embedded` regresses the card's overlay full view | Vitest covers both variants; the overlay path keeps its existing tests |
| R12 | HACS zip / release flow misses the panel | Nothing to do — the panel lives in the existing bundle; `check_release_zip.py` already asserts the bundle in the asset |
| R13 | Moving confirm/organize/import/diagnostics out of `hv-card-shell` regresses the card's dialogs | The dialogs still render inside the shell's shadow root (via its `HostSurfaces` instance), so the shell's existing dialog tests run against the moved surfaces; the panel gets its own cases for the same flows |

## Staged delivery — main stays running after every merge

**PR-1 — frontend: embedded full view + panel element + host-surface parity.** The
new element ships in the bundle but nothing instantiates it yet — inert. The card's
behaviour is unchanged apart from one deliberate fix (the full view's editor closes
when the edited item is deleted); its dialog surfaces move homes internally
(`hv-card-shell` → its `HostSurfaces` instance) without changing what they do. The
parity work lands here rather than PR-2 precisely because it refactors the card:
better before the panel is live than after.

**PR-2 — backend: registration + options toggle + strings + tests + docs.** Turns
the feature on. Includes the live verification pass.

## Decisions taken (revisit only with a reason)

- Toggle **default on** — discoverability is the feature; opt-out is respected.
- Sidebar title follows the existing **card title option** (falls back "HAventory"),
  so a user who renamed the card to "Pantry" sees "Pantry" in the sidebar.
- Icon `haventory:logo` — the HAventory mark, registered as a custom icon set by the
  card bundle; URL path `haventory`; `require_admin=False`.
- Panel renders the **extended view**, not a page-sized card.
- The panel offers the **full ⋮ menu** — organize, import and diagnostics included.
  Every surface `hv-full-view` can raise is owned by `host-surfaces.ts` and rendered
  by both hosts; a panel entry that silently did nothing (or a visible control with
  no handler) is not acceptable, least of all the empty state's "Import backup",
  which is the first thing a fresh install sees.
- No auto-added Overview shortcut — per-user data, no public API, and silently
  editing a user's personalized page would be wrong even if it worked.

---

## Appendix A — implementation prompt for PR-1 (Opus 5)

> Read `docs/sidebar-panel.md` first; it is the contract for this change. Implement
> **PR-1 only** (frontend: embedded full view + `haventory-panel` element) on a fresh
> branch off `main`.
>
> Scope (all inside `cards/haventory-card/`):
> 1. `src/components/hv-full-view.ts`: add
>    `@property({ type: Boolean, reflect: true }) embedded = false`. When set:
>    render no backdrop and no focus sentinels; the shell drops `role="dialog"`,
>    `aria-modal`, the Escape-to-close handler and the close button; `:host` becomes
>    a `display: block; height: 100%` box and the shell `position: relative;
>    inset: auto; height: 100%; box-shadow: none` (keep the grid rows and the
>    overflow-x rationale comment — the constraint still holds). The overlay variant
>    must be byte-for-byte unaffected; do not fork the template beyond these points.
> 2. Narrow-mode sidebar affordance: add a `narrow` boolean property; when
>    `embedded && narrow`, the app bar leads with a menu button that dispatches
>    `new Event('hass-toggle-menu', { bubbles: true, composed: true })`. Verify the
>    exact event name against the HA frontend source before relying on it, and record
>    what you found in the PR body.
> 3. New `src/haventory-panel.ts`: a Lit element registered via
>    `defineCardElement('haventory-panel', …)` (never a bare
>    `customElements.define`). Properties set by HA's custom-panel loader: `hass`,
>    `narrow`, `route`, `panel`. Mirror `HAventoryCard`'s store lifecycle (create
>    `Store` once on first `hass`, subscribe/unsubscribe on connect/disconnect).
>    Render `<hv-full-view embedded open>` wired with `.store`, `.heading`
>    (`panel?.config?.title` string, else the default title), `.columns` +
>    `.menuEntries` and the host-owned surfaces. Import the new module from
>    `index.ts` so it lands in the bundle.
> 4. Host-surface parity (`src/host-surfaces.ts`): one `HostSurfaces` class owning
>    every surface `hv-full-view` raises but cannot answer — column picker, export
>    download, the delete confirmation (plus the generic confirm the shell's
>    discard-changes prompt reuses), the organize dialog, the import sheet, the
>    diagnostics panel with its refresh state, and the shared ⋮ menu-entry builder.
>    The instance lives in `hv-card-shell` and in `haventory-panel`; `index.ts`
>    becomes a thin store-owning wrapper. Host differences enter as constructor
>    hooks (`isMobile`, `onItemDeleted`, `onBrowse`); `select-items` stays
>    host-specific. `hv-full-view` additionally closes its inline editor when the
>    edited item disappears from the store, so a confirmed delete does not leave the
>    create form behind.
> 5. Tests (TDD; happy path + edge cases per repo convention), vitest:
>    embedded mode renders without backdrop/dialog semantics and ignores Escape;
>    overlay mode still closes on Escape and backdrop click; the menu button appears
>    only when `embedded && narrow` and dispatches `hass-toggle-menu`; the panel
>    element builds a store from `hass`, falls back on a missing
>    `panel.config.title`, and survives `hass` updates without rebuilding the store;
>    `register.test.ts` gains the `haventory-panel` case; the panel answers every
>    action the view can raise — delete lands in the confirm-then-store flow,
>    the sidebar "+" opens Organize on the right tab, the empty state's offer opens
>    the import sheet, Diagnostics opens, and the ⋮ menus of card full view and
>    panel cannot drift apart; the card's dialog flows still pass against the moved
>    surfaces.
> 6. Gates before every commit (both must be green): backend
>    `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest -q`, `uv run ruff check .`,
>    `uv run ruff format --check .`, `uv run mypy`; frontend (in
>    `cards/haventory-card`) `npx eslint .`, `npm run typecheck`, `npx vitest run`,
>    `npm run build`.
>
> Non-goals: no backend changes, no manifest/options/strings changes (PR-2), no
> registration of the panel anywhere. The card must behave identically after this PR.
> Conventional Commits; comments follow the CLAUDE.md comment policy (constraints,
> not history).

## Appendix B — implementation prompt for PR-2 (Opus 5)

> Read `docs/sidebar-panel.md` first; it is the contract. PR-1 (embedded full view +
> `haventory-panel` in the bundle) must already be on `main` — verify before starting.
> Implement **PR-2 only** (backend registration + options toggle) on a fresh branch
> off `main`.
>
> Scope:
> 1. `const.py`: `CONF_SIDEBAR_PANEL_ENABLED = "sidebar_panel_enabled"`,
>    `DEFAULT_SIDEBAR_PANEL_ENABLED = True`, `PANEL_URL_PATH = "haventory"`,
>    `PANEL_ELEMENT_NAME = "haventory-panel"`, `PANEL_ICON = "haventory:logo"`.
> 2. `__init__.py`: a `_async_apply_sidebar_panel(hass, entry)` helper that computes
>    desired state (option on + bundle present) and converges to it:
>    remove any existing `haventory` panel (`frontend.async_remove_panel`,
>    `warn_if_unknown=False`), then, when desired, register via
>    `panel_custom.async_register_panel` with the parameters fixed in the Design
>    section — `module_url` MUST be the exact `_async_card_url(hass)` string the two
>    existing loaders receive. Track state in `hass.data[DOMAIN]["panel_registered"]`.
>    Call it from `async_setup_entry` (after `_register_frontend_module`), from
>    `_async_options_updated` (this also applies card-title changes to the sidebar
>    title), and remove the panel in `async_unload_entry`. All frontend/panel_custom
>    imports are defensive, mirroring the `add_extra_js_url` pattern: absence logs
>    DEBUG and never fails setup.
> 3. `manifest.json`: `dependencies` gains `"panel_custom"`.
> 4. Options flow: add the boolean to the init-step schema, defaulting from stored
>    options (missing → on). Place it at the top level, not inside the rate-limit
>    section — an options-flow rework may have landed since this plan was written;
>    follow the file's current structure. `strings.json` + `translations/en.json`:
>    label "Show HAventory in the sidebar"; description states it applies to all
>    users, that each user can still hide the entry via the sidebar's own edit mode,
>    and that the Overview's "Add shortcut" can pin the panel.
> 5. Offline stubs: extend `tests/conftest.py` with
>    `homeassistant.components.panel_custom.async_register_panel` and
>    `homeassistant.components.frontend.async_remove_panel` recording stubs.
> 6. Tests (TDD): offline — registered on setup with the exact expected kwargs
>    (assert the URL equals what the extra-JS loader received); setup → unload →
>    setup registers exactly once live with no `ValueError`; toggle off removes /
>    toggle on re-registers via a simulated options update; card-title change
>    re-registers with the new sidebar title; missing bundle skips registration;
>    missing `panel_custom` degrades to DEBUG. Integration (`tests/integration/`,
>    phacc at the pinned floor): real registration lands in `hass.data["frontend_panels"]`
>    (resolve the real dict key from core source, do not guess) with
>    `component_name == "custom"` and the `_panel_custom` config, and unload removes
>    it.
> 7. Docs: README (feature list, install/discoverability section — sidebar entry,
>    the per-user hide, the Overview "Add shortcut" walkthrough, the new-Overview
>    no-cards limitation), `docs/frontend_architecture.md` (panel element), CLAUDE.md
>    architecture bullet. Keep `docs/backend_api_contract.md` untouched — no WS
>    change.
> 8. Gates before every commit: the full backend + frontend gates from Appendix A,
>    plus one `scripts/test_integration.sh` run (the new manifest dependency must not
>    break the phacc suite — that trap is real, see the card-shipping plan's R4).
> 9. Live verification with the run-haventory skill: deploy; the sidebar shows
>    HAventory; the panel renders the extended view (screenshot, desktop + narrow —
>    check the menu button); toggle off in options → entry disappears without a
>    restart; toggle on → returns; the Overview editor's "Add shortcut" picker lists
>    HAventory (screenshot); grep the container log for tracebacks and for
>    deprecation warnings naming haventory (regression register R9). Do the
>    element-registration check in **Firefox** — it loses the registry-swap race
>    where Chromium wins it.
>
> Non-goals: no auto-added Overview shortcut, no changes to the card's own loaders or
> the release/zip flow, no options-flow restructuring beyond adding the toggle.
> Conventional Commits; comments per the CLAUDE.md policy. Report out-of-scope
> findings under "Follow-ups" in the PR body.
