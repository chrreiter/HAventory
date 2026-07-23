import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { nextZBase } from '../utils/zindex';
import type { ImportPolicy, ImportPreview, ImportSummary } from '../store/types';

/**
 * Import dialog with a preview step (data safety / restore-from-backup).
 *
 * Presentational: the user pastes or loads a JSON backup document and picks a
 * conflict policy. It emits `preview` (validate + classify without mutating) and
 * then `execute` (apply). The container performs the WebSocket calls and pushes
 * results back via the `preview`, `summary`, `busy`, and `errorMessage`
 * properties — mirroring how `hv-location-selector` receives async outcomes.
 */
@customElement('hv-import-dialog')
export class HVImportDialog extends LitElement {
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
      max-width: 520px;
      width: calc(100vw - 32px);
      max-height: calc(100vh - 48px);
      overflow: auto;
      box-sizing: border-box;
      font: inherit;
    }
    h2 { font-size: 1.15em; margin: 0 0 4px; }
    p.hint { margin: 0 0 12px; color: var(--secondary-text-color, #666); font-size: 0.9em; }
    label { display: block; margin: 8px 0 4px; font-weight: 600; }
    textarea {
      width: 100%;
      min-height: 120px;
      box-sizing: border-box;
      font-family: monospace;
      font-size: 0.85em;
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 4px;
      padding: 8px;
      resize: vertical;
    }
    .policies { display: flex; gap: 16px; flex-wrap: wrap; margin: 6px 0; }
    .policies label { display: inline-flex; align-items: center; gap: 6px; font-weight: 400; margin: 0; }
    input[type="radio"] { accent-color: var(--primary-color, #03a9f4); }
    .summary-grid { display: grid; grid-template-columns: auto repeat(4, 1fr); gap: 4px 10px; margin: 8px 0; align-items: center; }
    .summary-grid .head { font-weight: 600; }
    .errors { margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: #fdecea; color: #611a15; border: 1px solid #f5c6cb; }
    .errors ul { margin: 4px 0 0; padding-left: 18px; }
    .errors code { font-family: monospace; }
    .ok-banner { margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: #e6f4ea; color: #0f5132; border: 1px solid #badbcc; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    button {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font: inherit;
    }
    button.secondary { background: var(--secondary-background-color, #e0e0e0); color: var(--primary-text-color, #212121); }
    button:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .filename { font-size: 0.85em; color: var(--secondary-text-color, #666); margin-left: 8px; }
  `;

  @property({ type: Boolean, reflect: true }) open = false;
  /** Preview report from the container (null until a preview runs). */
  @property({ attribute: false }) preview: ImportPreview | null = null;
  /** Success summary from the container (null until an import completes). */
  @property({ attribute: false }) summary: ImportSummary | null = null;
  /** True while a WS call is in flight (disables actions). */
  @property({ type: Boolean }) busy = false;
  /** Container-level error (e.g. a WS failure) to surface to the user. */
  @property({ attribute: false }) errorMessage: string | null = null;

  @state() private _rawText = '';
  @state() private _policy: ImportPolicy = 'merge';
  @state() private _parseError: string | null = null;
  @state() private _fileName: string | null = null;
  @state() private _zBase: number | null = null;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      if (this.open) {
        this._zBase = nextZBase();
      } else {
        // Reset transient state whenever the dialog is closed.
        this._rawText = '';
        this._policy = 'merge';
        this._parseError = null;
        this._fileName = null;
        this.preview = null;
        this.summary = null;
        this.errorMessage = null;
      }
    }
  }

  private _onCancel = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
    this.open = false;
  };

  private _parseDocument(): unknown | undefined {
    const text = this._rawText.trim();
    if (!text) {
      this._parseError = 'Paste a backup document or choose a file first.';
      return undefined;
    }
    try {
      const parsed = JSON.parse(text);
      this._parseError = null;
      return parsed;
    } catch (e: unknown) {
      this._parseError = `Not valid JSON: ${(e as Error)?.message ?? 'parse error'}`;
      return undefined;
    }
  }

  private async _onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this._fileName = file.name;
    this._rawText = await file.text();
    // Reset any prior preview when a new document is loaded.
    this.preview = null;
    this.summary = null;
    this._parseError = null;
  }

  private _onPreview = () => {
    const document = this._parseDocument();
    if (document === undefined) return;
    this.dispatchEvent(
      new CustomEvent('preview', { detail: { document, policy: this._policy }, bubbles: true, composed: true }),
    );
  };

  private _onExecute = () => {
    const document = this._parseDocument();
    if (document === undefined) return;
    this.dispatchEvent(
      new CustomEvent('execute', { detail: { document, policy: this._policy }, bubbles: true, composed: true }),
    );
  };

  private _setPolicy(p: ImportPolicy) {
    this._policy = p;
    // Policy changed — a stale preview no longer matches the resolution.
    this.preview = null;
    this.summary = null;
  }

  private _renderCounts(label: string, counts?: { add: number; update: number; conflict: number; unchanged: number }) {
    const c = counts ?? { add: 0, update: 0, conflict: 0, unchanged: 0 };
    return html`
      <span class="head">${label}</span>
      <span data-testid="count-${label.toLowerCase()}-add">${c.add} add</span>
      <span data-testid="count-${label.toLowerCase()}-update">${c.update} update</span>
      <span data-testid="count-${label.toLowerCase()}-conflict">${c.conflict} conflict</span>
      <span data-testid="count-${label.toLowerCase()}-unchanged">${c.unchanged} unchanged</span>
    `;
  }

  render() {
    if (!this.open) return null;
    const preview = this.preview;
    const canImport = !!preview && preview.valid && !this.busy;
    return html`
      <div class="backdrop" role="presentation" style="z-index: ${this._zBase ?? 9998};" @click=${this._onCancel}></div>
      <div class="panel-wrap" role="none" style="z-index: ${(this._zBase ?? 9998) + 1};">
        <div class="panel" role="dialog" aria-modal="true" aria-label="Import inventory"
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this._onCancel(); } }}>
          <h2>Import inventory</h2>
          <p class="hint">
            Restore from a HAventory backup. Preview first to see what would change; nothing is
            written until you choose Import.
          </p>

          <label for="hv-import-file">Backup file (.json)</label>
          <div>
            <input
              id="hv-import-file"
              data-testid="import-file"
              type="file"
              accept="application/json,.json"
              @change=${this._onFile}
            />
            ${this._fileName ? html`<span class="filename" data-testid="import-filename">${this._fileName}</span>` : null}
          </div>

          <label for="hv-import-text">…or paste the document</label>
          <textarea
            id="hv-import-text"
            data-testid="import-text"
            .value=${this._rawText}
            @input=${(e: Event) => { this._rawText = (e.target as HTMLTextAreaElement).value; this.preview = null; this.summary = null; }}
            placeholder="{ &quot;haventory_export_version&quot;: 1, ... }"
          ></textarea>

          <label>On conflict</label>
          <div class="policies" data-testid="import-policies">
            ${(['merge', 'replace', 'skip'] as ImportPolicy[]).map((p) => html`
              <label>
                <input
                  type="radio"
                  name="policy"
                  data-testid="policy-${p}"
                  value=${p}
                  .checked=${this._policy === p}
                  @change=${() => this._setPolicy(p)}
                />
                <span>${p}</span>
              </label>
            `)}
          </div>

          ${this._parseError ? html`<div class="errors" data-testid="parse-error">${this._parseError}</div>` : null}

          ${preview && !preview.valid ? html`
            <div class="errors" data-testid="preview-errors">
              <strong>${preview.errors.length} problem${preview.errors.length === 1 ? '' : 's'} — nothing imported:</strong>
              <ul>
                ${preview.errors.slice(0, 20).map((err) => html`<li><code>${err.path}</code>: ${err.message}</li>`)}
              </ul>
            </div>
          ` : null}

          ${preview && preview.valid ? html`
            <div class="summary-grid" data-testid="preview-summary">
              <span class="head"></span><span class="head">add</span><span class="head">update</span><span class="head">conflict</span><span class="head">unchanged</span>
              ${this._renderCounts('Items', preview.counts.items)}
              ${this._renderCounts('Locations', preview.counts.locations)}
            </div>
          ` : null}

          ${this.summary ? html`
            <div class="ok-banner" data-testid="import-summary">
              Imported with policy <strong>${this.summary.policy}</strong>.
              Now ${this.summary.totals.items_total} item${this.summary.totals.items_total === 1 ? '' : 's'},
              ${this.summary.totals.locations_total} location${this.summary.totals.locations_total === 1 ? '' : 's'}.
            </div>
          ` : null}

          ${this.errorMessage ? html`<div class="errors" data-testid="import-error">${this.errorMessage}</div>` : null}

          <div class="actions">
            <button class="secondary" data-testid="import-close" @click=${this._onCancel}>${this.summary ? 'Close' : 'Cancel'}</button>
            <button data-testid="import-preview" @click=${this._onPreview} ?disabled=${this.busy}>Preview</button>
            <button data-testid="import-execute" @click=${this._onExecute} ?disabled=${!canImport}>Import</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-import-dialog': HVImportDialog;
  }
}
