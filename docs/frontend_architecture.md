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
(`setConfig`, `getCardSize`, `getGridOptions`, the statics `getStubConfig` and
`getConfigElement`, and `window.customCards`), and nothing else of substance:

```ts
setConfig(cfg) → { title?: string; quickFilters?: QuickFilterKey[] | null }
                                      // every other key is ignored, not rejected
render()       → <hv-card-shell>
```

`quick_filters` names the quick-filter pills the dashboard offers (`ui/quick-filters.ts`
holds the vocabulary). `null` — the omitted key, or anything that is not a list — means
all of them. The shell passes it to `hv-full-view` unchanged, so the card's badges and the
full view's pills offer one vocabulary; the sidebar panel, which has no dashboard config,
takes the default. It decides what is *allowed*: whether an allowed pill draws is still
the count's call.

`getStubConfig` and `getConfigElement` are **statics on the class**, not module exports:
Home Assistant reads them off `customElements.get(type)` and never imports from the bundle,
so an export is a spelling nothing looks at. `getGridOptions` sizes the card in a sections
view — full section width, and enough default rows that the list opens with room for
content — while `getCardSize` still answers the masonry view, which
knows nothing about columns.

It also publishes the active HA theme as `color-scheme` on the host, which every nested
component inherits.

`src/haventory-panel.ts` defines `haventory-panel` — the same bundle's second element,
which HA's custom-panel loader instantiates for the sidebar page. It mirrors the card's
store lifecycle and renders `<hv-full-view embedded open>`.

`src/haventory-card-editor.ts` defines `haventory-card-editor` — the bundle's third
HA-facing element, which `getConfigElement` creates by tag. It renders one field for
`title`, built from the card's own input and `--hv-*` tokens rather than HA's `ha-form`
(see "The Home Assistant contact surface" below), and turns its `input` event into a
`config-changed` carrying `{ ...config, title }`. The spread is the
point: the card ignores unknown keys instead of rejecting them, so `quick_filters` and
anything a future version writes survive an edit untouched. An emptied title is dropped
from the config rather than written as `""`, which hands the heading back to the
integration-wide option. All three elements register through `defineCardElement`
(`src/register.ts`), because HA creates each of them by tag after the frontend has swapped
`window.customElements`.

The integration registers that panel at `/haventory` through `panel_custom`, handing it
the *same* module URL both card loaders get (`__init__.py`, `_async_apply_sidebar_panel`),
so the browser's module map evaluates the bundle once whichever surface is opened first.
The registration's `config` carries `{"title": <card title option>}`, which is where the
panel's `panel.config.title` heading comes from; the sidebar entry itself is named by the
same option. Changing a registration is remove-then-register, because
`panel_custom.async_register_panel` does not forward
`frontend.async_register_built_in_panel`'s `update` argument and HA raises on a second
registration of a URL path that is already taken. Only a change pays for that: while the
panel is out of `hass.panels` the frontend sends whoever is standing on `/haventory` to
the default dashboard, so a reload — and an options save that leaves the title alone —
recognises the registration it already has and touches nothing. Unload keeps the panel for
the same reason; it is handed back when the entry is disabled or removed. The
`sidebar_panel_enabled` option turns it off, and both calls fire the frontend's
panel-update event, so the sidebar follows without a restart.

Both hosts hold a `HostSurfaces` instance (`src/host-surfaces.ts`): every surface
`hv-full-view` can raise but not answer itself — the column picker, the export download,
the delete/discard confirmation, the organize dialog, the import sheet, the diagnostics
panel with its refresh state, and the shared ⋮ menu-entry builder. On the card side the
instance lives in `hv-card-shell`; on the panel it lives in the panel element directly.
Host differences enter as constructor hooks (`onItemDeleted`, `onBrowse`). The phone form of
those dialogs is not one of them: the instance watches the viewport itself (`NARROW_QUERY`,
started and stopped from each host's connected/disconnected callbacks) and hands the same
answer to all five, so the card and the panel cannot disagree about what a phone is.

---

## The Home Assistant contact surface

`src/ha-contract.ts` is the one module that names what the card asks of Home Assistant,
and the file to open when an upgrade breaks something: the `HassLike` shape, thin wrappers
for `callWS` and `connection.subscribeMessage`, the `window.customCards` picker
registration, and the theme variables the card binds. `store/ws.ts` is the only caller of
the two WebSocket wrappers; `index.ts` is the only caller of the registration; `ui/theme.ts`
reads `SURFACE_VARS` from here to classify the surface the card is painted on.

The row that matters most is empty: **the card renders no `ha-*` element.** HA's frontend
components are registered lazily inside its own bundle, are not published for card authors
and are not versioned, and none of them exists in jsdom — so one rendered here would break
after a user's upgrade rather than in CI. Every glyph is inlined in `ui/icons` for the same
reason. `src/ha-contract.test.ts` sweeps the sources and fails on an `ha-*` tag, on a
`callWS` / `subscribeMessage` / `window.customCards` reached outside the contract, and on a
Home Assistant theme variable bound without a line in `HA_THEME_VARS`.

---

## Component map

```
haventory-card                     Lovelace element; store owner
└── hv-card-shell                  container: header, search, filters, list, footer;
    │                              holds the HostSurfaces instance (the four dialogs
    │                              below it render through that)
    ├── hv-overflow-menu           the ⋮ menu (also used by the app bar and rows)
    ├── hv-filter-chips            removable chips for every active filter
    ├── hv-filter-panel            the complete filter set; desktop panel / mobile sheet
    │   └── hv-location-tree       recursive tree with backend counts
    ├── hv-list                    rows, skeletons, empty states, near-end scroll
    │   ├── hv-list-row            stepper, badges, hover actions, row ⋮, photo thumbnail,
    │   │                          document marker
    │   └── hv-item-editor         inline expander (the one edit form); photo and
    │                              document pickers, cover/reorder controls,
    │                              per-document title field, per-file retry
    │       ├── hv-chip-input      tag chips with suggestions
    │       ├── hv-lightbox        the photo strip opens full-size here too
    │       └── hv-location-tree
    ├── hv-detail-sheet            the narrow read view, on the card and the full
    │   │                          view alike: read + edit in one sheet, photo
    │   │                          gallery strip and the Documents list
    │   ├── hv-item-editor
    │   ├── hv-lightbox            photos full-size, with arrows and a counter
    │   └── hv-checkout-popover    inline due-date step
    ├── hv-checkout-popover        desktop: anchored due-date step
    ├── hv-organize-dialog         Locations / Categories / Tags / Statuses
    ├── hv-import-sheet            input → preview → summary (+ invalid-document state)
    ├── hv-diagnostics-panel       health, drop counters, subscriptions, copy report
    ├── hv-confirm                 in-app confirmation (replaces window.confirm)
    ├── hv-banner                  the one alert treatment; the degraded and error
    │                              stacks are built in ui/banners.ts and rendered
    │                              by the card and the full view alike
    └── hv-full-view               fullscreen workspace
        ├── hv-location-tree       sidebar's Locations section, manage-capable
        ├── hv-filter-panel        same panel, staged behind a commit row on a phone
        ├── hv-item-editor         inline above the table (the same one edit form)
        ├── hv-data-table          sortable table + selection column; rows carry the
        │                          same ⋮ actions the card's rows do
        ├── hv-detail-sheet        the read view at phone width, the same one the
        │                          card opens
        ├── hv-checkout-popover    due-date step for a row and for a selection
        └── hv-bulk-bar            bulk actions, progress, per-operation results
```

The sidebar's Categories and Tags sections are rendered by `hv-full-view` itself rather
than by a component of their own: they are flat lists of `distinct_values` entries, and the
rows only have to look like `hv-location-tree`'s — which, being in another shadow root,
could not have shared the rule either way.

Each of those lists — status, categories and tags — is **one tab stop**, not one per row:
the list is as long as the household's vocabulary, and a stop per row put that vocabulary
between the search box and the table. The container carries `role="group"` with the
section's name, one row holds `tabindex="0"` and the rest `-1`, and ArrowDown/ArrowUp move
inside the list while Home and End reach its ends; neither end wraps. The rows stay
`<button aria-pressed>`, so Enter and Space still press them. Which row holds the stop is
kept per section in `_facetStop` and reconciled against the rendered rows after every
render: a held row drawn away — a narrowed vocabulary, a cleared filter — hands the stop to
the selected row, or to the first one. The section heading, its "+" and the tags any/all
pair are ordinary tab stops, so a section is still reached, opened and added to without the
arrows. `ui/roving-list.ts` holds the walk and the key handling; `hv-location-tree` runs the
same shape for the Locations section behind its own shadow boundary.

`hv-filter-panel` answers the same problem by showing less rather than by moving the stop:
its category and tag groups draw the first `CATEGORY_CHIP_LIMIT` (4) and `TAG_CHIP_LIMIT`
(8) chips and collapse the rest behind a "More…" chip carrying the hidden tally, so the
group costs a fixed handful of tab stops whatever the household has named. A selected value
past the cut is drawn anyway — the chip that says the filter is on must not be the one
"More…" hides — and the expansion is per mount, left alone by "Clear all" and by the sheet's
Cancel. Both lists arrive from `distinct_values` sorted alphabetically, so the cut is the
head of the alphabet, not the most-used values; the tag group's add field takes any label as
typed, so nothing has to be expanded to reach one.

Each of the four headings offers a create action, and the three that can be counted state
how many of their thing there is — Status is the household's own vocabulary, whose size says
nothing about the inventory the facet navigates. Categories and tags come with their
`distinct_values` length; locations are counted by `countLocations` in
`store/location-tree.ts`, which walks every depth and takes the same optional filter needle
`hv-location-tree` matches rows with, so the organize dialog's "N locations" can never
disagree with the tree printed under it. Creating differs by facet because the backend does:
a location is a real object and is created inline, while a category, tag or status is made
in the organize dialog, so those buttons ask the card to open `hv-organize-dialog` on the
matching tab (`menu-action` with `{ id: 'organize', tab }`). The app bar carries an Organize
button raising the same event with no tab, so the surface is one click from the view rather
than two through the ⋮ — which keeps its entry, since the plain card's header has no room
for a button.

### Two different "is this a phone?" signals

Two questions, two answers, and they are not interchangeable:

- **How wide is the card?** `MOBILE_BREAKPOINT` (600px), measured on the element by
  `ResponsiveController` and handed down as a `mobile` **property**. Everything drawn inside
  the card's own box reads this — the list, the steppers, the in-card sheets — because a card
  in a narrow dashboard column is a phone layout however wide the window is.
- **How wide is the window?** `NARROW_QUERY` (`(max-width: 700px)`, `ui/responsive.ts`), read
  with `matchMedia` and as a CSS `@media` block. Everything `position: fixed` reads this:
  `hv-full-view`, `hv-overflow-menu`, and the five dialogs `HostSurfaces` owns. A fixed
  overlay is laid out against the window, so the card's width says nothing about the room it
  has.

Each split bit once. `hv-item-editor` and `hv-filter-panel` are property-driven but are also
children of `hv-full-view`, which never set the property — so at 375px the expanded view drew
the editor's three-column desktop grid in 156px + 78px + 78px; `hv-full-view` now reads the
viewport query and hands the property down. Note what came with it: `hv-filter-panel` in
`mobile` mode *stages* its edits and drops its own footer, expecting the host to provide one,
so the expanded view also grew the commit row the card's filter sheet has: a head row above
the panel — the heading, how many filters are staged, and Clear all — and a footer of Cancel
and "Show N items". Three controls on one row is one too many for a 375px screen in German,
which is why the head row exists on both surfaces rather than only on the card's. For the
same reason the phone toolbar drops its column-picker button and leaves the ⋮ menu's
Columns entry as the route there.

In the other direction, `HostSurfaces` was fed the card's measurement, so the
organize dialog took its full-bleed phone page on a desktop monitor whenever the card sat in
a normal column — and expanding the card changed nothing, because the measured element was
still the card underneath.

On a phone viewport the four smaller dialogs — column picker, confirm, import, diagnostics —
rise from the bottom edge like every other phone surface, through the shared
`ui/dialog-sheet.ts` block rather than four private ones. The organize dialog keeps its
full-bleed page, which is what a four-tab management surface needs at that width.

Inside that dialog one declaration governs row height: `--hv-organize-row-pad` on its host,
read by its own value rows and inherited through the shadow boundary into the
`hv-location-tree` its Locations tab hosts, which reads the same property with its own
fallback. That is what keeps the tightening scoped — no other host declares it, so the
sidebar tree, the filter panel's picker and the editor's location field are untouched.

### Shared wording

`ui/empty-state.ts` owns the four empty-list situations — nothing yet, nothing matched,
nothing filed here, no connection — as copy, offered actions **and** the rule that picks
between them (`emptyKindFor`), so `hv-list` and the `hv-data-table` inside `hv-full-view`
cannot answer the same situation two different ways. `ui/plural.ts` owns count agreement
(`counted(n, 'item')`), and `ui/location-path.ts` owns the `/` → `›` separator every surface
that prints a location path uses. Only the CSS is per-component — style rules cannot cross a
shadow boundary, which is also why the sidebar's value rows restate `hv-location-tree`'s row
styling.

### The language the wording is in

Every string above — and every string in every component — comes out of `src/i18n/`.

- **`en.ts` is the key universe.** `TranslationKey` is `keyof typeof en`, so a key nothing
  defines does not compile at the call site; `de.ts` is a complete
  `Record<TranslationKey, string>`, so an English string added without a German one does not
  compile either. `catalog.test.ts` holds the rest: paired plurals, no orphaned keys, the same
  placeholders on both sides.
- **`t(key, params?)`** fills `{name}` placeholders; a placeholder with no parameter renders
  literally, so a typo shows rather than blanking a word. **`tn(key, count, params?)`** picks
  between `<key>.one` and `<key>.other` — two forms, which is the split English and German
  share. `Intl.PluralRules` would add a category axis every dictionary has to fill and answer
  a question neither language asks.
- **The language is `hass.language`**, read in `index.ts`'s and `haventory-panel.ts`'s
  `set hass` and on `haventory-card-editor`'s first update, resolved exact tag → primary
  subtag → `en`. A key a dictionary has not reached falls through to the **English string**,
  never to the key, so a partial dictionary shows a mixed screen rather than `hv.action.retry`
  on a button.
- **A module singleton, not a Lit context.** Half the copy lives in plain functions with no
  host element (`ui/empty-state`, `ui/health-codes`, `ui/plural`, `describeFailure`), and a
  context cannot reach any of them without changing every signature. The consequence is a
  rule: **copy cannot be a module constant.** A `const` computed when the module is evaluated
  freezes English into every surface that reads it, because the language arrives with the
  first `hass` — long after. `discardPrompt()`, `quickDayOffsets()`, `columnLabel()` and the
  editor's `customFieldTypes()` are all functions for that one reason.
- **Whole sentences, not fragments glued at the call site.** Word order is a language's own,
  and a sentence assembled from three keys can only ever be English word order with foreign
  words in it. Two shared namespaces keep that from multiplying: `hv.action.*` for the verbs
  and `hv.term.*` for the facts more than one surface states.
- **Deliberately untranslated**: `DEFAULT_CARD_TITLE` (a product name, pinned to `const.py`),
  the card-picker entry and `setConfig`'s refusal in `index.ts` (both run before any `hass`
  exists), the diagnostics panel's copy-to-clipboard report (it is read by a maintainer), and
  the backend's own error `message` text — the card translates the frame around it, and the
  sentence inside stays as the backend wrote it.

The integration's half is `custom_components/haventory/translations/`, one file per language
mirroring `strings.json`'s key tree. `CONTRIBUTING.md` carries the recipe for adding a
language to both halves.

### How a control says it is on

A filter that is on announces with `aria-pressed`, everywhere: both app bars' stat pills,
the sidebar's category and tag rows, and every chip and row in `hv-filter-panel`. The panel
draws the same "Show only" facets as chips on a desktop and as full-width rows in the phone
sheet, so the shared word is what stops one facet from announcing as a checkbox at one width
and a toggle at another — colour alone says nothing to a screen reader.

The paint follows the same rule. A row in the sheet carries the `chip` class beside its own,
so it takes the chip's outline and on-state tokens rather than drawing a checkbox's box; the
one thing it adds is a fixed-width mark, which holds a stacked column's labels on one left
edge as rows are pressed. Anything still drawing a box is selecting, not filtering.

The other two vocabularies mark genuinely different widgets, and neither is a filter:
`role="radio"` for a segmented picker whose options are exclusive (tag match mode in both
the panel and the sidebar, sort direction, the import sheet's policy) plus `role="switch"`
for the item editor's boolean custom field, and `role="checkbox"` for *selecting* rows
rather than filtering them — `hv-list-row`, `hv-data-table`'s header and row boxes (the
header carries `aria-checked="mixed"` for a partial page), and `hv-column-picker`.

### What a disclosure opens

A control that expands something carries `aria-expanded` **and** `aria-controls`, and the
element it names stays in the tree whether or not it is open — an `aria-controls` that
resolves to nothing announces the control as controlling nothing. Only the contents come and
go, so collapsing still discards the state inside. Every disclosure in the card is wired this
way: `hv-filter-panel`'s location chip, `hv-full-view`'s sidebar headings and Filters button,
`hv-card-shell`'s expand and filter buttons, `hv-item-editor`'s location, category and "More
fields" fields, `hv-organize-dialog`'s two location pickers, and `hv-location-tree`'s rows and
area bands. Ids are shadow-scoped, so the desktop panel and the phone sheet can both be
mounted without colliding. `hv-overflow-menu` is the one disclosure outside this rule: a menu
button announces its popup with `aria-haspopup`, so its menu is free to leave the DOM.

Where the target keeps a rendered box of its own it is held in the tree with `hidden`, so an
empty one neither paints nor takes a grid gap; a holder that sets a `display` of its own
needs a `[hidden]` rule to go with it, because an author rule outranks the browser's. Where
the contents belong to a layout the holder must not join — the item editor's "More fields"
are cells of the form grid — the holder takes `display: contents` instead and stays empty.

Two ids are generated rather than fixed, both in `hv-location-tree`: a row names a container
derived from its node id, and an area band names one derived from its collapse key. Anything
outside the id alphabet is escaped as `_<code point>_`, escaping `_` itself, which keeps the
mapping one-to-one — two nodes cannot collapse onto one container — and keeps the result
usable as a selector. A row with no children discloses nothing and so names nothing.

### The area beside a location

An item arrives with `effective_area_id` already resolved; a `Location` carries `area_id`
only on the root of its tree, because assigning an area moves it there and clears every
node below. So there are two resolutions, and `ui/area.ts` owns both: `areaNameById` for
the item half, and `effectiveAreaIdForLocation` — a cycle-guarded walk up a location's
ancestors — for the location half. Nothing is computed server-side beyond what is already
on the wire; no command changed.

`ui/location-path.ts` composes the result. `itemPathParts` and `locationPathParts` split
"where" into `{ areaName, path }`, `pathTitle` writes both as one string
(`Area: Kitchen · Garage › Shelf A`) for a `title` attribute, and `renderAreaChip` is the
single visual treatment — a home glyph and the name, styled by `.hv-area-chip` in the `chip`
fragment (`ui/chip.ts`) so every shadow root draws it identically. That chip is how an area is told apart
from a path segment: an area is never printed as one. It renders nothing when there is no
area, so callers embed it unguarded and a location outside every area reads exactly as it
did before areas were shown at all.

Two surfaces spell the area out in words instead — `hv-filter-chips`' location chip and
`hv-filter-panel`'s selected-location label. Both already sit inside a chip, and a chip
within a chip is noise, so they print `pathTitle`'s text form, which is also the wording
the area *filter*'s own chip has always used. `hv-list-row` does the same on a phone for a
different reason: with no room for a chip the area goes in as the leading text segment,
where `elidePath` keeps it. It is still marked as an area there — `elideMobilePath` composes
and elides the line exactly as it is shown and then takes the leading segment back off, so
the row can put the chip's own home glyph in front of it and drop the `›` that followed. The
mark is the separator, and it costs the line about what that separator cost. An area name
that itself contains ` › ` splits into two segments and comes back unmarked, which reads as
the line always did rather than marking the wrong words.

That line is three elements rather than one run of text — the lead the row is flagged with,
the pill, and the path tail. An ellipsis only ever replaces text, and the pill is an atomic
box: on a checked-out row with an overdue date the line ran out of room beside *Check in*
and the pill was cut mid-word, while every other row on the screen elided its path with a
"…". As flex items on a wrapping row capped at its first line, a piece that does not fit
wraps out of sight and is dropped whole instead. The " · " that introduces whichever piece
follows the lead sits inside that piece, so a line that drops the piece drops the separator
with it rather than ending on a dot.

Both live in `ui/location-path.ts`, because `hv-data-table` writes the same line: its
`narrow` property — the phone breakpoint, handed down by `hv-full-view`, which is the only
thing that can read a media query on the table's behalf — swaps the wrapping location cell
for the elided one. The table keeps every column and scrolls sideways, so at that width the
location column is off the right edge, and a path that wrapped there still set the row's
height: five segments cost a 129px row against 65px for one, for a column nobody can see
into. One line, whatever the depth; the cell's `title` still carries the path whole. Above
the breakpoint the column is on screen and `renderPathSegments` keeps every segment.

Threading is by property, outward from the two containers that hold `areasCache`.
`hv-card-shell` and `hv-full-view` pass `.areas` to `hv-list` (which forwards to
`hv-list-row`), `hv-data-table`, `hv-detail-sheet`, `hv-item-editor`, `hv-filter-panel`,
`hv-filter-chips`, `hv-bulk-bar` and every `hv-location-tree`; `hv-organize-dialog` passes
it to its three trees. Resolution happens in the component that renders — a `find` over a
handful of areas per render, not memoized.

`areasCache` is kept current for as long as the card is mounted. Areas are Home
Assistant's, so no `haventory/subscribe` topic reports a rename or a deletion; the store
subscribes to HA's own `area_registry_updated` event (`WSClient.subscribeAreaRegistry`)
and refetches the list, coalescing a burst into one call the way the location tree does.
A refused subscription is swallowed — the card keeps the areas it already fetched.

### The location editor states what its area select does

An area belongs to a tree, not to a location, so the organize dialog's area `<select>`
reaches further than it looks: an explicit pick moves the assignment to the tree root and
clears every node below, and giving one up empties the tree. `areaChangePreview`
(`ui/area.ts`, pure) turns the pending edit into `{ kind, rootId, rootName, treeSize,
effectiveAreaId, editsRoot }`, and `hv-organize-dialog` renders one muted line under the
select, updating on change, with the area in the shared `.hv-area-chip`.

Two things it has to get right. `kind` is `none` unless the selection differs from the
location's **own stored** `area_id` — the backend's own test — which on a nested location
is null, so the inherit option is a no-op there rather than a tree-wide clear; that case
prints the area being inherited instead, which the select itself cannot name. And it walks
the parent **as picked in the dialog**: a re-parent and an area change travel in one
`location/update` and the backend propagates after the move, so the area lands on the root
of the tree the save produces. With no areas defined there is nothing to pick and no
consequence to state, and the field is left out entirely.

### Location trees group by area

`hv-location-tree` partitions the roots it is handed with `groupRootsByArea`
(`store/location-tree.ts`, pure and DOM-free) and draws one header row per area, ordered by
area name with the same collator that sorts the tree. Roots belonging to no area follow
under a "No area" header, which appears only when at least one area group does — an
inventory that uses no areas renders as it did before. Headers are `treeitem`s one level
above their members, collapse like any node (a `_collapsedAreas` set, so absence means
open), sum their members' subtree counts, and stay visible while any member survives the
text filter without matching it themselves.

A header is never a location: it carries no id a picker could assign, so `areaSelectable`
makes it emit `select-area` rather than `select`, and what that means belongs to the host.
The full-view sidebar sets `filters.areaId` from it — a filter the item query already
accepts. The organize dialog's **parent** picker files the location at the top level of the
area, which is both halves of moving a subtree between areas in one gesture; it also sets
`showEmptyAreas`, so `groupRootsByArea` bands every area in the registry and not only the
ones already holding a tree (an area you cannot reach until something is in it is no target
at all). An empty band heads nothing, so it renders without a twisty and without
`aria-expanded`/`aria-controls`, and a text filter suspends the empty bands entirely.
Everywhere a `location_id` is what comes back — the item editor, bulk move, the merge
target — headers stay inert labels that only collapse: an area holds no items itself.

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
| `brand-icon.ts` | The HAventory mark as one path, published to HA's icon registry (`window.customIcons`) under the `haventory:` prefix so the sidebar entry can name it. The backend's `PANEL_ICON` is the matching string. |
| `responsive.ts` | The two phone predicates: `ResponsiveController` (a Lit reactive controller driving mobile mode from the card's own measured width, ≤600px) and `NARROW_QUERY`, the viewport query every fixed overlay switches on. |
| `dialog-sheet.ts` | The bottom-sheet presentation the host dialogs share under `mobile`, as one `css` block added to each of their `static styles`. |
| `relative-time.ts` | "2 h ago" / "Jul 31" formatting, overdue checks, and the `+N days` arithmetic the check-out chips use. |
| `day-clock.ts` | `onDayChange(cb)`: one shared timer to the next local midnight, so everything that renders a date re-renders when the day turns. See "The day turning over". |
| `item-form.ts` | Form model and payload building for the edit surfaces: validation per field, typed custom fields, tag normalization, and the `custom_fields_set` / `custom_fields_unset` diff. |
| `value-rewrite.ts` | Tag/category rename, merge and removal as batches of item updates. |
| `health-codes.ts` | Turns the health payload's repeated bare issue codes into one counted sentence each. |
| `fuzzy.ts` | Nearest-existing-value suggestion for the merge flow. |
| `empty-state.ts` | The four empty-list situations: which one applies (`emptyKindFor`), its copy and offered actions, and the markup. |
| `area.ts` | Resolving the HA area behind a location: id → name, and the ancestor walk that mirrors the backend's own resolver. |
| `location-path.ts` | The `/` → `›` convention for a location path, a location's label with a caller-supplied fallback, and the area-beside-the-path composition (`itemPathParts` / `locationPathParts` / `pathTitle` / `renderAreaChip`). |
| `dialog-focus.ts` | Initial focus and focus return for modal surfaces. Opening must move focus into the panel or its Escape handler never fires. |
| `media.ts` | Item attachments: the media path builder, the `MediaUrls` signed-URL cache (request, reuse, refresh before expiry, a distinguishable failed state, and the liveness probe that tells a reference whose file is gone from one that opens), `PictureFallback` for the surfaces that let the browser try the URL first, the per-kind `pictures()` / `manuals()` selectors and the title-or-filename fallback, and the `MediaBindings` shape a host hands its components. |
| `downscale.ts` | Re-encoding an oversized photo in the browser before it is uploaded: the size and type rules, the capped-edge arithmetic, and the decode/encode seam. Fails open — anything that does not work hands the original file back. |
| `status.ts` | The item-status vocabulary: the definitions a surface renders from (backend's, or the built-in three until `haventory/config` answers), the label / tone-class / glyph lookups with their fallbacks, the colour and glyph vocabularies the management picker offers, and `renderStatusChip` — one renderer so the mark cannot drift between a table cell and a detail sheet. |
| `keyboard.ts` | `onEscape()` for the surfaces where Escape means exactly "close", and the platform-correct save-shortcut label. |
| `roving-list.ts` | A long list of rows as one tab stop: which row holds `tabindex="0"` after a redraw (`syncRovingTabindex`), and which row an Arrow, Home or End press moves to (`rovingTarget`). Used by the sidebar's three facet lists; `hv-location-tree` carries its own copy of the pattern, since a tree also has to open and close nodes. |
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
`rate_limited` rejection with backoff before surfacing it, and classifies failures: a
*string* error code means a server answered and the command was refused — including the
taxonomy's `unknown_error` catch-all, which is a server-side fault, not a transport one.
Anything else (Home Assistant's numeric transport codes, a thrown `Error`, no code at all)
never reached a server; those are reported under the card's own `connection_lost` code with
wording that names the connection, and count toward `degraded.connectionLost`. An outage
fails every call in flight, so the error queue holds at most one such entry at a time.

`degraded.connectionLost` has two sources. Repeated transport failures are one, and they
catch an outage that closes no socket — a server that accepts the connection and stops
answering on it. The socket's own `disconnected` event is the other, and it is what an
**idle** surface depends on: every other signal comes from a call the card made, so a list
left open across a restart would otherwise go on showing pre-outage data with nothing to say
so. Home Assistant reconnects by itself, so the event starts a short grace period rather
than declaring the outage at once; `ready` inside that window cancels it, and `ready` after
it takes the banner back down.

A *rejected subscribe* kills live updates outright — no event will ever arrive to hint at
it — so it is handled separately. The four topics — items, stats, locations and statuses —
are opened as one **round**, because the
limiter bills each subscribe separately and can admit `items` while refusing `stats`; live
updates only count as restored once every subscribe in the newest round is accepted, which
`WSClient.subscribe`'s `onOpen` reports. A round refused with `rate_limited` is re-opened
automatically up to four times, waiting the envelope's retry-after hint when it carries one
(`retry_after_ms`, or `retry_after` in seconds, read from `data`, `context` or the top level
and clamped to 30 s) and otherwise backing off exponentially. `degraded.liveUpdates` tracks
this as `'live' | 'retrying' | 'paused'`, with `degraded.nextLiveRetryAt` for the scheduled
attempt; every surface renders it as a non-blocking banner that clears itself when a retry
gets back in. A round refused with `storage_error` or `unknown_command` is re-opened on the
same backoff but a larger budget, because both say the backend is not there *yet* rather
than broken: the first is what a config entry mid-reload answers, the second is Home
Assistant's answer for a command type nobody has registered, which is what a restarting
instance serves until the integration finishes setting up. Landing one of those re-reads the
inventory, since every event in the gap went to a subscription that no longer existed. Once
the budget is spent the state goes `'paused'`, the refusal reaches the error queue once, and
the banner's Refresh (i.e. `refreshAll()`) is the way back. Any other refusal is an outage:
reported immediately, never retried.

`Store.init()` opens the subscriptions and the watches in a `finally`, so a card whose first
load was refused outright still has them. Home Assistant rebuilds the Lovelace view when its
socket reconnects and does so before a restarting instance has set the integration up, so
that card is the common case rather than the odd one — and without the watches it would keep
its loading skeleton for as long as the page stayed open.

**The day turning over.** Every date the card renders — the overdue and inspection chips, the
table's tones, the sheet's facts — is a pure function of the item and the clock, read at
render, so nothing redrew when the only thing that moved was the date. A card on a wall
tablet therefore sat on yesterday's chips until somebody edited something, while the sensors
beside it had rolled over at midnight. `ui/day-clock.ts` is one module-level timer to the
next local midnight (plus a second, so a timer firing a hair early still reads the new day);
`hv-list-row`, `hv-data-table`, `hv-detail-sheet` and `hv-item-editor` subscribe on connect
and re-render, and the store re-reads `haventory/stats`. It also compares the day on
`visibilitychange`, because a device that slept through midnight wakes with a timer that
fired late or not at all.

The counts have two paths and want both: the backend broadcasts `stats/counts` at the
*instance's* midnight, which is the one that keeps the pills agreeing with the sensors, and
the store's own read covers that event being dropped by the rate limiter or served by a
backend too old to send it. The rows follow the *browser's* midnight, which is the day their
chips are compared against; the two are one instant in the ordinary case, and the zone split
is the follow-up #579 named.

**Why the card offers a manual Refresh.** Subscription events carry no sequence number or
generation, and the rate limiter can drop them silently, so a client cannot detect a gap.
Re-listing on demand is the documented recovery, so it is a first-class action rather than
a hidden one.

### `WSClient`

A typed wrapper over `hass.callWS` for each `haventory/*` command, plus `subscribe()`, which
takes `onError` and `onOpen` callbacks so both a refused and an accepted subscribe are
observable.

It is a deliberate 1:1 mirror of the command catalogue in `backend_api_contract.md`,
omitting only `haventory/cleanup` and `haventory/unsubscribe` (the latter handled by HA's
own `subscribeMessage`). A few wrappers have no caller in the card today; they complete the
mirror and are kept on purpose.

Two members are not plain `callWS` wrappers. `uploadAttachment` POSTs the bytes to Home
Assistant core's `/api/file_upload` through `hass.fetchWithAuth` and only then names the
resulting handle over the socket — a WebSocket frame carries JSON, and an 8 MB photo
base64'd into one would be both slower and larger. `signPath` calls core's
`auth/sign_path`, because an `<img src>` carries no `Authorization` header and the media
view requires one.

### Column preferences (`src/store/columns.ts`)

`ColumnKey` covers quantity, category, location, tags, due date, inspection date and
updated. Each definition carries a `tableSize` for the full-view table and — only where the
backend can actually sort by it — a `sortField`. Category, location and tags have none, so
their headers are not clickable: a header that looks interactive but does nothing is worse
than a plain one.

`DEFAULT_COLUMNS` is every key, in the canonical order: a browser that has made no choice
sees the whole record, and the picker is what thins it and reorders it. The stored array
*is* the order — `normalizeColumns` validates and dedupes without re-sorting, so a
selection written before ordering existed (always canonical) loads as the same table it
described, and `canonicalOrder` is what "Reset order" restores. The full set is wider than a phone and wider than many
desktops, which `hv-data-table` answers by scrolling sideways rather than dropping columns.
The name track (`NAME_COLUMN_SIZE`) outweighs every flexible column beside it in both
halves of its `minmax`, because the row's identity is the one column that cannot be
allowed to lose — and at phone width the table pins it, so it holds while the rest scrolls
under it. The pinning is why `hv-data-table` scrolls **both** axes on its host rather than
scrolling the rows in a box of their own: a sticky cell resolves its offsets against the
nearest scroll container, and a nested one that never moves sideways pins nothing.

Preferences persist in `localStorage` under `haventory:columns:v1` as `{ expanded: [...] }`.
Any other key in that record is ignored, so an older or newer payload never breaks the load.

---

## Behaviour worth knowing

- **One edit form.** `hv-item-editor` is used by the inline expander, the full view and the
  mobile sheet. On mobile it stacks and collapses description / dates / custom fields
  behind a single "More fields" disclosure. Its action bar is sticky on **every** host, not
  only the phone: each of them scrolls the form in a box (the card's list, the sheet, the
  expanded view's 70dvh cap), so Save and Cancel land below the fold on all three. The
  editor solves that once; no host grows a pinned footer of its own. The bar bleeds past
  `.grid`'s side padding so its opaque background reaches the form's edges.
- **No path discards typed edits without asking.** Cancel, the ✕ and Escape are the form's
  own, so `hv-item-editor` answers for them itself and hosts do not repeat the check; a host
  with somewhere to go afterwards — another row, a sheet coming down, the expanded view
  closing — calls `requestClose()` or asks its own copy. Either way the wording comes from
  `ui/discard`, so the same decision never reads as two different questions. The phone sheets
  are part of this: `hv-bottom-sheet` reports a scrim tap or a swipe-down and leaves the
  closing to its host, which is what lets `hv-detail-sheet` answer for the form inside it.
- **An attachment whose file is gone is a state, not an error.** Metadata outlives bytes —
  a JSON export carries the references and not the files, and a backup that took `.storage`
  without the config directory's `haventory/` tree leaves every attachment on every item
  like this — so every surface draws a *File missing* placeholder rather than a dead link or
  a broken `<img>`. Which way it is found differs by surface. The document rows, the
  editor's photo grid and the detail sheet's strip ask `MediaUrls.presence()` up front: one
  item's attachments are few, and asking first is what keeps a URL that can only fail from
  ever reaching an `<img>`. The row tiles and the lightbox wait for the image to fail and
  ask then (`PictureFallback`), because a table of two hundred rows would otherwise put two
  hundred extra questions to the backend to draw tiles that are almost always fine. Only a
  404 counts as missing; an inconclusive probe leaves the picture alone.
- **Optimistic writes** stay as they were; a rejected save keeps the expander open with the
  user's text in it, and conflicts render as a banner with *View latest* / *Re-apply*.
- **Bulk work is chunked**, so progress is determinate and cancel stops cleanly after the
  in-flight chunk. Nothing is rolled back — the endpoint is not transactional, and the UI
  says so.
- **A batch asks whatever the single row is asked.** The bar owns the steps that only
  concern a selection (which location, which tags); the two questions a single row already
  has a surface for — the delete confirmation and check-out's due date — belong to the
  host, which opens the same `hv-confirm` and `hv-checkout-popover` once and applies the
  one answer to every selected item. A `check-out` run detail carrying no `dueDate` key at
  all is how the bar says "ask"; `dueDate: null` is a user who chose no due date. Check-in
  stays immediate: there is nothing to ask.
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
items / locations / stats, and to HA's `area_registry_updated`.

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
- **No real drag and drop** — jsdom builds a `DragEvent` with no `DataTransfer` behind it,
  so the editor's file-drop tests carry a plain-object `dataTransfer` and assert the
  routing (which kind each dropped file becomes) rather than the browser's drag machinery.
  Dropping a file onto the editor is the only drag the card handles: an item's location
  changes through the item editor or the bulk bar's Move action, never by dragging the row
  onto a node of the sidebar tree.

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

**Buttons are the card's reordering idiom** — the organize dialog's status rows and the item
editor's photo strip both move an entry with a pair of arrow buttons, and both send the whole
new order to the backend. Pointer drag has no keyboard equivalent, so it could only ever
arrive *beside* the buttons and never in place of them; and whichever list grew it first
would settle the gesture for the others, the unbuilt column order among them. It is not
built. The buttons already carry the capability on every ordered list the card has, so
nothing waits on it, and whether the gesture is worth implementing across three surfaces at
once is a question about how the card gets used — which takes people using it to answer.

---

## Known gaps

- Nothing in the card moves by pointer drag. An item cannot be dragged onto a location in
  the sidebar tree — its location changes through the item editor or the bulk bar's Move
  action — and the ordered lists reorder with buttons, per the decision above.
- Large lists rely on paging; no row virtualization.
- The backend cannot sort by category, location or tags, filter by due date, or bulk-create
  items — the UI is shaped around those limits rather than hiding them.
