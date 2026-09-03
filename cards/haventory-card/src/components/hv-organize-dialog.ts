import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { keyed } from 'lit/directives/keyed.js';
import { ref } from 'lit/directives/ref.js';
import { tokens, base } from '../ui/tokens';
import { chip, tagLabel } from '../ui/chip';
import { Modal, modalChrome } from '../ui/modal';
import { LocationPicker } from '../ui/location-picker';
import { Picker } from '../ui/picker';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { counted } from '../ui/plural';
import {
  DEFAULT_STATUS,
  STATUS_COLORS,
  STATUS_ICONS,
  displayLabel,
  hexToneStyle,
  isHexColor,
  knownIcon,
  renderStatusChip,
  slugFromLabel,
  statusCount,
  statusLabel,
  statusList,
} from '../ui/status';
import { closestMatch } from '../ui/fuzzy';
import { describeRewrite, filterForValue, rewriteOps } from '../ui/value-rewrite';
import type { ValueKind } from '../ui/value-rewrite';
import { areaChangePreview, areaNameById } from '../ui/area';
import type { AreaChangePreview } from '../ui/area';
import { renderAreaChip } from '../ui/location-path';
import { countLocations } from '../store/location-tree';
import { CopyFlash, idRow } from '../ui/clipboard';
import { describeFailure } from './hv-bulk-bar';
import { makeBulkOp } from '../store/store';
import type { Store } from '../store/store';
import type {
  AreaRef,
  BulkFailure,
  DistinctValue,
  Item,
  LocationTreeNode,
  StatusColorValue,
  StatusDefinition,
  StoreState,
} from '../store/types';
import './hv-confirm';

export type OrganizeTab = 'locations' | 'categories' | 'tags' | 'statuses';

/**
 * What the colour input opens on before a household has chosen a colour of its
 * own. A native colour input has no empty state — it always shows something —
 * so this is a starting point, not a value: it is stored only once the picker
 * reports a choice. Held off the ten tones so an accidental accept is visibly
 * a custom colour rather than a token's near-twin.
 */
const CUSTOM_COLOR_SEED = '#7b5ea7';

/**
 * The trees the two location pickers open, named so `aria-controls` can point at
 * them. Each holder stays in the tree whether or not it is open — an
 * `aria-controls` that resolves to nothing announces the control as controlling
 * nothing — and only the tree inside comes and goes, so closing a picker still
 * discards its scroll and filter.
 */
const LOC_PARENT_TREE_ID = 'location-parent-tree-holder';
const MERGE_TARGET_TREE_ID = 'merge-target-tree-holder';

/** The same, for the list of values a category or tag merge can land on. */
const MERGE_VALUE_LIST_ID = 'merge-value-list-holder';

/**
 * How many values the merge list shows before it earns a filter of its own.
 *
 * The box is 200px tall and a row is about 32px of it, so six are on screen at
 * once: over a shorter list a search field would narrow nothing that is not
 * already visible. A household's tags run to hundreds, which is what it is
 * there for.
 */
const VALUE_FILTER_FROM = 6;

/**
 * The three batch rewrites.
 *
 * A kind rather than a label: every line a rewrite prints — the running count,
 * the "nothing to do", both finished forms — is a different sentence per
 * language, and only English builds them by appending "d" to the verb.
 */
type RewriteKind = 'merge' | 'rename' | 'remove';

interface RewriteState {
  kind: RewriteKind;
  done: number;
  total: number;
  failed: BulkFailure[];
  finished: boolean;
  /** A step outside the batch that failed — only a location merge has those. */
  error?: string | null;
}

/**
 * "Organize".
 *
 * One dialog, four tabs: locations, categories, tags and statuses. Locations
 * edit in place with a guarded delete — a location that still holds items or
 * children gets an inline explanation, never a browser confirm. Categories and
 * tags have no rename or merge endpoint, so those are batch rewrites over every
 * affected item, with the progress and partial-failure treatment bulk actions
 * get.
 */
@customElement('hv-organize-dialog')
export class HVOrganizeDialog extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    modalChrome,
    idRow,
    css`
      :host {
        /*
         * The vertical padding of every row in this dialog, declared once so
         * the four tabs cannot drift apart: the value rows below read it, and
         * it inherits through the shadow boundary into the hv-location-tree the
         * Locations tab hosts, which reads it with its own fallback. Nothing
         * outside declares it, so the sidebar's tree keeps its own spacing.
         */
        --hv-organize-row-pad: 8px;
      }
      .wrap {
        padding: 24px;
      }
      :host([mobile]) .wrap {
        padding: 0;
        place-items: stretch;
      }
      .panel {
        width: 620px;
        max-height: 100%;
        display: flex;
        flex-direction: column;
      }
      /* Mobile is a full-bleed page, not a floating modal. */
      :host([mobile]) .panel {
        width: 100%;
        height: 100%;
        max-height: none;
        border-radius: 0;
        box-shadow: none;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 15px 20px 12px;
      }
      :host([mobile]) .head {
        padding: 6px 8px 6px 4px;
        border-bottom: 1px solid var(--hv-divider);
      }
      .head h2 {
        margin: 0;
        flex: 1;
        font-size: 18px;
        font-weight: 500;
      }
      :host([mobile]) .head h2 {
        font-size: 17px;
      }
      .tabs {
        display: flex;
        border-bottom: 1px solid var(--hv-divider);
        padding: 0 20px;
      }
      :host([mobile]) .tabs {
        padding: 0;
      }
      .tabs button {
        border: none;
        background: none;
        padding: 8px 16px 10px;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text-secondary);
        border-bottom: 2px solid transparent;
      }
      :host([mobile]) .tabs button {
        flex: 1;
        padding: 12px 0;
      }
      .tabs button.on {
        color: var(--hv-primary-darker);
        font-weight: 500;
        border-bottom-color: var(--hv-primary);
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 20px 10px;
      }
      .search {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--hv-input-bg);
        border-radius: var(--hv-radius-chip);
        padding: 9px 14px;
        color: var(--hv-text-secondary);
      }
      .search input {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        outline: none;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
      }
      /* How many of this tab's thing there is — every tab prints one, hence a
         shared class. nowrap because on a phone the row has no width to spare
         and "13 locations" would break over two lines. */
      .toolbar-count {
        flex: none;
        white-space: nowrap;
        font-size: 12.5px;
        color: var(--hv-text-secondary);
      }
      /* Three items in a 335px row left the filter field 110px wide, with its own
         placeholder clipped to "Filter loca". The field takes the row and the
         count keeps the button company on the next one. */
      :host([mobile]) .toolbar {
        flex-wrap: wrap;
      }
      :host([mobile]) .search {
        flex-basis: 100%;
      }
      :host([mobile]) .toolbar-count {
        margin-right: auto;
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 14px 16px;
      }
      .value-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: var(--hv-organize-row-pad) 8px;
        border-radius: var(--hv-radius-input);
      }
      .value-row:hover {
        background: var(--hv-hover-overlay);
      }
      /* Two arrow buttons rather than a drag handle: this is the card's first
         reordering control, and buttons work from the keyboard without a
         parallel implementation for it.

         Side by side, because stacked they made the row they sit in twice as
         tall as the same row on every other tab — the pair was the whole of
         that difference. */
      .move {
        display: flex;
        flex-direction: row;
        flex: none;
        gap: 3px;
      }
      /* Sized rather than left at the glyph: WCAG 2.2 asks 24px of every
         pointer, and a pair that has to be aimed at is the complaint this
         answers, so they take more than the minimum. */
      .move button {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: none;
        background: none;
        color: var(--hv-text-tertiary);
        cursor: pointer;
        padding: 0;
        line-height: 0;
      }
      /* A phone keeps them stacked: a horizontal pair at the platform's 44px
         is 88px of row, which does not fit beside the chip, the count and two
         44px actions. */
      :host([mobile]) .move {
        flex-direction: column;
        gap: 1px;
      }
      :host([mobile]) .move button {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      .move button:hover:not([disabled]) {
        color: var(--hv-text);
      }
      .move button[disabled] {
        opacity: 0.3;
        cursor: default;
      }
      /* The identity items store, shown in the editor only: services.yaml and an
         export document carry it, and it is muted there because a household
         never needs to type it. It carries a title attribute too, because a
         slug long enough to outrun its line still elides. */
      .status-slug {
        font: 400 12px var(--hv-font);
        color: var(--hv-text-tertiary);
        white-space: nowrap;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* A label is a household's own words and can be long enough that the row
         overruns on its own — the fixed parts beside it (a 44px reorder column,
         the count, two 44px actions) leave a phone row barely 130px for it.
         Unshrinkable, the chip pushes the delete button past the dialog edge
         where no finger reaches it. */
      .status-row .hv-status-chip {
        flex: 0 1 auto;
        min-width: 0;
      }
      .status-name {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }
      .status-name .control {
        flex: 1 1 180px;
        width: auto;
      }
      /* The editor shows the slug for people writing automations, so here it
         keeps its full width and drops to a line of its own rather than eliding
         while the row still has room — the opposite of the list row above. */
      .status-name .status-slug {
        flex: 0 0 auto;
        max-width: 100%;
      }
      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 2px 0 4px;
      }
      /* A tone is a pair — a tint and the ink that reads on it — so the swatch
         shows both, with the glyph the status will carry standing in for the
         label. A bare fill leaves the five light tints all but identical on
         white, and in dark it leaves them washes with nothing behind them. */
      .swatch {
        justify-content: center;
        width: 34px;
        height: 26px;
        border-radius: var(--hv-radius-chip);
        cursor: pointer;
        padding: 0;
      }
      :host([mobile]) .swatch {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      /* The stand-in when a definition names a glyph this bundle does not
         carry: the swatch still has to show ink on its tint. */
      .swatch .letters {
        font: 600 12px var(--hv-font);
      }
      .glyph {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 26px;
        border-radius: var(--hv-radius-input);
        border: 1px solid var(--hv-divider);
        background: none;
        color: var(--hv-text-secondary);
        cursor: pointer;
      }
      .glyph:hover {
        background: var(--hv-hover-overlay);
      }
      :host([mobile]) .glyph {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      /* The eleventh swatch: a household's own colour, opening the browser's
         colour picker. The native control is the whole target rather than a
         thing beside it, so it is stretched over the swatch and made
         invisible — Chrome and Firefox each draw their own box, neither of
         which can be styled to match the ten. Focus still lands on it, so the
         ring below is drawn from the swatch around it. */
      .swatch.custom {
        position: relative;
        overflow: hidden;
        /* The unchosen state — a plain chip face, saying "pick one" where the
           ten say "this one" without borrowing a hue that means something.
           Written as the pair .hv-status-chip reads, never as background and
           color: a longhand here outranks that rule, and the inline pair a
           chosen colour arrives as would then never paint. */
        --hv-status-bg: var(--hv-chip-bg);
        --hv-status-fg: var(--hv-text-secondary);
      }
      .swatch.custom > input[type='color'] {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        padding: 0;
        border: none;
        cursor: pointer;
      }
      .swatch.custom:focus-within {
        outline: 2px solid var(--hv-primary);
        outline-offset: 1px;
      }
      .swatch.on,
      .glyph.on {
        outline: 2px solid var(--hv-primary);
        outline-offset: 1px;
      }
      .glyph.on {
        color: var(--hv-primary-darker);
      }
      .count-link {
        border: none;
        background: none;
        color: var(--hv-primary-dark);
        font: 400 12px var(--hv-font);
        padding: 0;
        /* "12 items" wrapping to two lines makes the row taller without making
           it narrower — the slug beside it is what gives way instead. */
        white-space: nowrap;
        flex: none;
        /* 12px text is a 14px-tall target, so the box is told to be bigger than
           its own line: WCAG 2.2 asks 24px of any pointer. Every tab prints a
           count, and one dialog cannot offer two sizes for one control. */
        display: inline-flex;
        align-items: center;
        min-height: 24px;
      }
      :host([mobile]) .count-link {
        min-height: var(--hv-tap-min, 44px);
      }
      .draft-note {
        font: 400 12px var(--hv-font);
        color: var(--hv-text-tertiary);
        font-style: italic;
      }
      .row-actions {
        margin-left: auto;
        display: flex;
        gap: 2px;
        flex: none;
      }
      :host(:not([mobile])) .value-row .row-actions {
        visibility: hidden;
      }
      :host(:not([mobile])) .value-row:hover .row-actions,
      :host(:not([mobile])) .value-row:focus-within .row-actions {
        visibility: visible;
      }
      .row-actions button {
        display: inline-grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--hv-text-secondary);
        padding: 0;
      }
      /* A phone row grows to hold a tappable action — a 44px child takes a
         ~44px row to ~66px. That height is the cost of the target: sizing one
         tab's actions and not the rest leaves 26px controls beside 44px ones
         in the same dialog. */
      :host([mobile]) .row-actions button {
        width: var(--hv-tap-min, 44px);
        height: var(--hv-tap-min, 44px);
      }
      .row-actions button.danger {
        color: var(--hv-error);
      }
      .row-actions button:hover {
        background: var(--hv-hover-overlay);
      }
      .expander {
        background: var(--hv-row-hover);
        border-left: 3px solid var(--hv-primary);
        border-radius: 0 10px 10px 0;
        padding: 12px 14px 14px;
        margin: 0 0 6px 8px;
        display: grid;
        gap: 11px;
      }
      .grid2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      :host([mobile]) .grid2 {
        grid-template-columns: 1fr;
      }
      .cell {
        display: grid;
        gap: 4px;
        min-width: 0;
        /* The area cell carries a preview line the name cell has no counterpart
           for, so the two are not the same height; packed to the start, the
           shorter one's field stays beside the other's instead of sinking to the
           bottom of the row. */
        align-content: start;
      }
      .cell.wide {
        grid-column: span 2;
      }
      :host([mobile]) .cell.wide {
        grid-column: span 1;
      }
      .control {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 9px 11px;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        text-align: left;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      :host([mobile]) .control {
        min-height: 46px;
        font-size: 15px;
      }
      /* The merge target takes what the struck-through source leaves of the row,
         and stops shrinking before the name it holds is unreadable. */
      .control.grow {
        flex: 1;
        min-width: 180px;
      }
      .control .value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tree-holder {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        max-height: 200px;
        overflow: auto;
        padding: 4px 0;
        margin-top: 6px;
      }
      /* The merge target list shares that box, so its own parts carry the
         padding the box leaves off the sides. */
      .list-filter {
        display: block;
        padding: 4px 8px 6px;
      }
      .option {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        border: none;
        background: none;
        text-align: left;
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
        padding: 7px 12px;
        border-radius: var(--hv-radius-input);
      }
      :host([mobile]) .option {
        min-height: var(--hv-tap-min, 44px);
        font-size: 15px;
      }
      .option .label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .option:hover {
        background: var(--hv-hover-overlay);
      }
      .option[aria-pressed='true'] {
        background: var(--hv-primary-tint);
        color: var(--hv-on-primary-tint);
        font-weight: 500;
      }
      .option-empty {
        padding: 8px 12px;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .actions .spacer {
        margin-left: auto;
      }
      .guard {
        display: flex;
        align-items: flex-start;
        /* The reassign guard puts three parts in here; unwrapped they share one
           row and the select comes out ~44px wide, which hides the one thing
           the guard exists to show. */
        flex-wrap: wrap;
        gap: 9px;
        padding: 10px 12px;
        margin: 0 8px 8px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12.5px;
        line-height: 1.5;
      }
      /* A guard's alert mark is a statement, not a control: warn ink and a
         width it will not give up, and nothing that would read as a button. */
      .guard-mark {
        color: var(--hv-warn);
        flex: none;
      }
      /* Where the items go is the guard's own sentence, not a note beside one:
         it takes a line to itself rather than competing with the select for
         width, and the guard's ink rather than the tertiary grey a note carries
         on a plain surface, which lands at 2.5:1 over this fill. */
      .status-guard .guard-message {
        flex: 1 1 100%;
      }
      .status-guard .actions {
        flex: 1 1 auto;
      }
      :host([mobile]) .status-guard {
        flex-direction: column;
        align-items: stretch;
      }
      /* Stacked, the three parts each take a line of their own; the basis above
         is a width and means nothing once the main axis is vertical. */
      :host([mobile]) .status-guard .guard-message,
      :host([mobile]) .status-guard .actions {
        flex: none;
      }
      .guard-target {
        display: flex;
        align-items: center;
        /* Below ~330px the label and a readable select no longer share a line;
           the select drops under it rather than overflowing the dialog. */
        flex-wrap: wrap;
        gap: 8px;
        flex: 1 1 auto;
        min-width: 0;
      }
      .guard-target > span {
        flex: none;
      }
      /* A select showing "O⌄" names nothing. It grows into the row instead of
         collapsing to its own arrow. */
      .guard-target select.control {
        flex: 1 1 auto;
        width: auto;
        min-width: 140px;
      }
      .track {
        height: 6px;
        border-radius: 999px;
        background: var(--hv-divider);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--hv-primary);
        transition: width var(--hv-motion-panel) ease-out;
      }
      .failure {
        display: flex;
        gap: 8px;
        padding: 9px 11px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-error-bg);
        color: var(--hv-error-deep);
        font-size: 12.5px;
      }
      /* Shaped like .failure and coloured a step softer: it reports something
         the household may go ahead with, so it must not read as a refusal. */
      .hint {
        display: flex;
        gap: 8px;
        padding: 9px 11px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12.5px;
      }
      .note {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        line-height: 1.5;
      }
      .empty {
        padding: 24px 10px;
        text-align: center;
        color: var(--hv-text-tertiary);
        font-size: 13px;
      }
      .sheet-actions {
        display: grid;
        gap: 2px;
      }
      .sheet-actions button {
        display: flex;
        align-items: center;
        gap: 14px;
        border: none;
        background: none;
        color: var(--hv-text);
        padding: 13px 4px;
        font: 400 14.5px var(--hv-font);
        text-align: left;
      }
      .sheet-actions button.danger {
        color: var(--hv-error-soft);
      }
    `,
  ];

  @property({ attribute: false }) store!: Store;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) tab: OrganizeTab = 'locations';
  @property({ type: Boolean, reflect: true }) mobile = false;

  /** The parent picker and the merge target: one location each, so a pick ends it. */
  private readonly _parentPicker = new LocationPicker(this);
  private readonly _mergePicker = new LocationPicker(this);
  /** The list of values a category or tag merges into; its filter goes with it. */
  private readonly _valuePicker = new Picker(this, {
    onClose: () => {
      this._valueFilter = '';
    },
  });
  /** The "Copied" label on the open location editor's id row. */
  private readonly _copyFlash = new CopyFlash(this);

  @state() private _filter = '';
  /** Location being edited, `'new'` for the create row, or null. */
  @state() private _editingLocation: string | 'new' | null = null;
  @state() private _locName = '';
  @state() private _locArea: string | null = null;
  @state() private _locParent: string | null = null;
  @state() private _locError: string | null = null;
  @state() private _guard: { locationId: string; message: string } | null = null;
  /** Location being merged away, with the location it is merging into. */
  @state() private _mergingLocation: string | null = null;
  @state() private _mergeTarget: string | null = null;
  /** Location whose actions are open in the touch sheet. */
  @state() private _sheetLocation: string | null = null;
  /** The value row expanded for rename or merge, if any; the kind comes from the active tab. */
  @state() private _editingValue: { value: string; mode: 'rename' | 'merge' } | null = null;
  @state() private _valueDraft = '';
  /** What narrows the merge target list, for a vocabulary too long to scan. */
  @state() private _valueFilter = '';
  @state() private _rewrite: RewriteState | null = null;
  @state() private _confirmRemove: string | null = null;
  /**
   * Which value the last delete confirmation was about, kept past the close so
   * the focus rescue can still find its row: nulling `_confirmRemove` is what
   * closes the confirmation, and the rescue runs after that re-render.
   */
  private _lastConfirmValue: string | null = null;
  @state() private _sheetValue: string | null = null;
  /** The "New category"/"New tag" row, open with the name being typed. */
  @state() private _editingStatus: string | 'new' | null = null;
  @state() private _statusLabel = '';
  @state() private _statusColor: StatusColorValue = 'neutral';
  @state() private _statusIcon = 'check';
  @state() private _statusError: string | null = null;
  /** A delete refused because items still carry the slug, and how many. */
  @state() private _statusGuard: { slug: string; count: number } | null = null;
  @state() private _reassignTarget = '';

  @state() private _creatingValue = false;
  @state() private _newValue = '';
  @state() private _newValueError: string | null = null;

  private _storeUnsub?: () => void;

  private _modal = new Modal(this, { open: () => this.open });

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.store && !this._storeUnsub) {
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._storeUnsub?.();
    this._storeUnsub = undefined;
  }

  /** Whether this update is the one that puts the dialog on screen. */
  private _opening = false;

  /**
   * Bring a disclosure into view as it opens, and hand a form's first field the
   * caret. Each renders below its trigger inside a pane that scrolls, so one
   * opened from a row near the bottom lands off screen and the tap reads as
   * having done nothing. `block: 'nearest'` moves nothing already on screen and
   * names no `behavior`, so there is no motion to gate on a preference.
   *
   * A ref fires when the element is built and not on the re-renders that
   * follow, which is what "newly open" means — as long as each disclosure is
   * `keyed` on what it is about, so a second row rebuilds it. Only a form takes
   * the caret: a guard announces itself through `role="alert"`, and a ⋮ sheet
   * is a menu, so pulling focus into either answers a tap nobody made.
   *
   * Not on the update that opens the dialog, where a disclosure carried over
   * from last time would scroll a pane nobody has looked at and take focus off
   * the panel `Modal` just put it on. And a microtask late, because a ref fires
   * while its subtree is still detached, where a scroll has nothing to act on
   * and `focus()` is a silent no-op.
   */
  private _reveal = (el?: Element) => {
    if (!el || this._opening) return;
    queueMicrotask(() => {
      if (!el.isConnected) return;
      // Scrolling needs a layout, and an environment that performs none offers
      // no `scrollIntoView` to call.
      (el as HTMLElement).scrollIntoView?.({ block: 'nearest' });
      const field = (el as HTMLElement).dataset.field;
      if (field) el.querySelector<HTMLElement>(`[data-testid="${field}"]`)?.focus();
    });
  };

  protected updated() {
    // A native select stops following its options' `selected` attributes once it
    // has been touched, so an area chosen in the parent tree is written to the
    // live element rather than left to the bindings to express.
    const areaSelect = this.renderRoot.querySelector<HTMLSelectElement>(
      '[data-testid="location-area"]',
    );
    if (areaSelect) areaSelect.value = this._locArea ?? '';
    this._opening = false;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('store') && this.store) {
      this._storeUnsub?.();
      this._storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
    if (changed.has('open') && this.open) {
      this._opening = true;
      this._resetTransient();
    }
    if (changed.has('tab')) this._resetTransient();
  }

  private _resetTransient() {
    this._filter = '';
    this._editingLocation = null;
    this._editingValue = null;
    this._valuePicker.close();
    this._guard = null;
    this._locError = null;
    this._rewrite = null;
    this._sheetValue = null;
    this._creatingValue = false;
    this._newValue = '';
    this._newValueError = null;
    this._mergingLocation = null;
    this._mergeTarget = null;
    this._mergePicker.close();
    this._sheetLocation = null;
  }

  private _close = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  // ---------- Chrome the four tabs share ----------
  /**
   * A tab's head row: what it is filtering, how many there are, and the one
   * thing this tab creates. Statuses are a fixed vocabulary to scroll rather
   * than a list to search, so the field is optional.
   */
  private _renderToolbar(opts: {
    search?: { label: string; placeholder: string };
    count: string;
    countTestid: string;
    newTestid: string;
    newLabel: string;
    onNew: () => void;
  }) {
    return html`<div class="toolbar">
      ${opts.search
        ? html`<label class="search">
            ${icon('magnify', 17)}
            <span class="hv-sr-only">${opts.search.label}</span>
            <input
              data-testid="organize-filter"
              placeholder=${opts.search.placeholder}
              .value=${this._filter}
              @input=${(e: Event) => {
                this._filter = (e.target as HTMLInputElement).value;
              }}
            />
          </label>`
        : null}
      <span class="toolbar-count" data-testid=${opts.countTestid}>${opts.count}</span>
      <button class="hv-pill" data-testid=${opts.newTestid} @click=${opts.onNew}>
        ${icon('plus', 15)}${opts.newLabel}
      </button>
    </div>`;
  }

  /**
   * The commit row every inline form and guard ends with. A guard's commit is a
   * text button in the error ink: it is the destructive half of a refusal, and
   * the filled shape would read as the recommended way on.
   */
  private _renderFooter(opts: {
    lead?: unknown;
    cancelTestid: string;
    onCancel: () => void;
    testid: string;
    label: unknown;
    onCommit: () => void;
    disabled?: boolean;
    danger?: boolean;
  }) {
    return html`<div class="actions">
      ${opts.lead ?? null}
      <span class="spacer"></span>
      <button class="hv-text-button" data-testid=${opts.cancelTestid} @click=${opts.onCancel}>
        ${t('hv.action.cancel')}
      </button>
      <button
        class=${opts.danger ? 'hv-text-button danger' : 'hv-pill'}
        data-testid=${opts.testid}
        ?disabled=${opts.disabled ?? false}
        @click=${opts.onCommit}
      >
        ${opts.label}
      </button>
    </div>`;
  }

  /** Touch has no hover, so a row's actions live in a sheet instead of beside it. */
  private _renderActionSheet(
    testid: string,
    key: string,
    actions: {
      testid: string;
      glyph: IconName;
      label: unknown;
      trailing?: unknown;
      danger?: boolean;
      onPick: () => void;
    }[],
  ) {
    return keyed(
      key,
      html`<div class="expander" data-testid=${testid} ${ref(this._reveal)}>
        <div class="sheet-actions">
          ${actions.map(
            (a) => html`<button
              class=${a.danger ? 'danger' : ''}
              data-testid=${a.testid}
              @click=${a.onPick}
            >
              ${icon(a.glyph, 20)}${a.label}${a.trailing ?? null}
            </button>`,
          )}
        </div>
      </div>`,
    );
  }

  // ---------- Locations ----------
  private _findNode(nodes: LocationTreeNode[], id: string): LocationTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const deeper = this._findNode(node.children ?? [], id);
      if (deeper) return deeper;
    }
    return null;
  }

  private _startLocationEdit(id: string | 'new') {
    const node = id === 'new' ? null : this._findNode(this.st?.locationTreeCache ?? [], id);
    this._mergingLocation = null;
    this._sheetLocation = null;
    this._editingLocation = id;
    this._locName = node?.name ?? '';
    this._locArea = node?.area_id ?? null;
    this._locParent = node?.parent_id ?? null;
    this._parentPicker.close();
    this._locError = null;
    this._guard = null;
    this._copyFlash.reset();
  }

  private async _saveLocation() {
    const name = this._locName.trim();
    if (!name) {
      this._locError = t('hv.organize.locationNeedsName');
      return;
    }
    this._locError = null;
    try {
      if (this._editingLocation === 'new') {
        await this.store?.createLocation(name, this._locParent, this._locArea);
      } else if (this._editingLocation) {
        const node = this._findNode(this.st?.locationTreeCache ?? [], this._editingLocation);
        await this.store?.updateLocation(this._editingLocation, {
          name,
          areaId: this._locArea,
          // Re-parenting moves the whole subtree; sending it with the rename
          // keeps the edit to a single round trip.
          ...(node && (node.parent_id ?? null) !== this._locParent ? { newParentId: this._locParent } : {}),
        });
      }
      this._editingLocation = null;
    } catch (err) {
      this._locError =
        (err as { message?: string })?.message ?? t('hv.organize.locationSaveFailed');
    }
  }

  private async _deleteLocation(node: LocationTreeNode) {
    const children = node.children?.length ?? 0;
    const items = node.subtree_item_count ?? 0;
    if (children > 0 || items > 0) {
      // Guard before asking the backend: it refuses a non-empty location, and
      // saying why up front beats surfacing a validation error after the fact.
      const parts: string[] = [];
      if (items) parts.push(counted(items, 'item'));
      if (children) parts.push(counted(children, 'subLocation'));
      this._guard = {
        locationId: node.id,
        message: t('hv.organize.locationStillHolds', {
          name: node.name,
          contents: parts.join(t('hv.import.and')),
        }),
      };
      return;
    }
    this._guard = null;
    try {
      await this.store?.deleteLocation(node.id);
    } catch (err) {
      this._guard = {
        locationId: node.id,
        message:
          (err as { message?: string })?.message ?? t('hv.organize.locationDeleteFailed'),
      };
    }
  }

  private _startLocationMerge(id: string) {
    this._editingLocation = null;
    this._sheetLocation = null;
    this._guard = null;
    this._rewrite = null;
    this._mergingLocation = id;
    this._mergeTarget = null;
    this._mergePicker.close();
  }

  /**
   * Fold one location into another and delete it.
   *
   * There is no merge endpoint, so this is the three moves it decomposes into:
   * the items filed directly here are re-filed in one batch, each child subtree
   * is re-parented (which rewrites its descendants' paths server-side), and the
   * emptied location is deleted. The delete is skipped if anything before it
   * failed — a location that still holds items is refused, and reporting the
   * real reason beats a second, misleading error.
   */
  private async _runLocationMerge(source: LocationTreeNode, targetId: string) {
    const kind: RewriteKind = 'merge';
    this._mergingLocation = null;
    this._rewrite = { kind, done: 0, total: 0, failed: [], finished: false, error: null };

    let items: Item[];
    try {
      items = (await this.store?.listAllMatching({ location_id: source.id, include_subtree: false })) ?? [];
    } catch (err) {
      this._rewrite = {
        kind,
        done: 0,
        total: 0,
        failed: [],
        finished: true,
        error: (err as { message?: string })?.message ?? t('hv.organize.locationReadFailed'),
      };
      return;
    }

    const ops = items.map((i) =>
      makeBulkOp('item_move', { item_id: i.id, location_id: targetId, expected_version: i.version }),
    );
    this._rewrite = { kind, done: 0, total: ops.length, failed: [], finished: false, error: null };
    const outcome = ops.length
      ? await this.store?.bulkExecute(ops, {
          onProgress: (done, total) => {
            this._rewrite = { kind, done, total, failed: [], finished: false, error: null };
          },
        })
      : undefined;
    const failed = outcome?.failed ?? [];

    let error: string | null = null;
    if (!failed.length) {
      try {
        for (const child of source.children ?? []) {
          await this.store?.moveLocationSubtree(child.id, targetId);
        }
        await this.store?.deleteLocation(source.id);
      } catch (err) {
        error =
          (err as { message?: string })?.message ??
          t('hv.organize.mergeMovedNotRemoved', { name: source.name });
      }
    } else {
      error = t('hv.organize.mergeKeptSource', {
        name: source.name,
        items: counted(failed.length, 'item'),
      });
    }

    this._rewrite = { kind, done: ops.length, total: ops.length, failed, finished: true, error };
  }

  // ---------- Categories & tags ----------
  private get _kind(): ValueKind {
    return this.tab === 'tags' ? 'tag' : 'category';
  }

  private get _values(): DistinctValue[] {
    const distinct = this.st?.distinctValuesCache;
    const list = this.tab === 'tags' ? (distinct?.tags ?? []) : (distinct?.categories ?? []);
    const needle = this._filter.trim().toLowerCase();
    return needle ? list.filter((v) => v.value.toLowerCase().includes(needle)) : list;
  }

  /** Singular noun for the tab, for button labels and messages. */
  private get _noun(): string {
    return this.tab === 'tags' ? t('hv.organize.noun.tag') : t('hv.organize.noun.category');
  }

  /** Plural noun for the tab, for the two sentences that count its values. */
  private get _plural(): string {
    return this.tab === 'tags' ? t('hv.organize.plural.tags') : t('hv.organize.plural.categories');
  }

  /**
   * One value of whichever facet the open tab manages, chipped the way the rest
   * of the card chips it: a tag blue and marked, a category neutral.
   */
  private _valueChip(value: string, opts: { style?: string; testid?: string } = {}) {
    const style = opts.style ?? '';
    const testid = opts.testid ?? '';
    return this.tab === 'tags'
      ? html`<span class="hv-chip tag" style=${style} data-testid=${testid}>${tagLabel(value)}</span>`
      : html`<span class="hv-chip" style=${style} data-testid=${testid}>${value}</span>`;
  }

  /** True while the value exists only on the card, with no item carrying it. */
  private _isDraft(value: string): boolean {
    return this.store?.isDraftValue(this._kind, value) ?? false;
  }

  private _createValue() {
    const name = this._newValue.trim();
    if (!name) {
      this._newValueError = t('hv.organize.valueNeedsName', { noun: this._noun });
      return;
    }
    if (!this.store?.addDraftValue(this._kind, name)) {
      this._newValueError = t('hv.organize.valueExists', { name });
      return;
    }
    this._creatingValue = false;
    this._newValue = '';
    this._newValueError = null;
  }

  private _startValueEdit(value: string, mode: 'rename' | 'merge') {
    this._editingValue = { value, mode };
    this._sheetValue = null;
    this._rewrite = null;
    // The list belongs to the row being opened, so it starts shut and unfiltered
    // however the last one was left.
    this._valuePicker.close();
    if (mode === 'merge') {
      // Pre-fill the closest existing value, which is usually the typo fix.
      this._valueDraft = closestMatch(value, this._otherValues(value)) ?? '';
    } else {
      this._valueDraft = value;
    }
  }

  /** Fetch every affected item, then rewrite them in one chunked batch. */
  private async _runRewrite(from: string, to: string | null, rewrite: RewriteKind) {
    const kind = this._kind;
    this._rewrite = { kind: rewrite, done: 0, total: 0, failed: [], finished: false };
    let items;
    try {
      items = (await this.store?.listAllMatching(filterForValue(kind, from))) ?? [];
    } catch {
      this._rewrite = { kind: rewrite, done: 0, total: 0, failed: [], finished: true };
      return;
    }
    const ops = rewriteOps(kind, items, from, to);
    if (!ops.length) {
      this._rewrite = { kind: rewrite, done: 0, total: 0, failed: [], finished: true };
      this._editingValue = null;
      return;
    }

    this._rewrite = { kind: rewrite, done: 0, total: ops.length, failed: [], finished: false };
    const outcome = await this.store?.bulkExecute(ops, {
      onProgress: (done, total) => {
        this._rewrite = {
          kind: rewrite,
          done,
          total,
          failed: this._rewrite?.failed ?? [],
          finished: false,
        };
      },
    });
    this._rewrite = {
      kind: rewrite,
      done: ops.length,
      total: ops.length,
      failed: outcome?.failed ?? [],
      finished: true,
    };
    this._editingValue = null;
    await this.store?.refreshDistinctValues().catch(() => undefined);
  }

  private _showValue(value: string) {
    // Filtering by a value is the list's job, so hand it back and get out of the way.
    if (this.tab === 'tags') this.store?.setFilters({ tags: [value], tagsMode: 'any' });
    else this.store?.setFilters({ categories: [value] });
    this._browse();
  }

  private _showLocation(locationId: string | null) {
    if (!locationId) return;
    this.store?.setFilters({ locationIds: [locationId], orphansOnly: false });
    this._browse();
  }

  /**
   * Close, asking the host for the expanded surface.
   *
   * This dialog is full-screen, so returning to the small card to look at what
   * you just picked means expanding again straight away.
   */
  private _browse() {
    this.dispatchEvent(new CustomEvent('browse', { bubbles: true, composed: true }));
    this._close();
  }

  // ---------- Render ----------
  /**
   * The consequence of the area select, spelled out before Save.
   *
   * An area belongs to a location tree, not to a location: assigning one moves it
   * to the tree's root and clears every node below, and clearing one empties the
   * tree. Both reach locations the editor does not show.
   */
  private _renderAreaPreview(preview: AreaChangePreview) {
    const areas = this.st?.areasCache?.areas ?? [];
    const chip = renderAreaChip(areaNameById(areas, preview.effectiveAreaId));
    const wholeTree = preview.treeSize > 1 && preview.rootName !== null;
    const size = counted(preview.treeSize, 'location');
    // The chip is an element, so the sentence around it is split at the
    // placeholder rather than interpolated as text.
    const around = (key: TranslationKey, params?: Record<string, string | number>) => {
      const [before, after] = t(key, { ...params, chip: '\u0000' }).split('\u0000');
      return html`${before}${chip}${after}`;
    };

    let line;
    if (preview.kind === 'assign-root') {
      line = wholeTree
        ? html`${around('hv.organize.areaAssignTree', {
            root: preview.rootName ?? '',
            size,
          })}${preview.editsRoot
            ? ''
            : t('hv.organize.areaStoredOnRoot', { root: preview.rootName ?? '' })}`
        : around('hv.organize.areaAssignOne');
    } else if (preview.kind === 'clear-tree') {
      line = wholeTree
        ? html`${t('hv.organize.areaClearTree', { root: preview.rootName ?? '', size })}`
        : html`${t('hv.organize.areaClearOne')}`;
    } else if (this._locArea === null && preview.effectiveAreaId !== null) {
      // Nothing to warn about — the save is a no-op — but a location that stores no
      // area of its own still resolves to one, and the empty option it sits on says
      // only where that comes from, never which area it is.
      line = around('hv.organize.areaInherited');
    } else {
      return null;
    }

    return html`<span class="note" data-testid="location-area-preview">${line}</span>`;
  }

  /**
   * What the parent button reads.
   *
   * A top-level location names the area it is filed under as well: the picker
   * sets both, and the button would otherwise look untouched after an area was
   * chosen in it.
   */
  private _parentLabel(parent: LocationTreeNode | null, areas: readonly AreaRef[]): string {
    if (parent) return parent.name;
    const areaName = areaNameById(areas, this._locArea);
    return areaName
      ? t('hv.organize.topLevelIn', { area: areaName })
      : t('hv.organize.topLevel');
  }

  private _renderLocationEditor(nodeId: string | 'new') {
    const tree = this.st?.locationTreeCache ?? [];
    const node = nodeId === 'new' ? null : this._findNode(tree, nodeId);
    const parent = this._locParent ? this._findNode(tree, this._locParent) : null;
    const areas = this.st?.areasCache?.areas ?? [];
    // The backend holds a tree's area on its root and resolves it downwards, so a nested
    // location's effective area comes from the tree rather than from its immediate parent
    // — naming the parent here would point at the wrong node. A top-level location has
    // nothing above it to resolve from, so for it the empty value just means no area.
    const areaDefaultLabel = parent
      ? t('hv.organize.areaInherit')
      : t('hv.term.noArea');
    const preview = areaChangePreview(
      this.st?.locationsFlatCache ?? [],
      { id: nodeId === 'new' ? null : nodeId, parentId: this._locParent },
      this._locArea,
    );

    return keyed(
      nodeId,
      html`<div class="expander" data-testid="location-editor" data-field="location-name" ${ref(this._reveal)}>
        <div class="grid2">
          <div class="cell ${areas.length ? '' : 'wide'}">
            <label class="hv-label" for="org-loc-name">${t('hv.field.name')}</label>
            <input
              id="org-loc-name"
              class="control"
              data-testid="location-name"
              .value=${this._locName}
              @input=${(e: Event) => {
                this._locName = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          ${
            // An inventory whose Home Assistant defines no areas has nothing to pick
            // from, and the select would offer its own empty option alone.
            areas.length
              ? html`<div class="cell">
                  <label class="hv-label" for="org-loc-area">${t('hv.organize.locationArea')}</label>
                  <select
                    id="org-loc-area"
                    class="control"
                    data-testid="location-area"
                    @change=${(e: Event) => {
                      this._locArea = (e.target as HTMLSelectElement).value || null;
                    }}
                  >
                    <option value="" ?selected=${!this._locArea}>${areaDefaultLabel}</option>
                    ${areas.map(
                      (a) => html`<option value=${a.id} ?selected=${this._locArea === a.id}>${a.name}</option>`,
                    )}
                  </select>
                  ${this._renderAreaPreview(preview)}
                </div>`
              : null
          }
          <div class="cell wide">
            <span class="hv-label">
              ${t('hv.organize.parentLocation')}
              <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--hv-text-tertiary)">
                ${t('hv.organize.parentLocationNote')}
              </span>
            </span>
            ${this._parentPicker.render(
              {
                triggerClass: 'control',
                testid: 'location-parent',
                holderId: LOC_PARENT_TREE_ID,
                trigger: html`${icon('mapMarker', 15)}<span class="value"
                    >${this._parentLabel(parent, areas)}</span
                  >${icon('chevronDown', 15)}`,
              },
              () => html`<hv-location-tree
                data-testid="location-parent-tree"
                .nodes=${tree}
                .areas=${areas}
                .selectedId=${this._locParent}
                .selectedAreaId=${this._locParent === null ? this._locArea : null}
                .excludeSubtreeOf=${node?.id ?? null}
                showAll
                allLabel=${t('hv.organize.topLevel')}
                areaSelectable
                showEmptyAreas
                @select=${(e: CustomEvent) => {
                  this._locParent = (e.detail as { locationId: string | null }).locationId;
                }}
                @select-area=${(e: CustomEvent) => {
                  // An area heads the top level rather than sitting in the tree,
                  // so picking one is both halves of the move: out to the top
                  // level, and into that area.
                  this._locParent = null;
                  this._locArea = (e.detail as { areaId: string }).areaId;
                }}
              ></hv-location-tree>`,
            )}
          </div>
          ${
            // haventory.item_create and location_create take this string as
            // location_id / parent_id. A location that has not been saved yet has
            // none, so the create form says nothing rather than showing a blank.
            nodeId === 'new'
              ? null
              : html`<div class="cell wide">
                  <span class="hv-label">${t('hv.term.id')}</span>
                  <div class="id-row">
                    <code data-testid="location-id">${nodeId}</code>
                    <button
                      class="hv-text-button"
                      data-testid="location-copy-id"
                      @click=${() => void this._copyFlash.copy(nodeId)}
                    >
                      ${this._copyFlash.copied ? t('hv.action.copied') : t('hv.action.copy')}
                    </button>
                  </div>
                </div>`
          }
        </div>
        ${this._locError
          ? html`<div class="failure" role="alert" data-testid="location-error">${this._locError}</div>`
          : null}
        ${this._renderFooter({
          lead: node
            ? html`<button
                class="hv-text-button danger"
                data-testid="location-delete"
                @click=${() => void this._deleteLocation(node)}
              >
                ${t('hv.action.delete')}
              </button>`
            : null,
          cancelTestid: 'location-cancel',
          onCancel: () => {
            this._editingLocation = null;
          },
          testid: 'location-save',
          label: t('hv.action.save'),
          onCommit: () => void this._saveLocation(),
        })}
      </div>`,
    );
  }

  private _renderLocationSheet(node: LocationTreeNode) {
    const count = node.subtree_item_count ?? 0;
    return this._renderActionSheet('location-sheet', node.id, [
      {
        testid: 'location-sheet-show',
        glyph: 'magnify',
        label: t('hv.organize.showItems', { items: counted(count, 'item') }),
        onPick: () => this._showLocation(node.id),
      },
      {
        testid: 'location-sheet-edit',
        glyph: 'pencil',
        label: t('hv.organize.editEllipsis'),
        onPick: () => this._startLocationEdit(node.id),
      },
      {
        testid: 'location-sheet-merge',
        glyph: 'callMerge',
        label: t('hv.organize.mergeIntoEllipsis'),
        onPick: () => this._startLocationMerge(node.id),
      },
      {
        testid: 'location-sheet-delete',
        glyph: 'del',
        label: t('hv.action.delete'),
        danger: true,
        onPick: () => {
          this._sheetLocation = null;
          void this._deleteLocation(node);
        },
      },
    ]);
  }

  /** The merge step: pick where this location's contents should end up. */
  private _renderLocationMerge(source: LocationTreeNode) {
    const tree = this.st?.locationTreeCache ?? [];
    const target = this._mergeTarget ? this._findNode(tree, this._mergeTarget) : null;
    const items = source.direct_item_count ?? 0;
    const children = source.children?.length ?? 0;
    const parts = [counted(items, 'item')];
    if (children) parts.push(counted(children, 'subLocation'));

    return html`<div class="expander" data-testid="location-merge">
      <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
        <span class="hv-chip" style="text-decoration: line-through">${source.name}</span>
        ${icon('arrowRight', 18)}
        ${this._mergePicker.renderTrigger({
          triggerClass: 'control grow',
          testid: 'merge-target',
          holderId: MERGE_TARGET_TREE_ID,
          trigger: html`${icon('mapMarker', 15)}<span class="value"
              >${target?.name ?? t('hv.organize.mergeIntoPlaceholder')}</span
            >${icon('chevronDown', 15)}`,
        })}
      </div>
      ${this._mergePicker.renderHolder(
        { holderId: MERGE_TARGET_TREE_ID },
        () => html`<hv-location-tree
          data-testid="merge-target-tree"
          .nodes=${tree}
          .areas=${this.st?.areasCache?.areas ?? []}
          .selectedId=${this._mergeTarget}
          .excludeSubtreeOf=${source.id}
          @select=${(e: CustomEvent) => {
            this._mergeTarget = (e.detail as { locationId: string | null }).locationId;
          }}
        ></hv-location-tree>`,
      )}
      <span class="note" data-testid="merge-effect">
        ${target
          ? t('hv.organize.mergeEffect', {
              contents: parts.join(t('hv.import.and')),
              target: target.name,
              source: source.name,
            })
          : // An area heads the tree without being part of it and holds no items
            // of its own, so it is the one row here that cannot take a merge.
            // Editing the location is where a whole subtree moves into an area.
            `${t('hv.organize.mergePickLocation')}${
              (this.st?.areasCache?.areas?.length ?? 0) > 0
                ? t('hv.organize.mergeAreasNote')
                : ''
            }`}
      </span>
      ${this._renderFooter({
        cancelTestid: 'merge-cancel',
        onCancel: () => {
          this._mergingLocation = null;
        },
        testid: 'merge-apply',
        label: t('hv.action.merge'),
        disabled: !this._mergeTarget,
        onCommit: () => {
          if (this._mergeTarget) void this._runLocationMerge(source, this._mergeTarget);
        },
      })}
    </div>`;
  }

  private _renderLocationsTab() {
    const tree = this.st?.locationTreeCache ?? [];
    const merging = this._mergingLocation ? this._findNode(tree, this._mergingLocation) : null;
    const sheeted = this._sheetLocation ? this._findNode(tree, this._sheetLocation) : null;
    // Counted at every depth and against the filter, exactly as the other two
    // tabs count their values, so all three tabs state a total in one idiom.
    const count = countLocations(tree, this._filter);
    return html`
      ${this._renderToolbar({
        search: {
          label: t('hv.organize.filterLocations'),
          placeholder: t('hv.organize.filterLocationsPlaceholder'),
        },
        count: counted(count, 'location'),
        countTestid: 'organize-location-count',
        newTestid: 'organize-new-location',
        newLabel: t('hv.fullView.newLocation'),
        onNew: () => this._startLocationEdit('new'),
      })}
      <div class="body">
        ${this._editingLocation === 'new' ? this._renderLocationEditor('new') : null}
        ${this._rewrite ? this._renderRewrite() : null}
        <hv-location-tree
          data-testid="organize-tree"
          manage
          showCounts
          ?mobile=${this.mobile}
          .nodes=${tree}
          .areas=${this.st?.areasCache?.areas ?? []}
          .filterText=${this._filter}
          @select=${(e: CustomEvent) =>
            this._showLocation((e.detail as { locationId: string | null }).locationId)}
          @edit-location=${(e: CustomEvent) =>
            this._startLocationEdit((e.detail as { locationId: string }).locationId)}
          @merge-location=${(e: CustomEvent) =>
            this._startLocationMerge((e.detail as { locationId: string }).locationId)}
          @more-location=${(e: CustomEvent) => {
            const { locationId } = e.detail as { locationId: string };
            this._sheetLocation = this._sheetLocation === locationId ? null : locationId;
            this._editingLocation = null;
            this._mergingLocation = null;
          }}
          @delete-location=${(e: CustomEvent) => {
            const node = (e.detail as { node: LocationTreeNode }).node;
            void this._deleteLocation(node);
          }}
        ></hv-location-tree>
        ${sheeted ? this._renderLocationSheet(sheeted) : null}
        ${merging ? this._renderLocationMerge(merging) : null}
        ${this._editingLocation && this._editingLocation !== 'new'
          ? this._renderLocationEditor(this._editingLocation)
          : null}
        ${this._guard
          ? keyed(
              this._guard.locationId,
              html`<div class="guard" role="alert" data-testid="location-guard" ${ref(this._reveal)}>
                <span class="guard-mark">${icon('alert', 17)}</span>
                <span>${this._guard.message}</span>
              </div>`,
            )
          : null}
      </div>
    `;
  }

  /** What the status line says, in as few words as the outcome allows. */
  private _rewriteSummary(rewrite: RewriteState): string {
    if (!rewrite.finished)
      return t(`hv.organize.rewrite.running.${rewrite.kind}`, {
        done: rewrite.done,
        total: rewrite.total,
      });
    if (!rewrite.total) return t(`hv.organize.rewrite.nothing.${rewrite.kind}`);
    const done = rewrite.total - rewrite.failed.length;
    const total = counted(rewrite.total, 'item');
    // The partial case is the only one that needs both numbers.
    if (rewrite.failed.length)
      return t(`hv.organize.rewrite.partial.${rewrite.kind}`, { done, total });
    return t(`hv.organize.rewrite.done.${rewrite.kind}`, { total });
  }

  private _renderRewrite() {
    const rewrite = this._rewrite;
    if (!rewrite) return null;
    const pct = rewrite.total ? Math.round((rewrite.done / rewrite.total) * 100) : 100;
    const trouble = rewrite.failed.length > 0 || !!rewrite.error;
    return html`<div class="expander" data-testid="rewrite-status">
      <div style="display:flex;gap:8px;font-size:12.5px">
        <span data-testid="rewrite-label">${this._rewriteSummary(rewrite)}</span>
        ${rewrite.failed.length
          ? html`<span style="margin-left:auto" data-testid="rewrite-failed"
              >${t('hv.bulk.progressFailed', { count: rewrite.failed.length })}</span
            >`
          : null}
      </div>
      ${rewrite.finished ? null : html`<div class="track"><div class="fill" style="width:${pct}%"></div></div>`}
      ${rewrite.error
        ? html`<div class="failure" role="alert" data-testid="rewrite-error">
            ${icon('alertCircle', 16)}<span>${rewrite.error}</span>
          </div>`
        : null}
      ${rewrite.failed.map(
        (f) => html`<div class="failure" data-testid="rewrite-failure">
          ${icon('alertCircle', 16)}<span
            >${t('hv.organize.rewriteFailure', {
              itemId: f.itemId ?? '',
              reason: describeFailure(f),
            })}</span
          >
        </div>`,
      )}
      ${
        // Only worth saying while it can still be interrupted, or when something
        // did go wrong and "how much of this stands?" is a live question.
        rewrite.finished && !trouble
          ? null
          : html`<span class="note">${t('hv.organize.rewriteNote')}</span>`
      }
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="rewrite-dismiss"
          @click=${() => {
            this._rewrite = null;
          }}
        >
          ${t('hv.action.dismissEntry')}
        </button>
      </div>
    </div>`;
  }

  /**
   * The other values of the open tab, which is what a merge can land on.
   *
   * A value merged into itself is a no-op the Merge button would still offer,
   * so the source is not among them.
   */
  private _otherValues(value: string): string[] {
    return (
      this.tab === 'tags'
        ? (this.st?.distinctValuesCache?.tags ?? [])
        : (this.st?.distinctValuesCache?.categories ?? [])
    )
      .map((v) => v.value)
      .filter((v) => v !== value);
  }

  /** The tab's value as the merge target field prints it: a tag wears its mark. */
  private _valueText(value: string) {
    return this.tab === 'tags' ? tagLabel(value) : value;
  }

  /**
   * What the merge target is set to, on the button that opens the list.
   *
   * The trigger and its list are the two halves of one control, drawn apart
   * because the row above holds the struck source and the arrow and the list
   * takes the full width under them.
   */
  private _renderValueTargetTrigger(others: string[]) {
    const picked = this._valueDraft.trim();
    return this._valuePicker.renderTrigger({
      triggerClass: 'control grow',
      testid: 'value-target',
      title: t('hv.organize.mergeInto'),
      disabled: !others.length,
      holderId: MERGE_VALUE_LIST_ID,
      trigger: html`<span class="value"
          >${picked ? this._valueText(picked) : t('hv.organize.mergeIntoPlaceholder')}</span
        >${icon('chevronDown', 15)}`,
    });
  }

  /**
   * The values a merge can land on, as the card's own elements.
   *
   * A native `<datalist>` draws its suggestions as browser chrome, and the Home
   * Assistant companion app's Android WebView draws none at all: the field
   * there opens nothing, and a household on a phone has no way to name a
   * target. It is a pick rather than free text — a merge lands on a value that
   * already exists, and typing one that does not is what rename is for.
   */
  private _renderValueTargetList(others: string[]) {
    const picked = this._valueDraft.trim();
    const needle = this._valueFilter.trim().toLowerCase();
    const shown = needle ? others.filter((v) => v.toLowerCase().includes(needle)) : others;
    return this._valuePicker.renderHolder(
      { holderId: MERGE_VALUE_LIST_ID },
      () => html`
        ${others.length > VALUE_FILTER_FROM
          ? html`<label class="list-filter">
              <span class="hv-sr-only">${t('hv.organize.filterValues', { values: this._plural })}</span>
              <input
                class="control"
                data-testid="value-target-filter"
                placeholder=${t('hv.organize.filterValuesPlaceholder', { values: this._plural })}
                .value=${this._valueFilter}
                @input=${(e: Event) => {
                  this._valueFilter = (e.target as HTMLInputElement).value;
                }}
              />
            </label>`
          : null}
        ${shown.length
          ? shown.map(
              (v) => html`<button
                class="option"
                data-testid="value-target-option"
                data-value=${v}
                aria-pressed=${String(v === picked)}
                @click=${() => {
                  this._valueDraft = v;
                  this._valuePicker.close();
                }}
              >
                <span class="label">${this._valueText(v)}</span>
                ${v === picked ? icon('check', 15) : null}
              </button>`,
            )
          : html`<div class="option-empty" data-testid="value-target-none">
              ${t('hv.organize.noValuesMatch', { values: this._plural })}
            </div>`}
      `,
    );
  }

  private _renderValueEditor(value: string, count: number) {
    const editing = this._editingValue!;
    const merging = editing.mode === 'merge';
    const others = merging ? this._otherValues(value) : [];
    const target = this._valueDraft.trim();

    return keyed(
      `${editing.mode}:${value}`,
      html`<div
        class="expander"
        data-testid="value-editor"
        data-mode=${editing.mode}
        data-field="value-target"
        ${ref(this._reveal)}
      >
        <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
          ${this._valueChip(value, { style: merging ? 'text-decoration: line-through' : undefined })}
          <span style="font-size:12.5px;color:var(--hv-text-secondary)">${counted(count, 'item')}</span>
          ${merging
            ? html`${icon('arrowRight', 18)}${this._renderValueTargetTrigger(others)}`
            : html`<label style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px">
                <span class="hv-sr-only">${t('hv.organize.newName')}</span>
                <input
                  class="control"
                  data-testid="value-target"
                  placeholder=${t('hv.organize.newNamePlaceholder')}
                  .value=${this._valueDraft}
                  @input=${(e: Event) => {
                    this._valueDraft = (e.target as HTMLInputElement).value;
                  }}
                />
              </label>`}
        </div>
        ${merging ? this._renderValueTargetList(others) : null}
        <span class="note" data-testid="value-effect">
          ${merging && !others.length
            ? t('hv.organize.mergeNoOther', { values: this._plural })
            : target
              ? describeRewrite(this._kind, count, value, target)
              : t('hv.organize.pickNameToContinue')}
        </span>
        ${this._renderFooter({
          cancelTestid: 'value-cancel',
          onCancel: () => {
            this._editingValue = null;
          },
          testid: 'value-apply',
          label: merging ? t('hv.action.merge') : t('hv.action.rename'),
          disabled: !target || target === value,
          onCommit: () => void this._runRewrite(value, target, merging ? 'merge' : 'rename'),
        })}
      </div>`,
    );
  }

  private _renderValueCreator() {
    return html`<div class="expander" data-testid="value-create">
      <label style="display:flex;align-items:center;gap:8px">
        <span class="hv-sr-only">${t('hv.organize.newValue', { noun: this._noun })}</span>
        <input
          class="control"
          data-testid="new-value-name"
          placeholder=${t('hv.organize.newValuePlaceholder', { noun: this._noun })}
          .value=${this._newValue}
          @input=${(e: Event) => {
            this._newValue = (e.target as HTMLInputElement).value;
            this._newValueError = null;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') this._createValue();
          }}
        />
      </label>
      ${this._newValueError
        ? html`<div class="failure" role="alert" data-testid="new-value-error">${this._newValueError}</div>`
        : null}
      <span class="note">${t('hv.organize.draftNote', { noun: this._noun })}</span>
      ${this._renderFooter({
        cancelTestid: 'new-value-cancel',
        onCancel: () => {
          this._creatingValue = false;
          this._newValueError = null;
        },
        testid: 'new-value-create',
        label: t('hv.action.create'),
        disabled: !this._newValue.trim(),
        onCommit: () => this._createValue(),
      })}
    </div>`;
  }

  // ---------- Statuses ----------

  /** The live vocabulary, or the built-ins until `haventory/config` answers. */
  private get _statusDefs(): readonly StatusDefinition[] {
    return statusList(this.st?.statuses);
  }

  /**
   * How many items carry a slug.
   *
   * Every row here names a status this dialog just listed, so a slug the counts
   * cannot price is one the payload has not caught up with — a row reading
   * "0 items" for the moment it takes is better than a row with no count at
   * all, because the count doubles as this tab's link into the items.
   */
  private _statusCount(slug: string): number {
    return statusCount(this.st?.statsCounts, slug) ?? 0;
  }

  /**
   * The label of the status the one being typed would duplicate, or null.
   *
   * Two statuses labelled the same are indistinguishable in every row badge,
   * filter chip and select on the card — only the slug tells them apart, and
   * the slug is what the editor hides. The status being edited is excluded:
   * keeping its own name is not a collision.
   *
   * Compared against what each status *displays*, not what it stores: a reader
   * in German sees "Fehlt" on the chips, and typing that word is the collision
   * they would have to live with. The stored English behind it is not on any
   * screen, so a warning about it would name a word nobody can see.
   */
  private get _duplicateLabel(): string | null {
    const typed = this._statusLabel.trim().toLowerCase();
    if (!typed) return null;
    const editing = this._editingStatus;
    const clash = this._statusDefs.find(
      (d) => d.slug !== editing && displayLabel(d).trim().toLowerCase() === typed,
    );
    return clash ? displayLabel(clash) : null;
  }

  private _startStatusEdit(slug: string | 'new') {
    const existing = slug === 'new' ? undefined : this._statusDefs.find((d) => d.slug === slug);
    this._editingStatus = slug;
    // The stored label, never the displayed one. The box is what `_saveStatus`
    // writes: seeded with a translation, a German household that opened this
    // editor and pressed save would rename the built-in three for everyone,
    // English readers included, and no language could translate them again.
    this._statusLabel = existing?.label ?? '';
    this._statusColor = existing?.color ?? 'neutral';
    this._statusIcon = existing?.icon ?? 'check';
    this._statusError = null;
    this._statusGuard = null;
  }

  private _cancelStatusEdit() {
    this._editingStatus = null;
    this._statusError = null;
  }

  private async _saveStatus() {
    const label = this._statusLabel.trim();
    if (!label) return;
    const editing = this._editingStatus;
    try {
      if (editing === 'new') {
        await this.store?.createStatus({
          slug: slugFromLabel(label, this.st?.statuses),
          label,
          color: this._statusColor,
          icon: this._statusIcon,
        });
      } else if (editing) {
        await this.store?.updateStatus(editing, {
          label,
          color: this._statusColor,
          icon: this._statusIcon,
        });
      }
      this._editingStatus = null;
      this._statusError = null;
    } catch (err) {
      this._statusError =
        (err as { message?: string })?.message ?? t('hv.organize.statusSaveFailed');
    }
  }

  /**
   * Move a status one place. `status/reorder` takes the whole permutation, so a
   * partial list cannot leave two definitions claiming one position.
   */
  private async _moveStatus(slug: string, delta: -1 | 1) {
    const slugs = this._statusDefs.map((d) => d.slug);
    const from = slugs.indexOf(slug);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= slugs.length) return;
    [slugs[from], slugs[to]] = [slugs[to], slugs[from]];
    try {
      await this.store?.reorderStatuses(slugs);
    } catch (err) {
      this._statusError =
        (err as { message?: string })?.message ?? t('hv.organize.statusReorderFailed');
    }
  }

  /**
   * Ask before deleting, in one idiom whichever branch it is.
   *
   * Both branches open the same inline disclosure: the in-use one carries the
   * reassign select — the backend refuses a delete that would strand items, and
   * picking where they go turns that refusal into a completed move — and the
   * unused one carries the question alone. Split across a disclosure and a
   * modal, the consequential path takes the lighter ceremony.
   */
  private _askDeleteStatus(slug: string) {
    const count = this._statusCount(slug);
    this._statusGuard = { slug, count };
    this._reassignTarget = count > 0 ? (this._statusDefs.find((d) => d.slug !== slug)?.slug ?? '') : '';
  }

  /** Send the delete, reassigning the items that carry the slug if any do. */
  private async _deleteStatus(slug: string, reassignTo?: string) {
    try {
      await this.store?.deleteStatus(slug, reassignTo);
      this._statusGuard = null;
      this._statusError = null;
    } catch (err) {
      this._statusError =
        (err as { message?: string })?.message ?? t('hv.organize.statusDeleteFailed');
    }
  }

  private _renderStatusesTab() {
    const defs = this._statusDefs;
    return html`
      ${this._renderToolbar({
        count: counted(defs.length, 'status'),
        countTestid: 'organize-status-count',
        newTestid: 'organize-new-status',
        newLabel: t('hv.organize.newStatus'),
        onNew: () => this._startStatusEdit('new'),
      })}
      <div class="body">
        ${this._editingStatus === 'new' ? this._renderStatusEditor('new') : null}
        ${defs.map((d, index) => {
          const isDefault = d.slug === DEFAULT_STATUS;
          const count = this._statusCount(d.slug);
          // What the chip beside these buttons says, so a screen reader names
          // the row the same way the screen does.
          const shown = displayLabel(d);
          return html`
            <div class="value-row status-row" data-testid="status-row" data-value=${d.slug}>
              <span class="move">
                <button
                  data-testid="status-up"
                  aria-label=${t('hv.organize.statusMoveUp', { label: shown })}
                  title=${t('hv.term.moveUp')}
                  ?disabled=${index === 0}
                  @click=${() => this._moveStatus(d.slug, -1)}
                >
                  ${icon('chevronUp', 18)}
                </button>
                <button
                  data-testid="status-down"
                  aria-label=${t('hv.organize.statusMoveDown', { label: shown })}
                  title=${t('hv.term.moveDown')}
                  ?disabled=${index === defs.length - 1}
                  @click=${() => this._moveStatus(d.slug, 1)}
                >
                  ${icon('chevronDown', 18)}
                </button>
              </span>
              ${renderStatusChip(d.slug, defs, { testid: 'status-chip' })}
              <button class="count-link" data-testid="status-count" @click=${() =>
                this._showStatus(d.slug)}>
                ${counted(count, 'item')}
              </button>
              <span class="row-actions">
                ${isDefault
                  ? html`<span class="hv-chip quiet" data-testid="status-default"
                      >${t('hv.organize.statusDefault')}</span
                    >`
                  : null}
                <button
                  data-testid="status-edit"
                  aria-label=${t('hv.organize.statusEdit', { label: shown })}
                  title=${t('hv.action.edit')}
                  @click=${() => this._startStatusEdit(d.slug)}
                >
                  ${icon('pencil', 16)}
                </button>
                ${isDefault
                  ? null
                  : html`
                      <button
                        class="danger"
                        data-testid="status-remove"
                        aria-label=${t('hv.organize.statusDelete', { label: shown })}
                        title=${t('hv.action.delete')}
                        @click=${() => this._askDeleteStatus(d.slug)}
                      >
                        ${icon('del', 16)}
                      </button>
                    `}
              </span>
            </div>
            ${this._editingStatus === d.slug ? this._renderStatusEditor(d.slug) : null}
            ${this._statusGuard?.slug === d.slug ? this._renderStatusGuard() : null}
          `;
        })}
        ${this._statusError && !this._editingStatus
          ? html`<div class="failure" role="alert" data-testid="status-error">
              ${this._statusError}
            </div>`
          : null}
      </div>
    `;
  }

  /** Take the user to the items on a status, the way a value count does. */
  private _showStatus(slug: string) {
    this.store?.setFilters({ status: slug });
    this._browse();
  }

  private _renderStatusEditor(slug: string | 'new') {
    const creating = slug === 'new';
    const derived = creating ? slugFromLabel(this._statusLabel, this.st?.statuses) : slug;
    const duplicate = this._duplicateLabel;
    const glyph = knownIcon(this._statusIcon);
    const custom = isHexColor(this._statusColor) ? this._statusColor : null;
    // A built-in nobody has renamed stores English and prints the reader's
    // language, so for that reader the box and the chips say different words.
    // Showing what the box's text prints as is what stops the English in it
    // reading as a mistake to be corrected — correcting it is exactly the
    // rename that would take the translation away from everyone. Dropped as
    // soon as the box stops holding the stored label: from that keystroke on
    // it is a new name, and the translation no longer describes it.
    const stored = creating ? undefined : this._statusDefs.find((d) => d.slug === slug);
    const shown = stored ? displayLabel(stored) : null;
    const printsAs =
      stored && this._statusLabel === stored.label && shown !== stored.label ? shown : null;
    return keyed(
      slug,
      html`<div class="expander" data-testid="status-editor" data-field="status-label" ${ref(this._reveal)}>
        <label class="status-name">
          <span class="hv-sr-only">${t('hv.organize.statusName')}</span>
          <input
            class="control"
            data-testid="status-label"
            placeholder=${t('hv.organize.statusNamePlaceholder')}
            .value=${this._statusLabel}
            @input=${(e: Event) => {
              this._statusLabel = (e.target as HTMLInputElement).value;
              this._statusError = null;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') void this._saveStatus();
            }}
          />
          <span class="status-slug" data-testid="status-slug-preview" title=${derived}
            >${derived}</span
          >
          ${printsAs === null
            ? null
            : html`<span class="hv-chip quiet" data-testid="status-shown">${printsAs}</span>`}
        </label>
        ${duplicate
          ? html`<div class="hint" data-testid="status-duplicate-hint">
              ${t('hv.organize.statusDuplicate', { label: duplicate })}
            </div>`
          : null}

        <span class="hv-label">${t('hv.organize.colour')}</span>
        <div class="swatches" data-testid="status-colors">
          ${STATUS_COLORS.map(
            (c) => html`<button
              class="swatch hv-status-chip tone-${c.replace(/_/g, '-')} ${this._statusColor === c
                ? 'on'
                : ''}"
              data-testid="status-color"
              data-value=${c}
              aria-label=${c.replace(/_/g, ' ')}
              aria-pressed=${String(this._statusColor === c)}
              @click=${() => {
                this._statusColor = c;
              }}
            >
              ${glyph ? icon(glyph, 15) : html`<span class="letters">Aa</span>`}
            </button>`,
          )}
          <label
            class="swatch custom hv-status-chip ${custom ? 'on' : ''}"
            style=${ifDefined(custom ? hexToneStyle(custom) : undefined)}
            data-testid="status-color-custom"
          >
            <input
              type="color"
              data-testid="status-color-hex"
              aria-label=${t('hv.organize.customColour')}
              .value=${custom ?? CUSTOM_COLOR_SEED}
              @input=${(e: Event) => {
                this._statusColor = (e.target as HTMLInputElement).value.toLowerCase();
              }}
            />
            ${glyph ? icon(glyph, 15) : html`<span class="letters">Aa</span>`}
          </label>
        </div>
        ${custom
          ? html`<div class="hint" data-testid="status-color-custom-hint">
              ${t('hv.organize.customColourHint', { hex: custom })}
            </div>`
          : null}

        <span class="hv-label">${t('hv.organize.icon')}</span>
        <div class="swatches" data-testid="status-icons">
          ${STATUS_ICONS.map(
            (name) => html`<button
              class="glyph ${this._statusIcon === name ? 'on' : ''}"
              data-testid="status-icon"
              data-value=${name}
              aria-label=${name}
              aria-pressed=${String(this._statusIcon === name)}
              @click=${() => {
                this._statusIcon = name;
              }}
            >
              ${icon(name, 16)}
            </button>`,
          )}
        </div>

        ${this._statusError
          ? html`<div class="failure" role="alert" data-testid="status-editor-error">
              ${this._statusError}
            </div>`
          : null}
        ${this._renderFooter({
          cancelTestid: 'status-cancel',
          onCancel: () => this._cancelStatusEdit(),
          testid: 'status-save',
          label: creating ? t('hv.action.create') : t('hv.action.save'),
          disabled: !this._statusLabel.trim(),
          onCommit: () => this._saveStatus(),
        })}
      </div>`,
    );
  }

  private _renderStatusGuard() {
    const guard = this._statusGuard;
    if (!guard) return null;
    const label = statusLabel(guard.slug, this._statusDefs);
    const targets = this._statusDefs.filter((d) => d.slug !== guard.slug);
    const inUse = guard.count > 0;
    return keyed(
      guard.slug,
      html`<div
        class="expander guard status-guard"
        data-testid="status-guard"
        role="alert"
        ${ref(this._reveal)}
      >
        <span class="guard-message" data-testid="status-guard-message"
          >${inUse
            ? t('hv.organize.statusInUse', { label, items: counted(guard.count, 'item') })
            : t('hv.organize.statusUnused', { label })}</span
        >
        ${inUse
          ? html`<label class="guard-target">
              <span>${t('hv.organize.moveThoseItemsTo')}</span>
              <select
                class="control"
                data-testid="status-reassign"
                .value=${this._reassignTarget}
                @change=${(e: Event) => {
                  this._reassignTarget = (e.target as HTMLSelectElement).value;
                }}
              >
                ${targets.map((d) => html`<option value=${d.slug}>${displayLabel(d)}</option>`)}
              </select>
            </label>`
          : null}
        ${this._renderFooter({
          cancelTestid: 'status-guard-cancel',
          onCancel: () => {
            this._statusGuard = null;
          },
          testid: 'status-guard-confirm',
          label: inUse ? t('hv.organize.reassignAndDelete') : t('hv.action.delete'),
          danger: true,
          onCommit: () => void this._deleteStatus(guard.slug, inUse ? this._reassignTarget : undefined),
        })}
      </div>`,
    );
  }

  private _renderValuesTab() {
    const values = this._values;
    const noun = this._plural;
    return html`
      ${this._renderToolbar({
        search: {
          label: t('hv.organize.filterValues', { values: noun }),
          placeholder: t('hv.organize.filterValuesPlaceholder', { values: noun }),
        },
        count: counted(values.length, this.tab === 'tags' ? 'tag' : 'category'),
        countTestid: 'organize-value-count',
        newTestid: 'organize-new-value',
        newLabel: t('hv.organize.newValue', { noun: this._noun }),
        onNew: () => {
          this._creatingValue = true;
          this._newValue = '';
          this._newValueError = null;
          this._editingValue = null;
        },
      })}
      <div class="body">
        ${this._creatingValue ? this._renderValueCreator() : null}
        ${this._rewrite ? this._renderRewrite() : null}
        ${values.length
          ? values.map(
              (v) => html`
                <div class="value-row" data-testid="value-row" data-value=${v.value}>
                  ${this._valueChip(v.value)}
                  ${this._isDraft(v.value)
                    ? html`<span class="draft-note" data-testid="value-draft">
                        ${t('hv.organize.draftBadge')}
                      </span>`
                    : html`<button
                        class="count-link"
                        data-testid="value-count"
                        @click=${() => this._showValue(v.value)}
                      >
                        ${counted(v.count, 'item')}
                      </button>`}
                  <span class="row-actions">
                    ${this._isDraft(v.value)
                      ? html`<button
                          class="danger"
                          data-testid="value-discard"
                          aria-label=${t('hv.organize.discardValue', { value: v.value })}
                          title=${t('hv.action.discard')}
                          @click=${() => this.store?.removeDraftValue(this._kind, v.value)}
                        >
                          ${icon('del', 16)}
                        </button>`
                      : this.mobile
                      ? html`<button
                          data-testid="value-more"
                          aria-label=${t('hv.organize.actionsFor', { value: v.value })}
                          @click=${() => {
                            this._sheetValue = v.value;
                          }}
                        >
                          ${icon('dotsVertical', 17)}
                        </button>`
                      : html`
                          <button
                            data-testid="value-rename"
                            aria-label=${t('hv.organize.renameValue', { value: v.value })}
                            title=${t('hv.action.rename')}
                            @click=${() => this._startValueEdit(v.value, 'rename')}
                          >
                            ${icon('pencil', 16)}
                          </button>
                          <button
                            data-testid="value-merge"
                            aria-label=${t('hv.organize.mergeValue', { value: v.value })}
                            title=${t('hv.organize.mergeIntoAnother')}
                            @click=${() => this._startValueEdit(v.value, 'merge')}
                          >
                            ${icon('callMerge', 16)}
                          </button>
                          <button
                            class="danger"
                            data-testid="value-remove"
                            aria-label=${t('hv.organize.removeValue', { value: v.value })}
                            title=${t('hv.organize.removeFromEveryItem')}
                            @click=${() => {
                              this._confirmRemove = v.value;
                            }}
                          >
                            ${icon('del', 16)}
                          </button>
                        `}
                  </span>
                </div>
                ${this._editingValue?.value === v.value ? this._renderValueEditor(v.value, v.count) : null}
                ${this._sheetValue === v.value ? this._renderValueSheet(v.value, v.count) : null}
              `,
            )
          : html`<div class="empty" data-testid="organize-empty">
              ${this._filter.trim()
                ? t('hv.organize.noValuesMatch', { values: noun })
                : t('hv.organize.noValuesYet', { values: noun })}
            </div>`}
      </div>
    `;
  }

  private _renderValueSheet(value: string, count: number) {
    const suggestion = closestMatch(value, this._otherValues(value));
    return this._renderActionSheet('value-sheet', value, [
      {
        testid: 'sheet-show',
        glyph: 'magnify',
        label: t('hv.organize.showItems', { items: counted(count, 'item') }),
        onPick: () => this._showValue(value),
      },
      {
        testid: 'sheet-rename',
        glyph: 'pencil',
        label: t('hv.organize.renameEllipsis'),
        onPick: () => this._startValueEdit(value, 'rename'),
      },
      {
        testid: 'sheet-merge',
        glyph: 'callMerge',
        label: t('hv.organize.mergeIntoEllipsis'),
        trailing: suggestion
          ? this._valueChip(suggestion, {
              style: 'margin-left:auto',
              testid: 'sheet-merge-suggestion',
            })
          : null,
        onPick: () => this._startValueEdit(value, 'merge'),
      },
      {
        testid: 'sheet-remove',
        glyph: 'del',
        label: t('hv.organize.removeFromAllItems'),
        danger: true,
        onPick: () => {
          this._sheetValue = null;
          this._confirmRemove = value;
        },
      },
    ]);
  }

  /**
   * Focus for a closed delete confirmation whose ✕ refused the return: the ✕
   * sits in hover-revealed row actions and the pointer is on the confirmation
   * at that moment, so a real browser will not focus it. The row takes the
   * focus instead — `:focus-within` re-reveals its actions, and Tab continues
   * from the user's place in the list. The panel catches the row being gone,
   * which is what a confirmed removal leaves behind.
   */
  private _refocusConfirmRow = () => {
    const value = this._lastConfirmValue;
    // Matched on `dataset` rather than an attribute selector: a tag is free
    // text, and a quote in one ends the selector early.
    const row =
      value === null
        ? null
        : (Array.from(
            this.renderRoot.querySelectorAll<HTMLElement>('[data-testid="value-row"]'),
          ).find((r) => r.dataset.value === value) ?? null);
    const target = row ?? this.renderRoot.querySelector<HTMLElement>('[data-testid="organize-dialog"]');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  render() {
    if (!this.open) return null;
    const removeCount =
      this._values.find((v) => v.value === this._confirmRemove)?.count ??
      (this.tab === 'tags'
        ? (this.st?.distinctValuesCache?.tags ?? [])
        : (this.st?.distinctValuesCache?.categories ?? [])
      ).find((v) => v.value === this._confirmRemove)?.count ??
      0;

    return html`
      ${this._modal.render(
        { label: t('hv.organize.title'), testid: 'organize-dialog', onClose: this._close },
        html`
          <div class="head">
            ${this.mobile
              ? html`<button
                  class="hv-icon-button"
                  data-testid="organize-back"
                  aria-label=${t('hv.action.back')}
                  @click=${this._close}
                >
                  ${icon('arrowLeft', 21)}
                </button>`
              : null}
            <h2>${t('hv.organize.title')}</h2>
            ${this.mobile
              ? null
              : html`<button
                  class="hv-icon-button"
                  data-testid="organize-close"
                  aria-label=${t('hv.action.close')}
                  @click=${this._close}
                >
                  ${icon('close', 20)}
                </button>`}
          </div>
          <div class="tabs" role="tablist">
            ${(['locations', 'categories', 'tags', 'statuses'] as OrganizeTab[]).map(
              (tab) => html`<button
                class=${this.tab === tab ? 'on' : ''}
                role="tab"
                aria-selected=${String(this.tab === tab)}
                data-testid="organize-tab"
                data-tab=${tab}
                @click=${() => {
                  this.tab = tab;
                }}
              >
                ${t(`hv.field.${tab}`)}
              </button>`,
            )}
          </div>
          ${this.tab === 'locations'
            ? this._renderLocationsTab()
            : this.tab === 'statuses'
              ? this._renderStatusesTab()
              : this._renderValuesTab()}
        `,
      )}

      <!-- The confirmation answers to this dialog, and its answer stops here: it
           reports a dismissal as a cancel event, which is what a host listening
           on this element reads as "close Organize". Unstopped, backing out of
           one tag's delete takes the whole dialog down with it, and the caret
           the confirmation hands back lands behind a surface that is gone. -->
      <hv-confirm
        data-testid="organize-confirm"
        ?open=${this._confirmRemove !== null}
        ?mobile=${this.mobile}
        .heading=${t('hv.organize.removeHeading', {
          value: this._confirmRemove ?? '',
          items: counted(removeCount, 'item'),
        })}
        .message=${t('hv.organize.removeMessage')}
        .confirmLabel=${t('hv.action.remove')}
        destructive
        .onOpenerGone=${this._refocusConfirmRow}
        @confirm=${(e: Event) => {
          e.stopPropagation();
          const value = this._confirmRemove;
          this._lastConfirmValue = value;
          this._confirmRemove = null;
          if (value) void this._runRewrite(value, null, 'remove');
        }}
        @cancel=${(e: Event) => {
          e.stopPropagation();
          this._lastConfirmValue = this._confirmRemove;
          this._confirmRemove = null;
        }}
      ></hv-confirm>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-organize-dialog': HVOrganizeDialog;
  }
}
