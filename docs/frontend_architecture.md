# HAventory Frontend Architecture

## Overview

The HAventory Lovelace card is a Home Assistant dashboard component built with:

- **Framework**: Lit 3 (web components, shadow DOM)
- **Language**: TypeScript 6 (`strict`)
- **Build**: Vite 8 → a single ESM bundle at
  `custom_components/haventory/www/haventory-card.js`, which the integration serves at
  `/haventory_static/haventory-card.js`
- **Tests**: Vitest 4 with jsdom

It provides the full inventory UI, updating live over the HAventory WebSocket API.

---

## Entry point

`src/index.ts` defines `haventory-card` — the element Home Assistant knows about. It owns
the `Store` (created on the first `hass` assignment), the Lovelace interface
(`setConfig`, `getCardSize`, `getStubConfig`, `window.customCards`), and nothing else of
substance:

```ts
setConfig(cfg) → { title?: string }   // every other key is ignored, not rejected
render()       → <hv-card-shell> + <hv-column-picker>
```

It renders `<hv-card-shell>` and keeps only the two surfaces the shell hands back up: the
column picker and the export download (which needs a DOM anchor click). It also publishes
the active HA theme as `color-scheme` on the host, which every nested component inherits.

---

## Component map

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
        ├── hv-location-tree       sidebar's Locations section, manage-capable
        ├── hv-filter-panel        same panel, staged behind a commit row on a phone
        ├── hv-item-editor         inline above the table (the same one edit form)
        ├── hv-data-table          sortable table + selection column
        └── hv-bulk-bar            bulk actions, progress, per-operation results
```

The sidebar's Categories and Tags sections are rendered by `hv-full-view` itself rather
than by a component of their own: they are flat lists of `distinct_values` entries, and the
rows only have to look like `hv-location-tree`'s — which, being in another shadow root,
could not have shared the rule either way.

Each of the three headings states how many of its thing there is, and offers a create
action. Categories and tags come with their `distinct_values` length; locations are counted
by `countLocations` in `store/location-tree.ts`, which walks every depth and takes the same
optional filter needle `hv-location-tree` matches rows with, so the organize dialog's
"N locations" can never disagree with the tree printed under it. Creating differs by facet
because the backend does: a location is a real object and is created inline, while a
category or tag exists only through the items using it, so those buttons ask the card to
open `hv-organize-dialog` on the matching tab (`menu-action` with `{ id: 'organize', tab }`).

### Two different "is this a phone?" signals

Most components take a `mobile` **property** fed by `hv-card-shell`'s *measured width* — a
card in a narrow dashboard column is a phone layout regardless of the viewport. `hv-full-view`
is the exception: it is fixed to the viewport, so it switches on a `@media (max-width: 700px)`
query instead.

That split bit once. `hv-item-editor` and `hv-filter-panel` are property-driven but are also
children of `hv-full-view`, which never set the property — so at 375px the expanded view drew
the editor's three-column desktop grid in 156px + 78px + 78px. `hv-full-view` now reads the
same breakpoint with `matchMedia` (`NARROW_QUERY`, kept in step with the media query) and
hands it down. Note what came with it: `hv-filter-panel` in `mobile` mode *stages* its edits
and drops its own footer, expecting the host to provide one, so the expanded view also grew
the Clear all / Cancel / "Show N items" row the card's filter sheet has.

### Shared wording

`ui/empty-state.ts` owns the four empty-list situations — nothing yet, nothing matched,
nothing filed here, no connection — as copy, offered actions **and** the rule that picks
between them (`emptyKindFor`), so `hv-list` and the `hv-data-table` inside `hv-full-view`
cannot answer the same situation two different ways. `ui/plural.ts` owns count agreement
(`counted(n, 'item')`), and `ui/location-path.ts` owns the `/` → `›` separator every surface
that prints a location path uses. Only the CSS is per-component — style rules cannot cross a
shadow boundary, which is also why the sidebar's value rows restate `hv-location-tree`'s row
styling.

### Container vs presentation

`hv-card-shell` and `hv-full-view` are **containers**: they hold the `Store` and call it
directly. Everything else is presentational and communicates by events.

Interactions nest several levels deep (row → editor → location tree → selection), and
threading each one back through the root element as a re-dispatched event is more plumbing
than it is worth.

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
| `empty-state.ts` | The four empty-list situations: which one applies (`emptyKindFor`), its copy and offered actions, and the markup. |
| `location-path.ts` | The `/` → `›` convention for a location path, and a location's label with a caller-supplied fallback. |
| `dialog-focus.ts` | Initial focus and focus return for modal surfaces. Opening must move focus into the panel or its Escape handler never fires. |
| `keyboard.ts` | `onEscape()` for the surfaces where Escape means exactly "close", and the platform-correct save-shortcut label. |
| `plural.ts` | Count agreement for every count string in the card. |
| `theme.ts` | Whether the card is painted on a light or dark surface, read from HA's own theme variables rather than `prefers-color-scheme`. |

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
| `refreshAll()` | Clears the degraded flags, reloads every cache, and re-subscribes with a fresh retry budget. The contract's prescribed recovery. |
| `exportDocument(scope)` | `'view'` forwards the active filter. |
| selection API | `toggleSelected`, `setSelected`, `clearSelection`, `selectAllLoaded`, `loadAllThenSelectAll`. |

**Filter translation.** `toWireFilter(filters)` is the single mapping from card state to the
backend's `ItemFilter`, exported so the count probe and "Export current view" send exactly
what the list is showing. `include_subtree` is always sent explicitly, because the list
filter defaults it to `false` server-side while subscriptions default it to `true`.

**Rate limiting and degraded state.** Every WS call goes through `run()`, which retries a
`rate_limited` rejection with backoff before surfacing it, and classifies failures: a code
from the backend's taxonomy means the socket is fine, anything else counts toward
`degraded.connectionLost`.

A *rejected subscribe* kills live updates outright — no event will ever arrive to hint at
it — so it is handled separately. The three topics are opened as one **round**, because the
limiter bills each subscribe separately and can admit `items` while refusing `stats`; live
updates only count as restored once every subscribe in the newest round is accepted, which
`WSClient.subscribe`'s `onOpen` reports. A round refused with `rate_limited` is re-opened
automatically up to four times, waiting the envelope's retry-after hint when it carries one
(`retry_after_ms`, or `retry_after` in seconds, read from `data`, `context` or the top level
and clamped to 30 s) and otherwise backing off exponentially. `degraded.liveUpdates` tracks
this as `'live' | 'retrying' | 'paused'`, with `degraded.nextLiveRetryAt` for the scheduled
attempt; the shell renders it as a non-blocking banner that clears itself when a retry gets
back in. Once the budget is spent the state goes `'paused'`, the refusal reaches the error
queue once, and the banner's Refresh (i.e. `refreshAll()`) is the way back. Any other
refusal is an outage: reported immediately, never retried.

**Why the card offers a manual Refresh.** Subscription events carry no sequence number or
generation, and the rate limiter can drop them silently, so a client cannot detect a gap.
Re-listing on demand is the documented recovery, so it is a first-class action rather than
a hidden one.

### `WSClient`

A typed wrapper over `hass.callWS` for each `haventory/*` command, plus `subscribe()`, which
takes `onError` and `onOpen` callbacks so both a refused and an accepted subscribe are
observable.

It is a deliberate 1:1 mirror of the command catalogue in `backend_api_contract.md`: it
wraps 32 of the backend's 34 commands, omitting only `haventory/cleanup` and
`haventory/unsubscribe` (the latter handled by HA's own `subscribeMessage`). A few wrappers
have no caller in the card today; they complete the mirror and are kept on purpose.

### Column preferences (`src/store/columns.ts`)

`ColumnKey` covers quantity, category, location, tags, due date, inspection date and
updated. Each definition carries a `tableSize` for the full-view table and — only where the
backend can actually sort by it — a `sortField`. Category, location and tags have none, so
their headers are not clickable: a header that looks interactive but does nothing is worse
than a plain one.

Preferences persist in `localStorage` under `haventory:columns:v1` as `{ expanded: [...] }`.
Any other key in that record is ignored, so an older or newer payload never breaks the load.

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
npm run typecheck
npx vitest run
npm run build
```

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

- Drag-and-drop of items onto sidebar tree nodes (optional in the handoff) is not built.
- `@lit-labs/virtualizer` is still a dependency but unused; large lists rely on paging.
- The backend cannot sort by category, location or tags, filter by due date, or bulk-create
  items — the UI is shaped around those limits rather than hiding them.
