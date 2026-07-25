import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { closestMatch } from '../ui/fuzzy';
import { describeRewrite, filterForValue, rewriteOps } from '../ui/value-rewrite';
import type { ValueKind } from '../ui/value-rewrite';
import { nextZBase } from '../utils/zindex';
import { DialogFocus } from '../ui/dialog-focus';
import { describeFailure } from './hv-bulk-bar';
import { makeBulkOp } from '../store/store';
import type { Store } from '../store/store';
import type { BulkFailure, DistinctValue, Item, LocationTreeNode, StoreState } from '../store/types';
import './hv-confirm';
import './hv-location-tree';

export type OrganizeTab = 'locations' | 'categories' | 'tags';

/** The three batch rewrites, and how each reads once it is over. */
const PAST_TENSE: Record<string, string> = {
  Merge: 'Merged',
  Rename: 'Renamed',
  Remove: 'Removed from',
};

interface RewriteState {
  label: string;
  done: number;
  total: number;
  failed: BulkFailure[];
  finished: boolean;
  /** A step outside the batch that failed — only a location merge has those. */
  error?: string | null;
}

/**
 * "Organize inventory" (mocks 2b / 2c, and 3a / 3b on mobile).
 *
 * One dialog with three tabs replaces the POC's separate category browser, tag
 * browser and location-selector management duties (open-items #12).
 *
 * Locations edit in place with a guarded delete — a location that still holds
 * items or children gets an inline explanation, never a browser confirm.
 * Categories and tags have no rename or merge endpoint, so those are batch
 * rewrites over every affected item, with the same progress and
 * partial-failure treatment bulk actions get.
 */
@customElement('hv-organize-dialog')
export class HVOrganizeDialog extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
      }
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
      }
      :host([mobile]) .wrap {
        padding: 0;
        place-items: stretch;
      }
      .panel {
        width: 620px;
        max-width: 100%;
        max-height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: var(--hv-surface);
        color: var(--hv-text);
        border-radius: var(--hv-radius-dialog);
        box-shadow: var(--hv-shadow-dialog);
        overflow: hidden;
      }
      /* Mobile is a full-bleed page, not a floating modal (mock 3a). */
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
        font: 400 13.5px var(--hv-font);
        color: var(--hv-text);
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
        padding: 11px 8px;
        border-radius: var(--hv-radius-input);
      }
      .value-row:hover {
        background: var(--hv-hover-overlay);
      }
      .value-chip {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-chip);
        padding: 4px 11px;
        font-size: 12.5px;
        color: var(--hv-chip-text);
      }
      .count-link {
        border: none;
        background: none;
        color: var(--hv-primary-dark);
        font: 400 12px var(--hv-font);
        padding: 0;
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
        gap: 9px;
        padding: 10px 12px;
        margin: 0 8px 8px;
        border-radius: var(--hv-radius-input);
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
        font-size: 12.5px;
        line-height: 1.5;
      }
      .guard .glyph {
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

  @state() private _zBase = 0;
  @state() private _filter = '';
  /** Location being edited, `'new'` for the create row, or null. */
  @state() private _editingLocation: string | 'new' | null = null;
  @state() private _locName = '';
  @state() private _locArea: string | null = null;
  @state() private _locParent: string | null = null;
  @state() private _locParentOpen = false;
  @state() private _locError: string | null = null;
  @state() private _guard: { locationId: string; message: string } | null = null;
  /** Location being merged away, with the location it is merging into. */
  @state() private _mergingLocation: string | null = null;
  @state() private _mergeTarget: string | null = null;
  @state() private _mergeTargetOpen = false;
  /** Location whose actions are open in the touch sheet. */
  @state() private _sheetLocation: string | null = null;
  /** Value row expanded for rename or merge, keyed `${kind}:${value}`. */
  @state() private _editingValue: { value: string; mode: 'rename' | 'merge' } | null = null;
  @state() private _valueDraft = '';
  @state() private _rewrite: RewriteState | null = null;
  @state() private _confirmRemove: string | null = null;
  @state() private _sheetValue: string | null = null;
  /** The "New category"/"New tag" row, open with the name being typed. */
  @state() private _creatingValue = false;
  @state() private _newValue = '';
  @state() private _newValueError: string | null = null;

  private storeUnsub?: () => void;

  private get st(): StoreState | null {
    return this.store?.state.value ?? null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.store && !this.storeUnsub) {
      this.storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.storeUnsub?.();
    this.storeUnsub = undefined;
  }


  /** Opening a surface must put focus in it, or Escape never reaches it. */
  private _dialogFocus = new DialogFocus();

  protected updated() {
    this._dialogFocus.sync(this.open, () =>
      this.renderRoot.querySelector<HTMLElement>('[data-testid="organize-dialog"]'),
    );
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('store') && this.store) {
      this.storeUnsub?.();
      this.storeUnsub = this.store.state.onChange(() => this.requestUpdate());
    }
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
      this._resetTransient();
    }
    if (changed.has('tab')) this._resetTransient();
  }

  private _resetTransient() {
    this._filter = '';
    this._editingLocation = null;
    this._editingValue = null;
    this._guard = null;
    this._locError = null;
    this._rewrite = null;
    this._sheetValue = null;
    this._creatingValue = false;
    this._newValue = '';
    this._newValueError = null;
    this._mergingLocation = null;
    this._mergeTarget = null;
    this._mergeTargetOpen = false;
    this._sheetLocation = null;
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

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
    this._locParentOpen = false;
    this._locError = null;
    this._guard = null;
  }

  private async _saveLocation() {
    const name = this._locName.trim();
    if (!name) {
      this._locError = 'A location needs a name.';
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
      this._locError = (err as { message?: string })?.message ?? 'Could not save that location.';
    }
  }

  private async _deleteLocation(node: LocationTreeNode) {
    const children = node.children?.length ?? 0;
    const items = node.subtree_item_count ?? 0;
    if (children > 0 || items > 0) {
      // Guard before asking the backend: it refuses a non-empty location, and
      // saying why up front beats surfacing a validation error after the fact.
      const parts: string[] = [];
      if (items) parts.push(`${items} item${items === 1 ? '' : 's'}`);
      if (children) parts.push(`${children} sub-location${children === 1 ? '' : 's'}`);
      this._guard = {
        locationId: node.id,
        message: `"${node.name}" still contains ${parts.join(' and ')}. Move or delete them first.`,
      };
      return;
    }
    this._guard = null;
    try {
      await this.store?.deleteLocation(node.id);
    } catch (err) {
      this._guard = {
        locationId: node.id,
        message: (err as { message?: string })?.message ?? 'Could not delete that location.',
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
    this._mergeTargetOpen = false;
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
    const label = 'Merge';
    this._mergingLocation = null;
    this._rewrite = { label, done: 0, total: 0, failed: [], finished: false, error: null };

    let items: Item[];
    try {
      items = (await this.store?.listAllMatching({ location_id: source.id, include_subtree: false })) ?? [];
    } catch (err) {
      this._rewrite = {
        label,
        done: 0,
        total: 0,
        failed: [],
        finished: true,
        error: (err as { message?: string })?.message ?? 'Could not read that location’s items.',
      };
      return;
    }

    const ops = items.map((i) =>
      makeBulkOp('item_move', { item_id: i.id, location_id: targetId, expected_version: i.version }),
    );
    this._rewrite = { label, done: 0, total: ops.length, failed: [], finished: false, error: null };
    const outcome = ops.length
      ? await this.store?.bulkExecute(ops, {
          onProgress: (done, total) => {
            this._rewrite = { label, done, total, failed: [], finished: false, error: null };
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
          `Moved the items, but "${source.name}" could not be removed.`;
      }
    } else {
      error = `"${source.name}" was kept: ${failed.length} item${failed.length === 1 ? '' : 's'} could not be moved.`;
    }

    this._rewrite = { label, done: ops.length, total: ops.length, failed, finished: true, error };
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
    return this.tab === 'tags' ? 'tag' : 'category';
  }

  /** True while the value exists only on the card, with no item carrying it. */
  private _isDraft(value: string): boolean {
    return this.store?.isDraftValue(this._kind, value) ?? false;
  }

  private _createValue() {
    const name = this._newValue.trim();
    if (!name) {
      this._newValueError = `A ${this._noun} needs a name.`;
      return;
    }
    if (!this.store?.addDraftValue(this._kind, name)) {
      this._newValueError = `"${name}" already exists.`;
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
    if (mode === 'merge') {
      // Pre-fill the closest existing value, which is usually the typo fix.
      const others = (this.tab === 'tags'
        ? (this.st?.distinctValuesCache?.tags ?? [])
        : (this.st?.distinctValuesCache?.categories ?? [])
      ).map((v) => v.value);
      this._valueDraft = closestMatch(value, others) ?? '';
    } else {
      this._valueDraft = value;
    }
  }

  /** Fetch every affected item, then rewrite them in one chunked batch. */
  private async _runRewrite(from: string, to: string | null, label: string) {
    const kind = this._kind;
    this._rewrite = { label, done: 0, total: 0, failed: [], finished: false };
    let items;
    try {
      items = (await this.store?.listAllMatching(filterForValue(kind, from))) ?? [];
    } catch {
      this._rewrite = { label, done: 0, total: 0, failed: [], finished: true };
      return;
    }
    const ops = rewriteOps(kind, items, from, to);
    if (!ops.length) {
      this._rewrite = { label, done: 0, total: 0, failed: [], finished: true };
      this._editingValue = null;
      return;
    }

    this._rewrite = { label, done: 0, total: ops.length, failed: [], finished: false };
    const outcome = await this.store?.bulkExecute(ops, {
      onProgress: (done, total, failed) => {
        this._rewrite = { label, done, total, failed: this._rewrite?.failed ?? [], finished: false };
        void failed;
      },
    });
    this._rewrite = {
      label,
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
    else this.store?.setFilters({ category: value });
    this._browse();
  }

  private _showLocation(locationId: string | null) {
    if (!locationId) return;
    this.store?.setFilters({ locationId, orphansOnly: false });
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
  private _renderLocationEditor(nodeId: string | 'new') {
    const tree = this.st?.locationTreeCache ?? [];
    const node = nodeId === 'new' ? null : this._findNode(tree, nodeId);
    const parent = this._locParent ? this._findNode(tree, this._locParent) : null;
    const areas = this.st?.areasCache?.areas ?? [];

    return html`<div class="expander" data-testid="location-editor">
      <div class="grid2">
        <div class="cell">
          <label class="hv-label" for="org-loc-name">Name</label>
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
        <div class="cell">
          <label class="hv-label" for="org-loc-area">Area (HA)</label>
          <select
            id="org-loc-area"
            class="control"
            data-testid="location-area"
            @change=${(e: Event) => {
              this._locArea = (e.target as HTMLSelectElement).value || null;
            }}
          >
            <option value="" ?selected=${!this._locArea}>
              Inherit${parent ? ` (${parent.name})` : ''}
            </option>
            ${areas.map(
              (a) => html`<option value=${a.id} ?selected=${this._locArea === a.id}>${a.name}</option>`,
            )}
          </select>
        </div>
        <div class="cell wide">
          <span class="hv-label">
            Parent location
            <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--hv-text-tertiary)">
              (moves whole subtree)
            </span>
          </span>
          <button
            class="control"
            data-testid="location-parent"
            aria-expanded=${String(this._locParentOpen)}
            @click=${() => {
              this._locParentOpen = !this._locParentOpen;
            }}
          >
            ${icon('mapMarker', 15)}<span class="value">${parent?.name ?? 'Top level'}</span>
            ${icon('chevronDown', 15)}
          </button>
          ${this._locParentOpen
            ? html`<div class="tree-holder">
                <hv-location-tree
                  data-testid="location-parent-tree"
                  .nodes=${tree}
                  .selectedId=${this._locParent}
                  .excludeSubtreeOf=${node?.id ?? null}
                  showAll
                  @select=${(e: CustomEvent) => {
                    this._locParent = (e.detail as { locationId: string | null }).locationId;
                    this._locParentOpen = false;
                  }}
                ></hv-location-tree>
              </div>`
            : null}
        </div>
      </div>
      ${this._locError
        ? html`<div class="failure" role="alert" data-testid="location-error">${this._locError}</div>`
        : null}
      <div class="actions">
        ${node
          ? html`<button
              class="hv-text-button danger"
              data-testid="location-delete"
              @click=${() => void this._deleteLocation(node)}
            >
              Delete
            </button>`
          : null}
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="location-cancel"
          @click=${() => {
            this._editingLocation = null;
          }}
        >
          Cancel
        </button>
        <button class="hv-pill" data-testid="location-save" @click=${() => void this._saveLocation()}>
          Save
        </button>
      </div>
    </div>`;
  }

  /** Touch has no hover, so a location's actions live in a sheet — as on the value rows. */
  private _renderLocationSheet(node: LocationTreeNode) {
    const count = node.subtree_item_count ?? 0;
    return html`<div class="expander" data-testid="location-sheet">
      <div class="sheet-actions">
        <button data-testid="location-sheet-show" @click=${() => this._showLocation(node.id)}>
          ${icon('magnify', 20)}Show ${count} item${count === 1 ? '' : 's'}
        </button>
        <button data-testid="location-sheet-edit" @click=${() => this._startLocationEdit(node.id)}>
          ${icon('pencil', 20)}Edit…
        </button>
        <button data-testid="location-sheet-merge" @click=${() => this._startLocationMerge(node.id)}>
          ${icon('callMerge', 20)}Merge into…
        </button>
        <button
          class="danger"
          data-testid="location-sheet-delete"
          @click=${() => {
            this._sheetLocation = null;
            void this._deleteLocation(node);
          }}
        >
          ${icon('del', 20)}Delete
        </button>
      </div>
    </div>`;
  }

  /** The merge step: pick where this location's contents should end up. */
  private _renderLocationMerge(source: LocationTreeNode) {
    const tree = this.st?.locationTreeCache ?? [];
    const target = this._mergeTarget ? this._findNode(tree, this._mergeTarget) : null;
    const items = source.direct_item_count ?? 0;
    const children = source.children?.length ?? 0;
    const parts = [`${items} item${items === 1 ? '' : 's'}`];
    if (children) parts.push(`${children} sub-location${children === 1 ? '' : 's'}`);

    return html`<div class="expander" data-testid="location-merge">
      <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
        <span class="value-chip" style="text-decoration: line-through">${source.name}</span>
        ${icon('arrowRight', 18)}
        <button
          class="control"
          style="flex:1;min-width:180px"
          data-testid="merge-target"
          aria-expanded=${String(this._mergeTargetOpen)}
          @click=${() => {
            this._mergeTargetOpen = !this._mergeTargetOpen;
          }}
        >
          ${icon('mapMarker', 15)}<span class="value">${target?.name ?? 'merge into…'}</span>
          ${icon('chevronDown', 15)}
        </button>
      </div>
      ${this._mergeTargetOpen
        ? html`<div class="tree-holder">
            <hv-location-tree
              data-testid="merge-target-tree"
              .nodes=${tree}
              .selectedId=${this._mergeTarget}
              .excludeSubtreeOf=${source.id}
              @select=${(e: CustomEvent) => {
                this._mergeTarget = (e.detail as { locationId: string | null }).locationId;
                this._mergeTargetOpen = false;
              }}
            ></hv-location-tree>
          </div>`
        : null}
      <span class="note" data-testid="merge-effect">
        ${target
          ? `${parts.join(' and ')} move to "${target.name}", then "${source.name}" is deleted.
             Items in sub-locations stay where they are; their paths just change.`
          : 'Pick a location to continue.'}
      </span>
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="merge-cancel"
          @click=${() => {
            this._mergingLocation = null;
          }}
        >
          Cancel
        </button>
        <button
          class="hv-pill"
          data-testid="merge-apply"
          ?disabled=${!this._mergeTarget}
          @click=${() => {
            if (this._mergeTarget) void this._runLocationMerge(source, this._mergeTarget);
          }}
        >
          Merge
        </button>
      </div>
    </div>`;
  }

  private _renderLocationsTab() {
    const tree = this.st?.locationTreeCache ?? [];
    const merging = this._mergingLocation ? this._findNode(tree, this._mergingLocation) : null;
    const sheeted = this._sheetLocation ? this._findNode(tree, this._sheetLocation) : null;
    return html`
      <div class="toolbar">
        <label class="search">
          ${icon('magnify', 17)}
          <span class="hv-sr-only">Filter locations</span>
          <input
            data-testid="organize-filter"
            placeholder="Filter locations…"
            .value=${this._filter}
            @input=${(e: Event) => {
              this._filter = (e.target as HTMLInputElement).value;
            }}
          />
        </label>
        <button
          class="hv-pill"
          data-testid="organize-new-location"
          @click=${() => this._startLocationEdit('new')}
        >
          ${icon('plus', 15)}New location
        </button>
      </div>
      <div class="body">
        ${this._editingLocation === 'new' ? this._renderLocationEditor('new') : null}
        ${this._rewrite ? this._renderRewrite() : null}
        <hv-location-tree
          data-testid="organize-tree"
          manage
          showCounts
          showAreas
          ?touch=${this.mobile}
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
          ? html`<div class="guard" role="alert" data-testid="location-guard">
              <span class="glyph">${icon('alert', 17)}</span>
              <span>${this._guard.message}</span>
            </div>`
          : null}
      </div>
    `;
  }

  /** What the status line says, in as few words as the outcome allows. */
  private _rewriteSummary(rewrite: RewriteState): string {
    if (!rewrite.finished) return `${rewrite.label} ${rewrite.done} of ${rewrite.total}`;
    if (!rewrite.total) return `Nothing to ${rewrite.label.toLowerCase()}.`;
    const done = rewrite.total - rewrite.failed.length;
    const past = PAST_TENSE[rewrite.label] ?? rewrite.label;
    // The partial case is the only one that needs both numbers.
    if (rewrite.failed.length) return `${past} ${done} of ${rewrite.total} items`;
    return `${past} ${rewrite.total} item${rewrite.total === 1 ? '' : 's'}`;
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
              >${rewrite.failed.length} failed</span
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
          ${icon('alertCircle', 16)}<span>${f.itemId} — ${describeFailure(f)}</span>
        </div>`,
      )}
      ${
        // Only worth saying while it can still be interrupted, or when something
        // did go wrong and "how much of this stands?" is a live question.
        rewrite.finished && !trouble
          ? null
          : html`<span class="note">
              Sent as one batch call · already-rewritten items keep the new value, so cancelling or a
              failure part-way is not undone.
            </span>`
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
          Dismiss
        </button>
      </div>
    </div>`;
  }

  private _renderValueEditor(value: string, count: number) {
    const editing = this._editingValue!;
    const merging = editing.mode === 'merge';
    const others = (this.tab === 'tags'
      ? (this.st?.distinctValuesCache?.tags ?? [])
      : (this.st?.distinctValuesCache?.categories ?? [])
    )
      .map((v) => v.value)
      .filter((v) => v !== value);
    const target = this._valueDraft.trim();

    return html`<div class="expander" data-testid="value-editor" data-mode=${editing.mode}>
      <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap">
        <span class="value-chip" style=${merging ? 'text-decoration: line-through' : ''}>${value}</span>
        <span style="font-size:12.5px;color:var(--hv-text-secondary)">${count} items</span>
        ${merging ? icon('arrowRight', 18) : null}
        <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px">
          <span class="hv-sr-only">${merging ? 'Merge into' : 'New name'}</span>
          <input
            class="control"
            data-testid="value-target"
            list="hv-organize-values"
            placeholder=${merging ? 'merge into…' : 'new name…'}
            .value=${this._valueDraft}
            @input=${(e: Event) => {
              this._valueDraft = (e.target as HTMLInputElement).value;
            }}
          />
        </label>
        <datalist id="hv-organize-values">
          ${others.map((v) => html`<option value=${v}></option>`)}
        </datalist>
      </div>
      <span class="note" data-testid="value-effect">
        ${target ? describeRewrite(this._kind, count, value, target) : 'Pick a name to continue.'}
      </span>
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="value-cancel"
          @click=${() => {
            this._editingValue = null;
          }}
        >
          Cancel
        </button>
        <button
          class="hv-pill"
          data-testid="value-apply"
          ?disabled=${!target || target === value}
          @click=${() => void this._runRewrite(value, target, merging ? 'Merge' : 'Rename')}
        >
          ${merging ? 'Merge' : 'Rename'}
        </button>
      </div>
    </div>`;
  }

  private _renderValueCreator() {
    return html`<div class="expander" data-testid="value-create">
      <label style="display:flex;align-items:center;gap:8px">
        <span class="hv-sr-only">New ${this._noun}</span>
        <input
          class="control"
          data-testid="new-value-name"
          placeholder=${`New ${this._noun}…`}
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
      <span class="note">
        A ${this._noun} exists through the items using it — there is nothing to create on the server. This
        one is kept on the card and offered while editing items, until an item takes it.
      </span>
      <div class="actions">
        <span class="spacer"></span>
        <button
          class="hv-text-button"
          data-testid="new-value-cancel"
          @click=${() => {
            this._creatingValue = false;
            this._newValueError = null;
          }}
        >
          Cancel
        </button>
        <button
          class="hv-pill"
          data-testid="new-value-create"
          ?disabled=${!this._newValue.trim()}
          @click=${() => this._createValue()}
        >
          Create
        </button>
      </div>
    </div>`;
  }

  private _renderValuesTab() {
    const values = this._values;
    const noun = this.tab === 'tags' ? 'tags' : 'categories';
    return html`
      <div class="toolbar">
        <label class="search">
          ${icon('magnify', 17)}
          <span class="hv-sr-only">Filter ${noun}</span>
          <input
            data-testid="organize-filter"
            placeholder=${`Filter ${noun}…`}
            .value=${this._filter}
            @input=${(e: Event) => {
              this._filter = (e.target as HTMLInputElement).value;
            }}
          />
        </label>
        <span style="font-size:12.5px;color:var(--hv-text-secondary)" data-testid="organize-value-count">
          ${values.length} ${noun}
        </span>
        <button
          class="hv-pill"
          data-testid="organize-new-value"
          @click=${() => {
            this._creatingValue = true;
            this._newValue = '';
            this._newValueError = null;
            this._editingValue = null;
          }}
        >
          ${icon('plus', 15)}New ${this._noun}
        </button>
      </div>
      <div class="body">
        ${this._creatingValue ? this._renderValueCreator() : null}
        ${this._rewrite ? this._renderRewrite() : null}
        ${values.length
          ? values.map(
              (v) => html`
                <div class="value-row" data-testid="value-row" data-value=${v.value}>
                  <span class="value-chip">${v.value}</span>
                  ${this._isDraft(v.value)
                    ? html`<span class="draft-note" data-testid="value-draft">
                        new · not saved until an item uses it
                      </span>`
                    : html`<button
                        class="count-link"
                        data-testid="value-count"
                        @click=${() => this._showValue(v.value)}
                      >
                        ${v.count} items
                      </button>`}
                  <span class="row-actions">
                    ${this._isDraft(v.value)
                      ? html`<button
                          class="danger"
                          data-testid="value-discard"
                          aria-label=${`Discard ${v.value}`}
                          title="Discard"
                          @click=${() => this.store?.removeDraftValue(this._kind, v.value)}
                        >
                          ${icon('del', 16)}
                        </button>`
                      : this.mobile
                      ? html`<button
                          data-testid="value-more"
                          aria-label=${`Actions for ${v.value}`}
                          @click=${() => {
                            this._sheetValue = v.value;
                          }}
                        >
                          ${icon('dotsVertical', 17)}
                        </button>`
                      : html`
                          <button
                            data-testid="value-rename"
                            aria-label=${`Rename ${v.value}`}
                            title="Rename"
                            @click=${() => this._startValueEdit(v.value, 'rename')}
                          >
                            ${icon('pencil', 16)}
                          </button>
                          <button
                            data-testid="value-merge"
                            aria-label=${`Merge ${v.value}`}
                            title="Merge into another"
                            @click=${() => this._startValueEdit(v.value, 'merge')}
                          >
                            ${icon('callMerge', 16)}
                          </button>
                          <button
                            class="danger"
                            data-testid="value-remove"
                            aria-label=${`Remove ${v.value}`}
                            title="Remove from every item"
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
              ${this._filter.trim() ? `No ${noun} match.` : `No ${noun} in use yet.`}
            </div>`}
      </div>
    `;
  }

  /** Touch has no hover, so the row's actions live in a sheet (mock 3b). */
  private _renderValueSheet(value: string, count: number) {
    const others = (this.tab === 'tags'
      ? (this.st?.distinctValuesCache?.tags ?? [])
      : (this.st?.distinctValuesCache?.categories ?? [])
    )
      .map((v) => v.value)
      .filter((v) => v !== value);
    const suggestion = closestMatch(value, others);
    return html`<div class="expander" data-testid="value-sheet">
      <div class="sheet-actions">
        <button data-testid="sheet-show" @click=${() => this._showValue(value)}>
          ${icon('magnify', 20)}Show ${count} items
        </button>
        <button data-testid="sheet-rename" @click=${() => this._startValueEdit(value, 'rename')}>
          ${icon('pencil', 20)}Rename…
        </button>
        <button data-testid="sheet-merge" @click=${() => this._startValueEdit(value, 'merge')}>
          ${icon('callMerge', 20)}Merge into…
          ${suggestion
            ? html`<span class="value-chip" style="margin-left:auto" data-testid="sheet-merge-suggestion"
                >${suggestion}</span
              >`
            : null}
        </button>
        <button
          class="danger"
          data-testid="sheet-remove"
          @click=${() => {
            this._sheetValue = null;
            this._confirmRemove = value;
          }}
        >
          ${icon('del', 20)}Remove from all items
        </button>
      </div>
    </div>`;
  }

  render() {
    if (!this.open) return null;
    const z = this._zBase || 9998;
    const removeCount =
      this._values.find((v) => v.value === this._confirmRemove)?.count ??
      (this.tab === 'tags'
        ? (this.st?.distinctValuesCache?.tags ?? [])
        : (this.st?.distinctValuesCache?.categories ?? [])
      ).find((v) => v.value === this._confirmRemove)?.count ??
      0;

    return html`
      <div class="backdrop" role="presentation" style="z-index:${z}" @click=${this._close}></div>
      <div class="wrap" role="none" style="z-index:${z + 1}">
        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="Organize inventory"
          data-testid="organize-dialog"
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              this._close();
            }
          }}
        >
          <div class="head">
            ${this.mobile
              ? html`<button class="hv-icon-button" data-testid="organize-back" aria-label="Back" @click=${this._close}>
                  ${icon('arrowLeft', 21)}
                </button>`
              : null}
            <h2>${this.mobile ? 'Organize' : 'Organize inventory'}</h2>
            ${this.mobile
              ? null
              : html`<button class="hv-icon-button" data-testid="organize-close" aria-label="Close" @click=${this._close}>
                  ${icon('close', 20)}
                </button>`}
          </div>
          <div class="tabs" role="tablist">
            ${(['locations', 'categories', 'tags'] as OrganizeTab[]).map(
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
                ${tab === 'locations' ? 'Locations' : tab === 'categories' ? 'Categories' : 'Tags'}
              </button>`,
            )}
          </div>
          ${this.tab === 'locations' ? this._renderLocationsTab() : this._renderValuesTab()}
        </div>
      </div>

      <hv-confirm
        data-testid="organize-confirm"
        ?open=${this._confirmRemove !== null}
        .heading=${`Remove "${this._confirmRemove}" from ${removeCount} item${removeCount === 1 ? '' : 's'}?`}
        message="The value is cleared on every item that carries it. The items themselves are not deleted."
        confirmLabel="Remove"
        destructive
        @confirm=${() => {
          const value = this._confirmRemove;
          this._confirmRemove = null;
          if (value) void this._runRewrite(value, null, 'Remove');
        }}
        @cancel=${() => {
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
