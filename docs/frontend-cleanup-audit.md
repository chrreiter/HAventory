# WP4.1 frontend cleanup — audit

Review artifact for the cleanup of `claude/ui-revamp-implementation-8fl22q` before it
merges to `main`. **Phase 1 only: nothing in the source tree has been changed.**

Base branch: `claude/ui-revamp-implementation-8fl22q` (99 commits ahead of `main`,
116 files, +24 704 / −7 098). Cleanup branch: `chore/frontend-cleanup-wp41`.

Scope is `cards/haventory-card/src` only. `custom_components/`, `tests/`,
`docs/backend_api_contract.md` and `docs/data_shapes.md` are out of scope.

## Method

Every file in `src/` was read in full. Dead-code candidates were then put through an
independent adversarial verification pass instructed to *refute* each claim, defaulting to
"alive" on any ambiguity. **13 of 46 candidates were refuted** — several of which a plain
identifier grep calls unused. Those refutations are recorded in §a.3 so they are not
re-proposed later. One surviving verdict was wrong and I overrode it (§a.2, `hv-list`).

Proof protocol per candidate: plain identifier search; usage inside `` html`` `` templates
(`${x}`, `<hv-x>`, `.prop=`, `?bool=`, `@event=`); custom-element tag strings; event-name
strings on *both* sides; CSS selector match inside `` css`` `` blocks; dynamic/string-key
access and whole-object serialization; type-level use.

Counts: 43 non-test source files, 15 546 lines, **602 comment blocks / 1 821 comment
lines** (5–17 % density per file).

## Summary

| Category | Finding | Proposed action |
|---|---|---|
| (a) Dead code | 20 proven dead — mostly CSS rules and unreachable options | Delete (§a.1) |
| (a) | 8 suspected + 13 refuted | **Leave alone** (§a.2, §a.3) |
| (a) | 5 unreferenced `WSClient` methods | **Keep** — deliberate typed mirror (§a.4) |
| (b) Duplication | 5 worth fixing at zero behaviour risk | Fix (§b.1) |
| (b) | 7 real, but low/medium risk | **Defer to follow-ups** (§b.2) |
| (c) Comments | 125 CUT of 602 blocks (~21 %); 477 KEEP | Rewrite (§c) |
| (d) Naming | 3 worth fixing | Fix (§d.1) |
| (d) | 5 recorded, rejected with reasons | Leave (§d.2) |
| (e) Tests | 89.93 % stmt / 82.88 % br / 86.02 % fn / 91.01 % line | Add ~16 tests (§e) |
| Follow-ups | 2 real behaviour bugs + 1 misleading green test | Do **not** fix here (§f) |

The single most important finding is not in any category: **the shared test mock hides two
whole code paths**, so a cleanup could delete the optimistic-concurrency argument chain and
the production subscribe path with every test still green. See §e.1.

---

## Proposed commenting convention (for approval)

To be added to the `## Conventions` section of `CLAUDE.md`, committed on its own before any
comment is touched. This is the rule from the brief, with **two additions** the audit turned
up that it did not cover (marked ★).

> - **Comments explain constraints, not history.** A comment earns its place by encoding
>   something the code cannot say itself: a browser or platform quirk, an API contract, a
>   required ordering, an accessibility requirement, a deliberate tradeoff whose alternative
>   looks better than it is. Write it in the present tense, about the code as it stands.
>   - Do **not** narrate development history — no references to what a component replaced,
>     what an earlier iteration did, which work package introduced it, or what "used to" be
>     here. That context dies with the branch and leaves a dangling reference. Git history is
>     where it belongs.
>   - ★ Do **not** point at anything a reader of this repository cannot open: design-mock
>     numbers, an external design canvas, or a numbered entry in a tracker or ledger. State
>     the constraint the reference was standing in for.
>   - Do **not** restate the line below. If a comment paraphrases the code, delete the
>     comment or fix the naming.
>   - ★ A comment that is wrong is worse than none. When a comment names a symbol, a type, a
>     caller or a stored shape, that name must still be correct.
>   - `TODO`/`FIXME` markers do not belong in committed code — the repo has zero and keeps it
>     that way. Record follow-ups in `docs/open-items.md` instead.
>   - Component-level JSDoc says what the component is responsible for and what it talks to.
>     Non-obvious CSS gets a why-comment; obvious CSS gets none.
>   - Applies to TypeScript and Python alike.

**Why ★1.** 18 comments cite a design mock by number — `(mock 4a)`, `(mocks 1e / 4i)`,
`Mock 3b pre-fills…`. The mocks live in `roadmap/`, which is **git-ignored**
(`.gitignore:231`), so they are not in the repository at all. Two more cite ledger entries
(`open-items #12`, `docs/open-items.md #1`) whose numbering is already stale. Same defect as
a POC reference; the brief's rule does not name them.

**Why ★2.** Ten of the CUTs are not history — they are comments that have gone factually
wrong as the code moved (§c.3). A reader who trusts them goes looking for things that are
not there.

**Not proposed:** a lint rule or grep check. The distinction is a judgment call and any
mechanical check would be wrong often enough to be ignored.

---

## (a) Dead / unreachable code

### a.1 Proven dead — safe to delete

| # | Location | What | Why unreachable |
|---|---|---|---|
| 1 | `hv-bulk-bar.ts:89` | `.picker select` half of `.picker input, .picker select` | The component renders no `<select>`; `grep '<select'` → 0 |
| 2 | `hv-bulk-bar.ts:143` (+ `:not([disabled])` at `:130`) | `.bar button[disabled]` | No `.bar` button is ever disabled; both `?disabled=` bindings are on `.picker` buttons |
| 3 | `hv-item-editor.ts:125` | `.pair` grid rule | No element carries `class="pair"` |
| 4 | `hv-item-editor.ts:690` | `_text()` option `span` | All 3 call sites use the default; both ternary arms unreachable |
| 5 | `hv-item-editor.ts:690` | `_text()` option `placeholder` | Never supplied; always renders `placeholder=""` |
| 6 | `hv-organize-dialog.ts:707–709` | `onProgress` 3rd parameter `failed` + its `void failed` | Bound then explicitly discarded |
| 7 | `hv-location-tree.ts:217` | `private _autoExpanded = new Set<string>()` | Never read, written or iterated; the filter path at `:300` sets `open = true` directly |
| 8 | `hv-location-tree.ts:216` | the JSDoc above it | Documents a mechanism that does not exist |
| 9 | `hv-filter-panel.ts:364` (+ bindings `hv-card-shell.ts:1002`, `hv-full-view.ts:1506`, doc `:363`) | `@property stagedCount` | Write-only. Both hosts push into it and both draw "Show N items" from their own private `_stagedCount`. The panel never reads it |
| 10 | `hv-card-shell.ts:602–604` | `case 'check-out':` in `_onRowEvent` | All 16 call sites pass literals from `{increment, decrement, check-in, request-delete, edit, open-item, row-action}`. The live path is `row-action` → `_onRowAction` case `'check-out'` (`:472`), which also carries the anchor rect |
| 11 | `hv-filter-chips.ts:35, 85, 25` | the `export` modifier on `chipsFor`, `clearedValueFor`, `FilterChip` | Used only inside their own module. **The functions stay** — only `export` goes. (But see §e.1 #5: they need a test first) |
| 12 | `store/store.ts:33` | orphaned JSDoc `/** Max items fetched for a … browse drill-down */` | The constant it documented is gone; it dangles above a blank line and mis-attaches to `PAGE_LIMIT`'s own doc block |
| 13 | `hv-full-view.ts:986–997` | orphaned JSDoc block | Sits above `_renderTagsMode`'s *own* JSDoc and documents neither. Belongs to `_renderFacetSection` (`:1024`), which has none. **Move, don't delete** |
| 14 | `store/store.ts:558` | `listAllMatching(filter, sort?)` — the `sort` parameter | Both callers pass one argument |
| 15–17 | `ui/icons.ts:28, 33, 39` | `ICONS.chevronLeft`, `ICONS.filterVariant`, `ICONS.tag` | `icon('tag'` → 0 hits; every `'tag'` string in the repo is the `ValueKind` union, not an icon name |
| 18 | `ui/tokens.ts:240, 251` | `.hv-chip` / `.hv-chip.selected` in `base` | Word-boundary search `hv-chip([^-a-zA-Z]|$)` repo-wide → 2 hits, both the definition. Every component that shows chips has its own `.chip` rule in its own shadow root. 16 lines of unreferenced CSS shipped in all 21 components |
| 19 | `hv-location-tree.ts:307` | `class="node"` on the wrapper div | The class is applied but **no CSS rule matches it** anywhere, and no test queries it. Inside a shadow root, so unreachable from outside CSS |
| 20 | `store/store.ts:283` | `Store.dispose()` | No caller — but see §a.4, this needs your call |

`chevronUp` is **not** dead (`hv-data-table.ts:278`), despite `icons.ts:18` saying the mocks
did not use it.

### a.2 Suspected — not proven, do not delete

| Location | What | Why it stays |
|---|---|---|
| `hv-list.ts:112, 114, 115, 116` + `:host([fill])` at `:47–55` | `fill`, `selectable`, `selection` | **Reachable but never activated.** `hv-list.ts:191–192` read `this.selectable` and `this.selection` on every render; the only host never sets them, so they carry defaults. Latent capability, not unreachable code. *A verifier called `selection` proven-dead — that verdict is wrong; `:192` reads it. Overridden.* |
| `hv-banner.ts:7, 13, 63, 67` | `BannerKind` member `'success'` | No caller asks for one, but it completes a four-way vocabulary on an exported public type |
| `hv-chip-input.ts:107` | `placeholder` | Only the default is used; public element attribute |
| `hv-location-tree.ts:410` | `<slot name="after-${node.id}">` | Zero consumers, but a composition surface |
| `hv-card-shell.ts:620–623` | `default:` arm of `_onRowEvent` | Unreachable from every current call site, but it dispatches a **runtime-variable** event name — an event dispatch is never called dead |
| `hv-item-editor.ts:253` | `.invalid .field-button` | No path puts `.invalid` around a `.field-button` today; defensive styling |
| `hv-list-row.ts:396`, `hv-data-table.ts:362`, `hv-bulk-bar.ts:396` | `data-item-id=` | Written in three templates, read by nothing — no `[data-item-id=` selector, no `dataset.itemId`. But it is rendered DOM, in the same family as `data-testid`, and costs nothing to keep |
| `ui/theme.ts:79` | the `export` on `SURFACE_VARS` | The array *is* used (`:94`); only the `export` has no consumer. The docblock reads as documentation of the theming contract, so the export may be deliberate. Dropping just the keyword is safe if you want it |

### a.3 Claimed dead, refuted — recorded so they are not re-proposed

| Claim | Actually used at |
|---|---|
| `hv-confirm.ts:94` `cancelLabel` | `hv-confirm.ts:151`, inside `render()` |
| `hv-chip-input.ts:108` `maxSuggestions` | `hv-chip-input.ts:131` — the only cap on the suggestion row; both call sites pass unbounded arrays |
| `hv-list.ts:117` `pendingIds`, `hv-list-row.ts:275` `pending`, `.pending` CSS | `hv-list.ts:193` `?pending=${this.pendingIds.has(it.id)}` — the optimistic chip does render |
| `hv-list.ts:121` `skeletonRows` | `hv-list.ts:165`, loading branch |
| `hv-item-editor.ts:262` `.list-holder` margin | `hv-item-editor.test.ts:523` asserts the exact source text of the combined rule |
| `hv-filter-chips.ts:9` `FilterChipKey` | `hv-filter-chips.ts:26, 72, 85` |
| `hv-overflow-menu.ts:289` `isItem` guard | Live call site inside `render()` |
| `hv-banner.ts:114` default `<slot>` | Unexercised composition surface, not dead markup |
| `ui/theme.ts:79` `SURFACE_VARS` | `ui/theme.ts:94`, inside `resolveColorScheme` |
| `ui/tokens.ts:60` `--hv-error-border` | Public CSS custom property on `:host` |
| `ui/icons.ts:71` `part="icon"` | A shadow part is stylable from the **immediate** host with no `exportparts` |
| `types.ts:406` `DegradedState.nextRetryAt` | `hv-diagnostics-panel.ts:256` serializes the whole object with `JSON.stringify` — invisible to an identifier grep |
| `types.ts:420` `StoreState.pendingOps` | No component reads it, but three `stateObs.set` calls fire a re-render at op completion, and in `deleteItem`'s success path it is the only post-await notification |

### a.4 `WSClient` — five unreferenced methods, recommend **keeping**

`ws.ts:37 ping`, `:131 addTags`, `:137 removeTags`, `:143 updateCustomFields`,
`:180 getLocation` have no callers, and all five refutations came back empty.

**Recommendation: keep all five.** `WSClient` wraps **32 of the backend's 34**
`@websocket_command` handlers; the only omissions are `haventory/cleanup` and
`haventory/unsubscribe` (the latter handled by HA's own `subscribeMessage`). It wraps
nothing that does not exist server-side. It is a deliberate typed mirror of the command
catalogue in `docs/backend_api_contract.md`, and `docs/frontend_architecture.md:191`
describes it as exactly that. Deleting five would take it to 27/34 and make the omissions
arbitrary.

The useful change is the opposite of deletion: **add the missing constraint comment** stating
the 1:1-mirror invariant, so the next reader does not "clean up" the unused wrappers. That is
a comment-phase change.

**`Store.dispose()` needs your decision.** It is unreferenced, but it documents a lifecycle
`index.ts` never wires up — `disconnectedCallback` unsubscribes from the store's observable
but never tears down the three WS subscriptions. Deleting it is behaviour-preserving;
*calling* it from `disconnectedCallback` is a behaviour change and belongs in its own commit.
My recommendation: **keep it and pin it with a test** (§e.1 #4), then decide separately.

---

## (b) Duplication

### b.1 Worth fixing — zero behaviour risk

| # | What | Sites | Fix |
|---|---|---|---|
| 1 | The `emptyKind` **selection rule**, byte-identical six lines in the same order | `hv-card-shell.ts:973`, `hv-full-view.ts:1238` | Extract `emptyKindFor(state)` into `ui/empty-state.ts`, beside `emptyStateCopy`. That module exists precisely so these two surfaces cannot drift — it already owns the copy and the markup but not the one decision with branching in it. `hv-full-view` even carries the comment "by the same rule the card's list uses". Both components lose a private getter, which also resolves the `emptyKind` / `_emptyKind` naming split for free |
| 2 | The `display_path` `"/"` → `" › "` prettifier, three of four copies character-for-character | `hv-list-row.ts:16` (exported, correctly imported by 2), `hv-filter-panel.ts:479`, `hv-item-editor.ts:717`, `hv-filter-chips.ts:44` | Add `locationLabel(loc, fallback)` beside `displayPath`. The three inline copies differ only in fallback string (`'Any location'` / `'No location'`) and optional-chaining order |
| 3 | Nine identical inline Escape listeners: `(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }` | `hv-bottom-sheet:176`, `hv-checkout-popover:303`, `hv-column-picker:155`, `hv-confirm:135`, `hv-diagnostics-panel:283`, `hv-import-sheet:640`, `hv-organize-dialog:1367`, `hv-overflow-menu:279`, `hv-full-view:1338` | `onEscape(fn)` in `ui/keyboard.ts` (which exists for keyboard concerns and currently holds only the Mac/PC label helper). One-line change per site, no new concept. **`hv-item-editor.ts:675` is deliberately excluded** — it also stops propagation and handles Ctrl/Cmd+Enter |
| 4 | Byte-identical tag-normalizing function under two names with two differently-worded doc comments | `ui/item-form.ts:141 normalizeTags` (exported), `ui/value-rewrite.ts:25 normalize` (private) | Delete `normalize`, import `normalizeTags`. No cycle: `item-form.ts` imports only types |
| 5 | `export type ListEmptyKind = EmptyKind` — a pure alias adding no meaning | `hv-list.ts:11`, used at `hv-list.ts:118`, `hv-card-shell.ts:30/973` | Drop the alias, import `EmptyKind` directly. Type-only, 3 sites, erased at compile |

### b.2 Real duplication, **deferred** — each carries behaviour risk

The brief's rule is explicit: if a cleanup risks behaviour change, record it instead.

| What | Sites | Risk | Why deferred |
|---|---|---|---|
| Stat-badge trio (low / overdue / checked out), ~30 lines each | `hv-card-shell.ts:813`, `hv-full-view.ts:1421` | low | Shared markup with different CSS classes and testid prefixes; a `renderStatBadges(...)` is defensible but changes rendered structure |
| Store-subscription lifecycle written out four times | `hv-card-shell.ts:381`, `hv-full-view.ts:693`, `hv-organize-dialog.ts:424`, `index.ts:24` | low | A `StoreController` would follow the existing `ResponsiveController` house style, but it is a real architectural change. Two wrinkles: `hv-card-shell` also resets `_searchDraft` in its branch, and `index.ts` subscribes from the `hass` setter |
| Tags Any/All segmented control, markup **and** CSS | `hv-filter-panel.ts:588/241`, `hv-full-view.ts:1006/389` | low | The a11y wiring (radiogroup + radio + aria-checked) is worth one home, but padding and testids differ |
| Modal chrome CSS — `.backdrop`, `.wrap`, `.panel` across five dialogs; scrim alpha has already drifted 0.35 vs 0.4 | `hv-column-picker:32`, `hv-confirm:26`, `hv-diagnostics-panel:30`, `hv-import-sheet:41`, `hv-organize-dialog:59`, `hv-full-view:67` | medium | `hv-diagnostics-panel`'s `.wrap` deliberately uses `minmax(0, 1fr)` to fix a 390 px overflow, `hv-organize-dialog` has `:host([mobile])` full-bleed overrides, `hv-confirm` intentionally has no max-height. A shared fragment must be additive or those regress |
| `.empty` block CSS | `hv-list.ts:56`, `hv-full-view.ts:511` | low | Identical but for one padding value |
| `.out-chip` rule copied into three components | `hv-list-row.ts:141` + 2 | low | Same shadow-boundary caveat |
| `emitSearch` / `_setFilters` / `_priceStaged`, byte-identical incl. the 150 ms; `SEARCH_DEBOUNCE_MS` declared twice | `hv-card-shell.ts:423/425/441`, `hv-full-view.ts:794/796/725` | low | Debounced *instance fields* on two independent `LitElement` subclasses. Sharing needs a mixin or base class — the structural change the brief forbids — and `_setFilters` is a 3-line passthrough where extraction is indirection for its own sake |
| `hv-full-view` hand-rolls focus capture-and-restore while `DialogFocus` exists | `hv-full-view.ts:740/754`, `hv-confirm.ts:105` | medium | **Not behaviour-preserving.** `DialogFocus` uses `deepActiveElement()` (walks shadow roots); `hv-full-view` uses bare `document.activeElement`, which from inside `hv-card-shell`'s shadow tree resolves to the outer host, not the button that opened the view. Switching changes which element is refocused. `hv-full-view` also focuses the first focusable inside `.shell`, which its sentinel focus trap depends on |

### b.3 Looks duplicated, is deliberate — leave

- **Sidebar value rows vs `hv-location-tree` rows** (`hv-full-view.ts:420`). Style rules
  cannot cross a shadow boundary; the existing comment says so.
- **Two "is this a phone?" signals.** `ResponsiveController` is used by `hv-card-shell` alone
  (measured element width, fed down as a `mobile` property); `hv-full-view` uses
  `matchMedia(NARROW_QUERY)` because it is fixed to the viewport.
  `hv-checkout-popover:271` reads `window.innerWidth` for popover placement — viewport math,
  not a breakpoint. Documented and correct.

---

## (c) Comments

**125 CUT, 477 KEEP**, of 602 blocks. Delete history / keep constraints — *not* "make
comments shorter". Total comment volume should fall only slightly, because most CUTs are
rewrites that preserve the constraint underneath.

### c.1 Distribution

| Reason | Count | Character |
|---|---|---|
| `used-to` — a fixed bug narrated in past tense | 58 | Mostly CSS post-mortems. Almost all **rewrite**, not delete |
| `replaced-narrative` | 32 | "the revamped card", "replaces the modal chain", "has always offered" |
| `restates-code` | 17 | `// rollback`, `// Trigger next page load`, a `@param` block repeating the signature |
| `POC-reference` | 10 | The dangling references the brief named |
| work-package / dangling external pointer | 8 | `(WP4.1)`, `(mock 4a)`, `open-items #12` |
| **TODO/FIXME markers** | **0** | Repo policy already holds; verified across all 43 files |

Worst-affected: `hv-full-view.ts` 23 of 61 blocks, `hv-item-editor.ts` 11 of 35,
`hv-filter-panel.ts` 11 of 32, `hv-card-shell.ts` 9 of 46, `ui/tokens.ts` 4 of 17.

### c.2 The shape of a typical rewrite

Most CUTs are a **constraint wrapped in history**. `hv-full-view.ts:544`:

> **now** — "The ceiling used to sit behind the phone-width breakpoint, which only helped
> phones…"
> **after** — "The second term of the `min()` measures the column rather than the viewport, so
> the context bar above the panel and the footer below it keep their room at any screen height
> — a width-only breakpoint leaves a 760×400 landscape phone and a 1280×900 desktop with no
> ceiling at all."

Same fact, no dangling "used to". A minority are delete-outright (`// rollback`,
`store.ts:33`, the orphaned block at `hv-full-view.ts:250`).

### c.3 Ten CUTs are factual corrections, not style

These actively mislead:

| Location | Says | Reality |
|---|---|---|
| `store/store.ts:153` | "using a Proxy" | `Object.assign` onto a held object plus a `Set` of listeners |
| `store/store.ts:282` | "the card calls this when it disconnects" | Nothing calls it |
| `ui/responsive.ts:16` | "pin it with `force`" | The API is `setForced()` |
| `ui/responsive.ts:39` | "the card exposes this as a `mobile` property" | It is `forceMobile`; `mobile` is this controller's getter |
| `hv-organize-dialog.ts:413` | "keyed `${kind}:${value}`" | The field holds `{ value, mode }`, matched on `v.value` at `:1297` |
| `hv-location-tree.ts:198` | "organize + sidebar management" | Only `hv-organize-dialog.ts:987` sets `manage` |
| `hv-filter-chips.ts:32` | "Exported so the card and the full view describe an active filter identically" | Nothing imports `chipsFor`; the sharing happens through the element |
| `ui/icons.ts:18` | `chevronUp` unused | Used at `hv-data-table.ts:278` |
| `hv-bottom-sheet.ts:8` | lists the organize action sheet as a host | `hv-organize-dialog` does not import or render it |
| `hv-filter-panel.ts:363` | "drives 'Show N items'" | Both hosts draw that button from their own `_stagedCount` |

### c.4 Load-bearing KEEPs — the ones a careless reviewer would cut

Not exhaustive; the highest-cost ones.

- `hv-card-shell.ts:67` — **iOS Safari zooms the page when a field under 16 px takes focus and
  never zooms back out.** Kept verbatim per the brief.
- `hv-card-shell.ts:59` — `--hv-tap-min` is declared once and inherited into every nested
  shadow root, keyed off measured width rather than `pointer: coarse`.
- `ui/tokens.ts:116` — `--hv-tap-min` / `--hv-input-font` are deliberately **absent** from the
  `tokens` block, because `tokens` redeclares its properties on every component's own `:host`,
  which would shadow the inherited value.
- `hv-filter-panel.ts:150` — only `input[type=search]` takes the 16 px anti-zoom size.
- `hv-full-view.ts:270` — the app bar's search deliberately opts *out* of that size.
- `hv-full-view.ts:43` — `NARROW_QUERY` and the `@media (max-width: 700px)` block are the same
  breakpoint expressed twice and must be kept in agreement.
- `store/ws.ts:269` — HA's `subscribeMessage` delivers the **inner** event payload, not the
  envelope. Precisely the shape the offline HA stubs get wrong.
- `store/store.ts:88` — `include_subtree` is sent explicitly because the backend's default
  differs between list filters (`false`) and subscriptions (`true`).
- `store/store.ts:667` — HA's WS client reconnects transparently and exposes no disconnect
  event, so a run of non-taxonomy failures is the only observable "connection lost" signal.
- `types.ts:214` — the backend names the per-op failure key `context`, **not** `data`.
- `types.ts:178` — `matching_*_count` is `undefined` for "nothing was asked", not "nothing
  matches"; treating it as 0 blanks the sidebar.
- `hv-item-editor.ts:798` — the scroll listener must be **capture** phase; the scrolling
  ancestor is inside another component's shadow root.
- `hv-location-tree.ts:135` — `.row.touch .actions` is inside the hover media block on purpose.
- `ui/icons.ts:15` — Apache-2.0 attribution for the Pictogrammers path data. Legally
  load-bearing, and it runs into a sentence that *is* a CUT — split carefully.
- `utils/zindex.ts:13` — the `eslint-disable` is required; removing it fails lint.

---

## (d) Naming / structure

Only differences where **the same concept is named two ways**. Each entry carries an explicit
recommendation, because a large rename diff is itself a regression risk.

### d.1 Worth fixing

| # | Concept | Variants | Why it earns the diff |
|---|---|---|---|
| 1 | The `_` prefix on private members | `storeUnsub` bare (`hv-card-shell:381`, `hv-full-view:693`, `hv-organize-dialog:424`) vs `_storeUnsub` (`index.ts:24`, identical code); `emitSearch` bare (`hv-card-shell:423`) vs `_priceStaged` prefixed (`hv-card-shell:441`) — **same file, same kind of member, 18 lines apart** | The one place the codebase contradicts itself *inside a single file*. ~25 sites, all `private`, zero test references, compiler-backed rename |
| 2 | The overlay-dismiss closure | `_onCancel` (`hv-column-picker:135`) vs `_close` in 5 components | The `_on*` prefix is load-bearing elsewhere — `_onRowEvent`, `_onMenuSelect`, `_onScroll` all *receive* an inbound event. `_onCancel` receives nothing; it emits `cancel` and is also wired to the "Done" button (`:178`), so the name misdescribes it. 4 sites, one file. **The `_cancel` (4) vs `_close` (5) split is left alone** — the method is always within ~20 lines of its call sites and the split does not even correlate with the event emitted |
| 3 | The "small screen" flag on a child | `mobile` in 6 components vs `touch` in `hv-location-tree:204`, with the adapter `?touch=${this.mobile}` at `hv-organize-dialog:990` | Removes an adapter rather than adding one. `hv-list-row:391` shows the intended pattern — property `mobile`, CSS class `touch`. **Do not rename the CSS class**, which is correct. ~6 source sites + 2 test files |

### d.2 Recorded and **not** fixed

| Concept | Variants | Why not |
|---|---|---|
| "user asked to delete this item" | `delete-item` (`hv-item-editor:1272`) vs `request-delete` (`hv-list-row:313`, `hv-detail-sheet:458`) | **Public surface** — both are `composed: true` events crossing shadow boundaries. The rename would not even delete the adapters, because the nested editor's event bubbles through and collapsing the names makes re-emit indistinguishable from pass-through. **Instead: copy the explanatory comment at `hv-detail-sheet.ts:506` to `hv-full-view.ts:1539`, which does the identical translation silently.** One line, folded into §c |
| The overlay "dismissed" event | `cancel` (9 components) vs `close` (`hv-full-view:772` only) | Public surface, and the divergence is arguably *meaningful*: the nine are dismissible modals where `cancel` implies "abandoned without committing"; a full-screen view's dismissal commits and abandons nothing. Renaming would make the name less true |
| `Cache` suffix on `StoreState` | 5 of 8 fields carry it; `statsCounts`, `versionInfo`, `locationMatchTotal` do not, and are assigned through the identical path | Genuine drift, but ~135 read sites across store and all 21 components, mostly inside template strings where the compiler helps least. Exactly the "large rename diff is itself a regression risk" case. Every field on that interface is a cache; the suffix carries no information |
| `_zBase` declaration and fallback | `number \| null` + `?? 9998` (3 components) vs `number = 0` + `\|\| 9998` (6), and `hv-overflow-menu:259` uses **10000** | Worth normalizing the type/operator and hoisting the magic literal into `utils/zindex.ts` (which already owns `Z_BASE_START`). **But the stray `10000` must be left exactly as it is** — changing it is a behaviour change, and whether it is deliberate is not mine to decide. Deferred pending your call on that literal |
| Private-member prefix, store vs components | `store.ts` uses `onXxx`/no underscore (27 of 27); components use `_onXxx` | Not mixed within a layer — each is internally consistent. The brief's bar is "genuinely mixed within the same layer" |

---

## (e) Test coverage gaps

Baseline from `npm run test:coverage` — **40 files, 715 tests, all passing**:

| Metric | % | Covered/total |
|---|---|---|
| Statements | 89.93 | 3146/3498 |
| Branches | 82.88 | 2334/2816 |
| Functions | 86.02 | 825/959 |
| Lines | 91.01 | 2612/2870 |

Lowest branch coverage: `store/ws.ts` 61.42, `hv-filter-chips.ts` 65.38, `ui/responsive.ts`
66.66, `hv-full-view.ts` 69.93, `hv-diagnostics-panel.ts` 76.54, `hv-organize-dialog.ts` 76.84.
`store/types.ts` reports 0 % with **0 uncovered lines** — pure types, erased at compile. Not a
gap.

### e.1 High — the safety net for Phase 3, write these first

**The overarching finding: the shared mock hides two whole code paths.** Both are pinnable
without touching production code, using a purpose-built fake in a new `src/store/ws.test.ts`
rather than by changing `makeMockHass` (which would ripple through all 39 test files).

| # | Gap | Where | Proposed test |
|---|---|---|---|
| 1 | **`expected_version` never reaches the wire in any test.** The mock *strips* it before applying an update (`test.utils.ts:386`). The entire optimistic-concurrency argument chain — `ws.ts:74–157`, `store.ts:768–876`, `hv-card-shell.ts:455–480` — could be deleted with every test still green | `ws.ts:61–157` | New `src/store/ws.test.ts`: spy on `callWS`; assert `updateItem('1',{name:'x'},7)` sends `expected_version: 7`, that the 2-arg form has no such key, that `checkOut('1', null, 3)` sends `due_date: null`, and that `listItems()` sends only `{type}` |
| 2 | **`subscribe()` never exercises the Promise path — the one that runs against real HA.** `test.utils.ts:512` returns a plain unsubscribe *function*; real HA returns `Promise<UnsubscribeFunc>`. So `ws.ts:284–290` and `:298–304` are dead in test and live in production | `ws.ts:281–304` (uncovered 286-288, 299-300, 302) | Same file: a fake whose `subscribeMessage` returns a deferred promise. (a) resolve, then unsubscribe → resolved fn called once; (b) unsubscribe *before* resolve → still called once on settle |
| 3 | **`subscribeTopics()` re-subscribe could leak a duplicate handle**, which would double-apply every live event. Called on init, on a location filter change, and by `refreshAll()` | `store.ts:244–265` | `store.revamp.test.ts`: call it twice, emit one item event, assert the item is applied once |
| 4 | **`Store.dispose()` has no test** and is the prime dead-code target | `store.ts:283–293` | `store.revamp.test.ts`: after `init()`, `dispose()`, assert `connected` is `{items:false,stats:false}` and a subsequent emit no longer changes `items` |
| 5 | **`hv-filter-chips` has no test file** — the only component without one. `chipsFor` builds up to 14 chips with per-key label formatting; `clearedValueFor` returns `''`/`[]`/`null`/`false` by key | `hv-filter-chips.ts:35–102` | New `hv-filter-chips.test.ts`: one chip per filter kind; renders `null` when unset and when no chip is active; `remove-filter` detail carries the right patch |
| 6 | **The `retrying` banner's precedence is load-bearing** — `run()` sets `rateLimited: true` *and* `retrying: 1` on the same failure, so only the else-if ordering keeps "Busy — retrying" visible | `hv-card-shell.ts:878–885` | `hv-card-shell.test.ts`: assert the retrying banner wins while a retry is in flight |
| 7 | **`nextRetryAt` + the exponential-backoff arithmetic are written and read by nothing** — a dead-code sweep would delete both | `store.ts:702–734` | `store.revamp.test.ts`: assert `retrying` increments once and `nextRetryAt` is set during a rate-limited retry, both cleared on settle |
| 8 | **`unknown_error` is deliberately excluded from the domain-code reset** (`code !== 'unknown_error'`) and therefore counts toward `CONNECTION_LOST_THRESHOLD`. Exactly what a simplification pass deletes | `store.ts:673–687` | `store.revamp.test.ts`: two consecutive `unknown_error` failures set `connectionLost` |
| 9 | **Conflict recovery buttons never clicked.** "Reapply" calls `updateItem(itemId, changes)` deliberately *without* `expectedVersion` — the missing third argument is what makes the retry succeed, and is invisible to a reader | `hv-card-shell.ts:932–960` | `hv-card-shell.test.ts`: conflict → click Reapply → item takes the new name, banner gone; click View latest → an `item/get` was issued |
| 10 | **`hv-list`'s three render branches, only one tested**: skeletons, the empty state, and `addingNew` pinning an editor over an *empty* list so the empty state must **not** appear | `hv-list.ts:161–198` | `hv-list.test.ts`: one assertion per branch |
| 11 | **The `connection-lost` empty state** ("Can't reach Home Assistant" + Try again → `refreshAll()`) is what a user sees when the socket dies | `hv-card-shell.ts:973–988` | `hv-card-shell.test.ts`: degraded + empty list → that headline and offer |
| 12 | **`hv-column-picker.test.ts:62` is a misleading green** — named "closes on Done and on Escape", body only clicks Done | `hv-column-picker.ts:154–155` | Split into two `it`s; add the Escape case |
| 13 | **`hv-overflow-menu` — no Escape, no focus test**, though it uses `DialogFocus` and both are the reason that helper exists | `hv-overflow-menu.ts:221–225, 279–284` | Open → `shadowRoot.activeElement` is the menu; Escape → closed and focus back on the trigger |

### e.2 Medium

| # | Gap | Where |
|---|---|---|
| 14 | Focus **restoration** is never asserted at component level for the four dialogs that own it (`dialog-focus.test.ts` covers the helper in isolation only) | `ui/dialog-focus.ts:33–52`; cheapest host is `hv-checkout-popover` |
| 15 | `hv-import-sheet` — the only `role="dialog"` surface with no Escape test at all | `hv-import-sheet.ts:312–316, 636–645` |
| 16 | `hv-bottom-sheet` does **not** use `DialogFocus` — opening leaves focus on `<body>` so Escape does nothing until the user clicks in. **Pin this as current behaviour**, do not "fix" it | `hv-bottom-sheet.ts:161–182` |
| 17 | `plural(n,'was','were')` — the card's only irregular-verb use, rendered only with plural counts today | `hv-bulk-bar.ts:389, 408` |
| 18 | Bulk edge cases: an `op_id` that never comes back; whole-call failure attributed per op; `item_delete`'s null result; cancellation counts | `store.ts:960–990` |

### e.3 Named in the brief but **not** a gap — stated so the list is honest

- **WS disconnect / reconnect *detection*.** Covered: `store.revamp.test.ts:393–429` asserts
  the `CONNECTION_LOST_THRESHOLD` (one failure is not an outage, two are) and that
  `refreshAll()` clears it. The *recovery* side is the gap (#3, #4, #11 above).
- **`rate_limited`.** Well covered at the store boundary: retry-then-succeed (`:351`),
  retry-then-give-up (`:371`), subscribe refusal (`:381`). Gaps are the banner branch and the
  counters (#6, #7).
- **Optimistic-concurrency conflicts.** Covered store-side (`store.test.ts:57`) and to the
  banner (`hv-card-shell.test.ts:782`). Gaps are the wire payload and the recovery buttons
  (#1, #9).
- **Cyclic location trees — structurally impossible, not untested.**
  `LocationTreeNode.children` is a nested array decoded from JSON, so a cycle cannot be
  represented; the backend rejects them and even the mock guards at `test.utils.ts:218`. No
  client-side cycle guard exists, so a cycle test would require *new production code* — out of
  scope for a behaviour-preserving cleanup. Deliberately not proposed.
- **Deep trees.** Covered to 3 levels: `location-tree.test.ts:27/62/73`,
  `hv-location-tree.test.ts:65/73`.
- **Pluralisation generally.** `ui/plural.ts` is 100 % covered and well adopted — no
  hand-written `n === 1 ? '' : 's'` survives anywhere.
- **Tab focus traps and `aria-labelledby`.** No dialog implements either (all use
  `aria-label`). Not proposed — testing them would mean building them.

Files with no test: `store/ws.ts` (highest-value gap), `hv-filter-chips.ts`,
`utils/zindex.ts`. Not real gaps: `index.ts` (covered by `haventory-card.test.ts`, name
mismatch only), `store/types.ts` and `ui/tokens.ts` (no runtime exports).

---

## (f) Follow-ups — found during the audit, **out of scope, not fixed here**

### f.1 "Import backup" does nothing from the card's empty state

`ui/empty-state.ts` offers *Import backup* for `emptyKind: 'no-items'`. `hv-list` dispatches
`empty-action` (`:157`) → `hv-card-shell._onEmptyAction` (`:982`) handles `clear-filters`,
`refresh`, `add-item` and re-dispatches everything else as `menu-action` → which bubbles past
the shell to `index.ts._onShellAction` (`:135`), whose switch has only `columns`, `export-all`,
`export-view`. The button is inert.

The same offer works from the full view, where `menu-action` is caught by `hv-card-shell`'s own
handler on `<hv-full-view>` (`:1163`), which does handle `import`. One-line fix: add
`else if (id === 'import')` to `_onEmptyAction`.

### f.2 Degraded banners render the wrong icon

`hv-banner.ts:103` declares `@property({ attribute: false }) glyph`, but `hv-card-shell` sets
it as a plain HTML attribute — `glyph="wifiOff"` (`:864`), `glyph="clock"` (`:881`, `:889`),
`glyph="refresh"` (`:908`). With `attribute: false` Lit does not observe the attribute, so
`glyph` stays `null` and all four fall back to `DEFAULT_ICON[kind]`. The `refresh` case is
accidentally correct; the connection-lost banner shows a generic alert instead of wifi-off.

Fix is `.glyph=${'wifiOff'}` at the call sites, or dropping `attribute: false`. **Consequence
for this audit:** `ICONS.wifiOff` and `ICONS.clock` are referenced in source and classified
alive — do **not** delete them on the grounds that they never render.

### f.3 Focus handling is inconsistent across modal surfaces

6 of 9 use `DialogFocus`. `hv-confirm:107` does initial focus but never restores;
`hv-bottom-sheet:177` has Escape with no focus management at all, so opening it leaves focus on
`<body>`. Converging them adds focus restoration where there is none — a behaviour change.
Pinned as current behaviour by §e.2 #16 instead.

### f.4 Smaller notes

- `@lit-labs/virtualizer` is a declared dependency nothing imports. Removing it is a dependency
  change, which the brief forbids.
- `hv-overflow-menu.ts:259` uses a `10000` z-index fallback where eight other sites use `9998`.
  Possibly deliberate, possibly drift — your call (§d.2).
- `store.ts:1116` — stray space before `.concat`. Formatting only, flagged because a reformat
  there touches merge-order logic pinned by the comment at `:1114`.
- `docs/frontend_architecture.md` is stale independent of this cleanup:
  `LEGACY_DEFAULT_COLUMNS` (`:203`) does not exist; column defs carry no `size` field (`:197`);
  prefs are not stored "per scope" (one `expanded` key); `:327` still says the card is "not yet
  verified against a running Home Assistant" while `:14` and `:287` say it was. Phase 4.

---

## Public surface inventory

Enumerated so the Phase 3 commits can be checked against it. **None of this may change.**

- **`setConfig` keys — one: `title`** (`index.ts:38–40`, falls back to `'Inventory'`).
  `setConfig` deliberately *ignores* every unknown key rather than rejecting it (`:35–37`),
  throwing only on a non-object, non-null config. That tolerance is itself contract. The
  removed `ui: legacy` key must not be reintroduced.
- **42 custom event names**, all `composed: true` and therefore escaping past the card host:
  `apply, browse, cancel, cancel-run, change, check-in, check-out, check-out-confirmed,
  clear-filters, clear-selection, close, confirm, decrement, delete-item, delete-location,
  dismiss-result, edit, edit-location, empty-action, execute, increment, invalidate-preview,
  menu-action, merge-location, more-location, near-end, open-item, preview, refresh,
  remove-filter, request-delete, retry-failed, row-action, run, save, select,
  select-all-loaded, select-orphans, set-due-date, sort-change, stage, toggle-select`.
- **54 `--hv-*` CSS custom properties**, plus the two per-component knobs
  `--hv-list-max-height` and `--hv-list-editing-max-height` (`hv-list.ts:35, 45`).
  `--hv-error-border` is defined and never read — flagged, **not** deleted, because a user
  theme or another card can read it across the shadow boundary.
- **2 localStorage keys:** `haventory:columns:v1` (`store/columns.ts:59`) and
  `haventory:filter-panel-open:v1` (`hv-card-shell.ts:34`, values `'1'`/`'0'`).
- **22 element tags:** `haventory-card` plus the 21 `hv-*` components.
- **Built asset path:** `cards/www/haventory/haventory-card.js` (git-ignored).

## Do not touch

- The `min(…dvh, calc(100% - 116px))` ceilings at `hv-full-view.ts:562` and `:628`, the
  `box-sizing: border-box` beside them, and `overflow-x:auto` / `overflow-y:hidden` on `.shell`
  (`:90–91`). These are the subject of the last four commits on the branch and fix controls
  landing off a landscape phone. **Rewrite the comments; do not touch the declarations or the
  magic 116.**
- `?startSelecting=` / `?noHeader=` bindings look mis-cased and are correct — Lit lowercases the
  attribute and the target properties derive the same observed attribute.
- `hv-filter-panel.test.ts` reads `el.working`; `forceMobile` is set only by
  `hv-card-shell.test.ts`. Both test-only but alive.
- Deleting `stagedCount` requires deleting **both** host bindings in the same commit — a
  `.prop=` binding to a non-existent property is silent at runtime and only `npm run typecheck`
  would notice.
- `ui/icons.ts` path data is verbatim MDI under Apache-2.0. Delete keys, never edit path
  strings, keep the attribution sentence.
- `ui/theme.ts` `MIN_OPAQUE_ALPHA` (0.1) and `DARK_THRESHOLD` (0.4) look like magic numbers and
  are tuned against real HA themes, pinned by `theme.test.ts:35–36`.
