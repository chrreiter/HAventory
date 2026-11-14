import { html } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { t } from './i18n';
import { editorErrorText } from './ui/editor-error';
import { HostState } from './ui/host-state';
import type { ConfirmDiscard } from './ui/discard';
import type { MediaBindings } from './ui/media';
import type { Store } from './store/store';
import type { Item, Location, StoreState } from './store/types';
import type { HVItemEditor } from './components/hv-item-editor';
import type { HvEvent, RowEventDetail } from './events';
import './components/hv-checkout-popover';
import './components/hv-detail-sheet';
import './components/hv-item-editor';

interface SurfaceOptions {
  /** The per-surface `data-testid`; the browser harnesses locate these. */
  testid: string;
  mobile: boolean;
}

export type { RowEventDetail } from './events';

/** The ways a host differs; everything else in this workspace is identical. */
export interface WorkspaceHooks {
  /** The host's discard question; `null` leaves a form without one. */
  confirmDiscard: () => ConfirmDiscard | null;
  /** The open form, in whichever shadow root this host renders it. */
  editor: () => HVItemEditor | null;
  /** A row was tapped or entered; on a phone the card opens the read sheet. */
  openItem: (itemId: string) => void;
  /** The row menu's Edit entry. */
  editItem: (itemId: string) => void;
  /** A delete was asked for, from a row menu, the open form or the read sheet. */
  requestDelete: (detail: { itemId: string; name?: string }) => void;
}

type Checkout = { itemId: string; mode: 'check-out' | 'set-due-date'; anchor: DOMRect | null };

/** What the workspace shows; changed only through `HostState.set`, which renders. */
interface WorkspaceState {
  /** Row expanded into the editor, or `'new'` for the create form. */
  editing: string | 'new' | null;
  editorBusy: boolean;
  /**
   * A refused save, shown inside the form: the store queues failures rather
   * than throwing, and a tall form can scroll the banners out of sight.
   */
  editorError: string | null;
  /**
   * The last copy of the row being edited. A refetch can drop it from the list,
   * and handing the editor `null` would wipe the typed edits.
   */
  pinnedItem: Item | null;
  /** Item shown in the read sheet, which is the phone's read surface. */
  detailItemId: string | null;
  /** Item whose check-out / due-date step is open, with where to anchor it. */
  checkout: Checkout | null;
}

/**
 * Everything both of the card's shells do to one item: the edit form and the
 * row it is open on, saving, the phone read sheet and the check-out step. Held
 * here once, as `HostSurfaces` holds the dialogs, so the compact card and the
 * expanded view cannot drift apart.
 */
export class ItemWorkspace implements ReactiveController {
  private readonly ui: HostState<WorkspaceState>;
  private readonly host: ReactiveControllerHost & EventTarget;
  private readonly getStore: () => Store | undefined;
  private readonly hooks: WorkspaceHooks;
  private storeUnsub?: () => void;
  private subscribedTo?: Store;
  private mediaFor?: Store;
  private mediaBindings: MediaBindings | null = null;

  constructor(
    host: ReactiveControllerHost & EventTarget,
    getStore: () => Store | undefined,
    hooks: WorkspaceHooks,
  ) {
    this.host = host;
    this.getStore = getStore;
    this.hooks = hooks;
    this.ui = new HostState<WorkspaceState>(host, {
      editing: null,
      editorBusy: false,
      editorError: null,
      pinnedItem: null,
      detailItemId: null,
      checkout: null,
    });
    host.addController(this);
  }

  /** Row expanded into the editor, or `'new'` for the create form. */
  get editing(): string | 'new' | null {
    return this.ui.value.editing;
  }

  get editorBusy(): boolean {
    return this.ui.value.editorBusy;
  }

  /** A refused save, shown inside the form. */
  get editorError(): string | null {
    return this.ui.value.editorError;
  }

  /** The last copy of the row being edited, kept while a refetch drops it. */
  get pinnedItem(): Item | null {
    return this.ui.value.pinnedItem;
  }

  hostConnected(): void {
    this.subscribe();
  }

  hostDisconnected(): void {
    this.storeUnsub?.();
    this.storeUnsub = undefined;
    this.subscribedTo = undefined;
  }

  /** A store handed in after the first render still has to be watched. */
  hostUpdate(): void {
    this.subscribe();
  }

  /** The `store` object is stable, so a property binding never re-renders the host. */
  private subscribe(): void {
    const store = this.getStore();
    if (!store || store === this.subscribedTo) return;
    this.storeUnsub?.();
    this.subscribedTo = store;
    this.storeUnsub = store.state.onChange(() => this.host.requestUpdate());
  }

  private get st(): StoreState | null {
    return this.getStore()?.state.value ?? null;
  }

  private itemById(itemId: string | null | undefined): Item | undefined {
    return this.st?.items.find((i) => i.id === itemId);
  }

  /** Picture access, built once per store: a fresh object would re-render every row. */
  get media(): MediaBindings | null {
    const store = this.getStore();
    if (!store) return null;
    if (this.mediaFor !== store) {
      this.mediaFor = store;
      this.mediaBindings = {
        sign: (path, expires) => store.signMediaPath(path, expires),
        upload: (itemId, file, kind) => store.uploadAttachment(itemId, file, kind),
        remove: (itemId, attachmentId) => store.removeAttachment(itemId, attachmentId),
        retitle: (itemId, attachmentId, title) => store.updateAttachment(itemId, attachmentId, title),
        reorder: (itemId, kind, attachmentIds) => store.reorderAttachments(itemId, kind, attachmentIds),
      };
    }
    return this.mediaBindings;
  }

  /** The item the open form edits — the listed row, or the pinned copy of it. */
  get editorItem(): Item | null {
    const id = this.editing;
    if (id === null || id === 'new') return null;
    return this.itemById(id) ?? (this.pinnedItem?.id === id ? this.pinnedItem : null);
  }

  /**
   * Hold on to the row being edited, and close what is open on an item the
   * store says was removed rather than filtered off the page.
   */
  syncPinnedItem(): void {
    const { detailItemId } = this.ui.value;
    if (detailItemId !== null && this.getStore()?.wasRemoved(detailItemId)) {
      this.ui.set({ detailItemId: null });
    }
    const editing = this.editing;
    if (editing === null || editing === 'new') {
      this.ui.set({ pinnedItem: null });
      return;
    }
    if (this.getStore()?.wasRemoved(editing)) {
      this.ui.set({ pinnedItem: null, editing: null, editorError: null });
      return;
    }
    const listed = this.itemById(editing);
    if (listed) this.ui.set({ pinnedItem: listed });
  }

  /** Open a form, closing the one that is open; only one row edits at a time. */
  startEdit(next: string | 'new' | null): void {
    if (this.editing === next) return;
    this.leave(() => this.setEditing(next));
  }

  /** Leave the open form for `go`, asking first if there is typing to lose. */
  leave(go: () => void): void {
    const ask = this.hooks.confirmDiscard();
    if (ask && this.editing !== null && this.hooks.editor()?.dirty) {
      ask(go);
      return;
    }
    go();
  }

  /** Show `next` in the form, dropping what the last save said. */
  setEditing(next: string | 'new' | null): void {
    this.ui.set({ editing: next, editorError: null });
  }

  openDetail(itemId: string): void {
    this.ui.set({ detailItemId: itemId });
  }

  closeDetail(): void {
    this.ui.set({ detailItemId: null, editorError: null });
  }

  /** A confirmed delete: close whatever still points at the item. */
  forgetItem(itemId: string): void {
    const { editing, detailItemId } = this.ui.value;
    this.ui.set({
      editing: editing === itemId ? null : editing,
      detailItemId: detailItemId === itemId ? null : detailItemId,
    });
  }

  /** The editor's way out of an empty location picker: a root location with no area. */
  readonly createLocationForEditor = (name: string): Promise<Location> => {
    const store = this.getStore();
    if (!store) return Promise.reject(new Error(t('hv.card.notConnected')));
    return store.createLocation(name, null, null);
  };

  readonly onEditorSave = async (
    e: HvEvent<'hv-item-editor', 'save'> | HvEvent<'hv-detail-sheet', 'save'>,
  ): Promise<void> => {
    const detail = e.detail;
    this.ui.set({ editorBusy: true, editorError: null });
    const before = this.st?.errorQueue.length ?? 0;
    try {
      if (detail.itemId && detail.changes) {
        await this.getStore()?.updateItem(detail.itemId, detail.changes, detail.expectedVersion);
      } else if (detail.create) {
        await this.getStore()?.createItem(detail.create);
      }
    } finally {
      this.ui.set({ editorBusy: false });
    }
    // A new error-queue entry means the save was refused, so the form stays open.
    // `busy` and the message settle in one synchronous run: the read sheet takes
    // `busy` falling with no message as a landed save and drops the form.
    const queue = this.st?.errorQueue ?? [];
    const failed = queue.length > before;
    const latest = failed ? queue[queue.length - 1] : undefined;
    this.ui.set({ editorError: latest ? editorErrorText(latest) : null });
    if (!failed) this.ui.set({ editing: null });
  };

  /** What a row's ⋮ entry means, the same wherever it was reached. */
  onRowAction(detail: RowEventDetail): void {
    const item = this.itemById(detail.itemId);
    if (!item) return;
    switch (detail.action) {
      case 'check-out':
      case 'set-due-date':
        this.ui.set({ checkout: { itemId: item.id, mode: detail.action, anchor: detail.anchor ?? null } });
        break;
      case 'check-in':
        void this.getStore()?.markCheckedIn(item.id, item.version);
        break;
      case 'edit':
        this.hooks.editItem(item.id);
        break;
      case 'delete':
        this.hooks.requestDelete({ itemId: item.id, name: item.name });
        break;
    }
  }

  /** Everything a row or the read sheet can raise about one item. */
  onRowEvent(
    name:
      | 'increment'
      | 'decrement'
      | 'check-in'
      | 'reminder-bump'
      | 'request-delete'
      | 'row-action'
      | 'edit'
      | 'open-item',
    detail: RowEventDetail,
  ): void {
    const item = this.itemById(detail.itemId);
    if (!item) return;
    const store = this.getStore();
    switch (name) {
      case 'increment':
        void store?.adjustQuantity(item.id, +1);
        break;
      case 'decrement':
        if (item.quantity > 0) void store?.adjustQuantity(item.id, -1);
        break;
      case 'check-in':
        void store?.markCheckedIn(item.id, item.version);
        break;
      case 'reminder-bump':
        void store?.bumpReminder(item.id, item.version);
        break;
      case 'request-delete':
        this.hooks.requestDelete({ itemId: item.id });
        break;
      case 'row-action':
        this.onRowAction(detail);
        break;
      case 'edit':
      case 'open-item':
        this.hooks.openItem(item.id);
        break;
    }
  }

  /**
   * The edit form. `noHeader` is for the phone add sheet, which draws its own title bar.
   * Keyed by item id: a different item, or a create's hop to a real id, is a new form.
   */
  renderEditor(opts: SurfaceOptions & { noHeader?: boolean }): unknown {
    const st = this.st;
    const item = this.editorItem;
    return keyed(
      item?.id ?? null,
      html`<hv-item-editor
      .statuses=${st?.statuses ?? null}
      data-testid=${opts.testid}
      .areas=${st?.areasCache?.areas ?? []}
      .media=${this.media}
      .mediaConfig=${st?.mediaConfig ?? null}
      ?noHeader=${opts.noHeader ?? false}
      .item=${item}
      .locations=${st?.locationsFlatCache ?? null}
      .locationTree=${st?.locationTreeCache ?? []}
      .categorySuggestions=${(st?.distinctValuesCache?.categories ?? []).map((c) => c.value)}
      .tagSuggestions=${(st?.distinctValuesCache?.tags ?? []).map((tag) => tag.value)}
      .customFieldKeys=${st?.distinctValuesCache?.custom_field_keys ?? []}
      .createLocation=${this.createLocationForEditor}
      .confirmDiscard=${this.hooks.confirmDiscard()}
      ?mobile=${opts.mobile}
      .busy=${this.editorBusy}
      .errorMessage=${this.editorError}
      @save=${this.onEditorSave}
      @delete-item=${(e: HvEvent<'hv-item-editor', 'delete-item'>) => this.hooks.requestDelete(e.detail)}
      @cancel=${() => this.setEditing(null)}
    ></hv-item-editor>`,
    );
  }

  /** The phone read sheet, which reads the viewport itself. */
  renderDetailSheet(opts: Pick<SurfaceOptions, 'testid'>): TemplateResult {
    const st = this.st;
    const { detailItemId } = this.ui.value;
    return html`<hv-detail-sheet
      .statuses=${st?.statuses ?? null}
      data-testid=${opts.testid}
      .areas=${st?.areasCache?.areas ?? []}
      .media=${this.media}
      .mediaConfig=${st?.mediaConfig ?? null}
      ?open=${detailItemId !== null}
      .item=${detailItemId ? (this.itemById(detailItemId) ?? null) : null}
      .locations=${st?.locationsFlatCache ?? null}
      .locationTree=${st?.locationTreeCache ?? []}
      .categorySuggestions=${(st?.distinctValuesCache?.categories ?? []).map((c) => c.value)}
      .tagSuggestions=${(st?.distinctValuesCache?.tags ?? []).map((tag) => tag.value)}
      .customFieldKeys=${st?.distinctValuesCache?.custom_field_keys ?? []}
      .createLocation=${this.createLocationForEditor}
      .confirmDiscard=${this.hooks.confirmDiscard()}
      .busy=${this.editorBusy}
      .errorMessage=${this.editorError}
      @cancel=${() => this.closeDetail()}
      @increment=${(e: HvEvent<'hv-detail-sheet', 'increment'>) => this.onRowEvent('increment', e.detail)}
      @decrement=${(e: HvEvent<'hv-detail-sheet', 'decrement'>) => this.onRowEvent('decrement', e.detail)}
      @check-in=${(e: HvEvent<'hv-detail-sheet', 'check-in'>) => this.onRowEvent('check-in', e.detail)}
      @reminder-bump=${(e: HvEvent<'hv-detail-sheet', 'reminder-bump'>) => this.onRowEvent('reminder-bump', e.detail)}
      @request-delete=${(e: HvEvent<'hv-detail-sheet', 'request-delete'>) => this.onRowEvent('request-delete', e.detail)}
      @check-out-confirmed=${(e: HvEvent<'hv-detail-sheet', 'check-out-confirmed'>) => this.onCheckOut(e)}
      @set-due-date=${(e: HvEvent<'hv-detail-sheet', 'set-due-date'>) => this.onSetDueDate(e)}
      @save=${this.onEditorSave}
    ></hv-detail-sheet>`;
  }

  /**
   * The check-out step for one row, anchored to the row when it hands a
   * rectangle over, else centred (the table's ⋮ can scroll out of view).
   */
  renderCheckoutPopover(opts: SurfaceOptions): TemplateResult {
    const close = () => this.ui.set({ checkout: null });
    const { checkout } = this.ui.value;
    return html`<hv-checkout-popover
      data-testid=${opts.testid}
      ?open=${checkout !== null}
      ?touch=${opts.mobile}
      .mode=${checkout?.mode ?? 'check-out'}
      .anchor=${checkout?.anchor ?? null}
      .item=${checkout ? (this.itemById(checkout.itemId) ?? null) : null}
      @check-out=${(e: HvEvent<'hv-checkout-popover', 'check-out'>) => {
        close();
        this.onCheckOut(e);
      }}
      @set-due-date=${(e: HvEvent<'hv-checkout-popover', 'set-due-date'>) => {
        close();
        this.onSetDueDate(e);
      }}
      @cancel=${close}
    ></hv-checkout-popover>`;
  }

  private onCheckOut(
    e: HvEvent<'hv-checkout-popover', 'check-out'> | HvEvent<'hv-detail-sheet', 'check-out-confirmed'>,
  ): void {
    const { itemId, dueDate } = e.detail;
    const item = this.itemById(itemId);
    if (item) void this.getStore()?.checkOut(item.id, dueDate, item.version);
  }

  /** A due date only exists while an item is out, so this is a plain update. */
  private onSetDueDate(
    e: HvEvent<'hv-checkout-popover', 'set-due-date'> | HvEvent<'hv-detail-sheet', 'set-due-date'>,
  ): void {
    const { itemId, dueDate } = e.detail;
    const item = this.itemById(itemId);
    if (item) void this.getStore()?.updateItem(item.id, { due_date: dueDate }, item.version);
  }
}
