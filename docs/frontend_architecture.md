# HAventory Frontend Architecture

## Overview

The HAventory Lovelace card is a Home Assistant dashboard component built with:

- **Framework**: Lit 3 (web components, shadow DOM)
- **Language**: TypeScript 6 (`strict`)
- **Build**: Vite 8, producing a single ESM bundle at
  `custom_components/haventory/www/haventory-card.js`, which the integration serves at
  `/haventory_static/haventory-card.js`
- **Tests**: Vitest 4 with jsdom

It provides the full inventory UI, updating live over the HAventory WebSocket API.

---

## Entry point

`src/index.ts` defines `haventory-card`, the element Home Assistant knows about. It owns the
`Store` (created on the first `hass` assignment) and the Lovelace interface (`setConfig`,
`getCardSize`, `getGridOptions`, the statics `getStubConfig` and `getConfigElement`, and
`window.customCards`), and nothing else of substance:

```ts
setConfig(cfg) → { title?: string; quickFilters?: QuickFilterKey[] | null }
                                      // every other key is ignored, not rejected
render()       → <hv-card-shell>
```

`quick_filters` names the quick-filter pills the dashboard offers (`ui/quick-filters.ts`
holds the vocabulary). `null`, the omitted key or anything that is not a list, means all of
them. The shell passes it to `hv-full-view` unchanged, so the card's badges and the full
view's pills offer one vocabulary. The sidebar panel, which has no dashboard config, takes
the default. It decides what is *allowed*; whether an allowed pill draws is still the
count's call.

`getStubConfig` and `getConfigElement` are **statics on the class**, not module exports:
Home Assistant reads them off `customElements.get(type)` and never imports from the bundle.
`getGridOptions` sizes the card in a sections view, while `getCardSize` still answers the
masonry view.

It also publishes the active HA theme as `color-scheme` on the host, which every nested
component inherits.

`src/haventory-panel.ts` defines `haventory-panel`, the same bundle's second element, which
HA's custom-panel loader instantiates for the sidebar page. It renders
`<hv-full-view embedded open>`.

Both take their store lifecycle from `StoreHostElement` (`src/store-host.ts`), which they
extend: the `hass` setter that sets the language before anything renders and builds the
store from the first object, the subscription that survives a disconnect and comes back with
the element, and the `color-scheme` publish. What each one adds is what it renders and what
configuration it reads.

`src/haventory-card-editor.ts` defines `haventory-card-editor`, the bundle's third HA-facing
element, which `getConfigElement` creates by tag. It renders one field for `title`, built
from the card's own input and `--hv-*` tokens rather than HA's `ha-form` (see "The Home
Assistant contact surface" below), and turns its `input` event into a `config-changed`
carrying `{ ...config, title }`. The spread is the point: the card ignores unknown keys, so
`quick_filters` and anything a future version writes survive an edit untouched. An emptied
title is dropped from the config rather than written as `""`, which hands the heading back
to the integration-wide option. All three elements register through `defineCardElement`
(`src/register.ts`), because HA creates each of them by tag after the frontend has swapped
`window.customElements`.

The integration registers that panel at `/haventory` through `panel_custom`, handing it the
*same* module URL both card loaders get (`__init__.py`, `_async_apply_sidebar_panel`), so the
browser's module map evaluates the bundle once whichever surface is opened first. The
registration's `config` carries `{"title": <card title option>}`, which is where the panel's
heading comes from; the sidebar entry itself is named by the same option. Changing a
registration is remove-then-register, because `panel_custom.async_register_panel` does not
forward the `update` argument and HA raises on a second registration of a URL path that is
already taken. Only a change pays for that: while the panel is out of `hass.panels` the
frontend sends whoever is standing on `/haventory` to the default dashboard, so a reload
that leaves the title alone recognises the registration it already has and touches nothing.
Unload keeps the panel for the same reason; it is handed back when the entry is disabled or
removed. The `sidebar_panel_enabled` option turns it off, and both calls fire the frontend's
panel-update event, so the sidebar follows without a restart.

Both hosts hold a `HostSurfaces` instance (`src/host-surfaces.ts`): every surface
`hv-full-view` can raise but not answer itself. That is the column picker, the export
download, the delete/discard confirmation, the organize dialog, the import sheet, the
diagnostics panel with its refresh state, and the shared ⋮ menu-entry builder. On the card
side the instance lives in `hv-card-shell`; on the panel it lives in the panel element
directly. Host differences enter as constructor hooks (`onItemDeleted`, `onBrowse`). The
phone form of those dialogs is not one of them: the instance watches the viewport itself
(a `ViewportNarrow` controller on the host) and hands the same answer to all five, so the
card and the panel cannot disagree about what a phone is.

`hv-card-shell` and `hv-full-view` hold an `ItemWorkspace` (`src/item-workspace.ts`) on the
same terms: host, `getStore`, hooks. It is everything the two shells do to one item: which
row the form is open on, the copy of that row pinned while a refetch is in flight, the save
and what a refused one leaves on screen, the read sheet's item, the check-out step, and one
dispatch table for every event a row can raise. It renders the editor, the read sheet and
the check-out popover. The hooks are the three things that genuinely differ: where a row tap
goes, who answers a delete, and which shadow root the open form is in.

---

## The Home Assistant contact surface

`src/ha-contract.ts` is the one module that names what the card asks of Home Assistant, and
the file to open when an upgrade breaks something: the `HassLike` shape, thin wrappers for
`callWS` and `connection.subscribeMessage`, the `window.customCards` picker registration,
and the theme variables the card binds. `store/ws.ts` is the only caller of the two
WebSocket wrappers; `index.ts` is the only caller of the registration; `ui/theme.ts` reads
`SURFACE_VARS` from here to classify the surface the card is painted on.

The row that matters most is empty: **the card renders no `ha-*` element.** HA's frontend
components are registered lazily inside its own bundle, are not published for card authors
and are not versioned, and none of them exists in jsdom, so one rendered here would break
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
    │                              below it render through that) and the ItemWorkspace
    │                              (the editor, the read sheet and the check-out step)
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
    │   │                          view alike: read + edit in one sheet (a save that
    │   │                          lands returns it to read), photo gallery strip and
    │   │                          the Documents list
    │   ├── hv-item-editor
    │   ├── hv-lightbox            photos full-size, with arrows and a counter
    │   └── hv-checkout-popover    inline due-date step
    ├── hv-checkout-popover        desktop: anchored due-date step
    ├── hv-organize-dialog         Locations / Categories / Tags / Statuses
    ├── hv-import-sheet            input → preview → summary (+ invalid-document state)
    ├── hv-diagnostics-panel       subscriptions, counts, version, copy report
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
than by a component of their own: they are flat lists of `distinct_values` entries.

Each of those lists (status, categories and tags) is **one tab stop**, not one per row,
because the list is as long as the household's vocabulary and a stop per row would put that
vocabulary between the search box and the table. The container carries `role="group"` with
the section's name, one row holds `tabindex="0"` and the rest `-1`, ArrowDown/ArrowUp move
inside the list, and Home and End reach its ends. The rows stay `<button aria-pressed>`, so
Enter and Space still press them. Which row holds the stop is kept per section in
`_facetStop` and reconciled against the rendered rows after every render. The section
heading, its "+" and the tags any/all pair are ordinary tab stops. `ui/roving-list.ts` holds
the walk and the key handling, and `hv-location-tree` reads the Locations section's from the
same module, one level deeper, because a tree's rows also open and close.

`hv-filter-panel` answers the same problem by showing less: its category and tag groups
draw `CATEGORY_CHIP_LIMIT` (4) and `TAG_CHIP_LIMIT` (8) chips and collapse the rest behind a
"More…" chip carrying the hidden tally. A selected value past the cut is drawn anyway, and
the expansion is per mount, left alone by "Clear all" and by the sheet's Cancel. Both lists
arrive from `distinct_values` sorted alphabetically, so the cut is taken over `count` (ties
by value), never over the filter-priced `matching_count`, which moves as a filter is built
and would reshuffle the row under the pointer. Expanding hands back the alphabetical order.

Each of the four headings offers a create action, and the three that can be counted state
how many of their thing there is. Categories and tags come with their `distinct_values`
length; locations are counted by `countLocations` in `store/location-tree.ts`, which walks
every depth and takes the same optional filter needle `hv-location-tree` matches rows with.
Creating differs by facet because the backend does: a location is a real object and is
created inline, while a category, tag or status is made in the organize dialog, so those
buttons ask the card to open `hv-organize-dialog` on the matching tab (`menu-action` with
`{ id: 'organize', tab }`). The app bar carries an Organize button raising the same event
with no tab.

### Two different "is this a phone?" signals

Two questions, two answers, and they are not interchangeable:

- **How wide is the card?** `MOBILE_BREAKPOINT` (600px), measured on the element by
  `ResponsiveController` and handed down as a `mobile` **property**. Everything drawn inside
  the card's own box reads this (the list, the steppers, the in-card sheets), because a card
  in a narrow dashboard column is a phone layout however wide the window is.
- **How wide is the window?** `NARROW_QUERY` (`(max-width: 700px)`, `ui/responsive.ts`),
  read with `matchMedia` and as a CSS `@media` block. Everything `position: fixed` reads
  this: `hv-full-view`, `hv-overflow-menu`, and the five dialogs `HostSurfaces` owns. A fixed
  overlay is laid out against the window, so the card's width says nothing about the room
  it has.

The two signals meet in the children of a fixed overlay. `hv-item-editor` and
`hv-filter-panel` are property-driven but also children of `hv-full-view`, so that surface
reads the viewport query and hands the property down. `hv-filter-panel` in `mobile` mode
*stages* its edits and drops its own footer, expecting the host to provide one, so the
expanded view carries the commit row the card's filter sheet has: a head row above the
panel (the heading, how many filters are staged, and Clear all) and a footer of Cancel and
"Show N items". Three controls on one row is one too many for a 375px screen in German,
which is why the head row exists on both surfaces. For the same reason the phone toolbar
drops its column-picker button and leaves the ⋮ menu's Columns entry as the route there.

In the other direction, `HostSurfaces` reads the viewport itself rather than taking the
card's measurement. Fed the card's width, the organize dialog would take its full-bleed
phone page on a desktop monitor whenever the card sits in a normal column.

On a phone viewport the four smaller dialogs (column picker, confirm, import, diagnostics)
rise from the bottom edge like every other phone surface, through the `modalSheet` block of
`ui/modal.ts`. The organize dialog takes the same module's chrome without that block and
keeps its full-bleed page, which is what a four-tab management surface needs at that width.

Inside that dialog one declaration governs row height: `--hv-organize-row-pad` on its host,
read by its own value rows and inherited through the shadow boundary into the
`hv-location-tree` its Locations tab hosts. No other host declares it, so the sidebar tree,
the filter panel's picker and the editor's location field are untouched.

### Shared wording

`ui/empty-state.ts` owns the four empty-list situations (nothing yet, nothing matched,
nothing filed here, no connection) as copy, offered actions **and** the rule that picks
between them (`emptyKindFor`), so `hv-list` and the `hv-data-table` inside `hv-full-view`
cannot answer the same situation two different ways. `ui/plural.ts` owns count agreement
(`counted(n, 'item')`), and `ui/location-path.ts` owns the `/` to `›` separator every
surface that prints a location path uses. Only the CSS is per-component, because style
rules cannot cross a shadow boundary.

### The language the wording is in

Every string in every component comes out of `src/i18n/`.

- **`en.ts` is the key universe.** `TranslationKey` is `keyof typeof en`, so a key nothing
  defines does not compile at the call site; `de.ts` is a `CompleteDictionary`, so an
  English string added without a German one does not compile either. `catalog.test.ts`
  holds the rest: an `.other` behind every counted key, no orphaned keys, the same
  placeholders on both sides, and completeness for the languages its `COMPLETE` list names.
  `unused-keys.test.ts` sweeps the sources for a key nothing reads.
- **`t(key, params?)`** fills `{name}` placeholders; a placeholder with no parameter renders
  literally, so a typo shows rather than blanking a word. **`tn(key, count, params?)`** asks
  `Intl.PluralRules` for the language's category and reads `<key>.<category>`, falling back
  to `<key>.other` and then to English.
- **The language is `hass.language`**, read in `index.ts`'s and `haventory-panel.ts`'s
  `set hass` and on `haventory-card-editor`'s first update, resolved exact tag, then primary
  subtag, then `en`. A key a dictionary has not reached falls through to the **English
  string**, never to the key.
- **A module singleton, not a Lit context.** Half the copy lives in plain functions with no
  host element (`ui/empty-state`, `ui/plural`, `describeFailure`), and a context cannot
  reach any of them without changing every signature. The consequence is a rule: **copy
  cannot be a module constant.** A `const` computed when the module is evaluated freezes
  English into every surface that reads it, because the language arrives with the first
  `hass`, long after. `discardPrompt()`, `quickDayOffsets()`, `columnLabel()` and the
  editor's `customFieldTypes()` are all functions for that one reason.
- **Whole sentences, not fragments glued at the call site.** Word order is a language's own.
  Three shared namespaces keep that from multiplying: `hv.action.*` for the verbs,
  `hv.term.*` for the facts more than one surface states, and `hv.field.*` for what an
  item's fields are called, one key per word, read by the column header, the sort option,
  the editor label, the facet tab and the detail sheet's fact row alike.
- **`hv.status.*` is displayed copy over stored data.** A household owns its status labels
  and renames them, so they are stored rather than translated, but nobody chose the three a
  store is seeded with. `ui/status.ts`'s `displayLabel` prints the reader's word for a
  built-in slug while its stored label is still the seeded English, and the stored label
  from the first rename on. Every surface reaches it through `statusLabel` or
  `renderStatusChip`, and nothing writes a translation back.
- **Deliberately untranslated**: `DEFAULT_CARD_TITLE` (a product name, pinned to
  `const.py`), the card-picker entry and `setConfig`'s refusal in `index.ts` (both run before
  any `hass` exists), the diagnostics panel's copy-to-clipboard report (read by a
  maintainer), and the backend's own error `message` text. The card translates the frame
  around it, and the sentence inside stays as the backend wrote it.

The integration's half is `custom_components/haventory/translations/`, one file per language
mirroring `strings.json`'s key tree. `CONTRIBUTING.md` carries the recipe for adding a
language to both halves.

### How a control says it is on

A filter that is on announces with `aria-pressed`, everywhere: both app bars' stat pills,
the sidebar's category and tag rows, and every chip and row in `hv-filter-panel`. The panel
draws the same "Show only" facets as chips on a desktop and as full-width rows in the phone
sheet, so the shared word is what stops one facet from announcing as a checkbox at one width
and a toggle at another. Colour alone says nothing to a screen reader.

The paint follows the same rule. A row in the sheet carries the `chip` class beside its
own, so it takes the chip's outline and on-state tokens rather than drawing a checkbox's
box. Anything still drawing a box is selecting, not filtering.

The other two vocabularies mark genuinely different widgets, and neither is a filter:
`role="radio"` for a segmented picker whose options are exclusive (tag match mode in both
the panel and the sidebar, sort direction, the import sheet's policy) plus `role="switch"`
for the item editor's boolean custom field, and `role="checkbox"` for *selecting* rows
rather than filtering them: `hv-list-row`, `hv-data-table`'s header and row boxes (the
header carries `aria-checked="mixed"` for a partial page), and `hv-column-picker`.

### What a disclosure opens

A control that expands something carries `aria-expanded` **and** `aria-controls`, and the
element it names stays in the tree whether or not it is open, because an `aria-controls`
that resolves to nothing announces the control as controlling nothing. Only the contents
come and go, so collapsing still discards the state inside. Every disclosure in the card is
wired this way: `hv-filter-panel`'s location chip, `hv-full-view`'s sidebar headings and
Filters button, `hv-card-shell`'s expand and filter buttons, `hv-item-editor`'s location and
category fields, `hv-organize-dialog`'s two location pickers and its merge-target value list,
and `hv-location-tree`'s rows and area bands. Ids are shadow-scoped, so the desktop panel
and the phone sheet can both be mounted without colliding. `hv-overflow-menu` is the one
disclosure outside this rule: a menu button announces its popup with `aria-haspopup`, so its
menu is free to leave the DOM.

Where the target keeps a rendered box of its own it is held in the tree with `hidden`, so an
empty one neither paints nor takes a grid gap. A holder that sets a `display` of its own
needs a `[hidden]` rule to go with it, because an author rule outranks the browser's.

Two ids are generated rather than fixed, both in `hv-location-tree`: a row names a container
derived from its node id, and an area band names one derived from its collapse key.
Anything outside the id alphabet is escaped as `_<code point>_`, escaping `_` itself, which
keeps the mapping one-to-one and the result usable as a selector. A row with no children
discloses nothing and so names nothing.

### The area beside a location

An item arrives with `effective_area_id` already resolved. A `Location` carries `area_id`
only on the root of its tree, because assigning an area moves it there and clears every
node below. So there are two resolutions, and `ui/area.ts` owns both: `areaNameById` for
the item half, and `effectiveAreaIdForLocation`, a cycle-guarded walk up a location's
ancestors, for the location half.

`ui/location-path.ts` composes the result. `itemPathParts` and `locationPathParts` split
"where" into `{ areaName, path }`, `pathTitle` writes both as one string
(`Area: Kitchen · Garage › Shelf A`) for a `title` attribute, and `renderAreaChip` is the
single visual treatment: a home glyph and the name, styled by `.hv-area-chip` in the `chip`
fragment (`ui/chip.ts`) so every shadow root draws it identically. That chip is how an area
is told apart from a path segment. It renders nothing when there is no area, so callers
embed it unguarded.

Two surfaces spell the area out in words instead: `hv-filter-chips`' location chip and
`hv-filter-panel`'s selected-location label. Both already sit inside a chip, and a chip
within a chip is noise, so they print `pathTitle`'s text form. `hv-list-row` does the same
on a phone for a different reason: with no room for a chip the area goes in as the leading
text segment, where `elidePath` keeps it. It is still marked as an area there:
`elideMobilePath` composes and elides the line exactly as it is shown and then takes the
leading segment back off, so the row can put the chip's own home glyph in front of it and
drop the `›` that followed. An area name that itself contains ` › ` splits into two
segments and comes back unmarked.

That line is three elements rather than one run of text: the lead the row is flagged with,
the pill, and the path tail. An ellipsis only ever replaces text, and the pill is an atomic
box, so as flex items on a wrapping row capped at its first line, a piece that does not fit
wraps out of sight and is dropped whole instead of being cut mid-word. The " · " that
introduces whichever piece follows the lead sits inside that piece, so a line that drops the
piece drops the separator with it.

Both live in `ui/location-path.ts`, because `hv-data-table` writes the same line: its
`narrow` property (the phone breakpoint, handed down by `hv-full-view`) swaps the wrapping
location cell for the elided one. The table keeps every column and scrolls sideways, so at
that width the location column is off the right edge, and a path that wrapped there would
still set the row's height. One line, whatever the depth; the cell's `title` still carries
the path whole. Above the breakpoint `renderPathSegments` keeps every segment.

Threading is by property, outward from the two containers that hold `areasCache`.
`hv-card-shell` and `hv-full-view` pass `.areas` to `hv-list` (which forwards to
`hv-list-row`), `hv-data-table`, `hv-detail-sheet`, `hv-item-editor`, `hv-filter-panel`,
`hv-filter-chips`, `hv-bulk-bar` and every `hv-location-tree`; `hv-organize-dialog` passes
it to its three trees. Resolution happens in the component that renders: a `find` over a
handful of areas per render, not memoized.

`areasCache` is kept current for as long as the card is mounted. Areas are Home Assistant's,
so no `haventory/subscribe` topic reports a rename or a deletion. The store subscribes to
HA's own `area_registry_updated` event (`WSClient.subscribeAreaRegistry`) and refetches the
list, coalescing a burst into one call the way the location tree does. A refused
subscription is swallowed; the card keeps the areas it already fetched.

### The location editor states what its area select does

An area belongs to a tree, not to a location, so the organize dialog's area `<select>`
reaches further than it looks: an explicit pick moves the assignment to the tree root and
clears every node below, and giving one up empties the tree. `areaChangePreview`
(`ui/area.ts`, pure) turns the pending edit into `{ kind, rootId, rootName, treeSize,
effectiveAreaId, editsRoot }`, and `hv-organize-dialog` renders one muted line under the
select, updating on change, with the area in the shared `.hv-area-chip`.

Two things it has to get right. `kind` is `none` unless the selection differs from the
location's **own stored** `area_id`, the backend's own test, which on a nested location is
null, so the inherit option is a no-op there rather than a tree-wide clear. That case prints
the area being inherited instead, which the select itself cannot name. And it walks the
parent **as picked in the dialog**: a re-parent and an area change travel in one
`location/update` and the backend propagates after the move, so the area lands on the root
of the tree the save produces. With no areas defined the field is left out entirely.

### Location trees group by area

`hv-location-tree` partitions the roots it is handed with `groupRootsByArea`
(`store/location-tree.ts`, pure and DOM-free) and draws one header row per area, ordered by
area name with the same collator that sorts the tree. Roots belonging to no area follow
under a "No area" header, which appears only when at least one area group does, so an
inventory that uses no areas renders as before. Headers are `treeitem`s one level above
their members, collapse like any node (a `_collapsedAreas` set, so absence means open), sum
their members' subtree counts, and stay visible while any member survives the text filter.

A header is never a location: it carries no id a picker could assign, so `areaSelectable`
makes it emit `select-area` rather than `select`, and what that means belongs to the host.
The full-view sidebar sets `filters.areaId` from it. The organize dialog's **parent** picker
files the location at the top level of the area, which is both halves of moving a subtree
between areas in one gesture; it also sets `showEmptyAreas`, so `groupRootsByArea` bands
every area in the registry and not only the ones already holding a tree. An empty band
heads nothing, so it renders without a twisty and without `aria-expanded`/`aria-controls`,
and a text filter suspends the empty bands entirely. Everywhere a `location_id` is what
comes back (the item editor, bulk move, the merge target), headers stay inert labels that
only collapse.

### Container vs presentation

`hv-card-shell` and `hv-full-view` are **containers**: they hold the `Store` and call it
directly. Everything else is presentational and communicates by events.

Interactions nest several levels deep (row, editor, location tree, selection), and threading
each one back through the root element as a re-dispatched event is more plumbing than it is
worth.

Because the shell receives a stable `store` object, a property binding would never re-render
it, so each container subscribes to `store.state.onChange` itself, through the
`ItemWorkspace` it holds, for as long as it is in the DOM.

---

## Shared UI layer (`src/ui/`)

| Module | What it does |
|---|---|
| `tokens.ts` | Every design token as a `--hv-*` custom property, bound to the HA theme variable first with the mock hex as fallback, plus dark-mode and reduced-motion overrides. `base` adds the pill, icon-button, chip and input primitives. Composed as `static styles = [tokens, base, css\`…\`]`. |
| `icons.ts` | Material Design Icons path data, inlined and rendered as `<svg fill="currentColor">`. See the note below. |
| `brand-icon.ts` | The HAventory mark as one path, published to HA's icon registry (`window.customIcons`) under the `haventory:` prefix so the sidebar entry can name it. The backend's `PANEL_ICON` is the matching string. |
| `responsive.ts` | The two phone predicates, both as Lit reactive controllers: `ResponsiveController` drives mobile mode from the card's own measured width (≤600px), and `ViewportNarrow` follows `NARROW_QUERY`, the viewport query every fixed overlay switches on. |
| `modal.ts` | The centred dialogs' chrome, once: the backdrop, centring and panel CSS (`modalChrome`), the phone bottom-sheet restyle of it (`modalSheet`), and the `Modal` controller that owns the stacking base, the focus in and back out, the Escape binding and the panel markup. |
| `relative-time.ts` | "2 h ago" / "Jul 31" formatting, overdue checks, and the `+N days` arithmetic the check-out chips use. |
| `day-clock.ts` | `onDayChange(cb)`: one shared timer to the next local midnight, so everything that renders a date re-renders when the day turns. See "The day turning over". |
| `item-form.ts` | Form model and payload building for the edit surfaces: validation per field, typed custom fields, tag normalization, and the save diff. An update names only the fields the edit changed, including the `custom_fields_set` / `custom_fields_unset` halves. |
| `value-rewrite.ts` | Tag and category rename, merge and removal as batches of item updates. |
| `fuzzy.ts` | Nearest-existing-value suggestion for the merge flow. |
| `empty-state.ts` | The four empty-list situations: which one applies (`emptyKindFor`), its copy and offered actions, and the markup. |
| `area.ts` | Resolving the HA area behind a location: id to name, and the ancestor walk that mirrors the backend's own resolver. |
| `location-path.ts` | The `/` to `›` convention for a location path, a location's label with a caller-supplied fallback, and the area-beside-the-path composition (`itemPathParts` / `locationPathParts` / `pathTitle` / `renderAreaChip`). |
| `dialog-focus.ts` | Initial focus and focus return for modal surfaces. Opening must move focus into the panel or its Escape handler never fires. |
| `media.ts` | Item attachments: the media path builder, the `MediaUrls` signed-URL cache (request, reuse, refresh before expiry, a distinguishable failed state, and the liveness probe that tells a reference whose file is gone from one that opens), `PictureFallback` for the surfaces that let the browser try the URL first, the per-kind `pictures()` / `manuals()` selectors and the title-or-filename fallback, and the `MediaBindings` shape a host hands its components. |
| `downscale.ts` | Re-encoding an oversized photo in the browser before it is uploaded: the size and type rules, the capped-edge arithmetic, and the decode/encode seam. Fails open: anything that does not work hands the original file back. |
| `status.ts` | The item-status vocabulary: the definitions a surface renders from (the backend's, or the built-in three until `haventory/config` answers), the label, tone-class and glyph lookups with their fallbacks, the colour and glyph vocabularies the management picker offers, and `renderStatusChip`, one renderer so the mark cannot drift between a table cell and a detail sheet. |
| `keyboard.ts` | `onEscape()` for the surfaces where Escape means exactly "close", and the platform-correct save-shortcut label. |
| `roving-list.ts` | A long list of rows as one tab stop: which row holds `tabindex="0"` after a redraw (`syncRovingTabindex`), and which row an Arrow, Home or End press moves to (`rovingTarget`). Used by the sidebar's three facet lists and by `hv-location-tree`, which also passes a `Disclosure` so Right and Left work the twisties and step out to a parent. |
| `day-offsets.ts` | The quick jumps a forward date is set by: three presets, the "+X days" box, and the rule that an empty box means no date rather than the last one. Drawn by the check-out popover and the editor's inspection field. |
| `picker.ts` | A trigger and the box it opens, drawn into the host's own template: the `aria-expanded` / `aria-controls` pair, the holder that stays in the tree while its contents come and go, a `disabled` trigger for a box with nothing in it, and an `onClose` hook for a host keeping a filter inside. |
| `location-picker.ts` | `Picker` around `hv-location-tree`: the same trigger and holder, plus closing on a pick, with `keepOpenOnSelect` for a surface that picks a set. |
| `attachments.ts` | The photo figure, the document row and the lightbox host the item editor and the detail sheet share, in particular the one answer both give to a reference whose file the backend does not have. |
| `plural.ts` | Count agreement for every count string in the card. |
| `theme.ts` | Whether the card is painted on a light or dark surface, read from HA's own theme variables rather than `prefers-color-scheme`. |

### Inline SVG instead of `<ha-icon>`

`ha-icon` resolves only inside the Home Assistant frontend: in Vitest/jsdom it is an
unresolved custom element that renders nothing, and it leaves the card icon-less anywhere HA
has not loaded its icon set. The glyphs are inlined as path data instead (Material Design
Icons, Apache-2.0), which renders everywhere and is assertable in a test. `ha-button-menu` /
`mwc-list-item` are replaced by `hv-overflow-menu` for the same reason. The rule in full is
[`CONTRIBUTING.md`](../CONTRIBUTING.md) → "The card renders no `ha-*` element".

---

## Store (`src/store/`)

### `Store`

Holds all app state in a small observable (`createObservable`), fetches over `WSClient`, and
applies optimistic writes with rollback.

**State**: `StoreState` in `src/store/types.ts`, which documents each field: the loaded page
and its cursor, the filtered total, the selection, the caches the sidebar and the
autocompletes read, what `haventory/config` answered, and the connection state the banners
render from.

**Notable methods**

| Method | Notes |
|---|---|
| `init()` | Parallel cache warm-up, first list, then subscribe. |
| `listItems(reset)` | Page size 50. Keeps `total`, the filtered match count across all pages. |
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

**Degraded state.** Every WS call goes through `run()`, which classifies failures. The
attachment family is excepted, because an upload's failures are HTTP and belong to the
picker that raised them. A *string* error code means a server answered and the command was
refused, including the taxonomy's `unknown_error` catch-all. Anything else (Home Assistant's
numeric transport codes, a thrown `Error`, no code at all) never reached a server. Those are
reported under the card's own `connection_lost` code with wording that names the connection,
and count toward `degraded.connectionLost`. An outage fails every call in flight, so the
error queue holds at most one such entry at a time.

`degraded.connectionLost` has two sources. Repeated transport failures are one, and they
catch an outage that closes no socket. The socket's own `disconnected` event is the other,
and it is what an **idle** surface depends on: every other signal comes from a call the
card made, so a list left open across a restart would otherwise go on showing pre-outage
data. Home Assistant reconnects by itself, so the event starts a short grace period rather
than declaring the outage at once; `ready` inside that window cancels it, and `ready` after
it takes the banner back down.

A *rejected subscribe* kills live updates outright, because no event will ever arrive to
hint at it, so it is handled separately. The four topics (items, stats, locations and
statuses) are opened as one **round**, because each subscribe is answered on its own and one
can be accepted while the next is refused. Live updates only count as restored once every
subscribe in the newest round is accepted, which `WSClient.subscribe`'s `onOpen` reports. A
round refused with `storage_error` or `unknown_command` is re-opened automatically on a
bounded budget, backing off exponentially and never waiting longer than 30 s for one
attempt. Both codes say the backend is not there *yet* rather than broken: the first is what
a config entry mid-reload answers, the second is Home Assistant's answer for a command type
nobody has registered, which is what a restarting instance serves until the integration
finishes setting up. `degraded.liveUpdates` tracks this as `'live' | 'retrying' | 'paused'`,
with `degraded.nextLiveRetryAt` for the scheduled attempt. Every surface renders it as a
non-blocking banner that clears itself when a retry gets back in. Landing one re-reads the
inventory, since every event in the gap went to a subscription that no longer existed. Once
the budget is spent the state goes `'paused'`, the refusal reaches the error queue once, and
the banner's Refresh (`refreshAll()`) is the way back. Any other refusal is an outage:
reported immediately, never retried.

`Store.init()` opens the subscriptions and the watches in a `finally`, so a card whose first
load was refused outright still has them. Home Assistant rebuilds the Lovelace view when
its socket reconnects and does so before a restarting instance has set the integration up,
so that card is the common case, and without the watches it would keep its loading skeleton
for as long as the page stayed open.

**The day turning over.** Every date the card renders (the overdue and inspection chips, the
table's tones, the sheet's facts) is a pure function of the item and the clock, read at
render, so nothing redrew when the only thing that moved was the date. A card on a wall
tablet sat on yesterday's chips until somebody edited something, while the sensors beside it
had rolled over at midnight. `ui/day-clock.ts` is one module-level timer to the next local
midnight (plus a second, so a timer firing a hair early still reads the new day).
`hv-list-row`, `hv-data-table`, `hv-detail-sheet` and `hv-item-editor` subscribe on connect
and re-render, and the store re-reads `haventory/stats`. It also compares the day on
`visibilitychange`, because a device that slept through midnight wakes with a timer that
fired late or not at all.

The counts have two paths and want both: the backend broadcasts `stats/counts` at the
*instance's* midnight, which is the one that keeps the pills agreeing with the sensors, and
the store's own read covers that event being served by a backend too old to send it. The
rows follow the *browser's* midnight. The two are one instant in the ordinary case, and the
zone split is the follow-up #579 named.

**Why the card offers a manual Refresh.** Subscription events carry no sequence number, so
a client that missed one cannot detect the gap. Re-listing on demand is the documented
recovery, so it is a first-class action rather than a hidden one.

### `WSClient`

A typed wrapper over `hass.callWS` for each `haventory/*` command, plus `subscribe()`,
which takes `onError` and `onOpen` callbacks so both a refused and an accepted subscribe are
observable. `openSubscription` is the unwrap `subscribe()` and the area-registry watch
share: Home Assistant answers with the unsubscribe function or a promise of one, and a caller
that let go before the promise resolved must not be left holding a live subscription.

It carries the commands the card sends and no others. The catalogue in
`backend_api_contract.md` is the whole surface a client may use; this is the part of it
HAventory's own card asks for.

Two members are not plain `callWS` wrappers. `uploadAttachment` POSTs the bytes to Home
Assistant core's `/api/file_upload` through `hass.fetchWithAuth` and only then names the
resulting handle over the socket, because a WebSocket frame carries JSON and an 8 MB photo
base64'd into one would be both slower and larger. `signPath` calls core's
`auth/sign_path`, because an `<img src>` carries no `Authorization` header and the media
view requires one.

### Column preferences (`src/store/columns.ts`)

`COLUMN_DEFS` is the vocabulary and the canonical order: `ColumnKey`, the track size each
column takes in the full-view table, and the backend sort field it maps to where there is
one. Status, category and tags have none, so their headers are not clickable.

`DEFAULT_COLUMNS` is derived, not written out: every key except those in `OFF_BY_DEFAULT`,
which is `reminder_date` alone. The stored array *is* the order. `normalizeColumns`
validates and dedupes without re-sorting, and `canonicalOrder` is what "Reset order"
restores. The full set is wider than a phone and wider than many desktops, which
`hv-data-table` answers by scrolling sideways rather than dropping columns. The name track
(`NAME_COLUMN_SIZE`) outweighs every flexible column beside it, and at phone width the table
pins it, so it holds while the rest scrolls under it. The pinning is why `hv-data-table`
scrolls **both** axes on its host rather than scrolling the rows in a box of their own: a
sticky cell resolves its offsets against the nearest scroll container, and a nested one that
never moves sideways pins nothing.

Preferences persist in `localStorage` under `haventory:columns:v1` as `{ expanded: [...] }`.
Any other key in that record is ignored, so an older or newer payload never breaks the load.

---

## Behaviour worth knowing

- **One edit form.** `hv-item-editor` is used by the inline expander, the full view and the
  mobile sheet. On mobile it stacks into one column and shows the same fields. Its action
  bar is sticky on **every** host, not only the phone: each of them scrolls the form in a box
  (the card's list, the sheet, the expanded view's 70dvh cap), so Save and Cancel would land
  below the fold on all three. The editor solves that once; no host grows a pinned footer of
  its own.
- **No path discards typed edits without asking, and one place asks.** Cancel, the ✕ and
  Escape are the form's own; a row switch, a sheet coming down and the expanded view closing
  belong to the surface around it. All of them call `confirmDiscard`, a
  `(onConfirm, onCancel?)` callback (`ui/discard`) handed down from `HostSurfaces`, which is
  the only thing that names the wording and the only thing that puts a dialog on screen.
  `hv-item-editor`, `hv-detail-sheet` and `hv-full-view` each take the callback as a
  property and pass it on to the form they host. The phone sheets are part of this:
  `hv-bottom-sheet` reports a scrim tap or a swipe-down and leaves the closing to its host,
  which is what lets `hv-detail-sheet` answer for the form inside it.
- **An attachment whose file is gone is a state, not an error.** Metadata outlives bytes: a
  JSON export carries the references and not the files, and a backup that took `.storage`
  without the config directory's `haventory/` tree leaves every attachment like this. Every
  surface draws a *File missing* placeholder rather than a dead link or a broken `<img>`.
  The document rows, the editor's photo grid and the detail sheet's strip ask
  `MediaUrls.presence()` up front, because one item's attachments are few. The row tiles
  and the lightbox wait for the image to fail and ask then (`PictureFallback`), because a
  table of two hundred rows would otherwise put two hundred extra questions to the backend.
  Only a 404 counts as missing; an inconclusive probe leaves the picture alone.
- **Optimistic writes** stay as they were; a rejected save keeps the expander open with the
  user's text in it, and conflicts render as a banner with *View latest* / *Re-apply*.
- **An item save carries only what the edit changed**, measured against the copy of the
  item the form was filled from. The form stays open across live events, so by the time
  Save is pressed the version it writes against can already carry another member's edit.
  Sending the whole form would put their field back the way this form found it. *Re-apply*
  resends that same diff, which is what lets it land on top of the change that caused the
  conflict instead of over it.
- **Bulk work is chunked**, so progress is determinate and cancel stops cleanly after the
  in-flight chunk. Nothing is rolled back; the endpoint is not transactional, and the UI says
  so.
- **A batch asks whatever the single row is asked.** The bar owns the steps that only
  concern a selection (which location, which tags). The two questions a single row already
  has a surface for (the delete confirmation and check-out's due date) belong to the host,
  which opens the same `hv-confirm` and `hv-checkout-popover` once and applies the one
  answer to every selected item. A `check-out` run detail carrying no `dueDate` key at all is
  how the bar says "ask"; `dueDate: null` is a user who chose no due date. Check-in stays
  immediate.
- **Per-operation results.** `haventory/items/bulk` returns a result per operation and
  partial failure is normal, so the result panel names every failed row, translates its
  error, and offers a retry scoped to those. Retries rebuild their operations rather than
  replaying them, because an `op_id` must never be reused: a repeat costs the whole batch.
- **Tag and category rename/merge have no endpoint.** They are batch rewrites over every
  affected item, each carrying `expected_version`.
- **Location deletes are guarded client-side** before the request, using the tree's own
  counts, so the reason is shown inline instead of a validation error after the fact.
- **Parent pickers exclude the location and its descendants.** The backend rejects cycles.

---

## Data flow

**Startup**: `hass` set, `new Store(hass)`, `init()` warms stats, areas, tree, flat
locations, distinct values and version in parallel, then `listItems(true)`, then subscribes
to items, locations and stats, and to HA's `area_registry_updated`.

**A user action**: the container calls the store, the store applies the change
optimistically and notifies, the container re-renders, the WS call resolves, and the store
applies the server's copy (or rolls back and pushes an error).

**A live event**: `WSClient` delivers the inner payload, the store merges it into `items`,
and subscribers re-render. Item create, delete and move also schedule a coalesced
`location/tree` refetch, because per-location counts are not pushed.

**A filter change**: `setFilters` resets the cursor, clears the list and the selection,
re-subscribes if the location scope changed, and re-lists.

---

## Testing

Component tests follow one pattern: `document.createElement`, set properties, await
`updateComplete`, query the shadow root by `data-testid`, dispatch real events. Every
interactive element carries a testid.

`src/test.utils.ts` provides `makeMockHass()`, an in-memory backend mirroring the WS
contract, including `items/bulk` with per-op results, a real nested `location/tree` with
counts, and hooks for the failure paths: `__failNext`, `__failSubscribe`, `__setItems`,
`__setLocations`, plus a `__calls` log. It **throws on an unhandled command**, so adding a WS
call without extending the mock fails loudly.

Things jsdom cannot do, and how the tests handle it:

- **No CSS evaluation in shadow DOM.** Tests assert the hook a stylesheet keys off (the
  reflected `mobile` attribute, say), never a computed style.
- **No layout.** `ResponsiveController` is driven by `stubElementWidth()`, a
  `ResizeObserver` that answers with the width the test names.
- **No real drag and drop.** jsdom builds a `DragEvent` with no `DataTransfer` behind it, so
  the editor's file-drop tests carry a plain-object `dataTransfer` and assert the routing
  (which kind each dropped file becomes) rather than the browser's drag machinery. Dropping
  a file onto the editor is the only drag the card handles.

The frontend half of the gate is what runs them; the commands are in
[CONTRIBUTING.md](../CONTRIBUTING.md#the-gate).

---

## Key design decisions

**Lit**: small, standards-based, and already how HA's own frontend is written. Shadow DOM
keeps card styles from leaking into a dashboard.

**Containers hold the store**: see above. The alternative was re-dispatching every nested
interaction through the root element.

**Optimistic updates**: the backend rewrites its whole store blob on each mutation, so a
round trip is not free. The UI stays responsive and rolls back on failure.

**Tokens over hardcoded colours**: every value binds to an HA theme variable first, so user
themes keep working. Accents with no HA equivalent (tints, hover washes, warning surfaces)
track `prefers-color-scheme`.

**Buttons are the card's reordering idiom.** The organize dialog's status rows and the item
editor's photo strip both move an entry with a pair of arrow buttons, and both send the
whole new order to the backend. Pointer drag has no keyboard equivalent, so it could only
ever arrive *beside* the buttons, and whichever list grew it first would settle the gesture
for the others. It is not built. Whether the gesture is worth implementing across three
surfaces at once is a question about how the card gets used, which takes people using it to
answer.

---

## Known gaps

- Nothing in the card moves by pointer drag. An item cannot be dragged onto a location in
  the sidebar tree (its location changes through the item editor or the bulk bar's Move
  action), and the ordered lists reorder with buttons, per the decision above.
- Large lists rely on paging; no row virtualization.
- The backend cannot sort by status, category or tags, and cannot bulk-create items. The UI
  is shaped around those limits rather than hiding them. Due, inspection and reminder dates
  filter through the overdue / due-now flags; `created_*` and `updated_*` are the only date
  windows.
