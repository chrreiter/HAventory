import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { activeFilterCount, defaultFilters } from '../store/store';
import type {
  DistinctValues,
  Location,
  LocationTreeNode,
  SortField,
  StoreFilters,
} from '../store/types';
import './hv-location-tree';

/** Sort fields the backend supports, in the order the menu lists them. */
const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: 'updated_at', label: 'Updated' },
  { field: 'created_at', label: 'Created' },
  { field: 'name', label: 'Name' },
  { field: 'quantity', label: 'Quantity' },
  { field: 'due_date', label: 'Due date' },
  { field: 'inspection_date', label: 'Inspection date' },
];

/** How many category chips to show before collapsing the rest behind "More…". */
const CATEGORY_CHIP_LIMIT = 4;

/** The two timestamps a "Changed" row can compare, and the filter keys behind them. */
type DateField = 'updated' | 'created';

const DATE_KEYS = {
  updated: { after: 'updatedAfter', before: 'updatedBefore', noun: 'Updated' },
  created: { after: 'createdAfter', before: 'createdBefore', noun: 'Created' },
} as const;

/**
 * Every filter the backend accepts, in one panel (mock 4b) — and the same set as
 * a staged bottom-sheet body on mobile (4c).
 *
 * Two pairs are deliberately kept apart because the backend treats them
 * differently: "Low stock" is a filter (`low_stock_only`) while "Low stock
 * first" is an ordering hint (`low_stock_first`), and tags are one selection
 * with an any/all mode that routes to `tags_any` or `tags_all`.
 *
 * Desktop applies each change immediately. Mobile stages edits locally and
 * reports the live match count on the apply button, so the user sees the
 * consequence before committing.
 */
@customElement('hv-filter-panel')
export class HVFilterPanel extends LitElement {
  static styles = [
    tokens,
    base,
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
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 1px solid var(--hv-divider);
        background: transparent;
        color: var(--hv-chip-text);
        border-radius: var(--hv-radius-chip);
        padding: 5px 12px;
        font: 400 12.5px var(--hv-font);
      }
      :host([mobile]) .chip {
        min-height: var(--hv-tap-min, 36px);
        padding: 0 14px;
        font-size: 13.5px;
      }
      .chip.on {
        color: var(--hv-primary-darker);
        background: var(--hv-primary-tint);
        border-color: var(--hv-primary);
      }
      .chip.on.warning {
        color: var(--hv-warn);
        background: var(--hv-warn-bg);
        border-color: var(--hv-amber);
      }
      .chip.more {
        border-style: dashed;
        color: var(--hv-text-secondary);
      }
      .chip .tally {
        opacity: 0.65;
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
      :host([mobile]) .field {
        min-height: 46px;
        width: 100%;
        font-size: var(--hv-input-font, 14px);
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
      /*
       * The comparison is a button, not a caption: it says which field this row
       * is about *and* which way the comparison runs, and clicking it flips the
       * direction.
       */
      .field .direction {
        white-space: nowrap;
        border: none;
        background: none;
        border-radius: 5px;
        padding: 2px 5px;
        margin: -2px -2px -2px -3px;
        font: inherit;
        color: var(--hv-text-secondary);
        /* It sits inline in the field's label, so it takes height from the
           field it is in rather than becoming a block of its own. */
        display: inline-flex;
        align-items: center;
        min-height: var(--hv-tap-min, auto);
      }
      .field.on .direction {
        color: var(--hv-text);
      }
      .field .direction:hover {
        background: var(--hv-hover-overlay);
        color: var(--hv-primary-dark);
      }
      /*
       * An appearance:none select is only as wide as its text, so the drawn
       * chevron sat outside it and clicking the chevron did nothing. The select
       * now fills the field and the chevron is decoration on top of it.
       */
      .field.select-field {
        position: relative;
        padding-right: 27px;
      }
      .field.select-field select {
        flex: 1;
        min-width: 0;
        /* The wrapper looked like a 46px control while the select inside it,
           which is what actually takes the tap, was 19px tall. */
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
        /* The pill around them looked like a control; each segment inside was
           22px tall. */
        min-height: var(--hv-tap-min, auto);
      }
      .segmented button.on {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        font-weight: 500;
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: var(--hv-chip-text);
        border: none;
        background: none;
        padding: 4px 0;
      }
      :host([mobile]) .check {
        min-height: var(--hv-tap-min, 44px);
        width: 100%;
        font-size: 14px;
      }
      .box {
        display: inline-grid;
        place-items: center;
        width: 15px;
        height: 15px;
        border-radius: 4px;
        border: 1.5px solid var(--hv-text-tertiary);
        color: #fff;
        flex: none;
      }
      :host([mobile]) .box {
        width: 20px;
        height: 20px;
        border-radius: 5px;
      }
      .box.on {
        background: var(--hv-primary);
        border-color: var(--hv-primary);
      }
      .box.on.warning {
        background: var(--hv-amber);
        border-color: var(--hv-amber);
      }
      .tally-right {
        margin-left: auto;
        font-size: 12.5px;
        color: var(--hv-text-tertiary);
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
        /* Same trap as the select: a 46px field wrapping a 21px input. */
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
      .link {
        border: none;
        background: none;
        font: 500 12.5px var(--hv-font);
        color: var(--hv-primary-dark);
        padding: 0;
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
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  /** Total matches for the applied filter, shown in the footer. */
  @property({ type: Number }) total: number | null = null;
  /** Global item count, for the "N of M match" footer. */
  @property({ type: Number }) grandTotal: number | null = null;
  /** Stage edits and apply on commit (mobile sheet) instead of applying live. */
  @property({ type: Boolean, reflect: true }) mobile = false;
  /** Live match count for the staged filter — drives "Show N items". */
  @property({ type: Number }) stagedCount: number | null = null;

  @state() private _draft: StoreFilters | null = null;
  @state() private _locationOpen = false;
  @state() private _showAllCategories = false;
  @state() private _tagDraft = '';
  /** Direction a date row falls back to while it holds no date. */
  @state() private _dateDirection: Record<DateField, 'after' | 'before'> = {
    updated: 'after',
    created: 'after',
  };

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

  /**
   * The sheet's "Clear all". In staged mode this has to empty the *draft* — a
   * store-level clear left the panel bound to its untouched draft, so the list
   * behind the sheet reloaded while every control stayed exactly as it was.
   * Nothing is applied until the footer button commits, like every other edit
   * in the sheet.
   */
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
    const tags = this.working.tags;
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    this._patch({ tags: next });
  }

  private _commitTagDraft() {
    // Tags are normalized server-side (trimmed, lowercased, deduplicated), so
    // lowercase on commit and what the user sees matches what is stored.
    const tag = this._tagDraft.trim().toLowerCase();
    this._tagDraft = '';
    if (!tag || this.working.tags.includes(tag)) return;
    this._patch({ tags: [...this.working.tags, tag] });
  }

  private _renderCheckbox(
    label: string,
    on: boolean,
    onToggle: () => void,
    opts: { warning?: boolean; tally?: number | null; testid?: string } = {},
  ) {
    return html`<button
      class="check"
      role="checkbox"
      aria-checked=${String(on)}
      data-testid=${opts.testid ?? 'filter-check'}
      @click=${onToggle}
    >
      <span class="box ${on ? 'on' : ''} ${opts.warning ? 'warning' : ''}">
        ${on ? icon('check', this.mobile ? 15 : 12) : null}
      </span>
      <span>${label}</span>
      ${opts.tally !== undefined && opts.tally !== null
        ? html`<span class="tally-right">${opts.tally}</span>`
        : null}
    </button>`;
  }

  private _renderLocationGroup() {
    const f = this.working;
    const loc = (this.locations ?? []).find((l) => l.id === f.locationId);
    const label = loc ? (loc.path?.display_path ?? loc.name).replace(/\s*\/\s*/g, ' › ') : 'Any location';
    return html`
      <div class="group">
        <span class="hv-label">Where</span>
        <div class="chips">
          <button
            class="chip ${f.locationId ? 'on' : ''}"
            data-testid="filter-location"
            aria-expanded=${String(this._locationOpen)}
            @click=${() => {
              this._locationOpen = !this._locationOpen;
            }}
          >
            ${icon('mapMarker', 14)}${label}${icon('chevronDown', 14)}
          </button>
          <label class="field select-field ${f.areaId ? 'on' : ''}" data-testid="filter-area">
            <span class="hv-sr-only">Area</span>
            <select
              .value=${f.areaId ?? ''}
              @change=${(e: Event) => this._patch({ areaId: (e.target as HTMLSelectElement).value || null })}
            >
              <option value="">Area: Any</option>
              ${this.areas.map(
                (a) => html`<option value=${a.id} ?selected=${f.areaId === a.id}>${a.name}</option>`,
              )}
            </select>
            <span class="chevron">${icon('chevronDown', 14)}</span>
          </label>
          ${this._renderCheckbox(
            'Include sub-locations',
            f.includeSubtree,
            () => this._patch({ includeSubtree: !f.includeSubtree }),
            { testid: 'filter-include-subtree' },
          )}
        </div>
        ${this._locationOpen
          ? html`<div class="tree-holder">
              <hv-location-tree
                data-testid="filter-location-tree"
                .nodes=${this.locationTree}
                .selectedId=${f.locationId}
                showAll
                showCounts
                .totalCount=${this.grandTotal}
                @select=${(e: CustomEvent) => {
                  this._patch({ locationId: (e.detail as { locationId: string | null }).locationId });
                  this._locationOpen = false;
                }}
              ></hv-location-tree>
            </div>`
          : null}
      </div>
    `;
  }

  private _renderCategoryGroup() {
    const f = this.working;
    const all = this.distinct?.categories ?? [];
    const shown = this._showAllCategories ? all : all.slice(0, CATEGORY_CHIP_LIMIT);
    const hidden = all.length - shown.length;
    if (!all.length) return null;
    return html`
      <div class="group">
        <span class="hv-label">Category</span>
        <div class="chips">
          ${shown.map(
            (c) => html`<button
              class="chip ${f.category === c.value ? 'on' : ''}"
              data-testid="filter-category"
              data-value=${c.value}
              @click=${() => this._patch({ category: f.category === c.value ? null : c.value })}
            >
              ${f.category === c.value ? icon('check', 12) : null}${c.value}
              <span class="tally">${c.count}</span>
            </button>`,
          )}
          ${hidden > 0
            ? html`<button
                class="chip more"
                data-testid="filter-category-more"
                @click=${() => {
                  this._showAllCategories = true;
                }}
              >
                More… <span class="tally">${hidden}</span>
              </button>`
            : null}
        </div>
        <span class="hint">Single select · counts from distinct values</span>
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
    return html`
      <div class="group">
        <div class="group-head">
          <span class="hv-label">Tags</span>
          <span class="segmented" style="margin-left:auto" role="radiogroup" aria-label="Tag match mode">
            ${(['any', 'all'] as const).map(
              (mode) => html`<button
                class=${f.tagsMode === mode ? 'on' : ''}
                role="radio"
                aria-checked=${String(f.tagsMode === mode)}
                data-testid="filter-tags-mode"
                data-mode=${mode}
                @click=${() => this._patch({ tagsMode: mode })}
              >
                ${mode === 'any' ? 'Any' : 'All'}
              </button>`,
            )}
          </span>
        </div>
        <div class="chips">
          ${all.map(
            (t) => html`<button
              class="chip ${selected.has(t.value) ? 'on' : ''}"
              data-testid="filter-tag"
              data-value=${t.value}
              @click=${() => this._toggleTag(t.value)}
            >
              ${selected.has(t.value) ? icon('check', 12) : null}${t.value}
              <span class="tally">${t.count}</span>
            </button>`,
          )}
          ${extras.map(
            (t) => html`<button
              class="chip on"
              data-testid="filter-tag"
              data-value=${t}
              @click=${() => this._toggleTag(t)}
            >
              ${icon('check', 12)}${t}
            </button>`,
          )}
          <label class="field" data-testid="filter-tag-add">
            <span class="hv-sr-only">Add tag</span>
            <input
              type="search"
              placeholder="+ add tag…"
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
        <span class="hint">Stored lowercase — input lowercases on commit</span>
      </div>
    `;
  }

  private _renderShowOnlyGroup() {
    const f = this.working;
    const counts = { low: null as number | null, out: null as number | null, none: null as number | null };
    return html`
      <div class="group">
        <span class="hv-label">Show only</span>
        <div class="chips">
          ${this.mobile
            ? html`
                ${this._renderCheckbox('Low stock', f.lowStockOnly, () => this._patch({ lowStockOnly: !f.lowStockOnly }), { warning: true, tally: counts.low, testid: 'filter-low-stock-only' })}
                ${this._renderCheckbox('Checked out', f.checkedOutOnly, () => this._patch({ checkedOutOnly: !f.checkedOutOnly }), { tally: counts.out, testid: 'filter-checked-out' })}
                ${this._renderCheckbox('Overdue', f.overdueOnly, () => this._patch({ overdueOnly: !f.overdueOnly }), { warning: true, testid: 'filter-overdue' })}
                ${this._renderCheckbox('No location', f.orphansOnly, () => this._patch({ orphansOnly: !f.orphansOnly }), { tally: counts.none, testid: 'filter-orphans' })}
              `
            : html`
                <button
                  class="chip ${f.lowStockOnly ? 'on warning' : ''}"
                  data-testid="filter-low-stock-only"
                  @click=${() => this._patch({ lowStockOnly: !f.lowStockOnly })}
                >
                  ${f.lowStockOnly ? icon('check', 12) : null}Low stock
                </button>
                <button
                  class="chip ${f.checkedOutOnly ? 'on' : ''}"
                  data-testid="filter-checked-out"
                  @click=${() => this._patch({ checkedOutOnly: !f.checkedOutOnly })}
                >
                  ${f.checkedOutOnly ? icon('check', 12) : null}Checked out
                </button>
                <button
                  class="chip ${f.overdueOnly ? 'on warning' : ''}"
                  data-testid="filter-overdue"
                  @click=${() => this._patch({ overdueOnly: !f.overdueOnly })}
                >
                  ${f.overdueOnly ? icon('check', 12) : null}Overdue
                </button>
                <button
                  class="chip ${f.orphansOnly ? 'on' : ''}"
                  data-testid="filter-orphans"
                  @click=${() => this._patch({ orphansOnly: !f.orphansOnly })}
                >
                  ${f.orphansOnly ? icon('check', 12) : null}No location
                </button>
              `}
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

  /**
   * One date row, with the comparison itself as the control.
   *
   * "Since" and "before" are the same question asked in two directions, so
   * flipping ≥/≤ is cheaper than a second row — and a date already picked moves
   * across with the flip, since it is the date you meant either way.
   */
  private _renderDateRow(field: DateField) {
    const { after: afterKey, before: beforeKey, noun } = DATE_KEYS[field];
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
        aria-label=${`${noun} ${before ? 'before' : 'since'} — switch to ${before ? 'since' : 'before'}`}
        title=${before ? 'Before this date — click for "since"' : 'Since this date — click for "before"'}
        @click=${() => {
          this._dateDirection = { ...this._dateDirection, [field]: before ? 'after' : 'before' };
          // Nothing to re-apply on an empty row, and patching two nulls would
          // reload the list for no reason.
          if (value) this._patch({ [afterKey]: before ? value : null, [beforeKey]: before ? null : value });
        }}
      >
        ${noun} ${before ? '≤' : '≥'}
      </button>
      <input
        type="date"
        aria-label=${`${noun} ${before ? 'before' : 'since'}`}
        .value=${dateOf(value)}
        @change=${(e: Event) => this._patch({ [activeKey]: toIso((e.target as HTMLInputElement).value) })}
      />
    </span>`;
  }

  private _renderDateGroup() {
    return html`
      <div class="group">
        <span class="hv-label">Changed</span>
        <div class="chips">${this._renderDateRow('updated')} ${this._renderDateRow('created')}</div>
      </div>
    `;
  }

  private _renderSortGroup() {
    const f = this.working;
    const isDateish = f.sort.field === 'updated_at' || f.sort.field === 'created_at';
    const descLabel = isDateish ? 'Newest' : 'Descending';
    const ascLabel = isDateish ? 'Oldest' : 'Ascending';
    return html`
      <div class="group">
        <span class="hv-label">Sort</span>
        <div class="chips">
          <label class="field select-field" data-testid="filter-sort-field">
            <span class="hv-sr-only">Sort by</span>
            <select
              @change=${(e: Event) =>
                this._patch({
                  sort: { field: (e.target as HTMLSelectElement).value as SortField, order: f.sort.order },
                })}
            >
              ${SORT_FIELDS.map(
                (s) => html`<option value=${s.field} ?selected=${f.sort.field === s.field}>${s.label}</option>`,
              )}
            </select>
            <span class="chevron">${icon('chevronDown', 14)}</span>
          </label>
          <span class="segmented" role="radiogroup" aria-label="Sort direction">
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
            'Low stock first',
            f.lowStockFirst,
            () => this._patch({ lowStockFirst: !f.lowStockFirst }),
            { testid: 'filter-low-stock-first' },
          )}
        </div>
        <span class="hint">Undated items always sort last, in both directions.</span>
      </div>
    `;
  }

  render() {
    if (!this.filters) return null;
    const count = activeFilterCount(this.working);
    return html`
      <div class="panel" data-testid="filter-panel">
        ${this._renderLocationGroup()} ${this._renderCategoryGroup()} ${this._renderTagGroup()}
        ${this._renderShowOnlyGroup()} ${this._renderDateGroup()} ${this._renderSortGroup()}
        ${this.mobile
          ? null
          : html`<div class="footer">
              <span data-testid="filter-summary">
                ${count} filter${count === 1 ? '' : 's'} active${this.total !== null && this.grandTotal !== null
                  ? ` · ${this.total} of ${this.grandTotal} match`
                  : ''}
              </span>
              <button class="link" data-testid="filter-clear-all" @click=${() => this.clearAll()}>
                Clear all
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
