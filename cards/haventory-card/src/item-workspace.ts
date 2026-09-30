import { html } from 'lit';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { t } from './i18n';
import { editorErrorText } from './ui/editor-error';
import type { ConfirmDiscard } from './ui/discard';
import type { MediaBindings } from './ui/media';
import type { Store } from './store/store';
import type { Item, ItemCreate, ItemUpdate, Location, StoreState } from './store/types';
import type { HVItemEditor } from './components/hv-item-editor';
import './components/hv-checkout-popover';
import './components/hv-detail-sheet';
import './components/hv-item-editor';

interface SurfaceOptions {
  /** The per-surface `data-testid`; the browser harnesses locate these. */
  testid: string;
  mobile: boolean;
}

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

/**
 * Everything both of the card's shells do to one item: the edit form and the
 * row it is open on, saving, the phone read sheet and the check-out step. Held
 * here once, as `HostSurfaces` holds the dialogs, so the compact card and the
 * expanded view cannot drift apart.
 */
export class ItemWorkspace implements ReactiveController {
  /** Row expanded into the editor, or `'new'` for the create form. */
  editing: string | 'new' | null = null;
  editorBusy = false;
  /**
   * A refused save, shown inside the form: the store queues failures rather
   * than throwing, and a tall form can scroll the banners out of sight.
   */
  editorError: string | null = null;
  /**
   * The last copy of the row being edited. A refetch can drop it from the list,
   * and handing the editor `null` would wipe the typed edits.
   */
  pinnedItem: Item | null = null;
  /** Item shown in the read sheet, which is the phone's read surface. */
  detailItemId: string | null = null;
  /** Item whose check-out / due-date step is open, with where to anchor it. */
  checkout: { itemId: string; mode: 'check-out' | 'set-due-date'; anchor: DOMRect | null } | null =
    null;

  private readonly host: ReactiveControllerHost & EventTarget;
  private readonly getStore: () => Store | undefined;
  private readonly hooks: WorkspaceHooks;
  private storeUnsub?: () => void;
  private subscribedTo?: Store;
  private mediaFor?: Store;
  private mediaBindings: MediaBindings | null = null;

  constructor(host: ReactiveControllerHost & EventTarget, getStore: () => Store | undefined, hooks: WorkspaceHooks) {
    this.host = host;
    this.getStore = getStore;
    this.hooks = hooks;
    host.addController(this);
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

  private itemById(itemId: string | undefined): Item | undefined {
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
    if (this.detailItemId !== null && this.getStore()?.wasRemoved(this.detailItemId)) {
      this.detailItemId = null;
    }
    const editing = this.editing;
    if (editing === null || editing === 'new') {
      this.pinnedItem = null;
      return;
    }
    if (this.getStore()?.wasRemoved(editing)) {
      this.pinnedItem = null;
      this.editing = null;
      this.editorError = null;
      return;
    }
    const listed = this.itemById(editing);
    if (listed) this.pinnedItem = listed;
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
    this.editing = next;
    this.editorError = null;
    this.host.requestUpdate();
  }

  openDetail(itemId: string): void {
    this.detailItemId = itemId;
    this.host.requestUpdate();
  }

  closeDetail(): void {
    this.detailItemId = null;
    this.editorError = null;
    this.host.requestUpdate();
  }

  /** A confirmed delete: close whatever still points at the item. */
  forgetItem(itemId: string): void {
    if (this.editing === itemId) this.editing = null;
    if (this.detailItemId === itemId) this.detailItemId = null;
    this.host.requestUpdate();
  }

  /** The editor's way out of an empty location picker: a root location with no area. */
  readonly createLocationForEditor = (name: string): Promise<Location> => {
    const store = this.getStore();
    if (!store) return Promise.reject(new Error(t('hv.card.notConnected')));
    return store.createLocation(name, null, null);
  };

  readonly onEditorSave = async (e: CustomEvent): Promise<void> => {
    const detail = e.detail as {
      itemId: string | null;
      expectedVersion?: number;
      changes?: ItemUpdate;
      create?: ItemCreate;
    };
    this.editorBusy = true;
    this.editorError = null;
    this.host.requestUpdate();
    const before = this.st?.errorQueue.length ?? 0;
    try {
      if (detail.itemId && detail.changes) {
        await this.getStore()?.updateItem(detail.itemId, detail.changes, detail.expectedVersion);
      } else if (detail.create) {
        await this.getStore()?.createItem(detail.create);
      }
    } finally {
      this.editorBusy = false;
    }
    // A new error-queue entry means the save was refused, so the form stays open.
    // `busy` and the message settle in one synchronous run: the read sheet takes
    // `busy` falling with no message as a landed save and drops the form.
    const queue = this.st?.errorQueue ?? [];
    const failed = queue.length > before;
    this.editorError = failed ? editorErrorText(queue[queue.length - 1]) : null;
    if (!failed) this.editing = null;
    this.host.requestUpdate();
  };

  /** What a row's ⋮ entry means, the same wherever it was reached. */
  onRowAction(detail: { itemId?: string; action?: string; anchor?: DOMRect }): void {
    const item = this.itemById(detail.itemId);
    if (!item) return;
    switch (detail.action) {
      case 'check-out':
      case 'set-due-date':
        this.checkout = { itemId: item.id, mode: detail.action, anchor: detail.anchor ?? null };
        this.host.requestUpdate();
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

  /** Everything a row or the read sheet can raise about one item; others are re-raised on the host. */
  onRowEvent(name: string, detail: { itemId?: string }): void {
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
        this.onRowAction(detail as { itemId?: string; action?: string; anchor?: DOMRect });
        break;
      case 'edit':
      case 'open-item':
        this.hooks.openItem(item.id);
        break;
      default:
        this.host.dispatchEvent(
          new CustomEvent(name, { detail: { itemId: item.id }, bubbles: true, composed: true }),
        );
    }
  }

  /** The edit form. `noHeader` is for the phone add sheet, which draws its own title bar. */
  renderEditor(opts: SurfaceOptions & { noHeader?: boolean }): TemplateResult {
    const st = this.st;
    return html`<hv-item-editor
      .statuses=${st?.statuses ?? null}
      data-testid=${opts.testid}
      .areas=${st?.areasCache?.areas ?? []}
      .media=${this.media}
      .mediaConfig=${st?.mediaConfig ?? null}
      ?noHeader=${opts.noHeader ?? false}
      .item=${this.editorItem}
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
      @delete-item=${(e: CustomEvent) =>
        this.hooks.requestDelete(e.detail as { itemId: string; name?: string })}
      @cancel=${() => this.setEditing(null)}
    ></hv-item-editor>`;
  }

  /** The phone read sheet, which reads the viewport itself. */
  renderDetailSheet(opts: Pick<SurfaceOptions, 'testid'>): TemplateResult {
    const st = this.st;
    return html`<hv-detail-sheet
      .statuses=${st?.statuses ?? null}
      data-testid=${opts.testid}
      .areas=${st?.areasCache?.areas ?? []}
      .media=${this.media}
      .mediaConfig=${st?.mediaConfig ?? null}
      ?open=${this.detailItemId !== null}
      .item=${this.detailItemId ? (this.itemById(this.detailItemId) ?? null) : null}
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
      @increment=${(e: CustomEvent) => this.onRowEvent('increment', e.detail)}
      @decrement=${(e: CustomEvent) => this.onRowEvent('decrement', e.detail)}
      @check-in=${(e: CustomEvent) => this.onRowEvent('check-in', e.detail)}
      @reminder-bump=${(e: CustomEvent) => this.onRowEvent('reminder-bump', e.detail)}
      @request-delete=${(e: CustomEvent) => this.onRowEvent('request-delete', e.detail)}
      @check-out-confirmed=${(e: CustomEvent) => this.onCheckOut(e)}
      @set-due-date=${(e: CustomEvent) => this.onSetDueDate(e)}
      @save=${this.onEditorSave}
    ></hv-detail-sheet>`;
  }

  /**
   * The check-out step for one row, anchored to the row when it hands a
   * rectangle over, else centred (the table's ⋮ can scroll out of view).
   */
  renderCheckoutPopover(opts: SurfaceOptions): TemplateResult {
    const close = () => {
      this.checkout = null;
      this.host.requestUpdate();
    };
    return html`<hv-checkout-popover
      data-testid=${opts.testid}
      ?open=${this.checkout !== null}
      ?touch=${opts.mobile}
      .mode=${this.checkout?.mode ?? 'check-out'}
      .anchor=${this.checkout?.anchor ?? null}
      .item=${this.checkout ? (this.itemById(this.checkout.itemId) ?? null) : null}
      @check-out=${(e: CustomEvent) => {
        close();
        this.onCheckOut(e);
      }}
      @set-due-date=${(e: CustomEvent) => {
        close();
        this.onSetDueDate(e);
      }}
      @cancel=${close}
    ></hv-checkout-popover>`;
  }

  private onCheckOut(e: CustomEvent): void {
    const { itemId, dueDate } = e.detail as { itemId: string; dueDate: string | null };
    const item = this.itemById(itemId);
    if (item) void this.getStore()?.checkOut(item.id, dueDate, item.version);
  }

  /** A due date only exists while an item is out, so this is a plain update. */
  private onSetDueDate(e: CustomEvent): void {
    const { itemId, dueDate } = e.detail as { itemId: string; dueDate: string | null };
    const item = this.itemById(itemId);
    if (item) void this.getStore()?.updateItem(item.id, { due_date: dueDate }, item.version);
  }
}
