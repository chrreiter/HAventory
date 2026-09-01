import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { browseRow } from '../ui/browse-row';
import { onEscape } from '../ui/keyboard';
import { rovingTarget, syncRovingTabindex } from '../ui/roving-list';
import { icon } from '../ui/icons';
import { t, tn } from '../i18n';
import { counted, showingCount } from '../ui/plural';
import { nextZBase } from '../utils/zindex';
import { activeFilterCount, defaultFilters, soleLocationId } from '../store/store';
import { countLocations } from '../store/location-tree';
import { emptyKindFor, renderEmptyState } from '../ui/empty-state';
import { deepFocusables } from '../ui/dialog-focus';
import {
  PATH_SEPARATOR,
  areaMarkName,
  locationPathParts,
  pathTitle,
  renderAreaChip,
} from '../ui/location-path';
import { DEFAULT_CARD_TITLE } from '../ui/card-title';
import type { QuickFilterKey } from '../ui/quick-filters';
import type { ConfirmDiscard } from '../ui/discard';
import { bannerStack, renderDegradedBanners, renderErrorBanners } from '../ui/banners';
import type { BannerHooks } from '../ui/banners';
import {
  priceStaged,
  renderFilterChips,
  renderFilterHead,
  renderFilterPanel,
  renderSearch,
  renderStagedFooter,
  searchBox,
  searchDebounce,
  sheetHead,
} from '../ui/filter-chrome';
import { renderStatBadges } from '../ui/stat-badges';
import { ViewportNarrow } from '../ui/responsive';
import { ItemWorkspace } from '../item-workspace';
import { statusCount, statusLabel, statusList } from '../ui/status';
import type { EmptyOffer } from '../ui/empty-state';
import type { Store } from '../store/store';
import type { ColumnKey } from '../store/columns';
import type {
  DistinctValue,
  Item,
  Location,
  LocationTreeNode,
  Sort,
  StoreFilters,
  StoreState,
} from '../store/types';
import type { OverflowMenuEntry } from './hv-overflow-menu';
import { makeBulkOp } from '../store/store';
import type { BulkOperation, BulkOutcome } from '../store/types';
import type { BulkProgress, BulkResultView, BulkRunDetail } from './hv-bulk-bar';
import './hv-bulk-bar';
import './hv-checkout-popover';
import './hv-confirm';
import './hv-data-table';
import './hv-location-tree';
import './hv-overflow-menu';
import type { HVItemEditor } from './hv-item-editor';
import type { HVLocationTree } from './hv-location-tree';
import type { HVFilterPanel } from './hv-filter-panel';

/** The sidebar's collapsible sections, in the order they appear. */
type SidebarSection = 'locations' | 'status' | 'categories' | 'tags';

/**
 * The sections whose rows the sidebar draws itself.
 *
 * Locations is the odd one out: its rows belong to `hv-location-tree`, which
 * runs the same one-stop pattern behind its own shadow boundary.
 */
type FacetSection = Exclude<SidebarSection, 'locations'>;

const FACET_SECTIONS: FacetSection[] = ['status', 'categories', 'tags'];

/**
 * Names a facet row by the value it stands for, so a stop survives a redraw
 * that keeps the row. One namespace across the three lists, since one field
 * holds all three keys.
 */
const facetRowKey = (section: FacetSection, value: string | undefined) =>
  `${section}:${value ?? ''}`;

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
 * App-bar width at or below which *Add item* keeps its icon and gives up its
 * label, and the bar tightens its gaps.
 *
 * German is what sets it. In the panel with all four counts showing, the bar
 * wants title 84 + search 260 + strip 329 + "Gegenstand hinzufügen" 189 +
 * organize 36 + ⋮ 34, plus 60px of gaps and 32px of padding — 1024, which is
 * exactly what a 1280px window leaves once Home Assistant's sidebar has taken
 * its 256. The icon-only button and the tighter gaps bring it to 851.
 */
const BAR_TIGHT = 1100;

/**
 * And at or below which the search box gives up 60px of its floor, so the pill
 * strip still has a pill to show. The narrowest bar that is not the phone
 * layout is 614px — an 870px window with the sidebar docked — where everything
 * but the strip costs 462px and the strip keeps the remaining 152.
 */
const BAR_TIGHTER = 900;

/**
 * The steps a bar of this width takes, as the classes that carry them.
 *
 * A width of 0 is a bar that has not been measured — no observer, or nothing
 * rendered yet — and answers with the widest form, which is the honest default
 * for a surface that cannot say how much room it has.
 */
function barSteps(width: number): string {
  if (width <= 0) return '';
  if (width <= BAR_TIGHTER) return 'tight tighter';
  if (width <= BAR_TIGHT) return 'tight';
  return '';
}

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
    browseRow,
    bannerStack,
    searchBox,
    sheetHead,
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
        /*
         * This surface covers the viewport, so how wide the card that opened it
         * happens to be says nothing about it. As an overlay it renders inside
         * the card's shadow tree, and hv-card-shell declares both of these on
         * :host([mobile]) — a card measured at 600px or under, which an
         * ordinary dashboard column is on a desktop. Every field and every
         * pressable row in here took phone sizing from that.
         *
         * Set to the guaranteed-invalid value rather than to a number: each
         * consumer then falls back to the size it was written with — 36px for
         * an app-bar button, 34px for the tally slot, 13.5px for the search
         * box — instead of one value flattening all of them. The media query
         * below raises both to touch sizing on a narrow *viewport*, which is
         * the only signal that means anything here, and it does so in the
         * panel and in the overlay alike.
         */
        --hv-tap-min: initial;
        --hv-input-font: initial;
        /* The app bar compresses in steps and its pill strip scrolls, so it
           fits whatever width it is given; the body below it does not — the
           sidebar and the table's own minimum set a floor the grid column
           takes whatever the screen is. On a phone held sideways, 760px, the
           surface was therefore wider than the viewport, and with overflow
           hidden the difference did not exist: the ⋮ was sliced down the
           middle, the editor's Save sat flush against the screen edge, and no
           gesture could bring either back.

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
        /* A grid item's minimum is its min-content, and for a nowrap flex row
           that is every item laid out in full — the pill strip included, which
           made the column as wide as the unscrolled pills and left the bar
           overhanging the panel by their width instead of shrinking the strip.
           Zero here hands the width back to the column, which is what lets the
           strip give. */
        min-width: 0;
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
      /* The bar's own fill and gutter for the box; ui/filter-chrome gives it
         its shape, and white ink is what a primary-coloured bar asks for. */
      .appbar .search {
        /* A flex-basis is a content-box width by default, so the full-width
           basis it takes on a phone came out 24px wider than the line — its own
           padding — and the bar overflowed its right edge by that much. */
        box-sizing: border-box;
        max-width: 420px;
        background: rgba(255, 255, 255, 0.22);
        padding: 7px 14px;
      }
      .appbar .search input {
        color: #fff;
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
       * The pills travel as one strip so that they, and not the bar, are what
       * gives when the room runs out: the strip is the only item beside the
       * search box that can shrink, and it scrolls its own overflow instead of
       * pushing the actions onto a second row.
       *
       * The 3px of padding is the applied ring — a 2px outline at a 1px offset
       * — which a scroll box would otherwise cut off on the first and last
       * pill and along both edges. The matching negative margin takes those
       * 3px back out of the bar, so the gaps either side read as the 12px the
       * bar declares.
       */
      .appbar .pills {
        display: flex;
        align-items: center;
        flex-wrap: nowrap;
        gap: 8px;
        flex: 0 1 auto;
        min-width: 0;
        overflow-x: auto;
        padding: 3px;
        margin: -3px;
        scrollbar-width: none;
      }
      .appbar .pills::-webkit-scrollbar {
        display: none;
      }
      /*
       * Above the phone breakpoint — the complement of NARROW_QUERY, whose own
       * block below owns everything at or under it.
       *
       * The search box has a floor here, or every pill added comes out of it
       * until there is no room left to read the query in. Wrapping onto a
       * second line is not the alternative: in German at 1280px the ⋮ goes
       * down on its own and leaves a band of empty blue under the pills. So
       * the row stays whole and two things give before it does: the pill strip
       * scrolls, and the two steps below trade away what can be read from an
       * icon.
       */
      @media (min-width: 701px) {
        .appbar .search {
          min-width: 260px;
        }
        /* Selection mode reuses this bar for a sentence and two buttons.
           Nothing in it is a bare glyph that a second line would strand, and
           the sentence is the household's count read out — it wraps as it did
           before the row above stopped wrapping. */
        .appbar.selecting {
          flex-wrap: wrap;
        }
        /* The heading is whatever the dashboard called this card, so it has no
           length the bar can count on. It elides rather than pushing the row
           off the side, but not before the strip has given what it has — and a
           shrink weight cannot buy that: negative space is shared by shrink ×
           basis, so a shrinkable heading takes a slice of every pixel the bar
           is over, and a slice of a fraction of a pixel is enough to swap the
           last letters for an ellipsis. So it does not shrink at all: it draws
           at its own width up to a cap and elides only past the cap, leaving
           the strip as what gives. The cap is a share of the bar rather than a
           pixel count, so it scales with it — a fixed one wide enough to be
           worth having would not fit the 614px bar the narrowest non-phone
           window leaves. min-width holds the flex item's automatic minimum off
           the cap. */
        .appbar h2 {
          flex: none;
          max-width: 30%;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .appbar .pills {
          flex-shrink: 100;
        }
        /* Two auto margins on one line share the free space between them, so a
           second one would strand the pill strip halfway across the bar. This
           is the one that holds the actions at the right edge. */
        .appbar .add {
          margin-left: auto;
        }
        /* Selection mode's own right-hand group is a single button, and it
           belongs at the far side of the bar, where it is on a phone too.
           Below this breakpoint the count's flex:1 already puts it there. */
        .appbar.selecting .clear {
          margin-left: auto;
        }
        /* First step. The add button's label is the widest thing on the bar
           that the button does not need to be understood — "Gegenstand
           hinzufügen" measures 187px against "Add item"'s 110 — and the icon
           with that label on the accessible name says it in 36px. Hiding the
           label is the template's job, off this same measurement, because
           hv-sr-only is the card's one way to keep a name undrawn. */
        .appbar.tight {
          gap: 8px;
        }
        .appbar.tight .add {
          padding: 7px 10px;
        }
        /* Second step. The search box gives up 60px of its floor: a
           placeholder that elides is still a search box, and what it buys is
           the pill strip keeping a pill or two on screen. */
        .appbar.tighter .search {
          min-width: 200px;
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
      /* Reachable from a narrow card, so it can land on a phone-width
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
        /* Touch sizing on a narrow viewport, which is the one measurement that
           describes this surface — the base rule above holds the card's own
           idea of narrow off it. Declared on the shell so the table, its sort
           headers and the context bar are covered too, not just the app bar. */
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
        /* Third row. The strip carries the order, because a child orders
           itself among its own siblings and the pills are the strip's. Here it
           wraps rather than scrolls — the row it lands on is its own and the
           height is free, which is the layout this branch was written for. */
        .appbar .pills {
          order: 2;
          flex-wrap: wrap;
          overflow: visible;
        }
        /* These are secondary toggles reporting a count, not the bar's
           actions, so they keep their own compact height instead of growing to
           the 44px tap target the buttons above them take. */
        .appbar .pill {
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

        /* Selection mode reuses this bar. The count is the only item in the row
           allowed to shrink — its siblings are flex:none — so it takes the
           slack and elides, which keeps Clear selection on the first row. The
           subtitle gets a line to itself rather than a column of its words. */
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
        /* Tighter padding than this leaves a target too short to hit even with
           a mouse, and a 264px column has room for it. */
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
      /* A status, category or tag row is the same control as a location row in
         the tree under the heading above it, and the two lists are read as one
         column — so both take their shape from ui/browse-row and neither
         declares it. All that is left here is where the empty note sits, which
         is under a row's name, past the slot the check occupies. */
      .section-empty {
        padding: 2px 16px 8px 38px;
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
      .context-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-left: auto;
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
        color: var(--hv-on-primary-tint);
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
       * Every filter the backend accepts, stacked in one column, is taller than
       * a phone screen, and the shell is fixed to the viewport and clips — so
       * without a ceiling and a scroll box the foot of the panel is reachable
       * by no gesture at all and the table under it is squeezed to zero.
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
        /* max-height sizes the content box by default, which would add the
           padding below the panel on top of the ceiling. */
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
      /* Both only rendered on a phone, where the panel stages its edits. The
         row's shape and the two labels in it come from ui/filter-chrome; the
         column around it already has a gutter, so it adds none of its own. */
      .panel-head {
        flex: none;
        padding: 2px 0 8px;
      }
      .panel-head .hv-text-button {
        flex: none;
      }
      .panel-foot {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        padding: 10px 0 2px;
      }
      /* The count is a sentence with the number inside it, so a label a few
         pixels wider than the button's share of the row would stack its words
         rather than run past the edge. The row has one other control and an
         auto margin between them, which is the give this takes. */
      .panel-foot .hv-pill {
        min-width: 130px;
        white-space: nowrap;
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
      /*
       * The row being edited can stop matching the filter the user just changed.
       * The form stays open on it so the typed edits survive; the hint is what
       * stops that from reading as a table that failed to filter.
       */
      .pinned-hint {
        margin: 0;
        padding: 6px 16px;
        font-size: 12px;
        color: var(--hv-text-secondary);
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

  /**
   * The editor, the read sheet and the check-out step, as the card's shell has
   * them. Delete leaves for the host here: this surface owns no confirmation,
   * and a row click and the row menu's Edit mean the same thing on it.
   */
  private readonly _workspace = new ItemWorkspace(this, () => this.store, {
    confirmDiscard: () => this.confirmDiscard,
    editor: () => this._editor,
    openItem: (itemId) => this._openItem(itemId),
    editItem: (itemId) => this._openItem(itemId),
    requestDelete: (detail) =>
      this.dispatchEvent(new CustomEvent('request-delete', { detail, bubbles: true, composed: true })),
  });

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) heading = DEFAULT_CARD_TITLE;
  @property({ attribute: false }) columns: ColumnKey[] = [];
  /**
   * Which quick-filter pills this dashboard offers, or `null` for all of them.
   * The card passes its own config down; the sidebar panel has no YAML to
   * configure, so it takes the default.
   */
  @property({ attribute: false }) quickFilters: QuickFilterKey[] | null = null;
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
   * Distinct from `_viewport` below, which is this surface's own phone
   * breakpoint: HA sets this whenever the sidebar is collapsed, at any width.
   */
  @property({ type: Boolean }) narrow = false;
  /**
   * The host's discard question, for this surface, its form and its sheet.
   *
   * This surface leaves an open form for another row, for the create form or by
   * closing altogether, and the last of those takes the asker down with it — so
   * the dialog belongs to the host, which is still standing afterwards. Null
   * leaves the form without a question.
   */
  @property({ attribute: false }) confirmDiscard: ConfirmDiscard | null = null;

  @state() private _zBase = 0;
  @state() private _filtersOpen = false;
  @state() private _searchDraft = '';
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
  /**
   * Which row holds each facet list's one tab stop, as `facetRowKey` writes it.
   *
   * A facet list is as long as the household's vocabulary, and a row per tab
   * stop put that vocabulary between this surface's search box and its table.
   * Null until the first walk over the rendered rows resolves it, which
   * `updated` does.
   */
  @state() private _facetStop: Record<FacetSection, string | null> = {
    status: null,
    categories: null,
    tags: null,
  };
  /**
   * True on a phone-width viewport (`NARROW_QUERY`).
   *
   * This surface switches its own layout on the matching `@media` block below,
   * but its two biggest children take theirs from a `mobile` *property*, and a
   * media query cannot set a property — so the same breakpoint is read here and
   * handed down. Without it a phone-width expanded view draws the item editor's
   * desktop grid in three columns of a few dozen pixels each.
   *
   * The phone panel drops its draft when it stops being on a phone, so a staged
   * set held from before the rotation would have the head row counting filters
   * the controls under it no longer carry.
   */
  private readonly _viewport = new ViewportNarrow(this, () => {
    this._stagedFilters = null;
  });
  /**
   * Which of the app bar's two steps the room calls for, as the classes that
   * carry them — see `barSteps`.
   *
   * The steps read the *bar's* width, not the window's: embedded, this surface
   * is the panel, which is the window minus whatever Home Assistant's sidebar
   * is taking, and no media query on this side can name that. A size container
   * would answer it in CSS, but `container-type` brings layout containment
   * with it, and a contained ancestor becomes the containing block for every
   * `position: fixed` descendant — the ⋮ menu, the confirms and the sheets
   * this surface hosts all place themselves from viewport coordinates, and
   * embedded they would land offset by the width of the sidebar. So the shell
   * is measured instead.
   *
   * The step is what is reactive, not the pixels: a drag across the whole
   * range redraws this tree twice rather than once a frame.
   */
  @state() private _barSteps = '';
  /**
   * The staged filter set's match count, so the phone footer's button can say
   * what pressing it will show — the same contract the card's filter sheet has.
   */
  @state() private _stagedCount: number | null = null;
  /**
   * The phone panel's in-flight filter set, so its head row counts what is
   * staged rather than what is applied — the two differ for as long as the
   * panel is open, which is exactly when the number is read.
   */
  @state() private _stagedFilters: StoreFilters | null = null;
  @state() private _selecting = false;
  @state() private _bulkProgress: BulkProgress | null = null;
  @state() private _bulkResult: BulkResultView | null = null;
  @state() private _pendingDelete = false;
  /** The whole selection's check-out is waiting on one due date. */
  @state() private _pendingBulkCheckout = false;
  @state() private _loadingAll = false;
  /** Set while a batch is running so Cancel can stop it between chunks. */
  private _bulkCancelled = false;
  /** The ops of the last run, so "Retry failed" can replay just the failures. */
  private _lastOps: { label: string; ops: BulkOperation[] } | null = null;

  private _prevFocus: HTMLElement | null = null;

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._barObserver?.disconnect();
    this._barTarget = null;
  }

  private _barObserver?: ResizeObserver;
  private _barTarget: Element | null = null;

  /**
   * Watch the rendered shell, which is the width the app bar has to fit in.
   * Called after every render, because the shell comes and goes with `open`.
   */
  private _syncBarMeasure() {
    const shell = this.shadowRoot?.querySelector('.shell') ?? null;
    if (shell === this._barTarget) return;
    this._barTarget = shell;
    this._barObserver?.disconnect();
    if (!shell || typeof ResizeObserver === 'undefined') {
      this._setBarWidth(0);
      return;
    }
    this._barObserver ??= new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      this._setBarWidth(entry.contentRect?.width ?? entry.target.getBoundingClientRect().width);
    });
    this._barObserver.observe(shell);
  }

  /** The one way in for a measured width; a test with no layout calls it too. */
  private _setBarWidth(width: number) {
    const next = barSteps(width);
    if (next !== this._barSteps) this._barSteps = next;
  }

  /** Price a staged (not yet applied) filter set, so the footer can be honest. */
  private _priceStaged = priceStaged(
    () => this.store,
    (count) => {
      this._stagedCount = count;
    },
  );

  protected willUpdate(changed: Map<string, unknown>) {
    this._workspace.syncPinnedItem();
    if (changed.has('open')) {
      if (this.open) {
        this._zBase = nextZBase();
        this._searchDraft = this.st?.filters.q ?? '';
        this._prevFocus = (document.activeElement as HTMLElement) ?? null;
        this._selecting = this.startSelecting;
      } else {
        this._filtersOpen = false;
        this._stagedFilters = null;
        this._workspace.setEditing(null);
        this._workspace.closeDetail();
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
        this._tree?.revealPathTo(soleLocationId(this.st?.filters ?? defaultFilters()));
      } else if (this._prevFocus?.isConnected) {
        this._prevFocus.focus();
      }
    }
    for (const section of FACET_SECTIONS) this._syncFacetStop(section);
    this._syncBarMeasure();
  }

  /** The rows of one facet list, in the order they are drawn. */
  private _facetRows(section: FacetSection): HTMLElement[] {
    return [
      ...this.renderRoot.querySelectorAll<HTMLElement>(`[data-testid="sidebar-${section}-row"]`),
    ];
  }

  /**
   * Leave one row of `section` in the tab order.
   *
   * Written here rather than in `render` because the walk is the rendered DOM:
   * a template cannot ask which row comes first without rebuilding the walk
   * from the values it was drawn from.
   */
  private _syncFacetStop(section: FacetSection) {
    const held = syncRovingTabindex(this._facetRows(section), this._facetStop[section], (el) =>
      facetRowKey(section, el.dataset.value),
    );
    this._holdFacetStop(section, held);
  }

  /**
   * Remember which row holds a list's stop, without redrawing for a key that
   * has not moved — `updated` writes this, so an unconditional assignment would
   * queue a render for every render.
   */
  private _holdFacetStop(section: FacetSection, key: string | null) {
    if (this._facetStop[section] === key) return;
    this._facetStop = { ...this._facetStop, [section]: key };
  }

  /**
   * The arrow layer, and the other half of the single tab stop: with one row
   * reachable by Tab, the arrows are the only way to the rest. Enter and Space
   * are left alone — the rows are buttons and already answer to both.
   */
  private _onFacetKeydown(section: FacetSection, e: KeyboardEvent) {
    const next = rovingTarget(e, this._facetRows(section));
    if (!next) return;
    this._holdFacetStop(section, facetRowKey(section, next.dataset.value));
    this._syncFacetStop(section);
    next.focus();
  }

  private get _tree(): HVLocationTree | null {
    return this.shadowRoot?.querySelector('hv-location-tree') ?? null;
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  };

  private get _editor(): HVItemEditor | null {
    return this.shadowRoot?.querySelector('hv-item-editor') ?? null;
  }

  /**
   * What the shared banner stacks act through.
   *
   * Reconnect and Refresh go out as the menu action the host already answers —
   * the dialogs and the re-read live in its `HostSurfaces`, not here, and both
   * hosts serve the same entry.
   */
  private get _bannerHooks(): BannerHooks {
    return {
      store: this.store,
      onRefresh: () =>
        this.dispatchEvent(
          new CustomEvent('menu-action', { detail: { id: 'refresh' }, bubbles: true, composed: true }),
        ),
    };
  }

  /**
   * Leave the open form — for another row, for the create form, or by closing
   * the whole surface. Closing is this surface's own destination: everywhere
   * else the workspace's question is the whole of it.
   */
  private _leaveEditor(to: string | 'new' | 'close') {
    this._workspace.leave(() => {
      if (to === 'close') this._close();
      else this._workspace.setEditing(to);
    });
  }

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

  private _emitSearch = searchDebounce(() => this.store);

  /**
   * Show an item: the read sheet on a narrow viewport, the inline form on a
   * wide one, with Edit one tap deeper inside the sheet.
   *
   * The desktop table is its own read surface — the row already says most of
   * what the sheet would — so there the form is the right answer to a row
   * click. A phone sees one column of that table and no hover, and the card
   * answers the same tap with the same sheet.
   */
  private _openItem(id: string) {
    if (this._viewport.narrow) {
      this._workspace.openDetail(id);
      return;
    }
    this._leaveEditor(id);
  }

  // ---------- Bulk actions ----------
  private get _selectedItems(): Item[] {
    const selection = this.st?.selection ?? new Set<string>();
    return (this.st?.items ?? []).filter((i) => selection.has(i.id));
  }

  private _exitSelection() {
    this._selecting = false;
    this._bulkResult = null;
    this._lastOps = null;
    this._pendingBulkCheckout = false;
    this.store?.clearSelection();
  }

  /** Build the batch for an action over the current selection. */
  private _opsFor(detail: BulkRunDetail, items: Item[]): { label: string; ops: BulkOperation[] } {
    switch (detail.action) {
      case 'move':
        return {
          label: t('hv.bulk.label.move'),
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
          label: t('hv.bulk.label.addTags'),
          // add_tags/remove_tags are additive server-side, so concurrent edits
          // by another client are not clobbered the way a whole-array update
          // would clobber them.
          ops: items.map((i) => makeBulkOp('item_add_tags', { item_id: i.id, tags: detail.tags ?? [] })),
        };
      case 'remove-tags':
        return {
          label: t('hv.bulk.label.removeTags'),
          ops: items.map((i) => makeBulkOp('item_remove_tags', { item_id: i.id, tags: detail.tags ?? [] })),
        };
      case 'set-category':
        return {
          label: t('hv.bulk.label.setCategory'),
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
          label: t('hv.bulk.label.adjustQty'),
          ops: items.map((i) => makeBulkOp('item_adjust_quantity', { item_id: i.id, delta: detail.delta ?? 0 })),
        };
      case 'check-out':
        return {
          label: t('hv.bulk.label.checkOut'),
          ops: items.map((i) =>
            makeBulkOp('item_check_out', { item_id: i.id, due_date: detail.dueDate ?? null }),
          ),
        };
      case 'check-in':
        return {
          label: t('hv.bulk.label.checkIn'),
          ops: items.map((i) => makeBulkOp('item_check_in', { item_id: i.id })),
        };
      case 'delete':
        return {
          label: t('hv.bulk.label.delete'),
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
    if (detail.action === 'check-out' && detail.dueDate === undefined) {
      // A check-out with no due date is a check-out nothing can ever call
      // overdue, so the batch asks the question a single row is asked — once,
      // and the answer covers the selection.
      this._pendingBulkCheckout = true;
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
      await this.store?.createLocation(
        trimmed,
        soleLocationId(this.st?.filters ?? defaultFilters()),
        null,
      );
      this._creatingLocation = false;
    } catch (err) {
      this._locationError =
        (err as { message?: string })?.message ?? t('hv.editor.locationCreateFailed');
    }
  }

  /**
   * The editor's first-run way out of an empty location picker.
   *
   * A root location with no area — the only placement that needs no tree to
   * point at — and the created object handed back, because the form files the
   * item in it as soon as it exists. Distinct from the sidebar's own creator
   * above, which files under whatever the sidebar has selected.
   */
  private _createLocationForEditor = (name: string): Promise<Location> => {
    const store = this.store;
    if (!store) return Promise.reject(new Error(t('hv.card.notConnected')));
    return store.createLocation(name, null, null);
  };

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
   * The mode is the filter panel's, and it keeps applying to every tag picked
   * here, so the sidebar has to show it rather than let "all" work unseen. Only
   * shown from the second tag on, since that is when any and all start meaning
   * different things.
   */
  private _renderTagsMode(mode: 'any' | 'all') {
    return html`<span class="segmented" role="radiogroup" aria-label=${t('hv.filter.tagMatchMode')}>
      ${(['any', 'all'] as const).map(
        (m) => html`<button
          class=${mode === m ? 'on' : ''}
          role="radio"
          aria-checked=${String(mode === m)}
          data-testid="sidebar-tags-mode"
          data-mode=${m}
          title=${m === 'any' ? t('hv.fullView.tagsAnyTitle') : t('hv.fullView.tagsAllTitle')}
          @click=${() => this.store?.setFilters({ tagsMode: m })}
        >
          ${m === 'any' ? t('hv.term.any') : t('hv.term.all')}
        </button>`,
      )}
    </span>`;
  }

  /**
   * The stored item status as a sidebar facet.
   *
   * Single-select, because the backend filter takes exactly one status, and
   * pressing the active row clears it — the same contract category has. Unlike
   * the other two facets the rows are a closed set the household defines rather
   * than values discovered from the inventory, so there is nothing to create
   * and no empty state to fall back to.
   */
  private _renderStatusSection() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    const counts = st?.statsCounts;
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle('status', t('hv.field.status'))}
        <!-- The other sections tally how many rows they hold. Here that number
             is the size of the household's vocabulary, which says nothing
             about the inventory the facet navigates. -->
        <span class="head-action">
          <button
            class="hv-icon-button"
            data-testid="sidebar-new-status"
            aria-label=${t('hv.fullView.newStatus')}
            title=${t('hv.fullView.newStatus')}
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('menu-action', {
                  detail: { id: 'organize', tab: 'statuses' },
                  bubbles: true,
                  composed: true,
                }),
              )}
          >
            ${icon('plus', 20)}
          </button>
        </span>
      </div>
      <div
        id=${sectionPanelId('status')}
        role="group"
        aria-label=${t('hv.field.status')}
        ?hidden=${!this._sections.status}
        @keydown=${(e: KeyboardEvent) => this._onFacetKeydown('status', e)}
      >
        ${this._sections.status
          ? statusList(this.st?.statuses).map(({ slug: s }) => {
              const on = filters.status === s;
              const tally = statusCount(counts, s);
              return html`<button
                class="value-row hv-browse-row ${on ? 'selected' : ''}"
                data-testid="sidebar-status-row"
                data-value=${s}
                aria-pressed=${String(on)}
                tabindex="-1"
                @click=${() => {
                  this._holdFacetStop('status', facetRowKey('status', s));
                  this.store?.setFilters({ status: on ? null : s });
                }}
              >
                <span class="hv-browse-row-lead ${on ? '' : 'placeholder'}">${icon('check', 15)}</span>
                <span class="label hv-browse-row-label">${statusLabel(s, this.st?.statuses)}</span>
                ${tally === null ? null : html`<span class="hv-tally">${tally}</span>`}
              </button>`;
            })
          : null}
      </div>
    `;
  }

  /**
   * Categories and tags as sidebar rows.
   *
   * Both accumulate, and both mean OR — an item carries one category, so a
   * selection of several can only be a union. Tags additionally offer any/all,
   * because an item carries several of those and both readings are useful.
   * Pressing a selected row takes it back out.
   */
  private _renderFacetSection(
    section: 'categories' | 'tags',
    label: string,
    values: DistinctValue[],
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
            aria-label=${section === 'tags' ? t('hv.fullView.newTag') : t('hv.fullView.newCategory')}
            title=${section === 'tags' ? t('hv.fullView.newTag') : t('hv.fullView.newCategory')}
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
      <div
        id=${sectionPanelId(section)}
        role="group"
        aria-label=${label}
        ?hidden=${!open}
        @keydown=${(e: KeyboardEvent) => this._onFacetKeydown(section, e)}
      >
        ${open
          ? values.length
            ? values.map(
                (v) => html`<button
                  class="value-row hv-browse-row ${isOn(v.value) ? 'selected' : ''}"
                  data-testid=${`sidebar-${section}-row`}
                  data-value=${v.value}
                  aria-pressed=${String(isOn(v.value))}
                  tabindex="-1"
                  @click=${() => {
                    this._holdFacetStop(section, facetRowKey(section, v.value));
                    onPick(v.value);
                  }}
                >
                  <span class="hv-browse-row-lead ${isOn(v.value) ? '' : 'placeholder'}"
                    >${icon('check', 15)}</span
                  >
                  <!-- These clip with an ellipsis, and a clipped value the user
                       typed is otherwise unreadable — there is nowhere else in
                       the sidebar it appears in full. -->
                  <span class="label hv-browse-row-label" title=${v.value}>${v.value}</span>
                  <!-- With a filter on, matches over total — the pair the
                       location rows already read. A total that never moves says
                       nothing about where the matches are. -->
                  <span class="hv-tally"
                    >${v.matching_count === undefined
                      ? v.count
                      : `${v.matching_count} / ${v.count}`}</span
                  >
                </button>`,
              )
            : html`<div class="section-empty" data-testid=${`sidebar-${section}-empty`}>
                ${section === 'tags'
                  ? t('hv.fullView.noTagsYet')
                  : t('hv.fullView.noCategoriesYet')}
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
    const selectedCategories = new Set(filters.categories);
    return html`
      <div class="sidebar" data-testid="full-sidebar">
        <div class="sidebar-head">
          ${this._renderSectionToggle('locations', t('hv.field.locations'))}
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
              aria-label=${t('hv.fullView.newLocation')}
              title=${t('hv.fullView.newLocation')}
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
          t('hv.field.categories'),
          distinct?.categories ?? [],
          (v) => selectedCategories.has(v),
          (v) =>
            this.store?.setFilters({
              categories: selectedCategories.has(v)
                ? filters.categories.filter((c) => c !== v)
                : [...filters.categories, v],
            }),
        )}
        ${this._renderFacetSection(
          'tags',
          t('hv.field.tags'),
          distinct?.tags ?? [],
          (v) => selectedTags.has(v),
          (v) =>
            this.store?.setFilters({
              tags: selectedTags.has(v) ? filters.tags.filter((t) => t !== v) : [...filters.tags, v],
            }),
          filters.tags.length > 1 ? this._renderTagsMode(filters.tagsMode) : null,
        )}
      </div>
    `;
  }

  /**
   * The location selection after picking `id`, matching how a category or tag
   * row behaves: pressing an unselected one adds it, pressing a selected one
   * takes it out, and the "All items" row (a null pick) clears the lot.
   */
  private _toggledLocations(id: string | null): string[] {
    const current = this.st?.filters.locationIds ?? [];
    if (id === null) return [];
    return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  }

  private _renderLocationSection() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    return html`
        ${this._creatingLocation
          ? html`<div class="new-location">
              <input
                data-testid="sidebar-new-location-name"
                placeholder=${t('hv.fullView.newLocationName')}
                aria-label=${t('hv.fullView.newLocationName')}
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
                ${t('hv.card.addShort')}
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
          .selectedIds=${filters.locationIds}
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
            this.store?.setFilters({
              locationIds: this._toggledLocations((e.detail as { locationId: string | null }).locationId),
              orphansOnly: false,
            })}
          @select-orphans=${() => this.store?.setFilters({ locationIds: [], orphansOnly: true })}
          @select-area=${(e: CustomEvent) =>
            this.store?.setFilters({
              areaId: (e.detail as { areaId: string }).areaId,
              locationIds: [],
              orphansOnly: false,
            })}
        ></hv-location-tree>
    `;
  }

  /** The phone panel's head row, which the card's filter sheet has carried all along. */
  private _renderPanelHead(filters: StoreFilters) {
    return renderFilterHead({
      rowClass: 'panel-head',
      testids: { row: 'full-panel-head', count: 'full-panel-count', clear: 'full-panel-clear' },
      staged: activeFilterCount(this._stagedFilters ?? filters),
      onClear: () => this._panel()?.clearAll(),
    });
  }

  // Resolved per click, never captured at render time: on the render that first
  // draws the panel this element does not exist yet, so a captured reference
  // would leave every button that names it doing nothing.
  private _panel() {
    return this.renderRoot?.querySelector<HVFilterPanel>('[data-testid="full-filter-panel"]');
  }

  /** The phone panel's commit row, without which its staged edits have no way out. */
  private _renderPanelFoot() {
    const panel = this._panel.bind(this);
    return renderStagedFooter({
      prefix: 'full-panel',
      rowClass: 'panel-foot',
      rowTestid: 'full-panel-foot',
      cancelClass: 'hv-text-button',
      applyClass: 'hv-pill',
      // The row's two controls belong at the far end of it, and one auto margin
      // is what puts them there.
      lead: html`<span class="spacer"></span>`,
      stagedCount: this._stagedCount,
      panel,
      onCancel: () => {
        panel()?.resetDraft();
        this._filtersOpen = false;
        this._stagedFilters = null;
      },
    });
  }

  private _renderEmpty() {
    const st = this.st;
    const filters = st?.filters ?? defaultFilters();
    return renderEmptyState(emptyKindFor(this.st), {
      locationName: (st?.locationsFlatCache ?? []).find((l) => l.id === soleLocationId(filters))?.name ?? null,
      onAction: (id: EmptyOffer['id']) => {
        if (id === 'clear-filters') this.store?.clearFilters();
        else if (id === 'add-item') this._leaveEditor('new');
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
    // "Items with no location" is its own answer to where the table is pointed,
    // so the crumb says that instead of a path and there is none to mark.
    const loc = filters.orphansOnly ? undefined : locations.find((l) => l.id === soleLocationId(filters));
    const parts = locationPathParts(loc, locations, st?.areasCache?.areas ?? [], '');
    const segments = parts.path ? parts.path.split(PATH_SEPARATOR) : [];
    const filterCount = activeFilterCount(filters);

    return html`
      <div class="context">
        <!-- The chip sits on the row rather than inside the text, because the
             text below prints one span per path segment and an area folded into
             that sequence would read as the path's first segment. -->
        <span class="crumb hv-chip-line" data-testid="full-breadcrumb" title=${pathTitle(parts)}>
          ${renderAreaChip(areaMarkName(parts.areaName, parts.path))}
          <span class="hv-chip-line-text">
            ${filters.orphansOnly
              ? html`<span class="current">${t('hv.term.noLocation')}</span>`
              : segments.length
                ? segments.map((seg, i) =>
                    i === segments.length - 1
                      ? html`<span class="current">${seg}</span>`
                      : html`<span>${seg} › </span>`,
                  )
                : html`<span class="current">${t('hv.tree.allItems')}</span>`}${st?.total !== null &&
            st?.total !== undefined
              ? html` · ${counted(st.total, 'item')}`
              : null}
          </span>
        </span>
        <!-- One flex item for everything right of the crumb, so that when the
             crumb and its count fill a phone-width row the chips and both
             buttons move to the next line together, rather than the column
             picker wrapping on its own under the filter button. -->
        <span class="context-actions">
          ${filterCount > 0
            ? renderFilterChips(st, {
                setFilters: (patch) => this.store?.setFilters(patch),
                clearFilters: () => this.store?.clearFilters(),
              })
            : null}
          <button
            class="filters-button ${this._filtersOpen ? 'on' : ''}"
            data-testid="full-filters-toggle"
            aria-expanded=${String(this._filtersOpen)}
            aria-controls=${FILTER_PANEL_ID}
            @click=${() => {
              this._filtersOpen = !this._filtersOpen;
              // The phone panel stages its edits, so its head row and its
              // button both have a number to print from the moment it opens.
              this._stagedFilters = this._filtersOpen && this._viewport.narrow ? filters : null;
              if (this._filtersOpen && this._viewport.narrow) this._priceStaged(filters);
            }}
          >
            ${icon('tune', 16)}${t('hv.card.filters')}
          </button>
          <!-- Not on a phone. This row also carries the chips and their clear
               button, and in German the four together were one control too
               many for 375px: the picker dropped onto a line of its own under
               the chip. The ⋮ menu offers Columns on both hosts, so nothing is
               lost by leaving it as the only route there at this width. -->
          ${this._viewport.narrow
            ? null
            : html`<button
                class="hv-icon-button"
                data-testid="columns-expanded"
                aria-label=${t('hv.fullView.chooseColumns')}
                title=${t('hv.fullView.chooseColumns')}
                @click=${() =>
                  this.dispatchEvent(
                    new CustomEvent('menu-action', { detail: { id: 'columns' }, bubbles: true, composed: true }),
                  )}
              >
                ${icon('viewColumn', 20)}
              </button>`}
        </span>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;
    const z = this._zBase || 9998;
    const modal = !this.embedded;

    return html`
      ${modal
        ? html`<div
            class="backdrop"
            role="presentation"
            style="z-index: ${z};"
            @click=${() => this._leaveEditor('close')}
          ></div>`
        : null}
      <div
        class="shell"
        role=${ifDefined(modal ? 'dialog' : undefined)}
        aria-modal=${ifDefined(modal ? 'true' : undefined)}
        aria-label=${this.heading}
        data-testid="full-view"
        style=${modal ? `z-index: ${z + 1};` : ''}
        @keydown=${modal ? onEscape(() => this._leaveEditor('close')) : nothing}
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
        <button
          class="tap"
          data-testid="exit-selection"
          aria-label=${t('hv.fullView.exitSelection')}
          @click=${() => this._exitSelection()}
        >
          ${icon('close', 20)}
        </button>
        <span class="count" data-testid="selection-count"
          >${t('hv.fullView.selectedCount', { count: selected })}</span
        >
        ${total !== null
          ? html`<span class="subcount" data-testid="selection-subcount"
              >${t('hv.fullView.ofMatching', { total })}</span
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
              ${this._loadingAll
                ? t('hv.fullView.loading')
                : t('hv.fullView.loadAll', { total })}
            </button>`
          : null}
        <!-- Selection mode opens at zero, so the bar's one action starts with
             nothing to act on; live rather than greyed it offers a no-op. -->
        <button
          class="ghost plain clear"
          data-testid="selection-clear"
          ?disabled=${selected === 0}
          @click=${() => this.store?.clearSelection()}
        >
          ${t('hv.fullView.clearSelection')}
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
      aria-label=${t('hv.fullView.openMenu')}
      title=${t('hv.fullView.menu')}
      @click=${() => this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true }))}
    >
      ${icon('menu', 20)}
    </button>`;
  }

  /**
   * The app bar prices derived exceptions only — low stock, overdue, due for
   * inspection, checked out. Every one of those is computed from the item and
   * means the same thing in every household, which is what lets them share the
   * bar's fixed amber/red vocabulary.
   *
   * A status is not one of those: a household names and colours its own, so a
   * status tally here would speak that vocabulary in the bar's hues, saying
   * "chore" about whatever the household actually meant. The sidebar facet and
   * the filter chips price and navigate statuses, in the household's own tones.
   */
  private _renderAppBar() {
    const st = this.st;
    const counts = st?.statsCounts;
    // The narrow branch dresses these same controls its own way, on its own
    // breakpoint, so the measured steps stand aside for it.
    const steps = this._viewport.narrow ? '' : this._barSteps;
    const addLabelClass = steps.includes('tight') ? 'add-label hv-sr-only' : 'add-label';
    const badges = renderStatBadges(st, this.quickFilters, {
      prefix: 'full-badge',
      // The bar substitutes its own solid fills for the card's pale tints, and
      // has no blue to spare on a blue bar — so the checked-out pill, which is
      // the card's one blue badge, takes no hue here.
      chipClass: (tone) => (tone === 'state' ? 'pill' : `pill ${tone}`),
      setFilters: (patch) => this.store?.setFilters(patch),
    });
    return html`
        <div class="appbar ${steps}">
          ${this.embedded
            ? this._renderMenuButton()
            : html`<button
                class="tap"
                data-testid="expand-toggle"
                aria-label=${t('hv.fullView.close')}
                @click=${() => this._leaveEditor('close')}
              >
                ${icon('close', 20)}
              </button>`}
          <h2>${this.heading}</h2>
          ${renderSearch({
            testid: 'full-search',
            draft: this._searchDraft,
            total: counts?.items_total ?? null,
            onInput: (q) => {
              this._searchDraft = q;
              this._emitSearch(q);
            },
          })}
          <!-- One strip, so the pills are what gives when the bar runs out of
               room — and no strip at all when nothing is flagged, because an
               empty one is still a flex item with a gap in front of it. -->
          ${badges?.any
            ? html`<div class="pills" data-testid="full-pills">${badges.pills}</div>`
            : null}
          <!-- On a phone the bar's first row holds the menu, this button, the
               organize pin and the overflow, and only the heading can shrink.
               The full German label is wider than the row has left, which
               squeezed the heading to "H…" and pushed the overflow onto a
               second row; the short label the card header uses keeps the row
               whole. On a bar that is merely tight the label goes to the
               accessible name instead, leaving the icon. Either way the full
               wording is what the button is called. -->
          <button
            class="add"
            data-testid="full-add-item"
            aria-label=${t('hv.card.addItem')}
            title=${t('hv.card.addItem')}
            @click=${() => this._leaveEditor('new')}
          >
            ${icon('plus', 16)}<span class=${addLabelClass}
              >${t(this._viewport.narrow ? 'hv.card.addShort' : 'hv.card.addItem')}</span
            >
          </button>
          <button
            class="tap"
            data-testid="full-organize"
            aria-label=${t('hv.organize.title')}
            title=${t('hv.organize.title')}
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('menu-action', { detail: { id: 'organize' }, bubbles: true, composed: true }),
              )}
          >
            ${icon('mapMarker', 20)}
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
    const loaded = st?.items.length ?? 0;
    const selection = st?.selection ?? new Set<string>();

    return html`
        <div class="body">
          ${this._renderSidebar()}
          <div class="main">
            ${this._renderContextBar()}
            <!-- The open form's own sentence is the save-failure surface: the
                 user's text is in front of it and the account of what happened
                 belongs beside it. Everything else — a lost connection, paused
                 live updates, a refused operation with nowhere else to be said —
                 is this queue's, on the same terms as the card's. -->
            ${renderDegradedBanners(st, this._bannerHooks)} ${renderErrorBanners(st, this._bannerHooks)}
            <div class="panel-holder" id=${FILTER_PANEL_ID} ?hidden=${!this._filtersOpen}>
              ${this._filtersOpen
                ? html`
                  ${this._viewport.narrow ? this._renderPanelHead(filters) : null}
                  <div class="panel-scroll">
                  ${renderFilterPanel(st, {
                    testid: 'full-filter-panel',
                    mobile: this._viewport.narrow,
                    setFilters: (patch) => this.store?.setFilters(patch),
                    clearFilters: () => this.store?.clearFilters(),
                    onStage: (staged) => {
                      this._stagedFilters = staged;
                      this._priceStaged(staged);
                    },
                    onApply: (applied) => {
                      this.store?.setFilters(applied);
                      this._filtersOpen = false;
                      this._stagedFilters = null;
                    },
                  })}
                  </div>
                  ${this._viewport.narrow ? this._renderPanelFoot() : null}
                `
                : null}
            </div>
            ${this._workspace.editing !== null
              ? html`<div class="editor-holder">
                  ${this._workspace.editing !== 'new' &&
                  !st?.items.some((i) => i.id === this._workspace.editing)
                    ? html`<p class="pinned-hint" data-testid="pinned-editor-hint">
                        ${t('hv.list.noLongerMatches')}
                      </p>`
                    : null}
                  ${this._workspace.renderEditor({
                    testid: 'full-editor',
                    mobile: this._viewport.narrow,
                  })}
                </div>`
              : null}

            ${this._selecting && st?.total !== null && st?.total !== undefined && loaded < st.total
              ? html`<div class="honesty" data-testid="selection-honesty">
                  ${t('hv.fullView.selectionHonesty', { loaded, total: st.total })}
                </div>`
              : null}

            <hv-data-table
              .statuses=${this.st?.statuses ?? null}
              .areas=${st?.areasCache?.areas ?? []}
              .media=${this._workspace.media}
              data-testid="full-table"
              .items=${(st?.items ?? []) as Item[]}
              .columns=${this.columns}
              .sort=${filters.sort as Sort}
              ?selectable=${this._selecting}
              ?narrow=${this._viewport.narrow}
              .selection=${selection}
              @sort-change=${(e: CustomEvent) => this.store?.setFilters({ sort: (e.detail as { sort: Sort }).sort })}
              @near-end=${(e: CustomEvent) =>
                void this.store?.prefetchIfNeeded((e.detail as { ratio: number }).ratio)}
              @increment=${(e: CustomEvent) => this._workspace.onRowEvent('increment', e.detail)}
              @decrement=${(e: CustomEvent) => this._workspace.onRowEvent('decrement', e.detail)}
              @edit=${(e: CustomEvent) => this._workspace.onRowEvent('edit', e.detail)}
              @open-item=${(e: CustomEvent) => this._workspace.onRowEvent('open-item', e.detail)}
              @row-action=${(e: CustomEvent) => this._workspace.onRowAction(e.detail)}
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
              ${showingCount(loaded, st?.total, activeFilterCount(filters) > 0)}${st?.cursor
                ? t('hv.fullView.scrollToLoadMore')
                : ''}
            </div>
          </div>
        </div>

        <hv-confirm
          data-testid="bulk-confirm"
          ?open=${this._pendingDelete}
          ?mobile=${this._viewport.narrow}
          .heading=${t('hv.fullView.deleteHeading', {
            items: counted(selection.size, 'item'),
          })}
          .message=${t('hv.fullView.deleteMessage')}
          .warning=${this._checkedOutWarning}
          .confirmLabel=${t('hv.fullView.deleteConfirm', { count: selection.size })}
          destructive
          @confirm=${() => {
            this._pendingDelete = false;
            void this._execute(this._opsFor({ action: 'delete' }, this._selectedItems));
          }}
          @cancel=${() => {
            this._pendingDelete = false;
          }}
        ></hv-confirm>

        ${this._viewport.narrow
          ? this._workspace.renderDetailSheet({ testid: 'full-detail-sheet' })
          : null}

        ${this._workspace.renderCheckoutPopover({
          testid: 'full-checkout',
          mobile: this._viewport.narrow,
        })}

        <!-- Centred at every width and scrimmed: it is opened by a bar at the
             foot of the table with no body of its own to sit in, and it anchors
             to nothing, so it takes the same middle-of-the-screen position the
             bulk confirm does. -->
        <hv-checkout-popover
          data-testid="full-bulk-checkout"
          ?open=${this._pendingBulkCheckout}
          ?touch=${this._viewport.narrow}
          .itemName=${counted(selection.size, 'item')}
          @check-out=${(e: CustomEvent) => {
            const { dueDate } = e.detail as { dueDate: string | null };
            this._pendingBulkCheckout = false;
            void this._execute(this._opsFor({ action: 'check-out', dueDate }, this._selectedItems));
          }}
          @cancel=${() => {
            this._pendingBulkCheckout = false;
          }}
        ></hv-checkout-popover>
    `;
  }

  /** Extra warning for a bulk delete that would remove checked-out items. */
  private get _checkedOutWarning(): string | null {
    const out = this._selectedItems.filter((i) => i.checked_out).length;
    if (!out) return null;
    return tn('hv.fullView.checkedOutWarning', out);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-full-view': HVFullView;
  }
}
