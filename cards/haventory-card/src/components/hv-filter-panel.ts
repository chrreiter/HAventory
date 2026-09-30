import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { tokens, base } from '../ui/tokens';
import { chip, tagLabel } from '../ui/chip';
import { locationPathParts, pathLabel } from '../ui/location-path';
import { icon } from '../ui/icons';
import { LocationPicker } from '../ui/location-picker';
import { counted } from '../ui/plural';
import { activeFilterCount, defaultFilters } from '../store/store';
import { DEFAULT_STATUS, statusCount, statusLabel, statusList, statusTone } from '../ui/status';
import type { DistinctValue, DistinctValues, Location, LocationTreeNode, SortField, StatsCounts, StatusDefinition, StoreFilters } from '../store/types';

/** Sort fields the backend supports, in the order the menu lists them. */
const SORT_FIELDS: readonly SortField[] = [
  'updated_at',
  'created_at',
  'name',
  'quantity',
  'due_date',
  'inspection_date',
  'reminder_date',
  'location',
];

/** How many category chips to show before collapsing the rest behind "More…". */
const CATEGORY_CHIP_LIMIT = 4;

/** The same for tags, of which a household names more: two rows at phone width. */
const TAG_CHIP_LIMIT = 8;

/**
 * Which values of a facet the panel draws, and in which order.
 *
 * The cut ranks by `count` (ties by value), not by the alphabetical answer or
 * by `matching_count`, which moves while a filter is built and would reshuffle
 * the chips. A selected value past the cut is drawn anyway. Expanded, the group
 * draws the answer's alphabetical order.
 */
const cutChips = (
  all: readonly DistinctValue[],
  limit: number,
  selected: ReadonlySet<string>,
  showAll: boolean,
): readonly DistinctValue[] => {
  if (showAll) return all;
  const ranked = [...all].sort(
    (a, b) => b.count - a.count || a.value.toLowerCase().localeCompare(b.value.toLowerCase()),
  );
  return [...ranked.slice(0, limit), ...ranked.slice(limit).filter((v) => selected.has(v.value))];
};

/** What the location chip discloses; the holder stays in the tree so `aria-controls` resolves. */
const LOCATION_TREE_ID = 'filter-location-tree-holder';

/** `list` with `value` added, or taken out if it was there. */
const toggled = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/** The "Show only" facets: filter key, label, the tone an applied chip takes, and its tally. */
type ShowOnlyKey = 'lowStockOnly' | 'checkedOutOnly' | 'overdueOnly' | 'inspectionDueOnly' | 'orphansOnly';
const SHOW_ONLY: [ShowOnlyKey, TranslationKey, '' | 'warning' | 'error', keyof StatsCounts, string][] = [
  ['lowStockOnly', 'hv.term.lowStock', 'warning', 'low_stock_count', 'filter-low-stock-only'],
  ['checkedOutOnly', 'hv.term.checkedOut', '', 'checked_out_count', 'filter-checked-out'],
  ['overdueOnly', 'hv.term.overdue', 'error', 'overdue_count', 'filter-overdue'],
  ['inspectionDueOnly', 'hv.term.inspectionDue', 'warning', 'inspection_due_count', 'filter-inspection-due'],
  ['orphansOnly', 'hv.term.noLocation', '', 'no_location_count', 'filter-orphans'],
];

/** The two timestamps a "Changed" row can compare, and the filter keys behind them. */
type DateField = 'updated' | 'created';

const DATE_KEYS = {
  updated: { after: 'updatedAfter', before: 'updatedBefore', noun: 'hv.field.updated_at' },
  created: { after: 'createdAfter', before: 'createdBefore', noun: 'hv.field.created_at' },
} as const;

/**
 * Every filter the backend accepts, in one panel, and the same set as a staged
 * bottom-sheet body on mobile. Desktop applies each change at once; mobile
 * stages edits until the priced apply button commits them.
 */
@customElement('hv-filter-panel')
export class HVFilterPanel extends LitElement {
  static styles = [
    tokens,
    base,
    chip,
    css`
      :host {
        display: block;
      }
      .panel {
        padding: 14px;
        background: var(--hv-surface-raised);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-panel);
        display: grid;
        gap: 13px;
      }
      :host([mobile]) .panel {
        background: transparent;
        border: none;
        border-radius: 0;
        padding: 14px 16px;
        gap: 16px;
      }
      .group {
        display: grid;
        gap: 7px;
      }
      .group-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        align-items: center;
      }
      /* Form values, sized like the selects and date fields beside them. */
      .chip {
        gap: 5px;
        padding: 5px 12px;
        font-size: 12.5px;
      }
      :host([mobile]) .chip {
        min-height: var(--hv-tap-min, 36px);
        padding: 0 14px;
        font-size: 13.5px;
      }
      .chip.more {
        border-style: dashed;
      }
      .hint {
        font-size: 11px;
        color: var(--hv-text-tertiary);
      }
      .field {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        background: var(--hv-input-bg);
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        color: var(--hv-text);
        padding: 7px 11px;
        font: 400 12.5px var(--hv-font);
      }
      /* The chips' size, not the card's 16px input size. */
      :host([mobile]) .field {
        min-height: 46px;
        width: 100%;
        font-size: 13.5px;
      }
      /* Except a free-text box: 16px stops iOS zooming the page on focus. */
      :host([mobile]) .field input[type='search'] {
        font-size: var(--hv-input-font, 16px);
      }
      .field.on {
        border-color: var(--hv-primary);
      }
      .field.muted {
        color: var(--hv-text-tertiary);
      }
      /* The field draws its own chevron, so drop the browser's. */
      .field select {
        appearance: none;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        color: inherit;
        font: inherit;
      }
      .field input[type='date'] {
        background: none;
        border: none;
        padding: 0;
        color: inherit;
        font: inherit;
      }
      /* The comparison is a button that flips the direction; it needs an outline
         at rest because a touch screen never hovers. */
      .field .direction {
        white-space: nowrap;
        box-sizing: border-box;
        border: 1px solid var(--hv-input-border);
        background: var(--hv-surface);
        border-radius: 6px;
        padding: 2px 7px;
        margin: -2px 0 -2px -4px;
        font: inherit;
        color: var(--hv-text-secondary);
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
      }
      .field.on .direction {
        color: var(--hv-text);
        border-color: var(--hv-primary-tint-border);
      }
      .field .direction:hover {
        background: var(--hv-hover-overlay);
        border-color: var(--hv-primary);
        color: var(--hv-primary-dark);
      }
      /* The select fills the field, so the drawn chevron on top of it is clickable. */
      .field.select-field {
        position: relative;
        padding-right: 27px;
      }
      .field.select-field select {
        flex: 1;
        min-width: 0;
        /* The select is what takes the tap, so it takes the field's height. */
        min-height: var(--hv-tap-min, auto);
      }
      .field .chevron {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: inline-flex;
        color: var(--hv-text-secondary);
        pointer-events: none;
      }
      .segmented {
        display: inline-flex;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
        overflow: hidden;
      }
      .segmented button {
        border: none;
        background: none;
        color: var(--hv-chip-text);
        padding: 4px 12px;
        font: 400 11.5px var(--hv-font);
        min-height: var(--hv-tap-min, auto);
      }
      .segmented button.on {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        font-weight: 500;
      }
      /* A "Show only" row is a full-width chip, so the stacked column has one right edge. */
      :host([mobile]) .check {
        box-sizing: border-box;
        width: 100%;
        min-height: var(--hv-tap-min, 44px);
      }
      /* The mark holds the glyph's width while off, so labels keep one left edge. */
      .check .mark {
        display: inline-grid;
        place-items: center;
        width: 12px;
        flex: none;
      }
      :host([mobile]) .check .mark {
        width: 15px;
      }
      /* The row form of a facet reads label-first, so its tally is pushed to
         the far edge; the chip form sits right after the label. */
      .hv-tally.tally-right {
        margin-left: auto;
      }
      select {
        font: inherit;
        color: inherit;
        background: transparent;
        border: none;
        outline: none;
      }
      input[type='date'],
      input[type='search'] {
        font: inherit;
        color: inherit;
        background: transparent;
        border: none;
        outline: none;
        min-width: 0;
        min-height: var(--hv-tap-min, auto);
        flex: 1;
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid var(--hv-divider);
        padding-top: 10px;
        font-size: 12px;
        color: var(--hv-text-secondary);
      }
      .tree-holder {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-surface);
        max-height: 230px;
        overflow: auto;
        padding: 4px 0;
      }
    `,
  ];

  /** The applied filters. In staged mode this is the baseline, not the edit target. */
  @property({ attribute: false }) filters!: StoreFilters;
  @property({ attribute: false }) distinct: DistinctValues | null = null;
  /** The status vocabulary from `haventory/config`; the built-ins stand in until it answers. */
  @property({ attribute: false }) statuses: StatusDefinition[] | null = null;
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  /** Total matches for the applied filter, shown in the footer. */
  @property({ type: Number }) total: number | null = null;
  /** Global item count, for the "N of M match" footer. */
  @property({ type: Number }) grandTotal: number | null = null;
  /** Stage edits and apply on commit (mobile sheet) instead of applying live. */
  @property({ type: Boolean, reflect: true }) mobile = false;
  /** Whole-inventory stat counts that price the "Show only" rows and the status chips. */
  @property({ attribute: false }) counts: StatsCounts | null = null;

  @state() private _draft: StoreFilters | null = null;
  @state() private _showAllCategories = false;
  @state() private _showAllTags = false;
  @state() private _tagDraft = '';
  /** Direction a date row falls back to while it holds no date. */
  @state() private _dateDirection: Record<DateField, 'after' | 'before'> = {
    updated: 'after',
    created: 'after',
  };

  /** The Where chip's tree, which stays open while a set of locations is picked. */
  private readonly _location = new LocationPicker(this, { keepOpenOnSelect: true });

  /** The filter set the controls are bound to. */
  get working(): StoreFilters {
    return this.mobile ? (this._draft ?? this.filters) : this.filters;
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (this.mobile && (changed.has('filters') || changed.has('mobile')) && !this._draft) {
      this._draft = { ...this.filters, tags: [...this.filters.tags] };
    }
    if (!this.mobile && changed.has('mobile')) this._draft = null;
  }

  /** Discard staged edits (the sheet's Cancel). */
  resetDraft() {
    this._draft = this.mobile ? { ...this.filters, tags: [...this.filters.tags] } : null;
  }

  /** "Clear all". Staged, it empties the draft, which the footer button commits. */
  clearAll() {
    if (!this.mobile) {
      this.dispatchEvent(new CustomEvent('clear-filters', { bubbles: true, composed: true }));
      return;
    }
    // Sort is a view preference, not a filter — "Clear all" keeps it.
    this._patch({ ...defaultFilters(), sort: this.working.sort });
  }

  private _patch(patch: Partial<StoreFilters>) {
    if (this.mobile) {
      this._draft = { ...this.working, ...patch };
      this.dispatchEvent(
        new CustomEvent('stage', { detail: { filters: this._draft }, bubbles: true, composed: true }),
      );
      return;
    }
    this.dispatchEvent(new CustomEvent('change', { detail: patch, bubbles: true, composed: true }));
  }

  /** Commit staged edits (the sheet's "Show N items"). */
  apply() {
    const draft = this._draft;
    this._draft = null;
    if (draft) {
      this.dispatchEvent(new CustomEvent('apply', { detail: draft, bubbles: true, composed: true }));
    }
  }

  private _toggleTag(tag: string) {
    this._patch({ tags: toggled(this.working.tags, tag) });
  }

  private _commitTagDraft() {
    // The server lowercases tags, so the chip matches what is stored.
    const tag = this._tagDraft.trim().toLowerCase();
    this._tagDraft = '';
    if (!tag || this.working.tags.includes(tag)) return;
    this._patch({ tags: [...this.working.tags, tag] });
  }

  /**
   * A labelled on/off filter row. `aria-pressed`, not a checkbox role, so it
   * announces as the same toggle as the chip it replaces on a wider screen.
   */
  private _renderCheckbox(
    label: string,
    on: boolean,
    onToggle: () => void,
    opts: { warning?: boolean; tally?: number | null; testid?: string } = {},
  ) {
    // The hue marks the applied state only; tinted at rest it would read as on.
    return html`<button
      class="hv-chip toggle chip check ${on ? 'on' : ''} ${on && opts.warning ? 'warning' : ''}"
      aria-pressed=${String(on)}
      data-testid=${opts.testid ?? 'filter-check'}
      @click=${onToggle}
    >
      <span class="mark">${on ? icon('check', this.mobile ? 15 : 12) : null}</span>
      <span>${label}</span>
      ${opts.tally !== undefined && opts.tally !== null
        ? html`<span class="hv-tally tally-right">${opts.tally}</span>`
        : null}
    </button>`;
  }

  private _renderLocationGroup() {
    const f = this.working;
    const locations = this.locations ?? [];
    // Words, not a nested chip; several picked locations are counted instead.
    const label =
      f.locationIds.length > 1
        ? counted(f.locationIds.length, 'location')
        : pathLabel(
            locationPathParts(
              locations.find((l) => l.id === f.locationIds[0]),
              locations,
              this.areas,
              t('hv.filter.anyLocation'),
            ),
          );
    return html`
      <div class="group">
        <span class="hv-label">${t('hv.filter.where')}</span>
        <div class="chips">
          ${this._location.renderTrigger({
            triggerClass: `hv-chip toggle chip ${f.locationIds.length ? 'on' : ''}`,
            testid: 'filter-location',
            holderId: LOCATION_TREE_ID,
            trigger: html`${icon('mapMarker', 14)}${label}${icon('chevronDown', 14)}`,
          })}
          <label class="field select-field ${f.areaId ? 'on' : ''}" data-testid="filter-area">
            <span class="hv-sr-only">${t('hv.filter.area')}</span>
            <select
              .value=${f.areaId ?? ''}
              @change=${(e: Event) => this._patch({ areaId: (e.target as HTMLSelectElement).value || null })}
            >
              <option value="">${t('hv.filter.areaAny')}</option>
              ${this.areas.map(
                (a) => html`<option value=${a.id} ?selected=${f.areaId === a.id}>${a.name}</option>`,
              )}
            </select>
            <span class="chevron">${icon('chevronDown', 14)}</span>
          </label>
          ${this._renderCheckbox(
            t('hv.filter.includeSubtree'),
            f.includeSubtree,
            () => this._patch({ includeSubtree: !f.includeSubtree }),
            { testid: 'filter-include-subtree' },
          )}
        </div>
        ${this._location.renderHolder(
          { holderId: LOCATION_TREE_ID },
          () => html`<hv-location-tree
            data-testid="filter-location-tree"
            .nodes=${this.locationTree}
            .areas=${this.areas}
            .selectedIds=${f.locationIds}
            showAll
            showCounts
            .totalCount=${this.grandTotal}
            @select=${(e: CustomEvent) => {
              const id = (e.detail as { locationId: string | null }).locationId;
              this._patch({ locationIds: id === null ? [] : toggled(f.locationIds, id) });
            }}
          ></hv-location-tree>`,
        )}
      </div>
    `;
  }

  private _renderCategoryGroup() {
    const f = this.working;
    const all = this.distinct?.categories ?? [];
    const selected = new Set(f.categories);
    const shown = cutChips(all, CATEGORY_CHIP_LIMIT, selected, this._showAllCategories);
    const hidden = all.length - shown.length;
    if (!all.length) return null;
    return html`
      <div class="group">
        <span class="hv-label">${t('hv.field.category')}</span>
        <div class="chips">
          ${shown.map(
            (c) => html`<button
              class="hv-chip toggle chip ${selected.has(c.value) ? 'on' : ''}"
              data-testid="filter-category"
              data-value=${c.value}
              aria-pressed=${String(selected.has(c.value))}
              @click=${() => this._patch({ categories: toggled(f.categories, c.value) })}
            >
              ${selected.has(c.value) ? icon('check', 12) : null}${c.value}
              <span class="hv-tally">${c.count}</span>
            </button>`,
          )}
          ${this._renderMore('filter-category-more', hidden, () => {
            this._showAllCategories = true;
          })}
        </div>
        <!-- Categories have no any/all control, so the OR rule is said. -->
        <span class="hint">${t('hv.filter.categoryHint')}</span>
      </div>
    `;
  }

  private _renderTagGroup() {
    const f = this.working;
    const all = this.distinct?.tags ?? [];
    const selected = new Set(f.tags);
    // Always show selected tags, even ones typed in that no item carries yet.
    const known = all.map((t) => t.value);
    const extras = f.tags.filter((t) => !known.includes(t));
    const shown = cutChips(all, TAG_CHIP_LIMIT, selected, this._showAllTags);
    const hidden = all.length - shown.length;
    return html`
      <div class="group">
        <div class="group-head">
          <span class="hv-label">${t('hv.field.tags')}</span>
          <!-- Beside the word it qualifies, as Sort's direction toggle is. -->
          <span class="segmented" role="radiogroup" aria-label=${t('hv.filter.tagMatchMode')}>
            ${(['any', 'all'] as const).map(
              (mode) => html`<button
                class=${f.tagsMode === mode ? 'on' : ''}
                role="radio"
                aria-checked=${String(f.tagsMode === mode)}
                data-testid="filter-tags-mode"
                data-mode=${mode}
                @click=${() => this._patch({ tagsMode: mode })}
              >
                ${mode === 'any' ? t('hv.term.any') : t('hv.term.all')}
              </button>`,
            )}
          </span>
        </div>
        <div class="chips">
          ${shown.map(
            (t) => html`<button
              class="hv-chip toggle tag chip ${selected.has(t.value) ? 'on' : ''}"
              data-testid="filter-tag"
              data-value=${t.value}
              aria-pressed=${String(selected.has(t.value))}
              @click=${() => this._toggleTag(t.value)}
            >
              ${selected.has(t.value) ? icon('check', 12) : null}${tagLabel(t.value)}
              <span class="hv-tally">${t.count}</span>
            </button>`,
          )}
          ${extras.map(
            (t) => html`<button
              class="hv-chip toggle tag chip on"
              data-testid="filter-tag"
              data-value=${t}
              aria-pressed="true"
              @click=${() => this._toggleTag(t)}
            >
              ${icon('check', 12)}${tagLabel(t)}
            </button>`,
          )}
          ${this._renderMore('filter-tag-more', hidden, () => {
            this._showAllTags = true;
          })}
          <label class="field" data-testid="filter-tag-add">
            <span class="hv-sr-only">${t('hv.filter.addTag')}</span>
            <input
              type="search"
              placeholder=${t('hv.filter.addTagPlaceholder')}
              .value=${this._tagDraft}
              size="10"
              @input=${(e: Event) => {
                this._tagDraft = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  this._commitTagDraft();
                }
              }}
              @blur=${() => this._commitTagDraft()}
            />
          </label>
        </div>
        <span class="hint">${t('hv.filter.tagsHint')}</span>
      </div>
    `;
  }

  /** The "More…" chip that expands a cut facet, when the cut hid anything. */
  private _renderMore(testid: string, hidden: number, onClick: () => void) {
    if (hidden <= 0) return null;
    return html`<button class="hv-chip toggle chip more" data-testid=${testid} @click=${onClick}>
      ${t('hv.filter.more')} <span class="hv-tally">${hidden}</span>
    </button>`;
  }

  /** The "Show only" facets: stacked rows on mobile, chips on desktop. */
  private _renderShowOnlyGroup() {
    const f = this.working;
    return html`
      <div class="group">
        <span class="hv-label">${t('hv.filter.showOnly')}</span>
        <div class="chips">
          ${SHOW_ONLY.map(([key, label, tone, countKey, testid]) => {
            const on = f[key];
            const tally = this.counts?.[countKey] as number | null | undefined;
            const toggle = () => this._patch({ [key]: !on });
            if (this.mobile) return this._renderCheckbox(t(label), on, toggle, { warning: !!tone, tally, testid });
            return html`<button
              class="hv-chip toggle chip ${on ? `on ${tone}` : ''}"
              data-testid=${testid}
              aria-pressed=${String(on)}
              @click=${toggle}
            >
              ${on ? icon('check', 12) : null}${t(label)}${tally === null || tally === undefined
                ? null
                : html`<span class="hv-tally">${tally}</span>`}
            </button>`;
          })}
        </div>
      </div>
    `;
  }

  /**
   * The stored item status, as one single-select chip row (the backend filter
   * takes one status). Each chip carries its household tone and its tally.
   */
  private _renderStatusGroup() {
    const f = this.working;
    const c = this.counts;
    return html`
      <div class="group">
        <span class="hv-label">${t('hv.field.status')}</span>
        <div class="chips">
          ${statusList(this.statuses).map(({ slug: s }) => {
            const on = f.status === s;
            // A chosen status shows its own colour; the rest stay outlines, so
            // the row reads as choices rather than as facts.
            const tone = on && s !== DEFAULT_STATUS ? statusTone(s, this.statuses) : null;
            const tally = statusCount(c, s);
            return html`<button
              class="hv-chip toggle chip hv-status-chip ${on ? 'on' : ''} ${tone?.toneClass ?? ''}"
              style=${ifDefined(tone?.toneStyle)}
              data-testid="filter-status"
              data-value=${s}
              aria-pressed=${String(on)}
              @click=${() => this._patch({ status: on ? null : s })}
            >
              ${on ? icon('check', 12) : null}${statusLabel(s, this.statuses)}
              ${tally === null ? null : html`<span class="hv-tally">${tally}</span>`}
            </button>`;
          })}
        </div>
      </div>
    `;
  }

  /**
   * Which way a date row compares. An applied bound decides it; an empty row
   * remembers the last flip, so pressing ≥ before picking a date does something.
   */
  private _dateDirectionOf(field: DateField): 'after' | 'before' {
    const f = this.working;
    if (f[DATE_KEYS[field].before]) return 'before';
    if (f[DATE_KEYS[field].after]) return 'after';
    return this._dateDirection[field];
  }

  /** One date row, whose ≥/≤ button flips the comparison and carries a picked date across. */
  private _renderDateRow(field: DateField) {
    const { after: afterKey, before: beforeKey, noun: nounKey } = DATE_KEYS[field];
    const noun = t(nounKey);
    const before = this._dateDirectionOf(field) === 'before';
    const activeKey = before ? beforeKey : afterKey;
    const value = this.working[activeKey];
    const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
    const toIso = (raw: string) => (raw ? `${raw}T00:00:00Z` : null);

    return html`<span class="field ${value ? 'on' : 'muted'}" data-testid=${`filter-${field}-date`}>
      ${icon('calendar', 14)}
      <button
        class="direction"
        data-testid=${`filter-${field}-direction`}
        data-direction=${before ? 'before' : 'after'}
        aria-label=${before
          ? t('hv.filter.dateFlipToSince', { noun })
          : t('hv.filter.dateFlipToBefore', { noun })}
        title=${before ? t('hv.filter.dateTitleBefore') : t('hv.filter.dateTitleSince')}
        @click=${() => {
          this._dateDirection = { ...this._dateDirection, [field]: before ? 'after' : 'before' };
          // An empty row has nothing to re-apply; two nulls would reload the list.
          if (value) this._patch({ [afterKey]: before ? value : null, [beforeKey]: before ? null : value });
        }}
      >
        ${noun} ${before ? '≤' : '≥'}
      </button>
      <input
        type="date"
        aria-label=${before
          ? t('hv.filter.dateBefore', { noun })
          : t('hv.filter.dateSince', { noun })}
        .value=${dateOf(value)}
        @change=${(e: Event) => this._patch({ [activeKey]: toIso((e.target as HTMLInputElement).value) })}
      />
    </span>`;
  }

  private _renderDateGroup() {
    return html`
      <div class="group">
        <span class="hv-label">${t('hv.filter.changed')}</span>
        <div class="chips">${this._renderDateRow('updated')} ${this._renderDateRow('created')}</div>
      </div>
    `;
  }

  private _renderSortGroup() {
    const f = this.working;
    const isDateish = f.sort.field === 'updated_at' || f.sort.field === 'created_at';
    const descLabel = isDateish ? t('hv.filter.newest') : t('hv.filter.descending');
    const ascLabel = isDateish ? t('hv.filter.oldest') : t('hv.filter.ascending');
    return html`
      <div class="group">
        <span class="hv-label">${t('hv.filter.sort')}</span>
        <div class="chips">
          <label class="field select-field" data-testid="filter-sort-field">
            <span class="hv-sr-only">${t('hv.filter.sortBy')}</span>
            <select
              @change=${(e: Event) =>
                this._patch({
                  sort: { field: (e.target as HTMLSelectElement).value as SortField, order: f.sort.order },
                })}
            >
              ${SORT_FIELDS.map(
                (field) => html`<option value=${field} ?selected=${f.sort.field === field}>
                  ${t(`hv.field.${field}`)}
                </option>`,
              )}
            </select>
            <span class="chevron">${icon('chevronDown', 14)}</span>
          </label>
          <span class="segmented" role="radiogroup" aria-label=${t('hv.filter.sortDirection')}>
            ${(['desc', 'asc'] as const).map(
              (order) => html`<button
                class=${f.sort.order === order ? 'on' : ''}
                role="radio"
                aria-checked=${String(f.sort.order === order)}
                data-testid="filter-sort-order"
                data-order=${order}
                @click=${() => this._patch({ sort: { field: f.sort.field, order } })}
              >
                ${order === 'desc' ? descLabel : ascLabel}
              </button>`,
            )}
          </span>
          ${this._renderCheckbox(
            t('hv.term.lowStockFirst'),
            f.lowStockFirst,
            () => this._patch({ lowStockFirst: !f.lowStockFirst }),
            { testid: 'filter-low-stock-first' },
          )}
        </div>
        <span class="hint">${t('hv.filter.sortHint')}</span>
      </div>
    `;
  }

  render() {
    if (!this.filters) return null;
    const count = activeFilterCount(this.working);
    return html`
      <div class="panel" data-testid="filter-panel">
        ${this._renderLocationGroup()} ${this._renderCategoryGroup()}
        ${this._renderShowOnlyGroup()} ${this._renderStatusGroup()} ${this._renderDateGroup()}
        <!-- Sort sits above the tag cloud, which grows without limit. -->
        ${this._renderSortGroup()} ${this._renderTagGroup()}
        ${this.mobile
          ? null
          : html`<div class="footer">
              <span data-testid="filter-summary">
                ${this.total !== null && this.grandTotal !== null
                  ? t('hv.filter.summaryMatching', {
                      filters: counted(count, 'filter'),
                      total: this.total,
                      grandTotal: this.grandTotal,
                    })
                  : t('hv.filter.summary', { filters: counted(count, 'filter') })}
              </span>
              <button class="hv-text-button" data-testid="filter-clear-all" @click=${() => this.clearAll()}>
                ${t('hv.action.clearAll')}
              </button>
            </div>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-filter-panel': HVFilterPanel;
  }
}
