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

/**
 * All that this workspace needs from the element hosting it: a redraw, a
 * lifecycle for the store subscription, and somewhere to raise a row event the
 * table below it does not answer.
 */
type WorkspaceHost = ReactiveControllerHost & EventTarget;

/** Where an editor, a read sheet or a check-out step is being drawn. */
interface SurfaceOptions {
  /** The per-surface `data-testid`; the browser harnesses locate these. */
  testid: string;
  /** Finger-sized controls and the one-column form. */
  mobile: boolean;
}

/** The ways a host differs; everything else in this workspace is identical. */
export interface WorkspaceHooks {
  /**
   * The host's discard question. The card's shells raise it through their
   * `HostSurfaces`, the expanded view through the property its host sets, and
   * `null` leaves a form without one.
   */
  confirmDiscard: () => ConfirmDiscard | null;
  /**
   * The open form, wherever this host renders it — the dirty check has to find
   * it across whichever shadow root it landed in.
   */
  editor: () => HVItemEditor | null;
  /**
   * A row was opened: tapped, or Enter on it. The expanded view answers this
   * and the menu entry below identically; the card does not, because a tap on
   * a phone opens the read sheet and the menu entry opens the form.
   */
  openItem: (itemId: string) => void;
  /** The row menu's Edit entry. */
  editItem: (itemId: string) => void;
  /**
   * A delete was asked for, from a row menu, the open form or the read sheet.
   * The card confirms it in its own `HostSurfaces`; the expanded view has none,
   * so it hands the request to whichever element is hosting it.
   */
  requestDelete: (detail: { itemId: string; name?: string }) => void;
}

/**
 * Everything both of the card's shells do to one item.
 *
 * The compact card and the expanded view are two sizes of the same workspace:
 * each opens the edit form, holds on to the row it is open on, saves it, shows
 * one item in a read sheet at phone width, and runs a check-out step from a
 * row. Written twice, the two copies were free to drift on when typing is
 * asked about, what a refused save leaves on screen and which events a row may
 * raise — so the state, the store calls and the three templates live here,
 * held by the host rather than repeated in it. The same arrangement
 * `HostSurfaces` uses for the dialogs.
 *
 * The templates take the surface's own `data-testid` and phone flag as
 * parameters: `inline-editor` / `full-editor` / `sheet-editor` and their
 * neighbours are what the browser harnesses locate, and one renderer is what
 * keeps them from drifting apart in anything else.
 */
export class ItemWorkspace implements ReactiveController {
  /** Row expanded into the editor, or `'new'` for the create form. */
  editing: string | 'new' | null = null;
  /** True while a save is in flight; the form greys itself out. */
  editorBusy = false;
  /**
   * What the open form says about a save the store refused.
   *
   * The store reports failures through its error queue rather than throwing,
   * and the form can be tall enough to have scrolled the host's banner list off
   * the screen — so the account of what happened goes inside the form, beside
   * the text it kept.
   */
  editorError: string | null = null;
  /**
   * The last copy of the row being edited, kept for as long as the form is
   * open.
   *
   * A filter change refetches, and the edited row can drop out of the result.
   * The editor rebuilds its model whenever the item it was handed changes, so
   * handing it `null` there would wipe the typed edits just as surely as
   * unmounting it. `syncPinnedItem` keeps this at the freshest listed copy.
   */
  pinnedItem: Item | null = null;
  /** Item shown in the read sheet, which is the phone's read surface. */
  detailItemId: string | null = null;
  /** Item whose check-out / due-date step is open, with where to anchor it. */
  checkout: { itemId: string; mode: 'check-out' | 'set-due-date'; anchor: DOMRect | null } | null =
    null;

  private readonly host: WorkspaceHost;
  private readonly getStore: () => Store | undefined;
  private readonly hooks: WorkspaceHooks;
  private storeUnsub?: () => void;
  private subscribedTo?: Store;
  private mediaFor?: Store;
  private mediaBindings: MediaBindings | null = null;

  constructor(host: WorkspaceHost, getStore: () => Store | undefined, hooks: WorkspaceHooks) {
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

  /**
   * Both hosts are passed a stable `store` object, so a property binding would
   * never re-render them — the workspace watches the store itself.
   */
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

  /**
   * Picture access for every surface below, built once per store.
   *
   * A fresh object each render would read as a changed property on every row
   * and re-render the whole list, so it is rebuilt only when the store is
   * swapped.
   */
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
   * Hold on to the row being edited, and close what is open on it when it is
   * really gone.
   *
   * Falling off the current page and being deleted look identical from the item
   * list alone; the store is the only place that knows which happened, so it is
   * asked rather than guessed at.
   */
  syncPinnedItem(): void {
    // The read sheet holds an id too, and a deleted item leaves it showing
    // nothing at all rather than closing.
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

  /**
   * Open a form, closing whichever one is open. Only one row edits at a time;
   * if the open one has unsaved changes the user is asked first, rather than
   * silently losing them.
   */
  startEdit(next: string | 'new' | null): void {
    if (this.editing === next) return;
    this.leave(() => this.setEditing(next));
  }

  /**
   * Leave the open form — for another row, for the create form, or by taking
   * the whole surface down — asking first if there is typing to lose.
   *
   * The form asks for its own Cancel, ✕ and Escape, but only about closing.
   * Everything here has somewhere else to be afterwards, so the destination is
   * held in the callback until the host's question comes back answered.
   */
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

  /** Open the read sheet on an item. */
  openDetail(itemId: string): void {
    this.detailItemId = itemId;
    this.host.requestUpdate();
  }

  /** Close the read sheet, dropping what the last save said inside it. */
  closeDetail(): void {
    this.detailItemId = null;
    this.editorError = null;
    this.host.requestUpdate();
  }

  /**
   * A delete has been confirmed and sent. Close whatever is still pointing at
   * the item, ahead of the store broadcasting its disappearance.
   */
  forgetItem(itemId: string): void {
    if (this.editing === itemId) this.editing = null;
    if (this.detailItemId === itemId) this.detailItemId = null;
    this.host.requestUpdate();
  }

  /**
   * The editor's first-run way out of an empty location picker: a root location
   * with no area, handed back so the form can file the item in it at once.
   */
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
    // The store reports failures through its error queue rather than throwing,
    // so a new entry is how we know the save did not land. Keep the form open
    // in that case so the user's edits are still there to retry.
    // The read sheet reads `busy` falling with `errorMessage` still null as the
    // save having landed, so the two are settled together in this synchronous
    // run, ahead of the one redraw below. An await between them would hand the
    // sheet the fall before the message, and it would drop the form on a refusal.
    const queue = this.st?.errorQueue ?? [];
    const failed = queue.length > before;
    this.editorError = failed ? editorErrorText(queue[queue.length - 1]) : null;
    if (!failed) this.editing = null;
    this.host.requestUpdate();
  };

  /**
   * What a row's ⋮ entry means. The ids and their meanings come from one list,
   * so a household learns Check out / Check in / due date / Edit / Delete once
   * however it reached them.
   */
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

  /**
   * Everything a row, a table row or the read sheet can raise about one item.
   * A name this does not know is re-raised on the host, which is where a
   * surface above it can still answer.
   */
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

  /**
   * The edit form.
   *
   * `noHeader` is for the phone add sheet, which draws its own title bar — the
   * editor's own header leads with an expander chevron that means nothing once
   * the form is not an expander.
   */
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

  /**
   * The read sheet: one item, at phone width, with Edit one tap deeper inside
   * it. The sheet reads the viewport itself, so it takes no phone flag from
   * here — only its host decides whether to draw it at all.
   */
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
   * The check-out step for one row.
   *
   * Never inline: that presentation is a step drawn inside the body of the
   * surface that opened it, and this is a sibling at the end of a shell with no
   * body around it. It hangs off the row that opened it wherever the row hands
   * a rectangle over, which the card's do and the table's do not — the table's
   * ⋮ sits in a column that scrolls sideways out of view, so there the step is
   * centred and scrimmed instead. The card's phone branch reaches its check-out
   * through the read sheet, which mounts its own.
   */
  renderCheckoutPopover(opts: SurfaceOptions): TemplateResult {
    return html`<hv-checkout-popover
      data-testid=${opts.testid}
      ?open=${this.checkout !== null}
      ?touch=${opts.mobile}
      .mode=${this.checkout?.mode ?? 'check-out'}
      .anchor=${this.checkout?.anchor ?? null}
      .item=${this.checkout ? (this.itemById(this.checkout.itemId) ?? null) : null}
      @check-out=${(e: CustomEvent) => {
        this.checkout = null;
        this.host.requestUpdate();
        this.onCheckOut(e);
      }}
      @set-due-date=${(e: CustomEvent) => {
        this.checkout = null;
        this.host.requestUpdate();
        this.onSetDueDate(e);
      }}
      @cancel=${() => {
        this.checkout = null;
        this.host.requestUpdate();
      }}
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
