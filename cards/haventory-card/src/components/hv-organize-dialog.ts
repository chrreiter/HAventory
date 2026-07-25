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
import type { Store } from '../store/store';
import type { BulkFailure, DistinctValue, LocationTreeNode, StoreState } from '../store/types';
import './hv-confirm';
import './hv-location-tree';

export type OrganizeTab = 'locations' | 'categories' | 'tags';

interface RewriteState {
  label: string;
  done: number;
  total: number;
  failed: BulkFailure[];
  finished: boolean;
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
  /** Value row expanded for rename or merge, keyed `${kind}:${value}`. */
  @state() private _editingValue: { value: string; mode: 'rename' | 'merge' } | null = null;
  @state() private _valueDraft = '';
  @state() private _rewrite: RewriteState | null = null;
  @state() private _confirmRemove: string | null = null;
  @state() private _sheetValue: string | null = null;

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

  private _renderLocationsTab() {
    const tree = this.st?.locationTreeCache ?? [];
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
        <hv-location-tree
          data-testid="organize-tree"
          manage
          showCounts
          showAreas
          .nodes=${tree}
          .areas=${this.st?.areasCache?.areas ?? []}
          .filterText=${this._filter}
          @edit-location=${(e: CustomEvent) =>
            this._startLocationEdit((e.detail as { locationId: string }).locationId)}
          @delete-location=${(e: CustomEvent) => {
            const node = (e.detail as { node: LocationTreeNode }).node;
            void this._deleteLocation(node);
          }}
        ></hv-location-tree>
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

  private _renderRewrite() {
    const rewrite = this._rewrite;
    if (!rewrite) return null;
    const pct = rewrite.total ? Math.round((rewrite.done / rewrite.total) * 100) : 100;
    return html`<div class="expander" data-testid="rewrite-status">
      <div style="display:flex;gap:8px;font-size:12.5px">
        <span data-testid="rewrite-label">
          ${rewrite.finished
            ? `${rewrite.label} finished — ${rewrite.total - rewrite.failed.length} of ${rewrite.total} rewritten`
            : `${rewrite.label} ${rewrite.done} of ${rewrite.total}`}
        </span>
        ${rewrite.failed.length
          ? html`<span style="margin-left:auto" data-testid="rewrite-failed"
              >${rewrite.failed.length} failed</span
            >`
          : null}
      </div>
      ${rewrite.finished ? null : html`<div class="track"><div class="fill" style="width:${pct}%"></div></div>`}
      ${rewrite.failed.map(
        (f) => html`<div class="failure" data-testid="rewrite-failure">
          ${icon('alertCircle', 16)}<span>${f.itemId} — ${describeFailure(f)}</span>
        </div>`,
      )}
      <span class="note">
        Sent as one batch call · already-rewritten items keep the new value, so cancelling or a failure
        part-way is not undone.
      </span>
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
      </div>
      <div class="body">
        ${this._rewrite ? this._renderRewrite() : null}
        ${values.length
          ? values.map(
              (v) => html`
                <div class="value-row" data-testid="value-row" data-value=${v.value}>
                  <span class="value-chip">${v.value}</span>
                  <button
                    class="count-link"
                    data-testid="value-count"
                    @click=${() => this._showValue(v.value)}
                  >
                    ${v.count} items
                  </button>
                  <span class="row-actions">
                    ${this.mobile
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
