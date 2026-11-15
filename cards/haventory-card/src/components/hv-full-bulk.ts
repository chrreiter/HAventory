import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, base } from '../ui/tokens';
import { t, tn } from '../i18n';
import type { TranslationKey } from '../i18n';
import { counted } from '../ui/plural';
import { SliceWatch } from '../ui/slice-watch';
import { makeBulkOp } from '../store/store';
import type { HvEvent } from '../events';
import type { Store } from '../store/store';
import type { BulkOperation, BulkOutcome, Item } from '../store/types';
import type { BulkAction, BulkProgress, BulkResultView, BulkRunDetail } from './hv-bulk-bar';
import './hv-bulk-bar';
import './hv-checkout-popover';
import './hv-confirm';

/**
 * The full view's bulk run: the bar at the foot of the table, the delete
 * confirm and the one due-date question for a check-out, and the run itself over
 * the store's selection. It reads the store for the selection and the pickers'
 * lists (`list`, `locations`, `facets`) and writes the batch and the narrowed
 * selection to it directly, so it sends no events. The full view renders it
 * only while selecting, so each selection mode starts with no progress, result
 * or open question.
 */
@customElement('hv-full-bulk')
export class HVFullBulk extends LitElement {
  static override styles = [
    tokens,
    base,
    css`
      /* An item of the full view's main column, which keeps it at its natural
         height under the table. The confirm and the popover are fixed overlays. */
      :host {
        display: block;
        flex: none;
      }
    `,
  ];

  @property({ attribute: false }) store!: Store;
  /** The phone viewport: the confirm raises as a sheet and the popover takes touch sizing. */
  @property({ attribute: false }) mobile = false;

  private readonly _view = new SliceWatch(this, ['list', 'locations', 'facets']);

  @state() private _bulkProgress: BulkProgress | null = null;
  @state() private _bulkResult: BulkResultView | null = null;
  @state() private _pendingDelete = false;
  /** The whole selection's check-out is waiting on one due date. */
  @state() private _pendingBulkCheckout = false;
  /** Set while a batch is running so Cancel can stop it between chunks. */
  private _bulkCancelled = false;
  /** The ops of the last run, so "Retry failed" can replay just the failures. */
  private _lastOps: { label: string; ops: BulkOperation[] } | null = null;

  private get _selectedItems(): Item[] {
    const st = this._view.state;
    const selection = st?.selection ?? new Set<string>();
    return (st?.items ?? []).filter((i) => selection.has(i.id));
  }

  /** Build the batch for an action over the current selection. */
  private _opsFor(detail: BulkRunDetail, items: Item[]): { label: string; ops: BulkOperation[] } {
    const tags = detail.tags ?? [];
    const version = (i: Item) => ({ expected_version: i.version });
    // add_tags/remove_tags are additive server-side, so they do not clobber a
    // concurrent edit the way a whole-array update would.
    const table: Record<BulkAction, [TranslationKey, (i: Item) => BulkOperation]> = {
      move: [
        'hv.bulk.label.move',
        (i) =>
          makeBulkOp('item_move', { item_id: i.id, location_id: detail.locationId ?? null, ...version(i) }),
      ],
      'add-tags': ['hv.bulk.label.addTags', (i) => makeBulkOp('item_add_tags', { item_id: i.id, tags })],
      'remove-tags': [
        'hv.bulk.label.removeTags',
        (i) => makeBulkOp('item_remove_tags', { item_id: i.id, tags }),
      ],
      'set-category': [
        'hv.bulk.label.setCategory',
        (i) => makeBulkOp('item_update', { item_id: i.id, category: detail.category ?? null, ...version(i) }),
      ],
      'adjust-qty': [
        'hv.bulk.label.adjustQty',
        (i) => makeBulkOp('item_adjust_quantity', { item_id: i.id, delta: detail.delta ?? 0 }),
      ],
      'check-out': [
        'hv.bulk.label.checkOut',
        (i) => makeBulkOp('item_check_out', { item_id: i.id, due_date: detail.dueDate ?? null }),
      ],
      'check-in': ['hv.bulk.label.checkIn', (i) => makeBulkOp('item_check_in', { item_id: i.id })],
      delete: ['hv.bulk.label.delete', (i) => makeBulkOp('item_delete', { item_id: i.id, ...version(i) })],
    };
    const [label, op] = table[detail.action];
    return { label: t(label), ops: items.map(op) };
  }

  private _onBulkRun = (e: HvEvent<'hv-bulk-bar', 'run'>) => {
    const detail = e.detail;
    if (detail.action === 'delete') {
      this._pendingDelete = true;
      return;
    }
    if (detail.action === 'check-out' && detail.dueDate === undefined) {
      // One due-date question covers the whole selection.
      this._pendingBulkCheckout = true;
      return;
    }
    void this._execute(this._opsFor(detail, this._selectedItems));
  };

  private async _execute(batch: { label: string; ops: BulkOperation[] }) {
    if (!batch.ops.length) return;
    this._lastOps = batch;
    this._bulkCancelled = false;
    this._bulkResult = null;
    this._bulkProgress = { done: 0, total: batch.ops.length, failed: 0, label: batch.label };

    // Count what ran: a cancel stops after the in-flight chunk, and deletes
    // come back with no item, so `outcome.succeeded` would undercount them.
    let ran = 0;
    const outcome: BulkOutcome | undefined = await this.store?.bulkExecute(batch.ops, {
      onProgress: (done, total, failed) => {
        ran = done;
        this._bulkProgress = { done, total, failed, label: batch.label };
      },
      isCancelled: () => this._bulkCancelled,
    });

    this._bulkProgress = null;
    if (!outcome) return;
    const { failed } = outcome;
    this._bulkResult = { label: batch.label, succeeded: Math.max(0, ran - failed.length), failed };
    // Narrow the selection to what still needs attention.
    this.store?.setSelected(outcome.failed.map((f) => f.itemId).filter((id): id is string => !!id));
  }

  /** Extra warning for a bulk delete that would remove checked-out items. */
  private get _checkedOutWarning(): string | null {
    const out = this._selectedItems.filter((i) => i.checked_out).length;
    if (!out) return null;
    return tn('hv.fullView.checkedOutWarning', out);
  }

  override render() {
    const st = this._view.state;
    const size = (st?.selection ?? new Set<string>()).size;
    return html`
      <hv-bulk-bar
        data-testid="full-bulk-bar"
        .areas=${st?.areasCache?.areas ?? []}
        .selectedCount=${size}
        .selectedItems=${this._selectedItems}
        .locationTree=${st?.locationTreeCache ?? []}
        .distinct=${st?.distinctValuesCache ?? null}
        .progress=${this._bulkProgress}
        .result=${this._bulkResult}
        @run=${this._onBulkRun}
        @cancel-run=${() => {
          this._bulkCancelled = true;
        }}
        @dismiss-result=${() => {
          this._bulkResult = null;
        }}
        @retry-failed=${() => {
          const failed = this._bulkResult?.failed ?? [];
          if (!this._lastOps || !failed.length) return;
          // Rebuild rather than replay: an op_id must never be reused.
          void this._execute({
            label: this._lastOps.label,
            ops: failed.map((f) => makeBulkOp(f.op.kind, { ...f.op.payload })),
          });
        }}
      ></hv-bulk-bar>

      <hv-confirm
        data-testid="bulk-confirm"
        ?open=${this._pendingDelete}
        ?mobile=${this.mobile}
        .heading=${t('hv.fullView.deleteHeading', { items: counted(size, 'item') })}
        .message=${t('hv.fullView.deleteMessage')}
        .warning=${this._checkedOutWarning}
        .confirmLabel=${t('hv.fullView.deleteConfirm', { count: size })}
        destructive
        @confirm=${() => {
          this._pendingDelete = false;
          void this._execute(this._opsFor({ action: 'delete' }, this._selectedItems));
        }}
        @cancel=${() => {
          this._pendingDelete = false;
        }}
      ></hv-confirm>

      <!-- Anchored to nothing, so centred and scrimmed like the bulk confirm. -->
      <hv-checkout-popover
        data-testid="full-bulk-checkout"
        ?open=${this._pendingBulkCheckout}
        ?touch=${this.mobile}
        .itemName=${counted(size, 'item')}
        @check-out=${(e: HvEvent<'hv-checkout-popover', 'check-out'>) => {
          const { dueDate } = e.detail;
          this._pendingBulkCheckout = false;
          void this._execute(this._opsFor({ action: 'check-out', dueDate }, this._selectedItems));
        }}
        @cancel=${() => {
          this._pendingBulkCheckout = false;
        }}
      ></hv-checkout-popover>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'hv-full-bulk': HVFullBulk;
  }
}
