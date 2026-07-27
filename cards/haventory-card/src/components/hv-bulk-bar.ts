import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { icon } from '../ui/icons';
import { counted, plural } from '../ui/plural';
import type { IconName } from '../ui/icons';
import type { BulkFailure, DistinctValues, Item, LocationTreeNode } from '../store/types';
import './hv-chip-input';
import './hv-location-tree';

/** A bulk action the bar can start. */
export type BulkAction =
  | 'move'
  | 'add-tags'
  | 'remove-tags'
  | 'set-category'
  | 'adjust-qty'
  | 'check-out'
  | 'check-in'
  | 'delete';

export interface BulkRunDetail {
  action: BulkAction;
  locationId?: string | null;
  tags?: string[];
  category?: string | null;
  delta?: number;
  dueDate?: string | null;
}

export interface BulkProgress {
  done: number;
  total: number;
  failed: number;
  label: string;
}

export interface BulkResultView {
  label: string;
  succeeded: number;
  failed: BulkFailure[];
}

const ACTIONS: { id: BulkAction; label: string; glyph?: IconName; immediate?: boolean }[] = [
  { id: 'move', label: 'Move to…', glyph: 'mapMarker' },
  { id: 'add-tags', label: 'Add tags…' },
  { id: 'remove-tags', label: 'Remove tags…' },
  { id: 'set-category', label: 'Set category…' },
  { id: 'adjust-qty', label: 'Adjust qty…' },
  { id: 'check-out', label: 'Check out', immediate: true },
  { id: 'check-in', label: 'Check in', immediate: true },
];

/**
 * The bulk action bar, its inline pickers, and the per-operation result state
 * (mock 4a).
 *
 * The result panel is the point: `haventory/items/bulk` returns a result per
 * operation and does not roll back, so partial failure is the normal case. A
 * spinner cannot say "39 of 42 moved, these 3 didn't and here's why" — this can,
 * and it can retry just the failures.
 *
 * Pickers open inline above the bar rather than as dialogs, so the bulk flow
 * never becomes the nested dialog stack the redesign is getting rid of.
 */
@customElement('hv-bulk-bar')
export class HVBulkBar extends LitElement {
  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .picker {
        padding: 12px 16px;
        background: var(--hv-surface);
        border-top: 1px solid var(--hv-divider);
        display: grid;
        gap: 8px;
      }
      .picker .row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .picker input {
        box-sizing: border-box;
        background: var(--hv-surface);
        border: 1px solid var(--hv-input-border);
        border-radius: var(--hv-radius-input);
        padding: 8px 10px;
        font: 400 var(--hv-input-font, 13.5px) var(--hv-font);
        color: var(--hv-text);
        min-width: 180px;
      }
      .tree-holder {
        border: 1px solid var(--hv-divider);
        border-radius: var(--hv-radius-input);
        max-height: 220px;
        overflow: auto;
        padding: 4px 0;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 12px 16px;
        background: #263238;
        color: #fff;
      }
      .bar .lead {
        font: 500 13px var(--hv-font);
        margin-right: 4px;
      }
      .bar button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: none;
        border-radius: var(--hv-radius-chip);
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
        padding: 7px 14px;
        font: 400 12.5px var(--hv-font);
      }
      .bar button:hover {
        background: rgba(255, 255, 255, 0.24);
      }
      .bar button.active {
        background: rgba(255, 255, 255, 0.32);
      }
      .bar button.danger {
        margin-left: auto;
        background: none;
        border: 1px solid rgba(239, 83, 80, 0.7);
        color: #ef9a9a;
        font-weight: 500;
      }
      .progress {
        padding: 12px 16px;
        background: #263238;
        color: #fff;
        display: grid;
        gap: 8px;
      }
      .progress .line {
        display: flex;
        align-items: center;
        gap: 8px;
        font: 400 12.5px var(--hv-font);
      }
      .track {
        height: 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.2);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--hv-primary);
        transition: width var(--hv-motion-panel) ease-out;
      }
      .result {
        background: var(--hv-surface);
        border-top: 1px solid var(--hv-divider);
      }
      .result-head {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 14px 18px 10px;
        border-bottom: 1px solid var(--hv-row-divider);
      }
      .result-head .title {
        font: 500 15px var(--hv-font);
        color: var(--hv-text);
      }
      .result-head .sub {
        font-size: 13px;
        color: var(--hv-text-secondary);
        margin-top: 2px;
      }
      .failures {
        display: grid;
        gap: 1px;
        background: var(--hv-row-divider);
        max-height: 220px;
        overflow-y: auto;
      }
      .failure {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 18px;
        background: var(--hv-surface);
      }
      .failure .glyph {
        color: var(--hv-error);
        flex: none;
        margin-top: 1px;
      }
      .failure .name {
        font: 500 13.5px var(--hv-font);
        color: var(--hv-text);
      }
      .failure .reason {
        font-size: 12px;
        color: var(--hv-error);
        line-height: 1.45;
      }
      .result-foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid var(--hv-row-divider);
      }
      .result-foot .hint {
        font-size: 12px;
        color: var(--hv-text-tertiary);
        margin-right: auto;
      }
    `,
  ];

  @property({ type: Number }) selectedCount = 0;
  @property({ attribute: false }) selectedItems: Item[] = [];
  @property({ attribute: false }) locationTree: LocationTreeNode[] = [];
  @property({ attribute: false }) distinct: DistinctValues | null = null;
  @property({ attribute: false }) progress: BulkProgress | null = null;
  @property({ attribute: false }) result: BulkResultView | null = null;

  @state() private _active: BulkAction | null = null;
  @state() private _tags: string[] = [];
  @state() private _draft = '';

  private _run(detail: BulkRunDetail) {
    this._active = null;
    this._tags = [];
    this._draft = '';
    this.dispatchEvent(new CustomEvent('run', { detail, bubbles: true, composed: true }));
  }

  private _renderPicker() {
    switch (this._active) {
      case 'move':
        return html`<div class="picker" data-testid="bulk-picker" data-picker="move">
          <span class="hv-label">Move ${counted(this.selectedCount, 'item')} to</span>
          <div class="tree-holder">
            <hv-location-tree
              data-testid="bulk-location-tree"
              .nodes=${this.locationTree}
              showAll
              @select=${(e: CustomEvent) =>
                this._run({ action: 'move', locationId: (e.detail as { locationId: string | null }).locationId })}
            ></hv-location-tree>
          </div>
        </div>`;
      case 'add-tags':
      case 'remove-tags': {
        const adding = this._active === 'add-tags';
        return html`<div class="picker" data-testid="bulk-picker" data-picker=${this._active}>
          <span class="hv-label">${adding ? 'Add tags to' : 'Remove tags from'} ${counted(this.selectedCount, 'item')}</span>
          <hv-chip-input
            data-testid="bulk-tags"
            .values=${this._tags}
            .suggestions=${(this.distinct?.tags ?? []).map((t) => t.value)}
            @change=${(e: CustomEvent) => {
              this._tags = (e.detail as { values: string[] }).values;
            }}
          ></hv-chip-input>
          <div class="row">
            <button class="hv-text-button" data-testid="bulk-picker-cancel" @click=${() => (this._active = null)}>
              Cancel
            </button>
            <button
              class="hv-pill"
              data-testid="bulk-picker-apply"
              ?disabled=${this._tags.length === 0}
              @click=${() => this._run({ action: adding ? 'add-tags' : 'remove-tags', tags: this._tags })}
            >
              ${adding ? 'Add' : 'Remove'}
            </button>
          </div>
        </div>`;
      }
      case 'set-category':
        return html`<div class="picker" data-testid="bulk-picker" data-picker="set-category">
          <span class="hv-label">Set the category on ${counted(this.selectedCount, 'item')}</span>
          <div class="row">
            <input
              data-testid="bulk-category"
              list="hv-bulk-categories"
              placeholder="Category (blank clears it)"
              .value=${this._draft}
              @input=${(e: Event) => {
                this._draft = (e.target as HTMLInputElement).value;
              }}
            />
            <datalist id="hv-bulk-categories">
              ${(this.distinct?.categories ?? []).map((c) => html`<option value=${c.value}></option>`)}
            </datalist>
            <button class="hv-text-button" data-testid="bulk-picker-cancel" @click=${() => (this._active = null)}>
              Cancel
            </button>
            <button
              class="hv-pill"
              data-testid="bulk-picker-apply"
              @click=${() => this._run({ action: 'set-category', category: this._draft.trim() || null })}
            >
              Set
            </button>
          </div>
        </div>`;
      case 'adjust-qty':
        return html`<div class="picker" data-testid="bulk-picker" data-picker="adjust-qty">
          <span class="hv-label">Adjust the quantity of ${counted(this.selectedCount, 'item')} by</span>
          <div class="row">
            <input
              type="number"
              data-testid="bulk-delta"
              placeholder="e.g. -1"
              .value=${this._draft}
              @input=${(e: Event) => {
                this._draft = (e.target as HTMLInputElement).value;
              }}
            />
            <button class="hv-text-button" data-testid="bulk-picker-cancel" @click=${() => (this._active = null)}>
              Cancel
            </button>
            <button
              class="hv-pill"
              data-testid="bulk-picker-apply"
              ?disabled=${!Number.isFinite(Number(this._draft)) || this._draft.trim() === '' || Number(this._draft) === 0}
              @click=${() => this._run({ action: 'adjust-qty', delta: Number(this._draft) })}
            >
              Apply
            </button>
          </div>
        </div>`;
      default:
        return null;
    }
  }

  private _renderProgress(progress: BulkProgress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return html`<div class="progress" data-testid="bulk-progress">
      <div class="line">
        <span data-testid="bulk-progress-label">${progress.label} ${progress.done} of ${progress.total}</span>
        ${progress.failed > 0
          ? html`<span style="margin-left:auto;opacity:.8" data-testid="bulk-progress-failed"
              >${progress.failed} failed</span
            >`
          : null}
        <button
          style="margin-left:${progress.failed > 0 ? '8px' : 'auto'}"
          data-testid="bulk-cancel"
          @click=${() => this.dispatchEvent(new CustomEvent('cancel-run', { bubbles: true, composed: true }))}
        >
          Cancel
        </button>
      </div>
      <div class="track"><div class="fill" style="width: ${pct}%"></div></div>
    </div>`;
  }

  private _renderResult(result: BulkResultView) {
    const failedCount = result.failed.length;
    const clean = failedCount === 0;
    return html`<div class="result" data-testid="bulk-result">
      <div class="result-head">
        <span class="glyph" style="color: var(--hv-${clean ? 'success' : 'warn'})">
          ${icon(clean ? 'checkCircle' : 'alert', 18)}
        </span>
        <div>
          <div class="title" data-testid="bulk-result-title">
            ${clean ? `${result.label} finished` : `${result.label} finished with errors`}
          </div>
          <div class="sub" data-testid="bulk-result-summary">
            ${result.succeeded} of ${result.succeeded + failedCount} succeeded.
            ${clean ? '' : `${failedCount} failed and ${plural(failedCount, 'was', 'were')} left unchanged.`}
          </div>
        </div>
      </div>
      ${failedCount
        ? html`<div class="failures">
            ${result.failed.map(
              (f) => html`<div class="failure" data-testid="bulk-failure" data-item-id=${f.itemId ?? ''}>
                <span class="glyph">${icon('alertCircle', 17)}</span>
                <div>
                  <div class="name">${this._nameFor(f)}</div>
                  <div class="reason">${describeFailure(f)}</div>
                </div>
              </div>`,
            )}
          </div>`
        : null}
      <div class="result-foot">
        <span class="hint">
          ${failedCount ? `Selection kept to the ${counted(failedCount, 'failed row')}` : ''}
        </span>
        <button
          class="hv-text-button"
          data-testid="bulk-result-dismiss"
          @click=${() => this.dispatchEvent(new CustomEvent('dismiss-result', { bubbles: true, composed: true }))}
        >
          Dismiss
        </button>
        ${failedCount
          ? html`<button
              class="hv-pill"
              data-testid="bulk-retry"
              @click=${() => this.dispatchEvent(new CustomEvent('retry-failed', { bubbles: true, composed: true }))}
            >
              Retry ${failedCount} failed
            </button>`
          : null}
      </div>
    </div>`;
  }

  private _nameFor(failure: BulkFailure): string {
    const found = this.selectedItems.find((i) => i.id === failure.itemId);
    return found?.name ?? failure.itemId ?? 'Item';
  }

  render() {
    if (this.result) return this._renderResult(this.result);
    if (this.progress) return this._renderProgress(this.progress);
    if (this.selectedCount === 0) return null;

    return html`
      ${this._renderPicker()}
      <div class="bar" data-testid="bulk-bar" role="toolbar" aria-label="Bulk actions">
        <span class="lead" data-testid="bulk-lead">Apply to ${counted(this.selectedCount, 'item')}</span>
        ${ACTIONS.map(
          (action) => html`<button
            class=${this._active === action.id ? 'active' : ''}
            data-testid="bulk-action"
            data-action=${action.id}
            @click=${() => {
              if (action.immediate) {
                // Check-out sends no due date, which the API allows; the date
                // step is offered by the check-out popover on single rows.
                this._run(action.id === 'check-out' ? { action: 'check-out', dueDate: null } : { action: action.id });
              } else {
                this._active = this._active === action.id ? null : action.id;
                this._tags = [];
                this._draft = '';
              }
            }}
          >
            ${action.glyph ? icon(action.glyph, 15) : null}${action.label}
          </button>`,
        )}
        <button class="danger" data-testid="bulk-action" data-action="delete" @click=${() => this._run({ action: 'delete' })}>
          ${icon('del', 15)}Delete
        </button>
      </div>
    `;
  }
}

/** Turn a per-operation error into something a person can act on. */
export function describeFailure(failure: BulkFailure): string {
  const { code, message } = failure.error;
  switch (code) {
    case 'conflict':
      return 'Conflict — changed by another client since you loaded it.';
    case 'not_found':
      return 'Not found — deleted before this ran.';
    case 'rate_limited':
      return 'Rate limited — try again in a few seconds.';
    case 'validation_error':
      return `Rejected — ${message}`;
    case 'storage_error':
      return "Couldn't save — the integration failed to write to storage.";
    default:
      return message || 'Failed.';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-bulk-bar': HVBulkBar;
  }
}
