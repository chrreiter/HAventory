import { css, html } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { ref } from 'lit/directives/ref.js';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { describeFailure } from '../components/hv-bulk-bar';
import { serverErrorText } from '../store/server-error';
import type { BulkFailure } from '../store/types';
import { icon } from './icons';
import type { IconName } from './icons';
import { counted } from './plural';

/**
 * What the organize dialog's three tab elements share: the toolbar, the
 * scrolling body, the row and its actions, the inline disclosure and its commit
 * row, the guard, the batch-rewrite status and the touch action sheet. Shadow
 * roots do not pass styles on, so each tab lists this sheet after `searchBox`,
 * whose search field it restyles.
 *
 * The `:host([mobile])` rules expect the element to reflect a `mobile`
 * attribute, as every tab does. Row padding reads `--hv-organize-row-pad`,
 * which the dialog declares and the tabs inherit.
 */
export const organizeTab = css`
  /* The tab stands where the dialog's scrolling body stood in its column, so
     the toolbar stays put and only the body scrolls. */
  :host {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
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
  .value-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: var(--hv-organize-row-pad) 8px;
    border-radius: var(--hv-radius-input);
  }
  .value-row:hover {
    background: var(--hv-hover-overlay);
  }
  .count-link {
    border: none;
    background: none;
    color: var(--hv-primary-dark);
    font: 400 12px var(--hv-font);
    padding: 0;
    white-space: nowrap;
    flex: none;
    /* WCAG 2.2's 24px pointer target, taller than the 12px text. */
    display: inline-flex;
    align-items: center;
    min-height: 24px;
  }
  :host([mobile]) .count-link {
    min-height: var(--hv-tap-min, 44px);
  }
  .row-actions {
    margin-left: auto;
    display: flex;
    gap: 2px;
    flex: none;
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
  :host([mobile]) .row-actions button {
    width: var(--hv-tap-min, 44px);
    height: var(--hv-tap-min, 44px);
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
`;

/** The failed request's own refusal, or the card's fallback sentence. */
export function errorText(err: unknown, fallback: TranslationKey, params?: Record<string, string>): string {
  return serverErrorText(err, t(fallback, params));
}

/**
 * Scroll a disclosure into view as it opens, and give a form's field the
 * caret: `data-field` holds a selector for it inside the disclosure. Called
 * from a `ref`, which fires only when the element is built (so each disclosure
 * is `keyed` on its subject) and again when it is re-attached. `held` is true
 * on the update that puts the dialog on screen, where `Modal` owns focus. The
 * work is deferred a microtask because a ref fires while its subtree is still
 * detached.
 */
export function reveal(el: Element | undefined, held: boolean): void {
  if (!el || held) return;
  queueMicrotask(() => {
    if (!el.isConnected) return;
    // Optional: a test DOM without layout has no scrollIntoView.
    (el as HTMLElement).scrollIntoView?.({ block: 'nearest' });
    const field = (el as HTMLElement).dataset.field;
    if (field) el.querySelector<HTMLElement>(field)?.focus();
  });
}

/** A tab's head row: its filter (statuses have none), its count and its create button. */
export function renderToolbar(opts: {
  search?: { label: string; placeholder: string; value: string; onInput: (value: string) => void };
  count: string;
  countTestid: string;
  newTestid: string;
  newLabel: string;
  onNew: () => void;
}) {
  const search = opts.search;
  return html`<div class="toolbar">
    ${
      search
        ? html`<label class="hv-search">
          ${icon('magnify', 17)}
          <span class="hv-sr-only">${search.label}</span>
          <input
            data-testid="organize-filter"
            placeholder=${search.placeholder}
            .value=${search.value}
            @input=${(e: Event) => search.onInput((e.target as HTMLInputElement).value)}
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
export function renderFooter(opts: {
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

export function renderFailure(testid: string, message: string | null) {
  return message ? html`<div class="failure" role="alert" data-testid=${testid}>${message}</div>` : null;
}

export interface SheetAction {
  testid: string;
  glyph: IconName;
  label: unknown;
  trailing?: unknown;
  danger?: boolean;
  onPick: () => void;
}

/**
 * Touch has no hover, so a row's actions live in a sheet instead of beside it.
 * Keyed on the row, so a second row's sheet is a new disclosure to reveal.
 */
export function renderActionSheet(
  testid: string,
  key: string,
  actions: SheetAction[],
  onBuilt: (el?: Element) => void,
) {
  return keyed(
    key,
    html`<div class="expander" data-testid=${testid} ${ref(onBuilt)}>
      <div class="sheet-actions">
        ${actions.map(
          (a) => html`<button class=${a.danger ? 'danger' : ''} data-testid=${a.testid} @click=${a.onPick}>
            ${icon(a.glyph, 20)}${a.label}${a.trailing ?? null}
          </button>`,
        )}
      </div>
    </div>`,
  );
}

/** A kind rather than a label, since each rewrite line is its own sentence per language. */
export type RewriteKind = 'merge' | 'rename' | 'remove';

/** A batch of item updates in flight or finished: a value rewrite, or a location merge. */
export interface RewriteState {
  kind: RewriteKind;
  done: number;
  total: number;
  failed: BulkFailure[];
  finished: boolean;
  /** A step outside the batch that failed — only a location merge has those. */
  error?: string | null;
}

export function rewriteState(
  kind: RewriteKind,
  done: number,
  total: number,
  finished = false,
  failed: BulkFailure[] = [],
  error: string | null = null,
): RewriteState {
  return { kind, done, total, failed, finished, error };
}

/** What the status line says, in as few words as the outcome allows. */
function rewriteSummary(rewrite: RewriteState): string {
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

/** The progress and partial-failure treatment a bulk action gets, for a rewrite. */
export function renderRewrite(rewrite: RewriteState, onDismiss: () => void) {
  const pct = rewrite.total ? Math.round((rewrite.done / rewrite.total) * 100) : 100;
  const trouble = rewrite.failed.length > 0 || !!rewrite.error;
  return html`<div class="expander" data-testid="rewrite-status">
    <div style="display:flex;gap:8px;font-size:12.5px">
      <span data-testid="rewrite-label">${rewriteSummary(rewrite)}</span>
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
      <button class="hv-text-button" data-testid="rewrite-dismiss" @click=${onDismiss}>
        ${t('hv.action.dismissEntry')}
      </button>
    </div>
  </div>`;
}
