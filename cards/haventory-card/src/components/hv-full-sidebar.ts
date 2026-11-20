import { LitElement, css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { browseRow } from '../ui/browse-row';
import { rovingTarget, syncRovingTabindex } from '../ui/roving-list';
import { icon } from '../ui/icons';
import { t } from '../i18n';
import { serverErrorText } from '../store/server-error';
import { defaultFilters, soleLocationId } from '../store/store';
import { countLocations } from '../store/location-tree';
import { SliceWatch } from '../ui/slice-watch';
import { statusCount, statusLabel, statusList, statusMatchingCount } from '../ui/status';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import type { Store } from '../store/store';
import type { DistinctValue } from '../store/types';
import type { HVLocationTree } from './hv-location-tree';
import type { OrganizeTab } from './hv-organize-dialog';
import './hv-location-tree';

/** The sidebar's collapsible sections, in the order they appear. */
export type SidebarSection = 'locations' | 'status' | 'categories' | 'tags';

/** The sections whose rows the sidebar draws itself; `hv-location-tree` draws the locations. */
type FacetSection = Exclude<SidebarSection, 'locations'>;

const FACET_SECTIONS: FacetSection[] = ['status', 'categories', 'tags'];

/** Names a facet row by its value, so a tab stop survives a redraw that keeps the row. */
const facetRowKey = (section: FacetSection, value: string | undefined) => `${section}:${value ?? ''}`;

/**
 * The element a section heading discloses. It stays in the tree while shut so
 * `aria-controls` always resolves; only its contents come and go.
 */
const sectionPanelId = (section: SidebarSection) => `sidebar-section-${section}`;

/**
 * The full view's sidebar: the location tree and the status, category and tag
 * facets with the backend's counts, and the inline new-location field. It
 * filters through the store directly. The parent owns which sections are open
 * (`sections`, which has to outlive a close of the full view), so a heading
 * asks with `toggle-section` rather than writing it, and a "+" for a
 * vocabulary created in the organize dialog sends `organize`.
 */
@customElement('hv-full-sidebar')
export class HVFullSidebar extends LitElement {
  static override styles = [
    tokens,
    base,
    browseRow,
    css`
      /* A scrolling region of the parent's body grid. */
      :host {
        display: block;
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
      /* The heading is the collapse button, so its "+" action is a sibling. */
      .section-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        /* Not flex:1, so the tags heading's Any/All sits right after the word. */
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
      /* The filter panel's Any/All control, in this shadow root. */
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
        padding: 4px 10px;
        font: 400 11.5px var(--hv-font);
        min-height: var(--hv-tap-min, auto);
      }
      .segmented button.on {
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        font-weight: 500;
      }
      /* Reserves the action's room so the tallies line up as one column. */
      .head-action {
        flex: none;
        display: flex;
        justify-content: flex-end;
        width: var(--hv-tap-min, 34px);
      }
      /* Facet rows take their shape from ui/browse-row, as the tree's do; the
         empty note lines up with a row's name. */
      .section-empty {
        padding: 2px 16px 8px 38px;
        font-size: 12.5px;
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
  /** Which sections are open. The parent keeps it, so it survives the full view closing. */
  @property({ attribute: false }) sections: Record<SidebarSection, boolean> = {
    locations: true,
    status: true,
    categories: true,
    tags: true,
  };

  private readonly _view = new SliceWatch(this, ['list', 'facets', 'stats', 'config', 'locations']);
  private readonly _emit = emitter<'hv-full-sidebar'>(this);

  @state() private _creatingLocation = false;
  @state() private _locationError: string | null = null;
  /** Which row holds each facet list's one tab stop (`facetRowKey`); null until `updated` resolves it. */
  @state() private _facetStop: Record<FacetSection, string | null> = {
    status: null,
    categories: null,
    tags: null,
  };

  @query('#sidebar-new-location-input') private _newLocationInput?: HTMLInputElement;

  private get _tree(): HVLocationTree | null {
    return this.shadowRoot?.querySelector('hv-location-tree') ?? null;
  }

  protected override firstUpdated(): void {
    this._tree?.revealPathTo(soleLocationId(this._view.state?.filters ?? defaultFilters()));
  }

  protected override updated(): void {
    for (const section of FACET_SECTIONS) this._syncFacetStop(section);
  }

  /** The rows of one facet list, in the order they are drawn. */
  private _facetRows(section: FacetSection): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>(`#${sectionPanelId(section)} .value-row`)];
  }

  /** Leave one row of `section` in the tab order, read off the rendered rows. */
  private _syncFacetStop(section: FacetSection) {
    const held = syncRovingTabindex(this._facetRows(section), this._facetStop[section], (el) =>
      facetRowKey(section, el.dataset.value),
    );
    this._holdFacetStop(section, held);
  }

  /** Remember a list's stop; `updated` calls this, so an unchanged key must not redraw. */
  private _holdFacetStop(section: FacetSection, key: string | null) {
    if (this._facetStop[section] === key) return;
    this._facetStop = { ...this._facetStop, [section]: key };
  }

  /** The arrows reach the rows the single tab stop leaves out; the rows are buttons for Enter and Space. */
  private _onFacetKeydown(section: FacetSection, e: KeyboardEvent) {
    const next = rovingTarget(e, this._facetRows(section));
    if (!next) return;
    this._holdFacetStop(section, facetRowKey(section, next.dataset.value));
    this._syncFacetStop(section);
    next.focus();
  }

  private async _createLocation(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this._locationError = null;
    try {
      // Under whatever the sidebar has selected, which is what "add here" means in a tree.
      await this.store?.createLocation(
        trimmed,
        soleLocationId(this._view.state?.filters ?? defaultFilters()),
        null,
      );
      this._creatingLocation = false;
    } catch (err) {
      this._locationError = serverErrorText(err, t('hv.editor.locationCreateFailed'));
    }
  }

  private _organize(tab: OrganizeTab) {
    this._emit('organize', { tab });
  }

  /** One collapsible sidebar heading; the chevron and the words are one target. */
  private _renderSectionToggle(section: SidebarSection, label: string) {
    const open = this.sections[section];
    return html`<button
      class="section-toggle"
      data-testid=${`sidebar-toggle-${section}`}
      aria-expanded=${String(open)}
      aria-controls=${sectionPanelId(section)}
      @click=${() => this._emit('toggle-section', { section, open: !open })}
    >
      ${icon(open ? 'chevronDown' : 'chevronRight', 18)}
      <span class="hv-label">${label}</span>
    </button>`;
  }

  /** The filter panel's any/all tag mode, shown here so it does not work unseen. */
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

  /** A section heading's "+"; statuses, categories and tags are created in Organize. */
  private _renderNewButton(testid: string, label: string, onClick: () => void) {
    return html`<span class="head-action">
      <button class="hv-icon-button" data-testid=${testid} aria-label=${label} title=${label} @click=${onClick}>
        ${icon('plus', 20)}
      </button>
    </span>`;
  }

  /**
   * The household's statuses as a single-select facet (the backend filter takes
   * one); pressing the active row clears it. No heading tally, since the row
   * count is the vocabulary's size rather than anything about the inventory.
   * With a filter on, a row reads matches over total as the category rows do;
   * the backend prices those matches without the status filter itself.
   */
  private _renderStatusSection() {
    const st = this._view.state;
    const filters = st?.filters ?? defaultFilters();
    const counts = st?.statsCounts;
    const facetStatuses = st?.distinctValuesCache?.statuses;
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle('status', t('hv.field.status'))}
        ${this._renderNewButton('sidebar-new-status', t('hv.fullView.newStatus'), () =>
          this._organize('statuses'),
        )}
      </div>
      <div
        id=${sectionPanelId('status')}
        role="group"
        aria-label=${t('hv.field.status')}
        ?hidden=${!this.sections.status}
        @keydown=${(e: KeyboardEvent) => this._onFacetKeydown('status', e)}
      >
        ${
          this.sections.status
            ? statusList(st?.statuses).map(({ slug: s }) => {
                const on = filters.status === s;
                const tally = statusCount(counts, s);
                const matching = statusMatchingCount(facetStatuses, s);
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
                <span class="label hv-browse-row-label">${statusLabel(s, st?.statuses)}</span>
                ${
                  tally === null
                    ? null
                    : html`<span class="hv-tally">${matching === null ? tally : `${matching} / ${tally}`}</span>`
                }
              </button>`;
              })
            : null
        }
      </div>
    `;
  }

  /** Categories and tags as multi-select sidebar rows; pressing a selected row takes it out. */
  private _renderFacetSection(
    section: 'categories' | 'tags',
    label: string,
    values: DistinctValue[],
    isOn: (value: string) => boolean,
    onPick: (value: string) => void,
    head?: unknown,
  ) {
    const open = this.sections[section];
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle(section, label)}
        ${head ?? null}
        <span class="section-tally" data-testid=${`sidebar-${section}-tally`}>${values.length}</span>
        ${this._renderNewButton(
          `sidebar-new-${section}`,
          section === 'tags' ? t('hv.fullView.newTag') : t('hv.fullView.newCategory'),
          () => this._organize(section),
        )}
      </div>
      <div
        id=${sectionPanelId(section)}
        role="group"
        aria-label=${label}
        ?hidden=${!open}
        @keydown=${(e: KeyboardEvent) => this._onFacetKeydown(section, e)}
      >
        ${
          open
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
                  <!-- The title is the only place a clipped value reads in full. -->
                  <span class="label hv-browse-row-label" title=${v.value}>${v.value}</span>
                  <!-- With a filter on, matches over total, as the location rows read. -->
                  <span class="hv-tally"
                    >${v.matching_count === undefined ? v.count : `${v.matching_count} / ${v.count}`}</span
                  >
                </button>`,
                )
              : html`<div class="section-empty" data-testid=${`sidebar-${section}-empty`}>
                ${section === 'tags' ? t('hv.fullView.noTagsYet') : t('hv.fullView.noCategoriesYet')}
              </div>`
            : null
        }
      </div>
    `;
  }

  override render() {
    const st = this._view.state;
    const filters = st?.filters ?? defaultFilters();
    const distinct = st?.distinctValuesCache;
    const selectedTags = new Set(filters.tags);
    const selectedCategories = new Set(filters.categories);
    return html`
      <div class="sidebar-head">
        ${this._renderSectionToggle('locations', t('hv.field.locations'))}
        <span class="section-tally" data-testid="sidebar-locations-tally">
          ${countLocations(st?.locationTreeCache ?? [])}
        </span>
        ${this._renderNewButton('sidebar-new-location', t('hv.fullView.newLocation'), () => {
          this._creatingLocation = !this._creatingLocation;
          this._locationError = null;
          // Nowhere to put the field if the section is shut.
          if (this._creatingLocation) this._emit('toggle-section', { section: 'locations', open: true });
        })}
      </div>
      <div id=${sectionPanelId('locations')} ?hidden=${!this.sections.locations}>
        ${this.sections.locations ? this._renderLocationSection() : null}
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
    `;
  }

  /** The location selection after picking `id`, as a facet row toggles; "All items" (null) clears it. */
  private _toggledLocations(id: string | null): string[] {
    const current = this._view.state?.filters.locationIds ?? [];
    if (id === null) return [];
    return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  }

  private _renderLocationSection() {
    const st = this._view.state;
    const filters = st?.filters ?? defaultFilters();
    return html`
      ${
        this._creatingLocation
          ? html`<div class="new-location">
              <input
                id="sidebar-new-location-input"
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
                  void this._createLocation(this._newLocationInput?.value ?? '');
                }}
              >
                ${t('hv.card.addShort')}
              </button>
            </div>`
          : null
      }
      ${
        this._locationError
          ? html`<div class="inline-error" role="alert" data-testid="sidebar-location-error">
              ${this._locationError}
            </div>`
          : null
      }
      <hv-location-tree
        data-testid="sidebar-tree"
        .nodes=${st?.locationTreeCache ?? []}
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
        @select=${(e: HvEvent<'hv-location-tree', 'select'>) =>
          this.store?.setFilters({
            locationIds: this._toggledLocations(e.detail.locationId),
            orphansOnly: false,
          })}
        @select-orphans=${() => this.store?.setFilters({ locationIds: [], orphansOnly: true })}
        @select-area=${(e: HvEvent<'hv-location-tree', 'select-area'>) =>
          this.store?.setFilters({
            areaId: e.detail.areaId,
            locationIds: [],
            orphansOnly: false,
          })}
      ></hv-location-tree>
    `;
  }
}
