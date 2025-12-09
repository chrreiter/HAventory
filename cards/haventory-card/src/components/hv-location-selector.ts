import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { nextZBase } from '../utils/zindex';
import type { Location } from '../store/types';

@customElement('hv-location-selector')
export class HVLocationSelector extends LitElement {
  static styles = css`
    :host { display: block; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 9998; }
    .panel-wrap { position: fixed; inset: 0; display: grid; place-items: center; z-index: 9999; }
    .panel {
      background: var(--card-background-color, var(--ha-card-background, #fff));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 8px;
      padding: 16px;
      max-width: 420px;
      width: calc(100vw - 32px);
      box-sizing: border-box;
    }
    .row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
    .row input[type="search"] {
      flex: 1;
      background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 8px;
    }
    .row input[type="search"]:focus {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -1px;
    }
    ul { list-style: none; padding-left: 12px; max-height: 320px; overflow: auto; margin: 8px 0; }
    li { padding: 4px 0; }
    .node { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .node:hover { color: var(--primary-color, #03a9f4); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .actions button {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
    }
    .actions button:hover { opacity: 0.9; }
    .create-section {
      margin-top: 8px;
    }
    .create-section input[type="text"] {
      flex: 1;
      background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 8px;
    }
    .create-section input[type="text"]:focus {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -1px;
    }
    .create-section select {
      flex: 1;
      background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 8px;
    }
    .create-section select:focus {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -1px;
    }
    .error-banner {
      background: var(--error-color, #db4437);
      color: #fff;
      padding: 8px;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .btn-secondary {
      background: var(--secondary-background-color, #f5f5f5);
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
    }
    .parent-display {
      padding: 8px;
      background: var(--secondary-background-color, #f5f5f5);
      border-radius: 4px;
      font-style: italic;
      color: var(--secondary-text-color, #666);
    }
    .field-label {
      font-size: 0.9em;
      color: var(--secondary-text-color, #666);
      margin-bottom: 4px;
    }
    .area-prefix {
      color: var(--secondary-text-color, #888);
    }
    .btn-edit {
      background: transparent;
      border: none;
      color: var(--secondary-text-color, #666);
      cursor: pointer;
      padding: 2px 6px;
      font-size: 0.85em;
      border-radius: 4px;
    }
    .btn-edit:hover {
      background: var(--secondary-background-color, #f5f5f5);
      color: var(--primary-color, #03a9f4);
    }
    .edit-form {
      padding: 12px;
      margin: 8px 0;
      background: var(--secondary-background-color, #f5f5f5);
      border-radius: 6px;
      border: 1px solid var(--divider-color, #ddd);
    }
    .edit-form input[type="text"],
    .edit-form select {
      width: 100%;
      box-sizing: border-box;
      background: var(--card-background-color, var(--ha-card-background, #fff));
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 8px;
    }
    .edit-form input[type="text"]:focus,
    .edit-form select:focus {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -1px;
    }
    .edit-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      justify-content: flex-end;
    }
    .edit-actions button {
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9em;
    }
    .btn-save {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
    }
    .btn-cancel-edit {
      background: transparent;
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, #ddd);
    }
  `;

  @property({ type: Boolean, reflect: true }) open: boolean = false;
  /** If true, show creation form instead of search/select. */
  @property({ type: Boolean }) createMode: boolean = false;
  @property({ attribute: false }) tree: unknown[] = [];
  @property({ attribute: false }) locations: Location[] | null = null;
  @property({ attribute: false }) areas: { id: string; name: string }[] = [];

  @state() private _q: string = '';
  @state() private _includeSubtree: boolean = true;
  @state() private _selectedId: string | null = null;
  @state() private _zBase: number | null = null;
  @state() private _createName: string = '';
  @state() private _createUnderSelected: boolean = false;
  @state() private _createAreaId: string | null = null;
  @state() private _creating: boolean = false;
  @state() private _createError: string | null = null;
  // Edit mode state
  @state() private _editingId: string | null = null;
  @state() private _editName: string = '';
  @state() private _editAreaId: string | null = null;
  @state() private _editing: boolean = false;
  @state() private _editError: string | null = null;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
      this.resetCreateState();
      this.createMode = false;
    }
  }

  private onCancel() {
    try {
      this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    } finally {
      this.open = false;
    }
  }
  private onSelect() {
    try {
      this.dispatchEvent(new CustomEvent('select', {
        detail: { locationId: this._selectedId, includeSubtree: this._includeSubtree },
        bubbles: true, composed: true,
      }));
    } finally {
      this.open = false;
    }
  }

  private onCreate() {
    const name = this._createName.trim();
    if (!name) {
      this._createError = 'Name is required.';
      return;
    }
    this._createError = null;
    this._creating = true;
    const parentId = this._createUnderSelected && this._selectedId ? this._selectedId : null;
    const areaId = this._createAreaId || null;
    this.dispatchEvent(new CustomEvent('create-location', {
      detail: { name, parentId, areaId },
      bubbles: true,
      composed: true,
    }));
  }

  public resetCreateState() {
    this._createName = '';
    this._createUnderSelected = false;
    this._createAreaId = null;
    this._creating = false;
    this._createError = null;
  }

  public setCreateError(msg: string) {
    this._createError = msg;
    this._creating = false;
  }

  public setCreatedLocation(locationId: string) {
    this._selectedId = locationId;
    this._creating = false;
    this._createError = null;
  }

  // ---------- Edit methods ----------
  private startEdit(loc: Location) {
    this._editingId = loc.id;
    this._editName = loc.name;
    this._editAreaId = loc.area_id ?? null;
    this._editError = null;
    this._editing = false;
  }

  private cancelEdit() {
    this._editingId = null;
    this._editName = '';
    this._editAreaId = null;
    this._editError = null;
    this._editing = false;
  }

  private onSaveEdit() {
    const name = this._editName.trim();
    if (!name) {
      this._editError = 'Name is required.';
      return;
    }
    this._editError = null;
    this._editing = true;
    this.dispatchEvent(new CustomEvent('update-location', {
      detail: { locationId: this._editingId, name, areaId: this._editAreaId },
      bubbles: true,
      composed: true,
    }));
  }

  public setEditError(msg: string) {
    this._editError = msg;
    this._editing = false;
  }

  public setEditSuccess() {
    this.cancelEdit();
  }

  /** Get effective area by walking up the location hierarchy */
  private _getEffectiveAreaId(location: Location): string | null {
    // Start with this location's area_id
    if (location.area_id) return location.area_id;
    // Walk up parent chain to find inherited area
    let parentId = location.parent_id;
    while (parentId) {
      const parent = (this.locations ?? []).find((l) => l.id === parentId);
      if (!parent) break;
      if (parent.area_id) return parent.area_id;
      parentId = parent.parent_id;
    }
    return null;
  }

  private _getAreaName(areaId: string | null): string | null {
    if (!areaId) return null;
    const area = this.areas.find((a) => a.id === areaId);
    return area?.name ?? null;
  }

  private renderList() {
    const list = (this.locations ?? []).filter((l) => {
      const q = this._q.trim().toLowerCase();
      if (!q) return true;
      return (
        (l.name || '').toLowerCase().includes(q) ||
        (l.path?.display_path || '').toLowerCase().includes(q)
      );
    });

    // Derive depth from display_path for indentation (simple heuristic): count separators
    function getDepth(path: string | undefined): number {
      if (!path) return 0;
      const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
      return Math.max(0, parts.length - 1);
    }

    return html`
      <ul aria-label="Location list">
        ${list.map((l) => {
          const depth = getDepth(l.path?.display_path);
          const effectiveAreaId = this._getEffectiveAreaId(l);
          const areaName = this._getAreaName(effectiveAreaId);
          const locationPath = l.path?.display_path || l.name;
          const isEditing = this._editingId === l.id;

          if (isEditing) {
            return html`
              <li style="padding-left: ${depth * 12}px;">
                <div class="edit-form">
                  ${this._editError ? html`<div class="error-banner" role="alert">${this._editError}</div>` : null}
                  <div class="row" style="flex-direction: column; align-items: stretch; margin-bottom: 8px;">
                    <span class="field-label">Name</span>
                    <input
                      type="text"
                      .value=${this._editName}
                      ?disabled=${this._editing}
                      @input=${(e: Event) => this._editName = (e.target as HTMLInputElement).value}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter') { e.preventDefault(); this.onSaveEdit(); }
                        if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
                      }}
                      aria-label="Location name"
                    />
                  </div>
                  <div class="row" style="flex-direction: column; align-items: stretch;">
                    <span class="field-label">Area</span>
                    <select
                      .value=${this._editAreaId ?? ''}
                      ?disabled=${this._editing}
                      @change=${(e: Event) => this._editAreaId = (e.target as HTMLSelectElement).value || null}
                      aria-label="Area"
                    >
                      <option value="">No area</option>
                      ${this.areas.map((a) => html`<option value=${a.id} ?selected=${this._editAreaId === a.id}>${a.name}</option>`)}
                    </select>
                  </div>
                  <div class="edit-actions">
                    <button class="btn-cancel-edit" @click=${() => this.cancelEdit()} ?disabled=${this._editing}>Cancel</button>
                    <button class="btn-save" @click=${() => this.onSaveEdit()} ?disabled=${this._editing || !this._editName.trim()}>
                      ${this._editing ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </li>
            `;
          }

          return html`
            <li style="padding-left: ${depth * 12}px;">
              <label class="node">
                <input type="radio" name="loc" .checked=${this._selectedId === l.id} @change=${() => this._selectedId = l.id} />
                ${areaName
                  ? html`<span><span class="area-prefix">${areaName} &gt;</span> ${locationPath}</span>`
                  : html`<span>${locationPath}</span>`}
                <button class="btn-edit" @click=${(e: Event) => { e.preventDefault(); e.stopPropagation(); this.startEdit(l); }} title="Edit location">✎</button>
              </label>
            </li>
          `;
        })}
      </ul>
    `;
  }

  private _getParentLocationDisplay(): string {
    if (!this._createUnderSelected || !this._selectedId) return '';
    const loc = (this.locations ?? []).find((l) => l.id === this._selectedId);
    return loc?.path?.display_path || loc?.name || this._selectedId;
  }

  private _renderCreateSection() {
    const parentDisplay = this._getParentLocationDisplay();
    return html`
      <div class="create-section">
        ${this._createError ? html`<div class="error-banner" role="alert">${this._createError}</div>` : null}
        <div class="row" style="flex-direction: column; align-items: stretch;">
          <span class="field-label">Name</span>
          <input
            type="text"
            placeholder="New location name"
            .value=${this._createName}
            ?disabled=${this._creating}
            @input=${(e: Event) => this._createName = (e.target as HTMLInputElement).value}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.onCreate(); } }}
            aria-label="New location name"
          />
        </div>
        <div class="row" style="flex-direction: column; align-items: stretch;">
          <span class="field-label">Area (optional)</span>
          <select
            .value=${this._createAreaId ?? ''}
            ?disabled=${this._creating}
            @change=${(e: Event) => this._createAreaId = (e.target as HTMLSelectElement).value || null}
            aria-label="Area"
          >
            <option value="">No area</option>
            ${this.areas.map((a) => html`<option value=${a.id} ?selected=${this._createAreaId === a.id}>${a.name}</option>`)}
          </select>
        </div>
        <div class="row">
          <label>
            <input
              type="checkbox"
              .checked=${this._createUnderSelected}
              ?disabled=${this._creating || !this._selectedId}
              @change=${(e: Event) => this._createUnderSelected = (e.target as HTMLInputElement).checked}
            />
            Create under selected location
          </label>
        </div>
        ${this._createUnderSelected && parentDisplay ? html`
          <div class="row" style="flex-direction: column; align-items: stretch;">
            <span class="field-label">Parent location</span>
            <div class="parent-display">${parentDisplay}</div>
          </div>
        ` : null}
        <div class="actions">
          <button class="btn-secondary" @click=${() => { this.createMode = false; this.resetCreateState(); }} ?disabled=${this._creating}>Back</button>
          <button @click=${this.onCreate} ?disabled=${this._creating || !this._createName.trim()}>
            ${this._creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;
    return html`
      <div class="backdrop" role="presentation" style="z-index: ${this._zBase ?? 9998};" @click=${this.onCancel}></div>
      <div class="panel-wrap" role="none" style="z-index: ${(this._zBase ?? 9998) + 1};">
        <div class="panel" role="dialog" aria-label="Location selector" @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.onCancel(); } }}>
          ${this.createMode ? html`
            <div class="row"><strong>Create New Location</strong></div>
            ${this._renderCreateSection()}
          ` : html`
            <div class="row"><input type="search" placeholder="Search" .value=${this._q} @input=${(e: Event) => this._q = (e.target as HTMLInputElement).value} /></div>
            ${this.renderList()}
            <div class="row">
              <label><input type="checkbox" .checked=${this._includeSubtree} @change=${(e: Event) => this._includeSubtree = (e.target as HTMLInputElement).checked} /> Include sublocations</label>
            </div>
            <div class="actions">
              <button class="btn-secondary" @click=${() => { this.createMode = true; }}>New location…</button>
              <button @click=${this.onCancel}>Cancel</button>
              <button @click=${this.onSelect}>Select</button>
            </div>
          `}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-location-selector': HVLocationSelector;
  }
}
