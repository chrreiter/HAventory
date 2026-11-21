import { html } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { createRef, ref } from 'lit/directives/ref.js';
import type { ReactiveController, ReactiveControllerHost, TemplateResult } from 'lit';
import { t } from './i18n';
import { editorErrorText } from './ui/editor-error';
import { HostState } from './ui/host-state';
import { icon } from './ui/icons';
import type { ConfirmDiscard } from './ui/discard';
import type { MediaBindings } from './ui/media';
import type { Store } from './store/store';
import type { Item, Location, StoreState } from './store/types';
import type { HVBanner } from './components/hv-banner';
import type { HVDetailSheet } from './components/hv-detail-sheet';
import type { HVItemEditor } from './components/hv-item-editor';
import type { HvEvent, RowEventDetail } from './events';
import './components/hv-banner';
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
   * Why a form or the read sheet here just closed: a delete this store did not
   * send took its item. `unsaved` when the form held typing that went with it,
   * `clean` for an untouched form or the read view. Cleared once dismissed, or
   * once a form or sheet opens or closes again.
   */
  deletedElsewhere: 'unsaved' | 'clean' | null;
  /**
   * The last copy of the row being edited. A refetch can drop it from the list,
   * and handing the editor `null` would wipe the typed edits.
   */
  pinnedItem: Item | null;
  /** Item shown in the read sheet, which is the phone's read surface. */
  detailItemId: string | null;
  /** Item whose check-out / due-date step is open, with where to anchor it. */
  checkout: Checkout | null;
  /**
   * Per item, how often `showLatest` started its form over. Part of the form's
   * key, so a bump is a new form, built from the item as it now stands.
   */
  formResets: Readonly<Record<string, number>>;
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
  /** The read sheet, whose open form's typing a host cannot see into. */
  private readonly sheet = createRef<HVDetailSheet>();
  private readonly notice = createRef<HVBanner>();
  /** Set when a notice is raised, so the update that draws it brings it into view. */
  private noticeRaised = false;

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
      deletedElsewhere: null,
      pinnedItem: null,
      detailItemId: null,
      checkout: null,
      formResets: {},
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

  /** The `showLatest` counts; a new object on every bump. */
  get formResets(): Readonly<Record<string, number>> {
    return this.ui.value.formResets;
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

  /**
   * A notice raised in this update is on the page now. The page may have
   * scrolled the host's banners out of view while the form or sheet was up.
   */
  hostUpdated(): void {
    if (!this.noticeRaised) return;
    this.noticeRaised = false;
    // Optional: a test DOM without layout has no scrollIntoView.
    this.notice.value?.scrollIntoView?.({ block: 'nearest' });
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
   * store says was removed rather than filtered off the page. Runs before the
   * render that drops the form, so the form can still say whether it held typing.
   */
  syncPinnedItem(): void {
    const { detailItemId } = this.ui.value;
    if (detailItemId !== null && this.getStore()?.wasRemoved(detailItemId)) {
      this.noteClosedByDelete(detailItemId, this.sheet.value?.dirty ?? false);
      this.ui.set({ detailItemId: null });
    }
    const editing = this.editing;
    if (editing === null || editing === 'new') {
      this.ui.set({ pinnedItem: null });
      return;
    }
    if (this.getStore()?.wasRemoved(editing)) {
      this.noteClosedByDelete(editing, this.hooks.editor()?.dirty ?? false);
      this.ui.set({ pinnedItem: null, editing: null, editorError: null });
      return;
    }
    const listed = this.itemById(editing);
    if (listed) this.ui.set({ pinnedItem: listed });
  }

  /**
   * A form or the read sheet is closing because `itemId` is gone. A delete sent
   * from here was asked for, so it says nothing; one made elsewhere is the only
   * explanation the user gets for the surface vanishing.
   */
  private noteClosedByDelete(itemId: string, unsaved: boolean): void {
    if (!this.getStore()?.wasRemovedElsewhere(itemId)) return;
    // The sheet and the inline form can both close in one pass; typing in either counts.
    const typed = unsaved || this.ui.value.deletedElsewhere === 'unsaved';
    this.ui.set({ deletedElsewhere: typed ? 'unsaved' : 'clean' });
    this.noticeRaised = true;
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

  /** Show `next` in the form, dropping what the last save said and the last delete notice. */
  setEditing(next: string | 'new' | null): void {
    this.ui.set({ editing: next, editorError: null, deletedElsewhere: null });
  }

  openDetail(itemId: string): void {
    this.ui.set({ detailItemId: itemId, deletedElsewhere: null });
  }

  closeDetail(): void {
    this.ui.set({ detailItemId: null, editorError: null, deletedElsewhere: null });
  }

  /**
   * "View latest" brought the server's copy of `itemId` in. A form open on it,
   * inline or in the read sheet, starts over from that copy, without its typing
   * or the refused save's message. A form on another item keeps both.
   */
  showLatest(itemId: string): void {
    const { editing, detailItemId, formResets } = this.ui.value;
    if (editing !== itemId && detailItemId !== itemId) return;
    this.ui.set({
      formResets: { ...formResets, [itemId]: (formResets[itemId] ?? 0) + 1 },
      editorError: null,
    });
  }

  /** How often `showLatest` started `itemId`'s form over; the form is keyed on it. */
  private formGeneration(itemId: string): number {
    return this.ui.value.formResets[itemId] ?? 0;
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
   * Keyed by item id and `showLatest` count: a different item, a create's hop to
   * a real id, or a "View latest" is a new form.
   */
  renderEditor(opts: SurfaceOptions & { noHeader?: boolean }): unknown {
    const st = this.st;
    const item = this.editorItem;
    return keyed(
      item ? `${item.id}:${this.formGeneration(item.id)}` : null,
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

  /**
   * What the host says, beside its banner stacks, when a form or the read sheet
   * closed because a delete made elsewhere took its item. Drawn by the host, not
   * inside the sheet, which is gone by then; the host's `bannerStack` lays it out.
   */
  renderDeletedNotice(): TemplateResult | null {
    const notice = this.ui.value.deletedElsewhere;
    if (notice === null) return null;
    const unsaved = notice === 'unsaved';
    return html`<div class="banners" data-testid="deleted-notice">
      <hv-banner
        ${ref(this.notice)}
        kind=${unsaved ? 'warning' : 'info'}
        .glyph=${'del'}
        .message=${unsaved ? t('hv.banner.deletedElsewhere.unsaved') : t('hv.banner.deletedElsewhere.message')}
      >
        <button
          slot="actions"
          class="hv-icon-button"
          data-testid="deleted-notice-dismiss"
          aria-label=${t('hv.action.dismiss')}
          @click=${() => this.ui.set({ deletedElsewhere: null })}
        >
          ${icon('close', 16)}
        </button>
      </hv-banner>
    </div>`;
  }

  /** The phone read sheet, which reads the viewport itself. */
  renderDetailSheet(opts: Pick<SurfaceOptions, 'testid'>): TemplateResult {
    const st = this.st;
    const { detailItemId } = this.ui.value;
    return html`<hv-detail-sheet
      ${ref(this.sheet)}
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
      .formGeneration=${detailItemId ? this.formGeneration(detailItemId) : 0}
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
