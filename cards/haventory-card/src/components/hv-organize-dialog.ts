import { t } from '../i18n';
import { serverErrorText } from '../store/server-error';
import type { TranslationKey } from '../i18n';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { cache } from 'lit/directives/cache.js';
import { keyed } from 'lit/directives/keyed.js';
import { ref } from 'lit/directives/ref.js';
import { emitter } from '../events';
import type { HvEvent } from '../events';
import { tokens, base } from '../ui/tokens';
import { chip } from '../ui/chip';
import { Modal, modalChrome } from '../ui/modal';
import { searchBox } from '../ui/filter-chrome';
import { LocationPicker } from '../ui/location-picker';
import { icon } from '../ui/icons';
import type { IconName } from '../ui/icons';
import { counted } from '../ui/plural';
import { areaChangePreview, areaNameById } from '../ui/area';
import type { AreaChangePreview } from '../ui/area';
import { renderAreaChip } from '../ui/location-path';
import { countLocations } from '../store/location-tree';
import { CopyFlash, idRow } from '../ui/clipboard';
import { describeFailure } from './hv-bulk-bar';
import { makeBulkOp } from '../store/store';
import type { Store } from '../store/store';
import type { AreaRef, BulkFailure, Item, LocationTreeNode, StoreState } from '../store/types';
import './hv-organize-statuses';
import './hv-organize-values';

export type OrganizeTab = 'locations' | 'categories' | 'tags' | 'statuses';

/** Picker holders, named so `aria-controls` can point at them while closed. */
const LOC_PARENT_TREE_ID = 'location-parent-tree-holder';
const MERGE_TARGET_TREE_ID = 'merge-target-tree-holder';

/** A kind rather than a label, since each rewrite line is its own sentence per language. */
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

/** The failed request's own refusal, or the card's fallback sentence. */
function errorText(err: unknown, fallback: TranslationKey, params?: Record<string, string>): string {
  return serverErrorText(err, t(fallback, params));
}

/**
 * "Organize": one dialog, four tabs (locations, categories, tags, statuses).
 * Locations edit in place with a guarded delete. Categories and tags have no
 * rename or merge endpoint, so those are batch rewrites over every affected
 * item, with the progress and partial-failure treatment bulk actions get.
 */
@customElement('hv-organize-dialog')
export class HVOrganizeDialog extends LitElement {
  static override styles = [
    tokens,
    base,
    chip,
    modalChrome,
    idRow,
    searchBox,
    css`
      :host {
        /* Every row's vertical padding, inherited into the hosted
           hv-location-tree too so the four tabs cannot drift apart. */
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
      .hv-search {
        background: var(--hv-input-bg);
        padding: 9px 14px;
        color: var(--hv-text-secondary);
      }
      .hv-search input {
        color: var(--hv-text);
      }
      .toolbar-count {
        flex: none;
        white-space: nowrap;
        font-size: 12.5px;
        color: var(--hv-text-secondary);
      }
      /* A phone row is too narrow for three parts: the field takes a row. */
      :host([mobile]) .toolbar {
        flex-wrap: wrap;
      }
      :host([mobile]) .hv-search {
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
        /* The area cell's preview line makes it taller; keep fields aligned. */
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
        /* Wraps, or the reassign guard's select is squeezed to ~44px. */
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
      .guard-mark {
        color: var(--hv-warn);
        flex: none;
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
      .note {
        font-size: 11.5px;
        color: var(--hv-text-tertiary);
        line-height: 1.5;
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
  @state() private _rewrite: RewriteState | null = null;

  private _storeUnsub?: () => void;

  private _modal = new Modal(this, { open: () => this.open });

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  private _subscribe() {
    this._storeUnsub?.();
    // The dialog reads locations, never the list.
    this._storeUnsub = this.store.watch(['locations'], () => this.requestUpdate());
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.store && !this._storeUnsub) this._subscribe();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._storeUnsub?.();
    this._storeUnsub = undefined;
  }

  @query('#org-loc-area') private _areaSelect?: HTMLSelectElement | null;

  private readonly _emit = emitter<'hv-organize-dialog'>(this);

  /** Whether this update is the one that puts the dialog on screen. */
  private _opening = false;
  /**
   * Counts the openings. The tabs other than statuses are keyed on it, so each
   * opening builds them afresh.
   */
  private _openings = 0;

  /**
   * Scroll a disclosure into view as it opens, and give a form's field the
   * caret: `data-field` holds a selector for it inside the disclosure. A ref
   * fires only when the element is built, so each disclosure is `keyed` on its
   * subject. Skipped on the update that opens the dialog, where `Modal` owns
   * focus, and deferred a microtask because a ref fires while its subtree is
   * still detached.
   */
  private _reveal = (el?: Element) => {
    if (!el || this._opening) return;
    queueMicrotask(() => {
      if (!el.isConnected) return;
      // Optional: a test DOM without layout has no scrollIntoView.
      (el as HTMLElement).scrollIntoView?.({ block: 'nearest' });
      const field = (el as HTMLElement).dataset.field;
      if (field) el.querySelector<HTMLElement>(field)?.focus();
    });
  };

  protected override updated() {
    // A touched native select stops following its options' `selected`, so an
    // area chosen in the parent tree is written to the live element.
    const areaSelect = this._areaSelect;
    if (areaSelect) areaSelect.value = this._locArea ?? '';
    this._opening = false;
  }

  protected override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('store') && this.store) this._subscribe();
    if (changed.has('open') && this.open) {
      this._opening = true;
      this._openings += 1;
      this._resetTransient();
    }
    if (changed.has('tab')) this._resetTransient();
  }

  private _resetTransient() {
    this._filter = '';
    this._editingLocation = null;
    this._guard = null;
    this._locError = null;
    this._rewrite = null;
    this._mergingLocation = null;
    this._mergeTarget = null;
    this._mergePicker.close();
    this._sheetLocation = null;
  }

  private readonly _isOpening = () => this._opening;

  private _close = () => {
    this._emit('cancel');
  };

  // ---------- Chrome the four tabs share ----------
  /** A tab's head row: its filter (statuses have none), its count and its create button. */
  private _renderToolbar(opts: {
    search?: { label: string; placeholder: string };
    count: string;
    countTestid: string;
    newTestid: string;
    newLabel: string;
    onNew: () => void;
  }) {
    return html`<div class="toolbar">
      ${
        opts.search
          ? html`<label class="hv-search">
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
          : null
      }
      <span class="toolbar-count" data-testid=${opts.countTestid}>${opts.count}</span>
      <button class="hv-pill" data-testid=${opts.newTestid} @click=${opts.onNew}>
        ${icon('plus', 15)}${opts.newLabel}
      </button>
    </div>`;
  }

  /** The commit row every inline form and guard ends with; `danger` for a guard's. */
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

  private _failure(testid: string, message: string | null) {
    return message ? html`<div class="failure" role="alert" data-testid=${testid}>${message}</div>` : null;
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
      this._locError = errorText(err, 'hv.organize.locationSaveFailed');
    }
  }

  private async _deleteLocation(node: LocationTreeNode) {
    const children = node.children?.length ?? 0;
    const items = node.subtree_item_count ?? 0;
    if (children > 0 || items > 0) {
      // The backend refuses a non-empty location; say why before asking it.
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
        message: errorText(err, 'hv.organize.locationDeleteFailed'),
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

  private _progress(
    kind: RewriteKind,
    done: number,
    total: number,
    finished = false,
    failed: BulkFailure[] = [],
    error: string | null = null,
  ) {
    this._rewrite = { kind, done, total, failed, finished, error };
  }

  /**
   * Fold one location into another and delete it, as the three moves it
   * decomposes into: re-file its direct items in one batch, re-parent each
   * child subtree, delete the emptied location. The delete is skipped if
   * anything before it failed, so the error reported is the real one.
   */
  private async _runLocationMerge(source: LocationTreeNode, targetId: string) {
    this._mergingLocation = null;
    this._progress('merge', 0, 0);

    let items: Item[];
    try {
      items = (await this.store?.listAllMatching({ location_id: source.id, include_subtree: false })) ?? [];
    } catch (err) {
      this._progress('merge', 0, 0, true, [], errorText(err, 'hv.organize.locationReadFailed'));
      return;
    }

    const ops = items.map((i) =>
      makeBulkOp('item_move', { item_id: i.id, location_id: targetId, expected_version: i.version }),
    );
    this._progress('merge', 0, ops.length);
    const outcome = ops.length
      ? await this.store?.bulkExecute(ops, {
          onProgress: (done, total) => this._progress('merge', done, total),
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
        error = errorText(err, 'hv.organize.mergeMovedNotRemoved', { name: source.name });
      }
    } else {
      error = t('hv.organize.mergeKeptSource', {
        name: source.name,
        items: counted(failed.length, 'item'),
      });
    }

    this._progress('merge', ops.length, ops.length, true, failed, error);
  }

  private _showLocation(locationId: string | null) {
    if (!locationId) return;
    this.store?.setFilters({ locationIds: [locationId], orphansOnly: false });
    this._browse();
  }

  /** A tab asks for the expanded surface; the dialog answers it and closes. */
  private _onTabBrowse = (e: Event) => {
    e.stopPropagation();
    this._browse();
  };

  /** Close, asking the host for the expanded surface to show what was picked. */
  private _browse() {
    this._emit('browse');
    this._close();
  }

  // ---------- Render ----------
  /**
   * The consequence of the area select, spelled out before Save: an area
   * belongs to a whole location tree, so a change reaches locations the editor
   * does not show.
   */
  private _renderAreaPreview(preview: AreaChangePreview) {
    const areas = this.st?.areasCache?.areas ?? [];
    const chip = renderAreaChip(areaNameById(areas, preview.effectiveAreaId));
    const wholeTree = preview.treeSize > 1 && preview.rootName !== null;
    const size = counted(preview.treeSize, 'location');
    // The chip is an element, so the sentence is split at its placeholder.
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
          })}${preview.editsRoot ? '' : t('hv.organize.areaStoredOnRoot', { root: preview.rootName ?? '' })}`
        : around('hv.organize.areaAssignOne');
    } else if (preview.kind === 'clear-tree') {
      line = wholeTree
        ? html`${t('hv.organize.areaClearTree', { root: preview.rootName ?? '', size })}`
        : html`${t('hv.organize.areaClearOne')}`;
    } else if (this._locArea === null && preview.effectiveAreaId !== null) {
      // No change, but name the area the empty option inherits.
      line = around('hv.organize.areaInherited');
    } else {
      return null;
    }

    return html`<span class="note" data-testid="location-area-preview">${line}</span>`;
  }

  /** What the parent button reads; a top-level one names its area, which the picker also sets. */
  private _parentLabel(parent: LocationTreeNode | null, areas: readonly AreaRef[]): string {
    if (parent) return parent.name;
    const areaName = areaNameById(areas, this._locArea);
    return areaName ? t('hv.organize.topLevelIn', { area: areaName }) : t('hv.organize.topLevel');
  }

  private _renderLocationEditor(nodeId: string | 'new') {
    const tree = this.st?.locationTreeCache ?? [];
    const node = nodeId === 'new' ? null : this._findNode(tree, nodeId);
    const parent = this._locParent ? this._findNode(tree, this._locParent) : null;
    const areas = this.st?.areasCache?.areas ?? [];
    // A nested location inherits from its tree's root; a top-level one has no area.
    const areaDefaultLabel = parent ? t('hv.organize.areaInherit') : t('hv.term.noArea');
    const preview = areaChangePreview(
      this.st?.locationsFlatCache ?? [],
      { id: nodeId === 'new' ? null : nodeId, parentId: this._locParent },
      this._locArea,
    );

    return keyed(
      nodeId,
      html`<div class="expander" data-testid="location-editor" data-field="#org-loc-name" ${ref(this._reveal)}>
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
                @select=${(e: HvEvent<'hv-location-tree', 'select'>) => {
                  this._locParent = e.detail.locationId;
                }}
                @select-area=${(e: HvEvent<'hv-location-tree', 'select-area'>) => {
                  // Picking an area moves the location to the top level, in it.
                  this._locParent = null;
                  this._locArea = e.detail.areaId;
                }}
              ></hv-location-tree>`,
            )}
          </div>
          ${
            // The id automations pass as location_id / parent_id; unsaved has none.
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
        ${this._failure('location-error', this._locError)}
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
          @select=${(e: HvEvent<'hv-location-tree', 'select'>) => {
            this._mergeTarget = e.detail.locationId;
          }}
        ></hv-location-tree>`,
      )}
      <span class="note" data-testid="merge-effect">
        ${
          target
            ? t('hv.organize.mergeEffect', {
                contents: parts.join(t('hv.import.and')),
                target: target.name,
                source: source.name,
              })
            : // An area cannot take a merge; the note points at editing instead.
              `${t('hv.organize.mergePickLocation')}${
                (this.st?.areasCache?.areas?.length ?? 0) > 0 ? t('hv.organize.mergeAreasNote') : ''
              }`
        }
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
        ${this._rewrite ? this._renderRewrite(this._rewrite) : null}
        <hv-location-tree
          data-testid="organize-tree"
          manage
          showCounts
          ?mobile=${this.mobile}
          .nodes=${tree}
          .areas=${this.st?.areasCache?.areas ?? []}
          .filterText=${this._filter}
          @select=${(e: HvEvent<'hv-location-tree', 'select'>) => this._showLocation(e.detail.locationId)}
          @edit-location=${(e: HvEvent<'hv-location-tree', 'edit-location'>) =>
            this._startLocationEdit(e.detail.locationId)}
          @merge-location=${(e: HvEvent<'hv-location-tree', 'merge-location'>) =>
            this._startLocationMerge(e.detail.locationId)}
          @more-location=${(e: HvEvent<'hv-location-tree', 'more-location'>) => {
            const { locationId } = e.detail;
            this._sheetLocation = this._sheetLocation === locationId ? null : locationId;
            this._editingLocation = null;
            this._mergingLocation = null;
          }}
          @delete-location=${(e: HvEvent<'hv-location-tree', 'delete-location'>) => {
            void this._deleteLocation(e.detail.node);
          }}
        ></hv-location-tree>
        ${sheeted ? this._renderLocationSheet(sheeted) : null}
        ${merging ? this._renderLocationMerge(merging) : null}
        ${
          this._editingLocation && this._editingLocation !== 'new'
            ? this._renderLocationEditor(this._editingLocation)
            : null
        }
        ${
          this._guard
            ? keyed(
                this._guard.locationId,
                html`<div class="guard" role="alert" data-testid="location-guard" ${ref(this._reveal)}>
                <span class="guard-mark">${icon('alert', 17)}</span>
                <span>${this._guard.message}</span>
              </div>`,
              )
            : null
        }
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
    if (rewrite.failed.length) return t(`hv.organize.rewrite.partial.${rewrite.kind}`, { done, total });
    return t(`hv.organize.rewrite.done.${rewrite.kind}`, { total });
  }

  private _renderRewrite(rewrite: RewriteState) {
    const pct = rewrite.total ? Math.round((rewrite.done / rewrite.total) * 100) : 100;
    const trouble = rewrite.failed.length > 0 || !!rewrite.error;
    return html`<div class="expander" data-testid="rewrite-status">
      <div style="display:flex;gap:8px;font-size:12.5px">
        <span data-testid="rewrite-label">${this._rewriteSummary(rewrite)}</span>
        ${
          rewrite.failed.length
            ? html`<span style="margin-left:auto" data-testid="rewrite-failed"
              >${t('hv.bulk.progressFailed', { count: rewrite.failed.length })}</span
            >`
            : null
        }
      </div>
      ${rewrite.finished ? null : html`<div class="track"><div class="fill" style="width:${pct}%"></div></div>`}
      ${
        rewrite.error
          ? html`<div class="failure" role="alert" data-testid="rewrite-error">
            ${icon('alertCircle', 16)}<span>${rewrite.error}</span>
          </div>`
          : null
      }
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
      ${rewrite.finished && !trouble ? null : html`<span class="note">${t('hv.organize.rewriteNote')}</span>`}
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

  // The cache keeps the statuses tab's open editor across a close, as it is kept across a tab switch.
  override render() {
    return cache(this.open ? this._renderOpen() : nothing);
  }

  private _renderOpen() {
    return html`
      ${this._modal.render(
        { label: t('hv.organize.title'), testid: 'organize-dialog', onClose: this._close },
        html`
          <div class="head">
            ${
              this.mobile
                ? html`<button
                  class="hv-icon-button"
                  data-testid="organize-back"
                  aria-label=${t('hv.action.back')}
                  @click=${this._close}
                >
                  ${icon('arrowLeft', 21)}
                </button>`
                : null
            }
            <h2>${t('hv.organize.title')}</h2>
            ${
              this.mobile
                ? null
                : html`<button
                  class="hv-icon-button"
                  data-testid="organize-close"
                  aria-label=${t('hv.action.close')}
                  @click=${this._close}
                >
                  ${icon('close', 20)}
                </button>`
            }
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
          ${cache(
            this.tab === 'statuses'
              ? html`<hv-organize-statuses
                  ?mobile=${this.mobile}
                  .store=${this.store}
                  .opening=${this._isOpening}
                  @browse=${this._onTabBrowse}
                ></hv-organize-statuses>`
              : html`${keyed(
                  `${this._openings}:${this.tab}`,
                  this.tab === 'locations'
                    ? this._renderLocationsTab()
                    : html`<hv-organize-values
                        ?mobile=${this.mobile}
                        .store=${this.store}
                        .kind=${this.tab === 'tags' ? 'tag' : 'category'}
                        .opening=${this._isOpening}
                        @browse=${this._onTabBrowse}
                      ></hv-organize-values>`,
                )}`,
          )}
        `,
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-organize-dialog': HVOrganizeDialog;
  }
}
