# HAventory Frontend Architecture

## Overview

The HAventory Lovelace card is a Home Assistant dashboard component built with:

- **Framework**: Lit 3 (web components, shadow DOM)
- **Language**: TypeScript 6 (`strict`)
- **Build**: Vite 8 → a single ESM bundle at `cards/www/haventory/haventory-card.js`
- **Tests**: Vitest 4 with jsdom

It provides the full inventory UI, updating live over the HAventory WebSocket API.

> **WP4.1 replaced the proof-of-concept UI with the redesigned one.** The old card is still
> reachable via `ui: legacy` in the Lovelace config while the revamp is experimental; its
> components are listed under [Legacy UI](#legacy-ui-uilegacy) and are otherwise untouched.

---

## Entry point

`src/index.ts` defines `haventory-card` — the element Home Assistant knows about. It owns
the `Store` (created on the first `hass` assignment), the Lovelace interface
(`setConfig`, `getCardSize`, `getStubConfig`, `window.customCards`), and nothing else of
substance. It is a dispatcher:

```ts
setConfig(cfg) → { title?: string; ui?: 'revamp' | 'legacy' }   // default: revamp
render()       → ui === 'legacy' ? legacy template : <hv-card-shell>
```

In revamp mode it renders `<hv-card-shell>` and keeps only the two surfaces the shell hands
back up: the column picker and the export download (which needs a DOM anchor click).

---

## Component map (revamped UI)

```
haventory-card                     Lovelace element; dispatcher + store owner
└── hv-card-shell                  container: header, search, filters, list, footer
    ├── hv-overflow-menu           the ⋮ menu (also used by the app bar and rows)
    ├── hv-filter-chips            removable chips for every active filter
    ├── hv-filter-panel            the complete filter set; desktop panel / mobile sheet
    │   └── hv-location-tree       recursive tree with backend counts
    ├── hv-list                    rows, skeletons, empty states, near-end scroll
    │   ├── hv-list-row            stepper, badges, hover actions, row ⋮
    │   └── hv-item-editor         inline expander (the one edit form)
    │       ├── hv-chip-input      tag chips with suggestions
    │       └── hv-location-tree
    ├── hv-detail-sheet            mobile: read view + edit view in one sheet
    │   ├── hv-item-editor
    │   └── hv-checkout-popover    inline due-date step
    ├── hv-checkout-popover        desktop: anchored due-date step
    ├── hv-organize-dialog         Locations / Categories / Tags
    ├── hv-import-sheet            input → preview → summary (+ invalid-document state)
    ├── hv-diagnostics-panel       health, drop counters, subscriptions, copy report
    ├── hv-confirm                 in-app confirmation (replaces window.confirm)
    ├── hv-banner                  the one alert treatment
    └── hv-full-view               fullscreen workspace
        ├── hv-location-tree       sidebar, manage-capable
        ├── hv-data-table          sortable table + selection column
        └── hv-bulk-bar            bulk actions, progress, per-operation results
```

### Container vs presentation

`hv-card-shell` and `hv-full-view` are **containers**: they hold the `Store` and call it
directly. Everything else is presentational and communicates by events.

This is a deliberate change from the POC, where every component was dumb and the root
element re-dispatched everything. The redesign nests interactions several levels deep (row
→ editor → location tree → selection), and threading each one through the root was the main
source of the POC's plumbing.

Because the shell receives a stable `store` object, a property binding would never
re-render it — so each container subscribes to `store.state.onChange` itself in
`connectedCallback` and unsubscribes on disconnect.

---

## Shared UI layer (`src/ui/`)

| Module | What it does |
|---|---|
| `tokens.ts` | Every design token as a `--hv-*` custom property, bound to the HA theme variable first with the mock hex as fallback, plus dark-mode and reduced-motion overrides. `base` adds the pill/icon-button/chip/input primitives. Composed as `static styles = [tokens, base, css\`…\`]`. |
| `icons.ts` | ~30 MDI glyphs as inline path data, rendered as `<svg fill="currentColor">`. See the deviation note below. |
| `responsive.ts` | `ResponsiveController` — a Lit reactive controller that drives mobile mode from the card's own measured width (≤600px). |
| `relative-time.ts` | "2 h ago" / "Jul 31" formatting, overdue checks, and the `+N days` arithmetic the check-out chips use. |
| `item-form.ts` | Form model and payload building for the edit surfaces: validation per field, typed custom fields, tag normalization, and the `custom_fields_set` / `custom_fields_unset` diff. |
| `value-rewrite.ts` | Tag/category rename, merge and removal as batches of item updates. |
| `health-codes.ts` | Turns the health payload's repeated bare issue codes into one counted sentence each. |
| `fuzzy.ts` | Nearest-existing-value suggestion for the merge flow. |

### Deviation: inline SVG instead of `<ha-icon>`

The design handoff specifies `<ha-icon icon="mdi:…">`. That element only resolves inside
the Home Assistant frontend: in Vitest/jsdom it is an unresolved custom element that renders
nothing, and it would leave the card silently icon-less anywhere HA has not loaded its icon
set. The glyphs are therefore inlined (path data taken verbatim from the design canvas;
Material Design Icons, Apache-2.0). `ha-button-menu` / `mwc-list-item` are likewise replaced
by `hv-overflow-menu`.

---

## Store (`src/store/`)

### `Store`

Holds all app state in a small observable (`createObservable`), fetches over `WSClient`, and
applies optimistic writes with rollback.

**State** (`StoreState`): `items`, `cursor`, `total`, `loading`, `filters`, `selection`,
`pendingOps`, `errorQueue`, `areasCache`, `locationTreeCache`, `locationsFlatCache`,
`statsCounts`, `healthCache`, `versionInfo`, `distinctValuesCache`, `connected`, `degraded`.

**Notable methods**

| Method | Notes |
|---|---|
| `init()` | Parallel cache warm-up, first list, then subscribe. |
| `listItems(reset)` | Page size 50. Keeps `total` — the filtered match count across all pages. |
| `countMatching(filters)` | Prices an unapplied filter with a `limit: 1` probe. Powers the mobile sheet's "Show N items". |
| `listAllMatching(filter)` / `loadAllPages()` | Omitting `limit` returns every match; used by "Load all N to select" and by tag/category rewrites. |
| `setFilters(patch)` | Clears the selection (a row that is no longer listed cannot stay selected) and only rebuilds subscriptions when the *location* scope changes. |
| `bulkExecute(ops, opts)` | Chunks `haventory/items/bulk` (25 ops per call), reports progress, and returns `{succeeded, failed, cancelled}`. |
| `refreshAll()` | Clears the degraded flags, reloads every cache, and re-subscribes. The contract's prescribed recovery. |
| `exportDocument(scope)` | `'view'` forwards the active filter. |
| selection API | `toggleSelected`, `setSelected`, `clearSelection`, `selectAllLoaded`, `loadAllThenSelectAll`. |

**Filter translation.** `toWireFilter(filters)` is the single mapping from card state to the
backend's `ItemFilter`, exported so the count probe and "Export current view" send exactly
what the list is showing. `include_subtree` is always sent explicitly, because the list
filter defaults it to `false` server-side while subscriptions default it to `true`.

**Rate limiting and degraded state.** Every WS call goes through `run()`, which retries a
`rate_limited` rejection with backoff before surfacing it, and classifies failures: a code
from the backend's taxonomy means the socket is fine, anything else counts toward
`degraded.connectionLost`. A *rejected subscribe* — which otherwise kills live updates
silently — marks the card degraded and drops `connected`.

**Why the card offers a manual Refresh.** Subscription events carry no sequence number or
generation, and the rate limiter can drop them silently, so a client cannot detect a gap.
Re-listing on demand is the documented recovery, so it is a first-class action rather than
a hidden one.

### `WSClient`

A typed wrapper over `hass.callWS` for each `haventory/*` command, plus `subscribe()`, which
now takes an `onError` callback so a refused subscribe is observable.

### Column preferences (`src/store/columns.ts`)

`ColumnKey` covers quantity, category, location, tags, due date, inspection date and
updated. Each definition carries a compact `size`, a `tableSize` for the full-view table,
and — only where the backend can actually sort by it — a `sortField`. Category, location and
tags have none, so their headers are not clickable: a header that looks interactive but does
nothing is worse than a plain one.

Preferences persist in `localStorage` under `haventory:columns:v1`, per scope
(`standard` / `expanded`). `LEGACY_DEFAULT_COLUMNS` pins what the pre-WP4.1 components fall
back to, so the redesigned defaults can move independently.

---

## Behaviour worth knowing

- **One edit form.** `hv-item-editor` is used by the inline expander, the full view and the
  mobile sheet. On mobile it stacks and collapses description / dates / custom fields
  behind a single "More fields" disclosure.
- **Only one expander at a time.** Opening another while the current one is dirty asks
  first.
- **Optimistic writes** stay as they were; a rejected save keeps the expander open with the
  user's text in it, and conflicts render as a banner with *View latest* / *Re-apply*.
- **Bulk work is chunked**, so progress is determinate and cancel stops cleanly after the
  in-flight chunk. Nothing is rolled back — the endpoint is not transactional, and the UI
  says so.
- **Per-operation results.** `haventory/items/bulk` returns a result per operation and
  partial failure is normal, so the result panel names every failed row, translates its
  error, and offers a retry scoped to those. Retries rebuild their operations rather than
  replaying them, because an `op_id` must never be reused (duplicates collapse silently
  server-side).
- **Tag and category rename/merge have no endpoint.** They are batch rewrites over every
  affected item, each carrying `expected_version`.
- **Location deletes are guarded client-side** before the request, using the tree's own
  counts, so the reason is shown inline instead of a validation error after the fact.
- **Parent pickers exclude the location and its descendants** — the backend rejects cycles.

---

## Data flow

**Startup** — `hass` set → `new Store(hass)` → `init()` warms stats, health, areas, tree,
flat locations, distinct values and version in parallel → `listItems(true)` → subscribe to
items / locations / stats.

**A user action** — container calls the store → store applies the change optimistically and
notifies → container re-renders → WS resolves → store applies the server's copy (or rolls
back and pushes an error).

**A live event** — `WSClient` delivers the inner payload → store merges it into `items` →
subscribers re-render. Item create/delete/move also schedules a coalesced `location/tree`
refetch, because per-location counts are not pushed.

**A filter change** — `setFilters` resets the cursor, clears the list and the selection,
re-subscribes if the location scope changed, and re-lists.

---

## Testing

Component tests follow one pattern: `document.createElement`, set properties, await
`updateComplete`, query the shadow root by `data-testid`, dispatch real events. Every
interactive element carries a testid.

`src/test.utils.ts` provides `makeMockHass()` — an in-memory backend mirroring the WS
contract, including `items/bulk` with per-op results, a real nested `location/tree` with
counts, and hooks for the failure paths: `__rateLimitNext`, `__failNext`, `__failSubscribe`,
`__setHealth`, `__setItems`, `__setLocations`, plus a `__calls` log. It **throws on an
unhandled command**, so adding a WS call without extending the mock fails loudly.

Things jsdom cannot do, and how the tests handle it:

- **No CSS evaluation in shadow DOM** — tests assert the hook a stylesheet keys off (e.g.
  the reflected `mobile` attribute), never a computed style.
- **No layout** — `ResponsiveController` is driven through `setWidth()` / `setForced()`
  rather than a real `ResizeObserver`.
- **No drag and drop** — dragging items onto tree nodes (an optional item in the handoff)
  is not implemented.

Run:

```bash
cd cards/haventory-card
npx eslint .
npx vitest run
npm run typecheck
npm run build
```

---

## Legacy UI (`ui: legacy`)

The proof-of-concept components are unchanged and still tested:
`hv-search-bar`, `hv-inventory-list`, `hv-item-row`, `hv-item-dialog`,
`hv-location-selector`, `hv-category-browser`, `hv-tag-browser`, `hv-column-picker`,
`hv-import-dialog`. `hv-column-picker` is shared with the revamped UI; the rest are reachable
only through `ui: legacy`.

They are kept as an escape hatch while the revamp is experimental and should be removed —
along with the `ui` option — once it has settled.

---

## Key design decisions

**Lit** — small, standards-based, and already how HA's own frontend is written; shadow DOM
keeps card styles from leaking into a dashboard.

**Containers hold the store** — see above; the alternative was re-dispatching every nested
interaction through the root element.

**Optimistic updates** — the backend rewrites its whole store blob on each mutation, so a
round trip is not free; the UI stays responsive and rolls back on failure.

**Tokens over hardcoded colours** — every value binds to an HA theme variable first, so user
themes keep working. Accents with no HA equivalent (tints, hover washes, warning surfaces)
track `prefers-color-scheme`.

---

## Known gaps

- Not yet verified against a running Home Assistant frontend (see the README).
- Drag-and-drop of items onto sidebar tree nodes (optional in the handoff) is not built.
- `@lit-labs/virtualizer` is still a dependency but unused; large lists rely on paging.
- The backend cannot sort by category, location or tags, filter by due date, or bulk-create
  items — the UI is shaped around those limits rather than hiding them.
