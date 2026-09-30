import { t, tn } from '../i18n';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { Modal, modalChrome, modalSheet } from '../ui/modal';
import { icon } from '../ui/icons';
import { counted } from '../ui/plural';
import { copyText } from '../ui/clipboard';
import type { ImportBucketCounts, ImportPolicy, ImportPreview, ImportSummary } from '../store/types';

/** Name clashes listed one by one before the block switches to a count. */
const WARNING_LIST_LIMIT = 5;

/** The non-zero counts of both kinds, since either can be the whole document. */
function countedKinds(items: number, locations: number): string[] {
  const parts: string[] = [];
  if (items) parts.push(counted(items, 'item'));
  if (locations) parts.push(counted(locations, 'location'));
  return parts;
}

/** What the execute button promises to write. */
function importButtonLabel(itemWrites: number, locationWrites: number): string {
  const parts = countedKinds(itemWrites, locationWrites);
  return parts.length
    ? t('hv.import.button', { parts: parts.join(' · ') })
    : t('hv.import.buttonBare');
}

/** What the completed import did, as one sentence naming only what moved. */
export function importSummaryLine(summary: ImportSummary): string {
  const added = countedKinds(summary.items.add, summary.locations.add);
  const updated = countedKinds(summary.items.update, summary.locations.update);
  const parts: string[] = [];
  if (added.length) parts.push(t('hv.import.added', { what: added.join(t('hv.import.and')) }));
  if (updated.length)
    parts.push(t('hv.import.updated', { what: updated.join(t('hv.import.and')) }));
  if (!parts.length) return t('hv.import.nothingChanged');
  const sentence = parts.join(', ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

// A policy decides what happens to an item the file and the inventory share by
// id, never by name; each description says so and that nothing is deleted.
const policies = (): { id: ImportPolicy; title: string; description: string }[] => [
  {
    id: 'merge',
    title: t('hv.import.policy.merge'),
    description: t('hv.import.policy.mergeDescription'),
  },
  {
    id: 'replace',
    title: t('hv.import.policy.replace'),
    description: t('hv.import.policy.replaceDescription'),
  },
  {
    id: 'skip',
    title: t('hv.import.policy.skip'),
    description: t('hv.import.policy.skipDescription'),
  },
];

/** The translated name a policy was picked by, which the preview quotes back. */
function policyTitle(id: ImportPolicy): string {
  return policies().find((p) => p.id === id)?.title ?? id;
}

/**
 * Restore from a backup. Nothing is written until the server-side dry run's
 * preview has been seen; an invalid document gets its own state listing the
 * JSON paths at fault.
 */
@customElement('hv-import-sheet')
export class HVImportSheet extends LitElement {
  static styles = [
    tokens,
    base,
    modalChrome,
    css`
      .wrap {
        padding: 24px;
      }
      .panel {
        width: 500px;
        max-height: 100%;
        display: flex;
        flex-direction: column;
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
      .head .sub .policy-name {
        color: var(--hv-text);
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
      .warn-list {
        margin: 6px 0 0;
        /* Room for the marker, which sits outside the text box by default. */
        padding-inline-start: 18px;
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
    modalSheet,
  ];

  @property({ type: Boolean, reflect: true }) open = false;
  /** Phone viewport: rise from the bottom edge instead of centring. */
  @property({ type: Boolean, reflect: true }) mobile = false;
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
  @state() private _copied = false;

  private _modal = new Modal(this, { open: () => this.open });

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
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
      this._parseError = t('hv.import.invalidJson', { message: (err as Error).message });
      return null;
    }
  }

  private _close = () => {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  };

  private _invalidate = () => {
    this.dispatchEvent(new CustomEvent('invalidate-preview', { bubbles: true, composed: true }));
  };

  private _alert(testid: string, content: unknown, glyph: 'alert' | 'alertCircle' = 'alert', role?: string) {
    return html`<div class="alert warn" role=${role ?? nothing} data-testid=${testid}>
      <span class="glyph">${icon(glyph, 18)}</span><span>${content}</span>
    </div>`;
  }

  private _errorAlert() {
    return this.errorMessage ? this._alert('import-error', this.errorMessage, 'alertCircle', 'alert') : null;
  }

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

  private async _copyErrors() {
    const text = (this.preview?.errors ?? []).map((e) => `${e.path}: ${e.message}`).join('\n');
    this._copied = await copyText(text);
  }

  private _renderInput() {
    return html`
      <div class="head">
        <div class="row"><h2>${t('hv.import.title')}</h2></div>
        <div class="sub">${t('hv.import.step1')}</div>
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
              ${source === 'paste' ? t('hv.import.pasteJson') : t('hv.import.chooseFileTab')}
            </button>`,
          )}
        </div>
        ${this._source === 'file'
          ? html`<div class="file-row">
              <label class="hv-pill outline">
                ${icon('upload', 15)} ${t('hv.import.chooseFile')}
                <input class="reveal" type="file" accept="application/json,.json" data-testid="import-file" @change=${(e: Event) => void this._onFile(e)} />
              </label>
              <span data-testid="import-filename" style="font-size:12.5px;color:var(--hv-text-secondary)">
                ${this._fileName ?? t('hv.import.noFileChosen')}
              </span>
            </div>`
          : null}
        <textarea
          data-testid="import-text"
          aria-label=${t('hv.import.textareaLabel')}
          placeholder='{ "haventory_export_version": 1, … }'
          .value=${this._text}
          @input=${(e: Event) => {
            this._text = (e.target as HTMLTextAreaElement).value;
            this._parseError = null;
          }}
        ></textarea>
        ${this._parseError ? this._alert('import-parse-error', this._parseError, 'alert', 'alert') : null}
        ${this._errorAlert()}

        <div>
          <span class="hv-label">${t('hv.import.ifExists')}</span>
          <div class="policies" role="radiogroup" style="margin-top:6px" data-testid="import-policies">
            ${policies().map(
              (policy) => html`<button
                class="policy ${this._policy === policy.id ? 'on' : ''}"
                role="radio"
                aria-checked=${String(this._policy === policy.id)}
                data-testid="import-policy"
                data-policy=${policy.id}
                @click=${() => {
                  this._policy = policy.id;
                  // A preview is only valid for the policy it was run with.
                  this._invalidate();
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
        <span class="hint">${t('hv.import.appliesEverywhere')}</span>
        <button class="hv-text-button" data-testid="import-cancel" @click=${this._close}>
          ${t('hv.action.cancel')}
        </button>
        <button
          class="hv-pill"
          data-testid="import-preview"
          ?disabled=${!this._text.trim() || this.busy}
          @click=${() => this._emit('preview')}
        >
          ${this.busy ? t('hv.import.checking') : t('hv.import.preview')}
        </button>
      </div>
    `;
  }

  private _countTable(
    captionKey: 'items' | 'locations',
    counts: ImportBucketCounts | undefined,
  ) {
    const caption =
      captionKey === 'items' ? t('hv.import.tableItems') : t('hv.field.locations');
    const rows: [string, keyof ImportBucketCounts][] = [
      [t('hv.import.bucket.add'), 'add'],
      [t('hv.import.bucket.update'), 'update'],
      [t('hv.import.bucket.conflict'), 'conflict'],
      [t('hv.import.bucket.unchanged'), 'unchanged'],
    ];
    return html`<div class="table">
      <div class="caption">${caption}</div>
      <div class="rows">
        ${rows.map(
          ([label, key]) => html`<div class="r ${key}" data-testid="import-count" data-key=${`${captionKey}-${key}`}>
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
          <h2>${t('hv.import.invalidTitle')}</h2>
        </div>
        <div class="sub">
          ${t('hv.import.invalidSub', { problems: counted(preview.errors.length, 'problem') })}
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
        <span class="hint">${t('hv.import.fixAndRetry')}</span>
        <button class="hv-text-button" data-testid="import-copy-errors" @click=${() => void this._copyErrors()}>
          ${this._copied ? t('hv.action.copied') : t('hv.import.copyErrors')}
        </button>
        <button
          class="hv-pill"
          data-testid="import-back"
          @click=${this._invalidate}
        >
          ${t('hv.import.backToInput')}
        </button>
      </div>
    `;
  }

  private _renderPreview(preview: ImportPreview) {
    const items = preview.counts.items;
    const locations = preview.counts.locations;
    const conflicts = preview.items.conflict.length + preview.locations.conflict.length;
    const itemWrites = (items?.add ?? 0) + (items?.update ?? 0);
    const locationWrites = (locations?.add ?? 0) + (locations?.update ?? 0);
    const willWrite = itemWrites + locationWrites;
    const warnings = preview.warnings ?? [];
    // An export carries attachment metadata, not bytes: say which photos this
    // install will not have, so their absence is not read as data loss.
    const files = preview.attachments ?? { referenced: 0, missing: 0 };

    return html`
      <div class="head">
        <div class="row"><h2>${t('hv.import.previewTitle')}</h2></div>
        <div class="sub">
          ${t('hv.import.step2')}
          <strong class="policy-name">${policyTitle(preview.policy)}</strong>
        </div>
      </div>
      <div class="body">
        <div class="tables">
          ${this._countTable('items', items)}${this._countTable('locations', locations)}
        </div>
        ${conflicts
          ? this._alert(
              'import-conflicts',
              html`${tn('hv.import.conflicts', conflicts, { conflicts: counted(conflicts, 'conflict') })}
              ${preview.policy === 'merge'
                ? t('hv.import.conflictsMerge')
                : preview.policy === 'skip'
                  ? t('hv.import.conflictsSkip')
                  : t('hv.import.conflictsReplace')}`,
            )
          : null}
        ${warnings.length
          ? this._alert(
              'import-warnings',
              html`${tn('hv.import.warnings', warnings.length, { clashes: counted(warnings.length, 'nameClash') })}
                <ul class="warn-list">
                  ${warnings.slice(0, WARNING_LIST_LIMIT).map((w) => html`<li>${w.message}</li>`)}
                </ul>
                ${warnings.length > WARNING_LIST_LIMIT
                  ? html`<span class="hint"
                      >${t('hv.import.warningsMore', { count: warnings.length - WARNING_LIST_LIMIT })}</span
                    >`
                  : null}`,
            )
          : null}
        ${files.missing
          ? this._alert(
              'import-attachments-missing',
              html`${tn('hv.import.attachmentsMissing', files.missing, {
                  missing: files.missing,
                  referenced: files.referenced,
                })}
                <span class="hint">${t('hv.import.attachmentsMissingHint')}</span>`,
            )
          : null}
        ${this._errorAlert()}
        <div class="fine">${t('hv.import.allOrNothing')}</div>
      </div>
      <div class="foot">
        <button
          class="hv-text-button"
          data-testid="import-back"
          @click=${this._invalidate}
        >
          ${t('hv.action.back')}
        </button>
        <span class="hint"></span>
        <button class="hv-text-button" data-testid="import-cancel" @click=${this._close}>
          ${t('hv.action.cancel')}
        </button>
        <button
          class="hv-pill"
          data-testid="import-execute"
          ?disabled=${this.busy}
          @click=${() => this._emit('execute')}
        >
          ${this.busy ? t('hv.import.importing') : importButtonLabel(itemWrites, locationWrites)}
        </button>
      </div>
      ${willWrite === 0
        ? html`<div class="foot" style="padding-top:0">
            <span class="hint" data-testid="import-nothing-to-do">
              ${t('hv.import.nothingToDo')}
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
          <h2>${t('hv.import.completeTitle')}</h2>
        </div>
      </div>
      <div class="body">
        <div class="alert ok" data-testid="import-summary">
          <span class="glyph">${icon('checkCircle', 18)}</span>
          <span>${importSummaryLine(summary)}</span>
        </div>
        <div class="fine">
          ${t('hv.import.holdsNow', {
            items: counted(summary.totals.items_total, 'item'),
            locations: counted(summary.totals.locations_total, 'location'),
          })}
        </div>
      </div>
      <div class="foot">
        <span class="hint"></span>
        <button class="hv-pill" data-testid="import-done" @click=${this._close}>
          ${t('hv.action.done')}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.open) return null;
    const body = this.summary
      ? this._renderSummary(this.summary)
      : this.preview && !this.preview.valid
        ? this._renderInvalid(this.preview)
        : this.preview
          ? this._renderPreview(this.preview)
          : this._renderInput();

    return this._modal.render(
      { label: t('hv.import.title'), testid: 'import-sheet', onClose: this._close },
      body,
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-import-sheet': HVImportSheet;
  }
}
