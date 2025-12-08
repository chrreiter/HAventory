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
          return html`
            <li style="padding-left: ${depth * 12}px;">
              <label class="node">
                <input type="radio" name="loc" .checked=${this._selectedId === l.id} @change=${() => this._selectedId = l.id} />
                <span>${l.path?.display_path || l.name}</span>
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
