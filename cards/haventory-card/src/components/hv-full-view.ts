import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { onEscape } from '../ui/keyboard';
import { icon } from '../ui/icons';
import { counted, plural } from '../ui/plural';
import { nextZBase } from '../utils/zindex';
import { debounce } from '../utils/debounce';
import { activeFilterCount, defaultFilters } from '../store/store';
import { countLocations } from '../store/location-tree';
import { emptyKindFor, renderEmptyState } from '../ui/empty-state';
import { deepFocusables } from '../ui/dialog-focus';
import { areaNameById, effectiveAreaIdForLocation } from '../ui/area';
import { renderAreaChip } from '../ui/location-path';
import { DEFAULT_CARD_TITLE } from '../ui/card-title';
import { ITEM_STATUSES, statusLabel } from '../ui/status';
import type { ItemStatus } from '../store/types';
import type { EmptyOffer } from '../ui/empty-state';
import type { Store } from '../store/store';
import type { ColumnKey } from '../store/columns';
import type { Item, LocationTreeNode, Sort, StoreFilters, StoreState } from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import { makeBulkOp } from '../store/store';
import type { BulkOperation, BulkOutcome } from '../store/types';
import type { BulkProgress, BulkResultView, BulkRunDetail } from './hv-bulk-bar';
import './hv-bulk-bar';
import './hv-confirm';
import './hv-data-table';
import type { MediaBindings } from '../ui/media';
import './hv-filter-chips';
import './hv-filter-panel';
import './hv-item-editor';
import './hv-location-tree';
import './hv-overflow-menu';
import type { HVLocationTree } from './hv-location-tree';
import type { HVFilterPanel } from './hv-filter-panel';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * The phone breakpoint, in JS.
 *
 * This surface fills the viewport rather than being sized by the card, so its
 * own layout switches on the `@media (max-width: 700px)` block below. Its two
 * biggest children take their layout from a `mobile` *property* instead, which
 * only the card ever set — so at 375px the expanded view drew the item editor's
 * three-column desktop grid in 156px + 78px + 78px, with "Low-stock at" wrapping
 * over its own field and Category too narrow to show a value. A media query
 * cannot set a property, so the same breakpoint is read here and handed down.
 *
 * Keep this string and the media query in agreement. Exported so the sidebar
 * panel can put the dialogs it hosts on the same breakpoint as this view.
 */
export const NARROW_QUERY = '(max-width: 700px)';

/** The sidebar's collapsible sections, in the order they appear. */
type SidebarSection = 'locations' | 'status' | 'categories' | 'tags';

/**
 * The element a section heading discloses, named so `aria-controls` can point at
 * it. Each panel stays in the tree whether or not its section is open — an
 * `aria-controls` that resolves to nothing announces the heading as controlling
 * nothing — and only its contents come and go.
 */
const sectionPanelId = (section: SidebarSection) => `sidebar-section-${section}`;

/**
 * What the context bar's Filters button discloses, on the same terms: the holder
 * stays in the tree shut or open, and only the panel inside it comes and goes.
 */
const FILTER_PANEL_ID = 'full-view-filter-panel';

/**
 * The expanded workspace.
 *
 * The coloured app bar is the mode signal — the standard card never has one, so
 * there is no doubt which surface you are looking at. The sidebar renders the
 * real location tree with the backend's own counts.
 */
@customElement('hv-full-view')
export class HVFullView extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: contents;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
      }
      .shell {
        position: fixed;
        inset: 0;
        display: grid;
        grid-template-rows: auto 1fr;
        background: var(--hv-surface);
        color: var(--hv-text);
        /* The app bar does not compress below 778px — close, the title, the
           search box's own minimum, three count pills, Add item and the ⋮ —
           and the grid column takes that minimum whatever the screen is. On a
           phone held sideways, 760px, the surface was therefore 18px wider
           than the viewport, and with overflow hidden those 18px did not
           exist: the ⋮ was sliced down the middle, the editor's Save sat flush
           against the screen edge, and no gesture could bring either back.

           Vertical stays clipped — this surface *is* the viewport and the
           boxes inside it do their own scrolling — but when the layout
           genuinely does not fit sideways it can now be panned to. */
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior: contain;
        box-shadow: var(--hv-shadow-overlay);
      }
      /* Embedded, this surface is a page rather than an overlay: the host sizes
         it and there is nothing behind it to lift off. Only the box changes —
         the grid rows and the horizontal pan above are what the layout inside
         depends on, and they still apply. */
      :host([embedded]) {
        display: block;
        height: 100%;
      }
      :host([embedded]) .shell {
        position: relative;
        inset: auto;
        height: 100%;
        box-shadow: none;
      }
      .appbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: var(--hv-primary);
        color: #fff;
      }
      .appbar.selecting {
        background: var(--hv-primary-darker);
      }
      .appbar .count {
        font: 500 18px var(--hv-font);
      }
      .appbar .subcount {
        font-size: 12.5px;
        opacity: 0.85;
      }
      .appbar .ghost {
        flex: none;
        border: 1px solid rgba(255, 255, 255, 0.45);
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        border-radius: var(--hv-radius-chip);
        padding: 5px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .appbar .ghost.plain {
        background: none;
        font-weight: 400;
      }
      .honesty {
        padding: 10px 20px;
        border-bottom: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .appbar h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        white-space: nowrap;
      }
      .appbar .tap {
        width: var(--hv-tap-min, 36px);
        height: var(--hv-tap-min, 36px);
        border: none;
        border-radius: 50%;
        background: none;
        color: #fff;
        display: inline-grid;
        place-items: center;
        padding: 0;
        flex: none;
      }
      .appbar .tap:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .appbar .search {
        flex: 1;
        /* Without this the field will not shrink below its content width, and
           a flex item that refuses to shrink pushes everything after it off
           the end of a narrow bar. */
        min-width: 0;
        /* A flex-basis is a content-box width by default, so the full-width
           basis it takes on a phone came out 24px wider than the line — its own
           padding — and the bar overflowed its right edge by that much. */
        box-sizing: border-box;
        max-width: 420px;
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.22);
        border-radius: var(--hv-radius-chip);
        padding: 7px 14px;
      }
      .appbar .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        color: #fff;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
      }
      .appbar .search input::placeholder {
        color: rgba(255, 255, 255, 0.8);
      }
      /*
       * The bar's filter toggles are the card's chips with the fills
       * substituted, and they take none of the pressable variant: it reads as an empty
       * outline until it is applied, and nothing on a primary-coloured bar can.
       *
       * The card's tints are pale washes of their hue chosen to sit on a plain
       * card surface, and in dark mode they are translucent — laid over this
       * already-blue bar, "low" comes out as faintly warm blue with amber text
       * on it. Same hues and same meanings, solid fills that do not depend on
       * what is behind them, and a white ring rather than a primary one,
       * because primary is what the bar itself is painted.
       */
      .appbar .hv-chip {
        background: rgba(255, 255, 255, 0.22);
        color: #fff;
      }
      .appbar .hv-chip:hover {
        background: rgba(255, 255, 255, 0.32);
      }
      .appbar .hv-chip.on {
        outline-color: #fff;
      }
      .appbar .hv-chip.warning {
        background: var(--hv-amber);
        color: var(--hv-on-amber);
      }
      .appbar .hv-chip.error {
        background: var(--hv-error);
        color: #fff;
      }
      /*
       * Above the phone breakpoint — the complement of NARROW_QUERY, whose own
       * block below owns everything at or under it.
       *
       * The search is the only item on this bar that can shrink: every pill,
       * the title and both trailing buttons are flex:none. So each pill added
       * comes out of the search box, and with all six showing it collapsed to
       * "Search all 1(" in a 1024px content area. A floor stops that, and the
       * bar takes a second line instead — which is what the phone layout
       * already does with these same pills.
       */
      @media (min-width: 701px) {
        .appbar {
          flex-wrap: wrap;
        }
        .appbar .search {
          min-width: 260px;
        }
        /* The spacer can only push on the line it sits on, so once the bar
           wraps it holds the first line open while the actions it was meant to
           push land left-aligned under the title. Carrying the margin on the
           actions themselves keeps them at the right edge of whichever line
           they end up on, and reads the same as today when nothing wraps. */
        .appbar .spacer {
          display: none;
        }
        .appbar .add {
          margin-left: auto;
        }
      }
      .appbar .add {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: #fff;
        color: var(--hv-primary-darker);
        padding: 7px 15px;
        font: 500 13px var(--hv-font);
      }
      .spacer {
        margin-left: auto;
      }
      .body {
        display: grid;
        grid-template-columns: 264px 1fr;
        min-height: 0;
      }
      /* Now reachable from a narrow card, so it can land on a phone-width
         viewport: there is no room for a 264px tree beside the table, and the
         app bar's search and filters still cover navigation.

         This surface is fixed to the viewport rather than sized by the card,
         so a media query — not the card's measured-width mobile flag — is the
         right signal here. */
      @media (max-width: 700px) {
        .body {
          grid-template-columns: 1fr;
        }
        .sidebar {
          display: none;
        }
        /* The full view is reachable from a phone, and nothing in the app bar
           could give: every child is flex:none, the heading is nowrap, and
           .search had flex:1 but no min-width:0 so it would not compress below
           its content. At 375px the bar laid out to 634px inside a 375px page
           with no horizontal scroll, which put Add item (532..636), the badges
           and the ⋮ (648..682) permanently off-screen — you could not add an
           item or open the menu at all. */
        /* This surface fills the screen even when the card that opened it is
           narrow, so it sets its own touch sizing rather than inheriting the
           card's. Declared on the shell so the table, its sort headers and the
           context bar are covered too, not just the app bar. */
        .shell {
          --hv-tap-min: 44px;
          --hv-input-font: 16px;
        }
        .appbar {
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 12px;
        }
        /* The bar reads at the size of the list it sits over: 13.5px is the
           table row (hv-data-table .row), and matching it is what stops a
           three-row bar from looking like the loudest thing on the screen.
           This is the one control that opts out of the shell's 16px input
           size above — the size iOS wants to avoid zooming a focused field —
           because it is a filter box in a bar, not a form field. */
        .appbar .search input {
          font-size: 13.5px;
          min-height: 34px;
        }
        .filters-button {
          min-height: var(--hv-tap-min, auto);
        }
        .appbar h2 {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 17px;
        }
        /* Second row: the search alone. A 200px basis let the first count pill
           ride up beside it, which split the three pills across two rows and
           read as if that one belonged to the search box. A full-width basis
           gives the search the line and keeps the pills together under it. */
        .appbar .search {
          order: 1;
          flex: 1 0 100%;
          max-width: none;
          padding: 5px 12px;
        }
        /* Third row. These are secondary toggles reporting a count, not the
           bar's actions, so they keep their own compact height instead of
           growing to the 44px tap target the buttons above them take. */
        .appbar .pill {
          order: 2;
          min-height: 30px;
          padding: 5px 11px;
        }
        .appbar .ghost,
        .appbar .add {
          min-height: var(--hv-tap-min, auto);
        }
        .appbar .add {
          padding: 0 14px;
        }
        /* An auto margin cannot push anything anywhere once the row wraps, and
           it would only add a phantom flex item to the line. */
        .appbar .spacer {
          display: none;
        }

        /* Selection mode reuses this bar and broke in its own way. .subcount
           was the only shrinkable item in a row of flex:none siblings, so it
           collapsed to its longest word and stacked "of 556 / matching / the /
           current / filter" down five lines, eating ~230px of a 667px screen —
           and Clear selection landed at 380..490, off the side. Giving the
           count the slack keeps Clear on the first row, and the subtitle gets
           a line to itself instead of a column. */
        .appbar.selecting .count {
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .appbar.selecting .subcount {
          order: 1;
          flex-basis: 100%;
        }
        .appbar.selecting .load-all {
          order: 2;
        }
      }
      .sidebar {
        background: var(--hv-page);
        border-right: 1px solid var(--hv-divider);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 16px;
      }
      .sidebar-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px 16px 6px;
      }
      /* The heading is the collapse control, so it is a button — which is why
         the "+ new location" action stays a sibling rather than a child of it. */
      .section-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        /* Not flex:1: the tags heading puts its Any/All control immediately
           after the word it qualifies, and a stretching heading would shove it
           across to the tally. The tally right-aligns by margin instead. */
        flex: 0 1 auto;
        min-width: 0;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        padding: 0;
        margin-left: -4px;
        color: var(--hv-text-secondary);
        text-align: left;
      }
      .section-toggle:hover {
        color: var(--hv-text);
      }
      .section-toggle .hv-label {
        color: inherit;
      }
      .section-tally {
        flex: none;
        margin-left: auto;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      /* The filter panel's Any/All control, in the sidebar that also selects
         tags. Same rules, different shadow root. */
      .segmented {
        display: inline-flex;
        flex: none;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
        overflow: hidden;
      }
      .segmented button {
        border: none;
        background: none;
        color: var(--hv-chip-text);
        /* 2px of padding measured 17px tall, which is a poor target even for a
           mouse; there is room for this in a 264px column. */
        padding: 4px 10px;
        font: 400 11.5px var(--hv-font);
        min-height: var(--hv-tap-min, auto);
      }
      .segmented button.on {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        font-weight: 500;
      }
      /* The three tallies read as one column, so a heading with no trailing
         action still reserves the room one takes — otherwise the Locations
         count sits an icon-button's width left of the other two. */
      .head-action {
        flex: none;
        display: flex;
        justify-content: flex-end;
        width: var(--hv-tap-min, 34px);
      }
      /*
       * A category or tag row. Deliberately the same shape as a location row in
       * hv-location-tree — it is the same act, filtering the table down to one
       * facet — but that tree is another shadow root, so the rule cannot be
       * shared. Indented to where the tree's names start, past its twisty.
       */
      .value-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        min-height: var(--hv-tap-min, auto);
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 7px 12px 7px 34px;
        border-radius: var(--hv-radius-input);
      }
      .value-row:hover {
        background: var(--hv-hover-overlay);
      }
      .value-row.on {
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
        font-weight: 500;
        box-shadow: inset -3px 0 0 0 var(--hv-primary);
      }
      .value-row .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .value-row .tally {
        flex: none;
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
      }
      .value-row.on .tally {
        color: inherit;
      }
      .section-empty {
        padding: 2px 16px 8px 34px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .main {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }
      .context {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 20px;
        flex-wrap: wrap;
      }
      .crumb {
        font-size: 13px;
        color: var(--hv-text-secondary);
        min-width: 0;
      }
      .crumb .current {
        font-weight: 500;
        color: var(--hv-text);
      }
      /* The segments and the count wrap as one run of text; only the chip is
         held out of it, so the row can centre the two against each other. */
      .crumb > .hv-chip-line-text {
        flex: 1;
      }
      .filters-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-text-secondary);
        border-radius: var(--hv-radius-chip);
        padding: 6px 13px;
        font: 500 12.5px var(--hv-font);
      }
      .filters-button.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
        color: var(--hv-primary-darker);
      }
      /* The empty state is slotted into the table, so it stays in this tree and
         is styled here — the same block the card's list draws, since the words
         and the offers now come from one place. */
      .empty {
        display: grid;
        justify-items: center;
        gap: 10px;
        padding: 12px 16px 24px;
        text-align: center;
        color: var(--hv-text-secondary);
        font-size: 13px;
      }
      .empty .headline {
        font-size: 14px;
        font-weight: 500;
        color: var(--hv-text);
      }
      .empty .offers {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      /*
       * Every filter the backend accepts, stacked in one column, is around
       * 1600px of form. Nothing in this column was a scroll container and the
       * shell is fixed to the viewport and clips, so on a 756px screen 1138px
       * of the panel simply did not exist: the sort controls, the date rows
       * and the Show N items button sat about a thousand pixels below the
       * bottom edge, reachable by no gesture at all, and the table under it
       * was squeezed to zero.
       *
       * Same shape as the editor holder below — a ceiling with a scroll box
       * inside it — except the foot stays pinned, because the panel's whole
       * point is the count on that button.
       *
       * The second term of the min() measures the column rather than the
       * viewport, so the context bar above the panel and the footer below it
       * keep their room at any screen height. A width-only breakpoint would
       * leave both a 760x400 landscape phone and a 1280x900 desktop with no
       * effective ceiling at all.
       */
      .panel-holder {
        padding: 0 20px 12px;
        display: flex;
        flex-direction: column;
        flex: none;
        min-height: 0;
        /* The ceiling is a content-box measurement by default, so the 12px of
           padding below the panel was added back on top of it and the footer
           hung 5px off the bottom of a landscape screen. */
        box-sizing: border-box;
        max-height: min(80dvh, calc(100% - 116px));
      }
      /* The holder outlives the panel inside it so the id the Filters button
         names always resolves. The display above would otherwise beat the
         browser's own rule for [hidden] and leave the empty box laying out its
         padding. */
      .panel-holder[hidden] {
        display: none;
      }
      .panel-scroll {
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow-y: auto;
        /* Stop a flick that runs out of panel from scrolling the surface
           underneath it. */
        overscroll-behavior-y: contain;
      }
      /* Only rendered on a phone, where the panel stages its edits. */
      .panel-foot {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        padding: 10px 0 2px;
      }
      .panel-foot .hv-pill {
        min-width: 130px;
      }
      .footer {
        padding: 10px 20px;
        border-top: 1px solid var(--hv-row-divider);
        font-size: 12px;
        color: var(--hv-text-tertiary);
      }
      .inline-error {
        margin: 0 16px 8px;
        padding: 8px 10px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12px;
      }
      .sentinel {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .editor-holder {
        border-bottom: 1px solid var(--hv-divider);
        /* The form shares a column with a table that wants every pixel it can
           get, and an overflow-y:auto box has an automatic minimum size of
           zero — so this one was free to be squeezed to nothing. It opened
           around 130px tall, a field and a half, while the ceiling below never
           came into play at all.

           Refusing to shrink turns that ceiling into the actual size and makes
           the table give the room up instead, which is exactly what already
           happens for the filter panel above it. */
        flex: none;
        /* A ceiling in dvh alone says nothing about the room this column has.
           Turn a phone on its side — 760x400 — and the app bar (64), the
           context bar (68) and the footer (41) leave 227px, while 70dvh asks
           for 280: the holder ran 13px past the bottom of the screen and took
           the footer with it. The shell clips and cannot scroll, so the sticky
           Save/Cancel bar this box pins to its own bottom edge was cut off with
           no gesture that could reach it.

           The second term measures the column itself, so the app bar's height
           is already accounted for however it lays out; the 116px is the
           context bar above the form plus the footer below it. */
        max-height: min(70dvh, calc(100% - 116px));
        overflow-y: auto;
      }
      .new-location {
        display: flex;
        gap: 6px;
        padding: 6px 16px 10px;
      }
      .new-location input {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 7px 10px;
        font: 400 var(--hv-input-font, 13px) var(--hv-font);
        color: var(--hv-text);
      }
    `,
  ];

  @property({ attribute: false }) store!: Store;

  private _media: MediaBindings | null = null;

  /** Picture access for the editor this view hosts; built once per store. */
  private get media(): MediaBindings | null {
    const store = this.store;
    if (!store) return null;
    this._media ??= {
      sign: (path, expires) => store.signMediaPath(path, expires),
      upload: (itemId, file) => store.uploadAttachment(itemId, file),
      remove: (itemId, attachmentId) => store.removeAttachment(itemId, attachmentId),
    };
    return this._media;
  }
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) heading = DEFAULT_CARD_TITLE;
  @property({ attribute: false }) columns: ColumnKey[] = [];
  /** Extra entries the host adds to the app bar's ⋮ menu. */
  @property({ attribute: false }) menuEntries: OverflowMenuEntry[] = [];
  /** Open straight into selection mode (the card's "Select items…" entry). */
  @property({ type: Boolean }) startSelecting = false;
  /**
   * Fill the host instead of taking over the viewport.
   *
   * The overlay variant is a modal takeover of the page the card sits on. A
   * Home Assistant panel is the page: it owns the whole content area, has
   * nowhere to close to, and shares the tab order and the Escape key with
   * whatever else the frontend puts on screen. So the modal apparatus —
   * backdrop, dialog role, focus sentinels, Escape-to-close, the close button —
   * comes off, and only that.
   */
  @property({ type: Boolean, reflect: true }) embedded = false;
  /**
   * Home Assistant's own narrow flag, forwarded by the panel host.
   *
   * Distinct from `_narrow` below, which is this surface's own phone
   * breakpoint: HA sets this whenever the sidebar is collapsed, at any width.
   */
  @property({ type: Boolean }) narrow = false;

  @state() private _zBase = 0;
  @state() private _filtersOpen = false;
  @state() private _searchDraft = '';
  @state() private _editing: string | 'new' | null = null;
  @state() private _editorBusy = false;
  @state() private _creatingLocation = false;
  @state() private _locationError: string | null = null;
  /**
   * Locations leads and stays open — it is the primary axis and the one thing
   * that was always there. The other two open too, since an empty sidebar is
   * the problem they exist to solve; collapsing either sticks for the session.
   */
  @state() private _sections: Record<SidebarSection, boolean> = {
    locations: true,
    status: true,
    categories: true,
    tags: true,
  };
  /** True on a phone-width viewport — see NARROW_QUERY. */
  @state() private _narrow = false;
  /**
   * The staged filter set's match count, so the phone footer's button can say
   * what pressing it will show — the same contract the card's filter sheet has.
   */
  @state() private _stagedCount: number | null = null;
  @state() private _selecting = false;
  @state() private _bulkProgress: BulkProgress | null = null;
  @state() private _bulkResult: BulkResultView | null = null;
  @state() private _pendingDelete = false;
  @state() private _loadingAll = false;
  /** Set while a batch is running so Cancel can stop it between chunks. */
  private _bulkCancelled = false;
  /** The ops of the last run, so "Retry failed" can replay just the failures. */
  private _lastOps: { label: string; ops: BulkOperation[] } | null = null;

  private _storeUnsub?: () => void;
  private _prevFocus: HTMLElement | null = null;

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.store && !this._storeUnsub) {
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
    this._narrowQuery ??= window.matchMedia?.(NARROW_QUERY) ?? null;
    if (this._narrowQuery) {
      this._narrow = this._narrowQuery.matches;
      this._narrowQuery.addEventListener('change', this._onNarrowChange);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._storeUnsub?.();
    this._storeUnsub = undefined;
    this._narrowQuery?.removeEventListener('change', this._onNarrowChange);
  }

  private _narrowQuery?: MediaQueryList | null;
  private _onNarrowChange = (e: MediaQueryListEvent) => {
    this._narrow = e.matches;
  };

  /** Price a staged (not yet applied) filter set, so the footer can be honest. */
  private _priceStaged = debounce((filters: StoreFilters) => {
    void this.store?.countMatching(filters).then((count) => {
      this._stagedCount = count;
    });
  }, 150);

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('store') && this.store) {
      this._storeUnsub?.();
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
    // An editor whose item has left the store — deleted here, by another
    // client, or filtered out of the list — would otherwise render `.item` as
    // null, which is the create form. Gated on `loading`: a filter change
    // empties the list while the next page is fetched, and that absence says
    // nothing yet.
    if (
      this._editing !== null &&
      this._editing !== 'new' &&
      this.st !== null &&
      !this.st.loading &&
      !this.st.items.some((i) => i.id === this._editing)
    ) {
      this._editing = null;
    }
    if (changed.has('open')) {
      if (this.open) {
        this._zBase = nextZBase();
        this._searchDraft = this.st?.filters.q ?? '';
        this._prevFocus = (document.activeElement as HTMLElement) ?? null;
        this._selecting = this.startSelecting;
      } else {
        this._filtersOpen = false;
        this._editing = null;
        this._creatingLocation = false;
        this._locationError = null;
        this._selecting = false;
        this._bulkResult = null;
        this._bulkProgress = null;
      }
    }
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) {
        // Pulling focus in is dialog behaviour, and there is no trap here to
        // pull it into. Embedded it would also fire on plain navigation, where
        // landing the caret in the app bar's search field raises a phone's
        // keyboard over the list the user came to read.
        if (!this.embedded) this._focusFirst();
        // Reveal the selected branch so the sidebar isn't showing roots only.
        this._tree?.revealPathTo(this.st?.filters.locationId ?? null);
      } else if (this._prevFocus?.isConnected) {
        this._prevFocus.focus();
      }
    }
  }

  private get _tree(): HVLocationTree | null {
    return this.shadowRoot?.querySelector('hv-location-tree') ?? null;
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  };

  // ---------- Focus trap ----------
  /**
   * The trap's two sentinels bounce focus to the first and last of these, so the
   * walk has to reach every control the shell renders — including the ones the
   * sidebar tree, the filter panel, the editor and the table draw inside their
   * own shadow roots, which a query rooted here cannot see.
   *
   * The sentinels themselves are focusable and would otherwise be their own
   * first and last, which is a trap that only ever bounces between them.
   */
  private _focusables(): HTMLElement[] {
    return deepFocusables(this.shadowRoot?.querySelector('.shell')).filter(
      (el) => !el.classList.contains('sentinel'),
    );
  }

  private _focusFirst() {
    this._focusables()[0]?.focus();
  }

  private _focusLast() {
    const list = this._focusables();
    list[list.length - 1]?.focus();
  }

  private _emitSearch = debounce((q: string) => this.store?.setFilters({ q }), SEARCH_DEBOUNCE_MS);

  private _setFilters(patch: Partial<StoreFilters>) {
    this.store?.setFilters(patch);
  }

  private _onRowEvent(name: string, detail: { itemId?: string }) {
    const item = this.st?.items.find((i) => i.id === detail.itemId);
    if (!item) return;
    switch (name) {
      case 'increment':
        void this.store?.adjustQuantity(item.id, +1);
        break;
      case 'decrement':
        if (item.quantity > 0) void this.store?.adjustQuantity(item.id, -1);
        break;
      case 'edit':
      case 'open-item':
        this._editing = item.id;
        break;
    }
  }

  private _onEditorSave = async (e: CustomEvent) => {
    const detail = e.detail as {
      itemId: string | null;
      expectedVersion?: number;
      changes?: Parameters<Store['updateItem']>[1];
      create?: Parameters<Store['createItem']>[0];
    };
    this._editorBusy = true;
    const before = this.st?.errorQueue.length ?? 0;
    try {
      if (detail.itemId && detail.changes) {
        await this.store?.updateItem(detail.itemId, detail.changes, detail.expectedVersion);
      } else if (detail.create) {
        await this.store?.createItem(detail.create);
      }
    } finally {
      this._editorBusy = false;
    }
    if ((this.st?.errorQueue.length ?? 0) === before) this._editing = null;
  };

  // ---------- Bulk actions ----------
  private get _selectedItems(): Item[] {
    const selection = this.st?.selection ?? new Set<string>();
    return (this.st?.items ?? []).filter((i) => selection.has(i.id));
  }

  private _exitSelection() {
    this._selecting = false;
    this._bulkResult = null;
    this._lastOps = null;
    this.store?.clearSelection();
  }

  /** Build the batch for an action over the current selection. */
  private _opsFor(detail: BulkRunDetail, items: Item[]): { label: string; ops: BulkOperation[] } {
    switch (detail.action) {
      case 'move':
        return {
          label: 'Move',
          ops: items.map((i) =>
            makeBulkOp('item_move', {
              item_id: i.id,
              location_id: detail.locationId ?? null,
              expected_version: i.version,
            }),
          ),
        };
      case 'add-tags':
        return {
          label: 'Tagging',
          // add_tags/remove_tags are additive server-side, so concurrent edits
          // by another client are not clobbered the way a whole-array update
          // would clobber them.
          ops: items.map((i) => makeBulkOp('item_add_tags', { item_id: i.id, tags: detail.tags ?? [] })),
        };
      case 'remove-tags':
        return {
          label: 'Untagging',
          ops: items.map((i) => makeBulkOp('item_remove_tags', { item_id: i.id, tags: detail.tags ?? [] })),
        };
      case 'set-category':
        return {
          label: 'Categorising',
          ops: items.map((i) =>
            makeBulkOp('item_update', {
              item_id: i.id,
              category: detail.category ?? null,
              expected_version: i.version,
            }),
          ),
        };
      case 'adjust-qty':
        return {
          label: 'Adjusting',
          ops: items.map((i) => makeBulkOp('item_adjust_quantity', { item_id: i.id, delta: detail.delta ?? 0 })),
        };
      case 'check-out':
        return {
          label: 'Checking out',
          ops: items.map((i) =>
            makeBulkOp('item_check_out', { item_id: i.id, due_date: detail.dueDate ?? null }),
          ),
        };
      case 'check-in':
        return { label: 'Checking in', ops: items.map((i) => makeBulkOp('item_check_in', { item_id: i.id })) };
      case 'delete':
        return {
          label: 'Delete',
          ops: items.map((i) => makeBulkOp('item_delete', { item_id: i.id, expected_version: i.version })),
        };
    }
  }

  private _onBulkRun = (e: CustomEvent) => {
    const detail = e.detail as BulkRunDetail;
    if (detail.action === 'delete') {
      // Destructive actions get a confirmation step of their own.
      this._pendingDelete = true;
      return;
    }
    void this._execute(this._opsFor(detail, this._selectedItems));
  };

  private async _execute(batch: { label: string; ops: BulkOperation[] }) {
    if (!batch.ops.length) return;
    this._lastOps = batch;
    this._bulkCancelled = false;
    this._bulkResult = null;
    this._bulkProgress = { done: 0, total: batch.ops.length, failed: 0, label: batch.label };

    // Count what actually ran rather than assuming the whole batch did: a
    // cancellation stops after the in-flight chunk, and deletes come back with
    // no item, so `outcome.succeeded` alone would undercount them.
    let ran = 0;
    const outcome: BulkOutcome | undefined = await this.store?.bulkExecute(batch.ops, {
      onProgress: (done, total, failed) => {
        ran = done;
        this._bulkProgress = { done, total, failed, label: batch.label };
      },
      isCancelled: () => this._bulkCancelled,
    });

    this._bulkProgress = null;
    if (!outcome) return;
    this._bulkResult = {
      label: batch.label,
      succeeded: Math.max(0, ran - outcome.failed.length),
      failed: outcome.failed,
    };
    // Narrow the selection to what still needs attention.
    this.store?.setSelected(outcome.failed.map((f) => f.itemId).filter((id): id is string => !!id));
  }

  private async _createLocation(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._locationError = null;
    try {
      // New locations land under whatever the sidebar currently has selected,
      // which is what "add here" means in a tree.
      await this.store?.createLocation(trimmed, this.st?.filters.locationId ?? null, null);
      this._creatingLocation = false;
    } catch (err) {
      this._locationError = (err as { message?: string })?.message ?? 'Could not create that location.';
    }
  }

  // ---------- Sections ----------
  /**
   * One collapsible sidebar heading. The chevron and the words are one target —
   * a 20px twisty beside inert text is a worse hit area than the whole row, and
   * there is nothing else the heading could do.
   */
  private _renderSectionToggle(section: SidebarSection, label: string) {
    const open = this._sections[section];
    return html`<button
      class="section-toggle"
      data-testid=${`sidebar-toggle-${section}`}
      aria-expanded=${String(open)}
      aria-controls=${sectionPanelId(section)}
      @click=${() => {
        this._sections = { ...this._sections, [section]: !open };
      }}
    >
      ${icon(open ? 'chevronDown' : 'chevronRight', 18)}
      <span class="hv-label">${label}</span>
    </button>`;
  }

  /**
   * Which way multiple selected tags combine, in the sidebar that selects them.
   *
   * The sidebar accumulated tags but said nothing about the mode governing them,
   * so a filter set to "all" in the filter panel silently kept applying to every
   * tag picked here. Only shown from the second tag on, since that is when any
   * and all start meaning different things.
   */
  private _renderTagsMode(mode: 'any' | 'all') {
    return html`<span class="segmented" role="radiogroup" aria-label="Tag match mode">
      ${(['any', 'all'] as const).map(
        (m) => html`<button
          class=${mode === m ? 'on' : ''}
          role="radio"
          aria-checked=${String(mode === m)}
          data-testid="sidebar-tags-mode"
          data-mode=${m}
          title=${m === 'any' ? 'Items with any of the selected tags' : 'Items with all of them'}
          @click=${() => this._setFilters({ tagsMode: m })}
        >
          ${m === 'any' ? 'Any' : 'All'}
        </button>`,
      )}
    </span>`;
  }

  /**
   * The stored item status as a sidebar facet.
   *
   * Single-select, because the backend filter takes exactly one status, and
   * pressing the active row clears it — the same contract category has. Unlike
   * the other two facets the rows are a closed set the backend defines rather
   * than values discovered from the inventory, so there is nothing to create
   * and no empty state to fall back to.
   */
  private _renderStatusSection() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const counts = st?.statsCounts;
    // Only the two flagged states are priced by the counts payload; OK is
    // whatever is left of the inventory. An older backend sends neither, and
    // then no row claims a number rather than every row claiming a wrong one.
    const missing = counts?.missing_count;
    const needsRepair = counts?.needs_repair_count;
    const tallyFor = (s: ItemStatus): number | null => {
      if (missing === undefined || needsRepair === undefined) return null;
      if (s === 'missing') return missing;
      if (s === 'needs_repair') return needsRepair;
      return Math.max(0, counts!.items_total - missing - needsRepair);
    };
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle('status', 'Status')}
        <!-- The other sections tally how many rows they hold; this one always
             holds three, so the number would say the same thing forever. -->
      </div>
      <div id=${sectionPanelId('status')} ?hidden=${!this._sections.status}>
        ${this._sections.status
          ? ITEM_STATUSES.map((s) => {
              const on = filters.status === s;
              const tally = tallyFor(s);
              return html`<button
                class="value-row ${on ? 'on' : ''}"
                data-testid="sidebar-status-row"
                data-value=${s}
                aria-pressed=${String(on)}
                @click=${() => this._setFilters({ status: on ? null : s })}
              >
                ${on ? icon('check', 15) : null}
                <span class="label">${statusLabel(s)}</span>
                ${tally === null ? null : html`<span class="tally">${tally}</span>`}
              </button>`;
            })
          : null}
      </div>
    `;
  }

  /**
   * Categories and tags as sidebar rows.
   *
   * Category is single-select and tags are multi-select, because that is what
   * the backend does with them: `category` is one value, `tags` is a set routed
   * through tags_any/tags_all. Pressing the active one clears it.
   */
  private _renderFacetSection(
    section: 'categories' | 'tags',
    label: string,
    values: { value: string; count: number }[],
    isOn: (value: string) => boolean,
    onPick: (value: string) => void,
    head?: unknown,
  ) {
    const open = this._sections[section];
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle(section, label)}
        ${head ?? null}
        <span class="section-tally" data-testid=${`sidebar-${section}-tally`}>${values.length}</span>
        <span class="head-action">
          <!-- Locations could be added to from here and the other two could not,
               so the one heading with a "+" was also the only facet you could
               create without hunting for the organize dialog. A category or tag
               exists through the items using it — there is nothing to create on
               the server — so this opens Organize on the matching tab, where
               that is explained, rather than inventing a second place to do it.
               The ellipsis is the card's usual mark for "opens elsewhere". -->
          <button
            class="hv-icon-button"
            data-testid=${`sidebar-new-${section}`}
            aria-label=${`New ${section === 'tags' ? 'tag' : 'category'}…`}
            title=${`New ${section === 'tags' ? 'tag' : 'category'}…`}
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('menu-action', {
                  detail: { id: 'organize', tab: section },
                  bubbles: true,
                  composed: true,
                }),
              )}
          >
            ${icon('plus', 20)}
          </button>
        </span>
      </div>
      <div id=${sectionPanelId(section)} ?hidden=${!open}>
        ${open
          ? values.length
            ? values.map(
                (v) => html`<button
                  class="value-row ${isOn(v.value) ? 'on' : ''}"
                  data-testid=${`sidebar-${section}-row`}
                  data-value=${v.value}
                  aria-pressed=${String(isOn(v.value))}
                  @click=${() => onPick(v.value)}
                >
                  ${isOn(v.value) ? icon('check', 15) : null}
                  <!-- These clip with an ellipsis, and a clipped value the user
                       typed is otherwise unreadable — there is nowhere else in
                       the sidebar it appears in full. -->
                  <span class="label" title=${v.value}>${v.value}</span>
                  <span class="tally">${v.count}</span>
                </button>`,
              )
            : html`<div class="section-empty" data-testid=${`sidebar-${section}-empty`}>
                ${section === 'tags' ? 'No tags in use yet' : 'No categories in use yet'}
              </div>`
          : null}
      </div>
    `;
  }

  private _renderSidebar() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const distinct = st?.distinctValuesCache;
    const selectedTags = new Set(filters.tags);
    return html`
      <div class="sidebar" data-testid="full-sidebar">
        <div class="sidebar-head">
          ${this._renderSectionToggle('locations', 'Locations')}
          <!-- Categories and tags each state how many there are; locations
               offered a "+" and no number, so the one section you can add to was
               also the one you could not size up. -->
          <span class="section-tally" data-testid="sidebar-locations-tally">
            ${countLocations(st?.locationTreeCache ?? [])}
          </span>
          <span class="head-action">
            <button
              class="hv-icon-button"
              data-testid="sidebar-new-location"
              aria-label="New location"
              title="New location"
              @click=${() => {
                this._creatingLocation = !this._creatingLocation;
                this._locationError = null;
                // Nowhere to put the field if the section is shut.
                if (this._creatingLocation) this._sections = { ...this._sections, locations: true };
              }}
            >
              ${icon('plus', 20)}
            </button>
          </span>
        </div>
        <div id=${sectionPanelId('locations')} ?hidden=${!this._sections.locations}>
          ${this._sections.locations ? this._renderLocationSection() : null}
        </div>
        ${this._renderStatusSection()}
        ${this._renderFacetSection(
          'categories',
          'Categories',
          distinct?.categories ?? [],
          (v) => filters.category === v,
          (v) => this._setFilters({ category: filters.category === v ? null : v }),
        )}
        ${this._renderFacetSection(
          'tags',
          'Tags',
          distinct?.tags ?? [],
          (v) => selectedTags.has(v),
          (v) =>
            this._setFilters({
              tags: selectedTags.has(v) ? filters.tags.filter((t) => t !== v) : [...filters.tags, v],
            }),
          filters.tags.length > 1 ? this._renderTagsMode(filters.tagsMode) : null,
        )}
      </div>
    `;
  }

  private _renderLocationSection() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    return html`
        ${this._creatingLocation
          ? html`<div class="new-location">
              <input
                data-testid="sidebar-new-location-name"
                placeholder="New location name"
                aria-label="New location name"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') void this._createLocation((e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') this._creatingLocation = false;
                }}
              />
              <button
                class="hv-pill"
                data-testid="sidebar-new-location-save"
                @click=${() => {
                  const input = this.shadowRoot?.querySelector<HTMLInputElement>(
                    '[data-testid="sidebar-new-location-name"]',
                  );
                  void this._createLocation(input?.value ?? '');
                }}
              >
                Add
              </button>
            </div>`
          : null}
        ${this._locationError
          ? html`<div class="inline-error" role="alert" data-testid="sidebar-location-error">
              ${this._locationError}
            </div>`
          : null}
        <hv-location-tree
          data-testid="sidebar-tree"
          .nodes=${(st?.locationTreeCache ?? []) as LocationTreeNode[]}
          .selectedId=${filters.locationId}
          .orphansSelected=${filters.orphansOnly}
          .areas=${st?.areasCache?.areas ?? []}
          .selectedAreaId=${filters.areaId}
          areaSelectable
          showAll
          showOrphans
          showCounts
          .totalCount=${st?.statsCounts?.items_total ?? null}
          .orphanCount=${st?.statsCounts?.no_location_count ?? null}
          .matchingTotalCount=${st?.locationMatchTotal ?? null}
          @select=${(e: CustomEvent) =>
            this._setFilters({
              locationId: (e.detail as { locationId: string | null }).locationId,
              orphansOnly: false,
            })}
          @select-orphans=${() => this._setFilters({ locationId: null, orphansOnly: true })}
          @select-area=${(e: CustomEvent) =>
            this._setFilters({
              areaId: (e.detail as { areaId: string }).areaId,
              locationId: null,
              orphansOnly: false,
            })}
        ></hv-location-tree>
    `;
  }

  /**
   * The phone panel's commit row.
   *
   * `hv-filter-panel` stages its edits when it is on a phone and drops its own
   * footer, because its host is expected to provide one — the card's filter
   * sheet does. This surface had neither, so telling the panel it was on a phone
   * without this would stage every edit with no way to apply it.
   */
  private _renderPanelFoot() {
    // Resolved per click, never captured at render time: on the render that
    // first draws the panel this element does not exist yet, so a captured
    // reference would leave all three buttons doing nothing.
    const panel = () => this.renderRoot?.querySelector<HVFilterPanel>('[data-testid="full-filter-panel"]');
    return html`<div class="panel-foot" data-testid="full-panel-foot">
      <button class="hv-text-button" data-testid="full-panel-clear" @click=${() => panel()?.clearAll()}>
        Clear all
      </button>
      <span class="spacer"></span>
      <button
        class="hv-text-button"
        data-testid="full-panel-cancel"
        @click=${() => {
          panel()?.resetDraft();
          this._filtersOpen = false;
        }}
      >
        Cancel
      </button>
      <button class="hv-pill" data-testid="full-panel-apply" @click=${() => panel()?.apply()}>
        ${this._stagedCount === null ? 'Show items' : `Show ${counted(this._stagedCount, 'item')}`}
      </button>
    </div>`;
  }

  private _renderEmpty() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    return renderEmptyState(emptyKindFor(this.st), {
      locationName: (st?.locationsFlatCache ?? []).find((l) => l.id === filters.locationId)?.name ?? null,
      onAction: (id: EmptyOffer['id']) => {
        if (id === 'clear-filters') this.store?.clearFilters();
        else if (id === 'add-item') this._editing = 'new';
        else if (id === 'refresh') void this.store?.refreshAll();
        else
          this.dispatchEvent(
            new CustomEvent('menu-action', { detail: { id }, bubbles: true, composed: true }),
          );
      },
    });
  }

  private _renderContextBar() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const locations = st?.locationsFlatCache ?? [];
    const loc = locations.find((l) => l.id === filters.locationId);
    const segments = loc ? (loc.path?.display_path ?? loc.name).split('/').map((s) => s.trim()) : [];
    // The crumb prints each path segment as its own span, so the area needs the
    // chip to stay out of that sequence rather than reading as a first segment.
    const areaName = loc
      ? areaNameById(st?.areasCache?.areas ?? [], effectiveAreaIdForLocation(locations, loc.id))
      : null;
    const filterCount = activeFilterCount(filters);

    return html`
      <div class="context">
        <span class="crumb hv-chip-line" data-testid="full-breadcrumb">
          ${filters.orphansOnly || !segments.length ? null : renderAreaChip(areaName)}
          <span class="hv-chip-line-text">
            ${filters.orphansOnly
              ? html`<span class="current">No location</span>`
              : segments.length
                ? segments.map((seg, i) =>
                    i === segments.length - 1
                      ? html`<span class="current">${seg}</span>`
                      : html`<span>${seg} › </span>`,
                  )
                : html`<span class="current">All items</span>`}${st?.total !== null &&
            st?.total !== undefined
              ? html` · ${counted(st.total, 'item')}`
              : null}
          </span>
        </span>
        <span class="spacer"></span>
        ${filterCount > 0
          ? html`<hv-filter-chips
              .filters=${filters}
              .locations=${st?.locationsFlatCache ?? null}
              .areas=${st?.areasCache?.areas ?? []}
              @remove-filter=${(e: CustomEvent) =>
                this._setFilters((e.detail as { patch: Partial<StoreFilters> }).patch)}
              @clear-filters=${() => this.store?.clearFilters()}
            ></hv-filter-chips>`
          : null}
        <button
          class="filters-button ${this._filtersOpen ? 'on' : ''}"
          data-testid="full-filters-toggle"
          aria-expanded=${String(this._filtersOpen)}
          aria-controls=${FILTER_PANEL_ID}
          @click=${() => {
            this._filtersOpen = !this._filtersOpen;
            // The phone panel stages its edits, so its button has a number to
            // print from the moment it opens.
            if (this._filtersOpen && this._narrow) this._priceStaged(filters);
          }}
        >
          ${icon('tune', 16)}Filters
        </button>
        <button
          class="hv-icon-button"
          data-testid="columns-expanded"
          aria-label="Choose columns"
          title="Choose columns"
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent('menu-action', { detail: { id: 'columns' }, bubbles: true, composed: true }),
            )}
        >
          ${icon('viewColumn', 20)}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;
    const z = this._zBase || 9998;
    const modal = !this.embedded;

    return html`
      ${modal
        ? html`<div class="backdrop" role="presentation" style="z-index: ${z};" @click=${this._close}></div>`
        : null}
      <div
        class="shell"
        role=${ifDefined(modal ? 'dialog' : undefined)}
        aria-modal=${ifDefined(modal ? 'true' : undefined)}
        aria-label=${this.heading}
        data-testid="full-view"
        style=${modal ? `z-index: ${z + 1};` : ''}
        @keydown=${modal ? onEscape(() => this._close()) : nothing}
      >
        ${modal ? html`<span class="sentinel" tabindex="0" @focus=${() => this._focusLast()}></span>` : null}
        ${this._selecting ? this._renderSelectionBar() : this._renderAppBar()}
        ${this._renderBody()}
        ${modal ? html`<span class="sentinel" tabindex="0" @focus=${() => this._focusFirst()}></span>` : null}
      </div>
    `;
  }

  private _renderSelectionBar() {
    const st = this.st;
    const selected = st?.selection.size ?? 0;
    const total = st?.total ?? null;
    const loaded = st?.items.length ?? 0;
    const canLoadMore = total !== null && loaded < total;

    return html`
      <div class="appbar selecting" data-testid="selection-bar">
        <button class="tap" data-testid="exit-selection" aria-label="Exit selection" @click=${() => this._exitSelection()}>
          ${icon('close', 20)}
        </button>
        <span class="count" data-testid="selection-count">${selected} selected</span>
        ${total !== null
          ? html`<span class="subcount" data-testid="selection-subcount"
              >of ${total} matching the current filter</span
            >`
          : null}
        ${canLoadMore
          ? html`<button
              class="ghost load-all"
              data-testid="selection-load-all"
              ?disabled=${this._loadingAll}
              @click=${async () => {
                this._loadingAll = true;
                try {
                  await this.store?.loadAllThenSelectAll();
                } finally {
                  this._loadingAll = false;
                }
              }}
            >
              ${this._loadingAll ? 'Loading…' : `Load all ${total} to select`}
            </button>`
          : null}
        <span class="spacer"></span>
        <button class="ghost plain" data-testid="selection-clear" @click=${() => this.store?.clearSelection()}>
          Clear selection
        </button>
      </div>
    `;
  }

  /**
   * The way back to a collapsed sidebar, which a panel has to offer itself.
   *
   * A custom panel is handed the whole content area, so once Home Assistant
   * hides the sidebar — which is what `narrow` means — nothing else on screen
   * can bring it back. `hass-toggle-menu` is the event `home-assistant-main`
   * listens for; with no detail it toggles the drawer. It leaves this shadow
   * root only because it is composed.
   */
  private _renderMenuButton() {
    if (!this.narrow) return null;
    return html`<button
      class="tap"
      data-testid="panel-menu"
      aria-label="Open the Home Assistant menu"
      title="Menu"
      @click=${() => this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true }))}
    >
      ${icon('menu', 20)}
    </button>`;
  }

  /**
   * One flagged status as an app-bar toggle, beside the derived counts.
   *
   * Only `missing` and `needs_repair` get one: they are the exceptions worth
   * interrupting for, and an "OK" pill would price the other 99% of a healthy
   * inventory. Single-select like every other status surface, so pressing one
   * while the other is on replaces it rather than asking for items that are
   * somehow both.
   */
  private _renderStatusPill(status: 'missing' | 'needs_repair', count: number | undefined) {
    // Absent rather than zero: the same rule the overdue and inspection pills
    // follow, so the bar only ever carries counts worth acting on.
    if (!count) return null;
    const on = (this.st?.filters ?? defaultFilters()).status === status;
    const noun = statusLabel(status).toLowerCase();
    return html`<button
      class="hv-chip pill warning ${on ? 'on' : ''}"
      data-testid="full-badge-status"
      data-value=${status}
      aria-pressed=${String(on)}
      title=${`Show only items marked ${noun}`}
      @click=${() => this._setFilters({ status: on ? null : status })}
    >
      ${count} ${noun}
    </button>`;
  }

  private _renderAppBar() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const counts = st?.statsCounts;
    return html`
        <div class="appbar">
          ${this.embedded
            ? this._renderMenuButton()
            : html`<button class="tap" data-testid="expand-toggle" aria-label="Close full view" @click=${this._close}>
                ${icon('close', 20)}
              </button>`}
          <h2>${this.heading}</h2>
          <label class="search">
            ${icon('magnify', 18)}
            <span class="hv-sr-only">Search items</span>
            <input
              type="search"
              data-testid="full-search"
              placeholder=${counts ? `Search all ${counted(counts.items_total, 'item')}…` : 'Search items…'}
              .value=${this._searchDraft}
              @input=${(e: Event) => {
                this._searchDraft = (e.target as HTMLInputElement).value;
                this._emitSearch(this._searchDraft);
              }}
            />
          </label>
          <span class="spacer"></span>
          ${counts && counts.low_stock_count > 0
            ? html`<button
                class="hv-chip pill warning ${filters.lowStockOnly ? 'on' : ''}"
                data-testid="full-badge-low"
                aria-pressed=${String(filters.lowStockOnly)}
                title="Show only low-stock items"
                @click=${() => this._setFilters({ lowStockOnly: !filters.lowStockOnly })}
              >
                ${counts.low_stock_count} low
              </button>`
            : null}
          ${counts && (counts.overdue_count ?? 0) > 0
            ? html`<button
                class="hv-chip pill error ${filters.overdueOnly ? 'on' : ''}"
                data-testid="full-badge-overdue"
                aria-pressed=${String(filters.overdueOnly)}
                title="Show only overdue items"
                @click=${() => this._setFilters({ overdueOnly: !filters.overdueOnly })}
              >
                ${counts.overdue_count} overdue
              </button>`
            : null}
          ${counts && (counts.inspection_overdue_count ?? 0) > 0
            ? html`<button
                class="hv-chip pill warning ${filters.inspectionDueOnly ? 'on' : ''}"
                data-testid="full-badge-inspection"
                aria-pressed=${String(filters.inspectionDueOnly)}
                title="Show only items due for inspection"
                @click=${() => this._setFilters({ inspectionDueOnly: !filters.inspectionDueOnly })}
              >
                ${counts.inspection_overdue_count} to inspect
              </button>`
            : null}
          ${counts && counts.checked_out_count > 0
            ? html`<button
                class="hv-chip pill ${filters.checkedOutOnly ? 'on' : ''}"
                data-testid="full-badge-out"
                aria-pressed=${String(filters.checkedOutOnly)}
                title="Show only checked-out items"
                @click=${() => this._setFilters({ checkedOutOnly: !filters.checkedOutOnly })}
              >
                ${counts.checked_out_count} checked out
              </button>`
            : null}
          ${this._renderStatusPill('missing', counts?.missing_count)}
          ${this._renderStatusPill('needs_repair', counts?.needs_repair_count)}
          <button
            class="add"
            data-testid="full-add-item"
            @click=${() => {
              this._editing = 'new';
            }}
          >
            ${icon('plus', 16)}Add item
          </button>
          <hv-overflow-menu
            onPrimary
            data-testid="full-overflow"
            .entries=${this.menuEntries}
            @select=${(e: CustomEvent) => {
              if ((e.detail as { id: string }).id === 'select-items') {
                this._selecting = true;
                return;
              }
              this.dispatchEvent(
                new CustomEvent('menu-action', { detail: e.detail, bubbles: true, composed: true }),
              );
            }}
          ></hv-overflow-menu>
        </div>
    `;
  }

  private _renderBody() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const counts = st?.statsCounts;
    const loaded = st?.items.length ?? 0;
    const selection = st?.selection ?? new Set<string>();

    return html`
        <div class="body">
          ${this._renderSidebar()}
          <div class="main">
            ${this._renderContextBar()}
            <div class="panel-holder" id=${FILTER_PANEL_ID} ?hidden=${!this._filtersOpen}>
              ${this._filtersOpen
                ? html`
                  <div class="panel-scroll">
                  <hv-filter-panel
                    data-testid="full-filter-panel"
                    .filters=${filters}
                    .distinct=${st?.distinctValuesCache ?? null}
                    .areas=${st?.areasCache?.areas ?? []}
                    .locations=${st?.locationsFlatCache ?? null}
                    .locationTree=${st?.locationTreeCache ?? []}
                    .total=${st?.total ?? null}
                    .grandTotal=${counts?.items_total ?? null}
                    .counts=${counts ?? null}
                    ?mobile=${this._narrow}
                    @change=${(e: CustomEvent) => this._setFilters(e.detail as Partial<StoreFilters>)}
                    @stage=${(e: CustomEvent) =>
                      this._priceStaged((e.detail as { filters: StoreFilters }).filters)}
                    @apply=${(e: CustomEvent) => {
                      this._setFilters(e.detail as StoreFilters);
                      this._filtersOpen = false;
                    }}
                    @clear-filters=${() => this.store?.clearFilters()}
                  ></hv-filter-panel>
                  </div>
                  ${this._narrow ? this._renderPanelFoot() : null}
                `
                : null}
            </div>
            ${this._editing !== null
              ? html`<div class="editor-holder">
                  <hv-item-editor
                    data-testid="full-editor"
                    .areas=${st?.areasCache?.areas ?? []}
                    .media=${this.media}
                    .mediaConfig=${st?.mediaConfig ?? null}
                    .item=${this._editing === 'new'
                      ? null
                      : (st?.items.find((i) => i.id === this._editing) ?? null)}
                    .locations=${st?.locationsFlatCache ?? null}
                    .locationTree=${st?.locationTreeCache ?? []}
                    .categorySuggestions=${(st?.distinctValuesCache?.categories ?? []).map((c) => c.value)}
                    .tagSuggestions=${(st?.distinctValuesCache?.tags ?? []).map((t) => t.value)}
                    .customFieldKeys=${st?.distinctValuesCache?.custom_field_keys ?? []}
                    .busy=${this._editorBusy}
                    ?mobile=${this._narrow}
                    @save=${this._onEditorSave}
                    @cancel=${() => {
                      this._editing = null;
                    }}
                    @delete-item=${(e: CustomEvent) =>
                      this.dispatchEvent(
                        new CustomEvent('request-delete', { detail: e.detail, bubbles: true, composed: true }),
                      )}
                  ></hv-item-editor>
                </div>`
              : null}

            ${this._selecting && st?.total !== null && st?.total !== undefined && loaded < st.total
              ? html`<div class="honesty" data-testid="selection-honesty">
                  ${loaded} of ${st.total} loaded · scroll to load more. Select-all covers loaded rows only.
                </div>`
              : null}

            <hv-data-table
              .areas=${st?.areasCache?.areas ?? []}
              data-testid="full-table"
              .items=${(st?.items ?? []) as Item[]}
              .columns=${this.columns}
              .sort=${filters.sort as Sort}
              ?selectable=${this._selecting}
              .selection=${selection}
              @sort-change=${(e: CustomEvent) => this._setFilters({ sort: (e.detail as { sort: Sort }).sort })}
              @near-end=${(e: CustomEvent) =>
                void this.store?.prefetchIfNeeded((e.detail as { ratio: number }).ratio)}
              @increment=${(e: CustomEvent) => this._onRowEvent('increment', e.detail)}
              @decrement=${(e: CustomEvent) => this._onRowEvent('decrement', e.detail)}
              @edit=${(e: CustomEvent) => this._onRowEvent('edit', e.detail)}
              @open-item=${(e: CustomEvent) => this._onRowEvent('open-item', e.detail)}
              @toggle-select=${(e: CustomEvent) =>
                this.store?.toggleSelected((e.detail as { itemId: string }).itemId)}
              @select-all-loaded=${() => this.store?.selectAllLoaded()}
              @clear-selection=${() => this.store?.clearSelection()}
            >
              <div slot="empty">${this._renderEmpty()}</div>
            </hv-data-table>

            ${this._selecting
              ? html`<hv-bulk-bar
                  data-testid="full-bulk-bar"
                  .areas=${st?.areasCache?.areas ?? []}
                  .selectedCount=${selection.size}
                  .selectedItems=${this._selectedItems}
                  .locationTree=${st?.locationTreeCache ?? []}
                  .distinct=${st?.distinctValuesCache ?? null}
                  .progress=${this._bulkProgress}
                  .result=${this._bulkResult}
                  @run=${this._onBulkRun}
                  @cancel-run=${() => {
                    this._bulkCancelled = true;
                  }}
                  @dismiss-result=${() => {
                    this._bulkResult = null;
                  }}
                  @retry-failed=${() => {
                    const failed = this._bulkResult?.failed ?? [];
                    if (!this._lastOps || !failed.length) return;
                    // Rebuild rather than replay: the failed rows may have moved
                    // on, and an op_id must never be reused.
                    void this._execute({
                      label: this._lastOps.label,
                      ops: failed.map((f) => makeBulkOp(f.op.kind, { ...f.op.payload })),
                    });
                  }}
                ></hv-bulk-bar>`
              : null}

            <div class="footer" data-testid="full-footer">
              ${st?.total !== null && st?.total !== undefined
                ? `Showing ${loaded} of ${st.total}${st.cursor ? ' · scroll to load more' : ''}`
                : `Showing ${loaded}`}
            </div>
          </div>
        </div>

        <hv-confirm
          data-testid="bulk-confirm"
          ?open=${this._pendingDelete}
          .heading=${`Delete ${counted(selection.size, 'item')}?`}
          message="This cannot be undone. Items are removed for every connected client. Locations and tags are not affected."
          .warning=${this._checkedOutWarning}
          .confirmLabel=${`Delete ${selection.size}`}
          destructive
          @confirm=${() => {
            this._pendingDelete = false;
            void this._execute(this._opsFor({ action: 'delete' }, this._selectedItems));
          }}
          @cancel=${() => {
            this._pendingDelete = false;
          }}
        ></hv-confirm>
    `;
  }

  /** Extra warning for a bulk delete that would remove checked-out items. */
  private get _checkedOutWarning(): string | null {
    const out = this._selectedItems.filter((i) => i.checked_out).length;
    if (!out) return null;
    return `${out} of them ${plural(out, 'is', 'are')} checked out`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-full-view': HVFullView;
  }
}
