import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { onEscape } from '../ui/keyboard';
import { icon } from '../ui/icons';
import { counted } from '../ui/plural';
import { nextZBase } from '../utils/zindex';
import { DialogFocus } from '../ui/dialog-focus';
import type { ImportBucketCounts, ImportPolicy, ImportPreview, ImportSummary } from '../store/types';

const POLICIES: { id: ImportPolicy; title: string; description: string }[] = [
  {
    id: 'merge',
    title: 'Merge',
    description: 'Keep existing items, update the ones present in the file, add the rest',
  },
  {
    id: 'replace',
    title: 'Replace',
    description: 'Delete everything not in the file — the file becomes the whole inventory',
  },
  { id: 'skip', title: 'Skip', description: "Only add items that don't exist yet" },
];

/**
 * Restore from a backup (mock 4d).
 *
 * The server-side dry run is mandatory and stays that way: nothing is written
 * until the preview has been seen. An invalid document comes back as a
 * structured list of JSON paths rather than counts, so that gets its own state
 * instead of being flattened into "import failed".
 */
@customElement('hv-import-sheet')
export class HVImportSheet extends LitElement {
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
        background: rgba(0, 0, 0, 0.35);
      }
      .wrap {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
      }
      .panel {
        width: 500px;
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
      .head {
        padding: 16px 20px 12px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .head .row {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .head h2 {
        margin: 0;
        flex: 1;
        font-size: 17px;
        font-weight: 500;
      }
      .head .sub {
        font-size: 12.5px;
        color: var(--hv-text-secondary);
        margin-top: 3px;
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 20px;
        display: grid;
        gap: 14px;
      }
      .tabs {
        display: flex;
        gap: 16px;
      }
      .tabs button {
        border: none;
        background: none;
        padding: 0 4px 7px;
        font: 400 13px var(--hv-font);
        color: var(--hv-text-secondary);
        border-bottom: 2px solid transparent;
      }
      .tabs button.on {
        color: var(--hv-primary-darker);
        font-weight: 500;
        border-bottom-color: var(--hv-primary);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-height: 132px;
        resize: vertical;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: var(--hv-input-bg);
        color: var(--hv-text);
        padding: 12px;
        font: 400 11.5px/1.6 ui-monospace, Menlo, monospace;
      }
      .policies {
        display: grid;
        gap: 8px;
      }
      .policy {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        background: none;
        text-align: left;
        color: inherit;
      }
      .policy.on {
        border-color: var(--hv-primary);
        background: var(--hv-primary-tint);
      }
      .radio {
        flex: none;
        width: 17px;
        height: 17px;
        border-radius: 50%;
        border: 1.5px solid var(--hv-text-tertiary);
        margin-top: 1px;
      }
      .policy.on .radio {
        border: 5px solid var(--hv-primary);
        background: var(--hv-surface);
      }
      .policy .title {
        font: 500 13.5px var(--hv-font);
      }
      .policy .desc {
        font-size: 12px;
        color: var(--hv-text-secondary);
        line-height: 1.45;
      }
      .tables {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .table {
        border: 1px solid var(--hv-divider);
        border-radius: 10px;
        overflow: hidden;
      }
      .table .caption {
        padding: 8px 12px;
        background: var(--hv-input-bg);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--hv-text-secondary);
      }
      .table .rows {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
      }
      .table .r {
        display: flex;
        padding: 8px 12px;
        background: var(--hv-surface);
        font-size: 13px;
      }
      .table .r span:last-child {
        margin-left: auto;
        font-weight: 500;
      }
      .table .r.add span:last-child {
        color: var(--hv-success);
      }
      .table .r.update span:last-child {
        color: var(--hv-primary-darker);
      }
      .table .r.conflict span:last-child {
        color: var(--hv-warn);
      }
      .table .r.unchanged {
        color: var(--hv-text-secondary);
      }
      .table .r.unchanged span:last-child {
        font-weight: 400;
      }
      .alert {
        display: flex;
        gap: 9px;
        padding: 11px 13px;
        border-radius: var(--hv-radius-input);
        font-size: 12.5px;
        line-height: 1.5;
      }
      .alert.warn {
        background: var(--hv-warn-bg);
        color: var(--hv-warn-deep);
      }
      .alert.warn .glyph {
        color: var(--hv-warn);
      }
      .alert.ok {
        background: var(--hv-primary-tint);
        color: var(--hv-success);
      }
      .fine {
        font-size: 12px;
        color: var(--hv-text-tertiary);
        line-height: 1.5;
      }
      .errors {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
        border: 1px solid var(--hv-row-divider);
        border-radius: 8px;
        overflow: hidden;
      }
      .error {
        padding: 10px 14px;
        background: var(--hv-surface);
      }
      .error .path {
        font: 400 11.5px ui-monospace, Menlo, monospace;
        color: var(--hv-primary-darker);
      }
      .error .msg {
        font-size: 12.5px;
        color: var(--hv-error);
        line-height: 1.45;
      }
      .foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px 16px;
      }
      .foot .hint {
        font-size: 12px;
        color: var(--hv-text-tertiary);
        margin-right: auto;
      }
      .primary {
        border: none;
        border-radius: var(--hv-radius-chip);
        background: var(--hv-primary);
        color: var(--hv-text-on-primary);
        padding: 9px 20px;
        font: 500 13.5px var(--hv-font);
      }
      .primary[disabled] {
        opacity: 0.5;
      }
      .reveal {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      .file-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ attribute: false }) preview: ImportPreview | null = null;
  @property({ attribute: false }) summary: ImportSummary | null = null;
  @property({ type: Boolean }) busy = false;
  /** A failure that is not a document-validation problem (storage, transport). */
  @property({ type: String }) errorMessage: string | null = null;

  @state() private _source: 'paste' | 'file' = 'paste';
  @state() private _text = '';
  @state() private _fileName: string | null = null;
  @state() private _policy: ImportPolicy = 'merge';
  @state() private _parseError: string | null = null;
  @state() private _zBase = 0;
  @state() private _copied = false;


  /** Opening a surface must put focus in it, or Escape never reaches it. */
  private _dialogFocus = new DialogFocus();

  protected updated() {
    this._dialogFocus.sync(this.open, () =>
      this.renderRoot.querySelector<HTMLElement>('[data-testid="import-sheet"]'),
    );
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      this._zBase = nextZBase();
      this._source = 'paste';
      this._text = '';
      this._fileName = null;
      this._policy = 'merge';
      this._parseError = null;
      this._copied = false;
    }
  }

  private _parsed(): unknown | null {
    try {
      const doc = JSON.parse(this._text);
      this._parseError = null;
      return doc;
    } catch (err) {
      this._parseError = `That is not valid JSON — ${(err as Error).message}`;
      return null;
    }
  }

  private _close = () => {
    this.open = false;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private _emit(name: string) {
    const document = this._parsed();
    if (document === null) return;
    this.dispatchEvent(
      new CustomEvent(name, { detail: { document, policy: this._policy }, bubbles: true, composed: true }),
    );
  }

  private async _onFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this._fileName = file.name;
    this._text = await file.text();
    this._parseError = null;
  }

  private _copyErrors() {
    const text = (this.preview?.errors ?? []).map((e) => `${e.path}: ${e.message}`).join('\n');
    void navigator.clipboard?.writeText?.(text).catch(() => undefined);
    this._copied = true;
  }

  // ---------- States ----------
  private _renderInput() {
    return html`
      <div class="head">
        <div class="row"><h2>Import backup</h2></div>
        <div class="sub">Step 1 of 2 · nothing is written until you press Import</div>
      </div>
      <div class="body">
        <div class="tabs" role="tablist">
          ${(['paste', 'file'] as const).map(
            (source) => html`<button
              class=${this._source === source ? 'on' : ''}
              role="tab"
              aria-selected=${String(this._source === source)}
              data-testid="import-source"
              data-source=${source}
              @click=${() => {
                this._source = source;
              }}
            >
              ${source === 'paste' ? 'Paste JSON' : 'Choose file'}
            </button>`,
          )}
        </div>
        ${this._source === 'file'
          ? html`<div class="file-row">
              <label class="hv-pill outline">
                ${icon('upload', 15)} Choose file…
                <input class="reveal" type="file" accept="application/json,.json" data-testid="import-file" @change=${(e: Event) => void this._onFile(e)} />
              </label>
              <span data-testid="import-filename" style="font-size:12.5px;color:var(--hv-text-secondary)">
                ${this._fileName ?? 'No file chosen'}
              </span>
            </div>`
          : null}
        <textarea
          data-testid="import-text"
          aria-label="Backup JSON"
          placeholder='{ "haventory_export_version": 1, … }'
          .value=${this._text}
          @input=${(e: Event) => {
            this._text = (e.target as HTMLTextAreaElement).value;
            this._parseError = null;
          }}
        ></textarea>
        ${this._parseError
          ? html`<div class="alert warn" role="alert" data-testid="import-parse-error">
              <span class="glyph">${icon('alert', 18)}</span><span>${this._parseError}</span>
            </div>`
          : null}
        ${this.errorMessage
          ? html`<div class="alert warn" role="alert" data-testid="import-error">
              <span class="glyph">${icon('alertCircle', 18)}</span><span>${this.errorMessage}</span>
            </div>`
          : null}

        <div>
          <span class="hv-label">If an item already exists</span>
          <div class="policies" role="radiogroup" style="margin-top:6px" data-testid="import-policies">
            ${POLICIES.map(
              (policy) => html`<button
                class="policy ${this._policy === policy.id ? 'on' : ''}"
                role="radio"
                aria-checked=${String(this._policy === policy.id)}
                data-testid="import-policy"
                data-policy=${policy.id}
                @click=${() => {
                  this._policy = policy.id;
                  // A preview is only valid for the policy it was run with.
                  this.dispatchEvent(new CustomEvent('invalidate-preview', { bubbles: true, composed: true }));
                }}
              >
                <span class="radio"></span>
                <span>
                  <span class="title">${policy.title}</span>
                  <span class="desc" style="display:block">${policy.description}</span>
                </span>
              </button>`,
            )}
          </div>
        </div>
      </div>
      <div class="foot">
        <span class="hint">Import applies for every connected client</span>
        <button class="hv-text-button" data-testid="import-cancel" @click=${this._close}>Cancel</button>
        <button
          class="primary"
          data-testid="import-preview"
          ?disabled=${!this._text.trim() || this.busy}
          @click=${() => this._emit('preview')}
        >
          ${this.busy ? 'Checking…' : 'Preview'}
        </button>
      </div>
    `;
  }

  private _countTable(caption: string, counts: ImportBucketCounts | undefined) {
    const rows: [string, keyof ImportBucketCounts, string][] = [
      ['Add', 'add', 'add'],
      ['Update', 'update', 'update'],
      ['Conflict', 'conflict', 'conflict'],
      ['Unchanged', 'unchanged', 'unchanged'],
    ];
    return html`<div class="table">
      <div class="caption">${caption}</div>
      <div class="rows">
        ${rows.map(
          ([label, key, cls]) => html`<div class="r ${cls}" data-testid="import-count" data-key=${`${caption.toLowerCase()}-${key}`}>
            <span>${label}</span><span>${key === 'add' ? '+' : ''}${counts?.[key] ?? 0}</span>
          </div>`,
        )}
      </div>
    </div>`;
  }

  private _renderInvalid(preview: ImportPreview) {
    return html`
      <div class="head">
        <div class="row">
          <span style="color:var(--hv-error)">${icon('alertCircle', 20)}</span>
          <h2>This file can't be imported</h2>
        </div>
        <div class="sub">
          ${counted(preview.errors.length, 'problem')} found · nothing was changed
        </div>
      </div>
      <div class="body">
        <div class="errors" data-testid="import-errors">
          ${preview.errors.map(
            (err) => html`<div class="error" data-testid="import-error-row">
              <div class="path">${err.path}</div>
              <div class="msg">${err.message}</div>
            </div>`,
          )}
        </div>
      </div>
      <div class="foot">
        <span class="hint">Fix the file and preview again</span>
        <button class="hv-text-button" data-testid="import-copy-errors" @click=${() => this._copyErrors()}>
          ${this._copied ? 'Copied' : 'Copy errors'}
        </button>
        <button
          class="primary"
          data-testid="import-back"
          @click=${() =>
            this.dispatchEvent(new CustomEvent('invalidate-preview', { bubbles: true, composed: true }))}
        >
          Back to input
        </button>
      </div>
    `;
  }

  private _renderPreview(preview: ImportPreview) {
    const items = preview.counts.items;
    const locations = preview.counts.locations;
    const conflicts = preview.items.conflict.length + preview.locations.conflict.length;
    const willWrite = (items?.add ?? 0) + (items?.update ?? 0);

    return html`
      <div class="head">
        <div class="row"><h2>Import backup · preview</h2></div>
        <div class="sub">
          Step 2 of 2 · validated on the server, nothing written yet · policy
          <strong style="color:var(--hv-text)">${preview.policy}</strong>
        </div>
      </div>
      <div class="body">
        <div class="tables">${this._countTable('Items', items)}${this._countTable('Locations', locations)}</div>
        ${conflicts
          ? html`<div class="alert warn" data-testid="import-conflicts">
              <span class="glyph">${icon('alert', 18)}</span>
              <span>
                ${counted(conflicts, 'conflict')} — the file and this inventory both changed
                ${conflicts === 1 ? 'that entry' : 'those entries'}.
                ${preview.policy === 'merge'
                  ? "Merge keeps the file's values."
                  : preview.policy === 'skip'
                    ? 'Skip leaves them as they are.'
                    : 'Replace overwrites them.'}
              </span>
            </div>`
          : null}
        ${this.errorMessage
          ? html`<div class="alert warn" role="alert" data-testid="import-error">
              <span class="glyph">${icon('alertCircle', 18)}</span><span>${this.errorMessage}</span>
            </div>`
          : null}
        <div class="fine">
          Import is all-or-nothing: any failure rolls the whole document back. On success every connected card
          reloads its data.
        </div>
      </div>
      <div class="foot">
        <button
          class="hv-text-button"
          data-testid="import-back"
          @click=${() =>
            this.dispatchEvent(new CustomEvent('invalidate-preview', { bubbles: true, composed: true }))}
        >
          Back
        </button>
        <span class="hint"></span>
        <button class="hv-text-button" data-testid="import-cancel" @click=${this._close}>Cancel</button>
        <button
          class="primary"
          data-testid="import-execute"
          ?disabled=${this.busy}
          @click=${() => this._emit('execute')}
        >
          ${this.busy ? 'Importing…' : `Import ${items?.add ?? 0} + ${items?.update ?? 0}`}
        </button>
      </div>
      ${willWrite === 0
        ? html`<div class="foot" style="padding-top:0">
            <span class="hint" data-testid="import-nothing-to-do">
              Nothing in this file would change the inventory
            </span>
          </div>`
        : null}
    `;
  }

  private _renderSummary(summary: ImportSummary) {
    return html`
      <div class="head">
        <div class="row">
          <span style="color:var(--hv-success)">${icon('checkCircle', 20)}</span>
          <h2>Import complete</h2>
        </div>
      </div>
      <div class="body">
        <div class="alert ok" data-testid="import-summary">
          <span class="glyph">${icon('checkCircle', 18)}</span>
          <span>
            Imported ${summary.items.add} new, updated ${summary.items.update},
            ${counted(summary.locations.add, 'location')} added.
          </span>
        </div>
        <div class="fine">
          The inventory now holds ${counted(summary.totals.items_total, 'item')} across
          ${counted(summary.totals.locations_total, 'location')}. Every connected card has reloaded.
        </div>
      </div>
      <div class="foot">
        <span class="hint"></span>
        <button class="primary" data-testid="import-done" @click=${this._close}>Done</button>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;
    const z = this._zBase || 9998;
    const body = this.summary
      ? this._renderSummary(this.summary)
      : this.preview && !this.preview.valid
        ? this._renderInvalid(this.preview)
        : this.preview
          ? this._renderPreview(this.preview)
          : this._renderInput();

    return html`
      <div class="backdrop" role="presentation" style="z-index:${z}" @click=${this._close}></div>
      <div class="wrap" role="none" style="z-index:${z + 1}">
        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="Import backup"
          data-testid="import-sheet"
          @keydown=${onEscape(() => this._close())}
        >
          ${body}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-import-sheet': HVImportSheet;
  }
}
