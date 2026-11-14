import { html } from 'lit';
import type { ReactiveControllerHost, TemplateResult } from 'lit';
import type { ColumnKey } from './store/columns';
import { loadColumnPrefs, saveColumnPrefs } from './store/columns';
import { activeFilterCount } from './store/store';
import type { Store } from './store/store';
import type { ImportPreview, ImportSummary } from './store/types';
import { t, tn } from './i18n';
import type { HvEvent } from './events';
import { serverErrorText } from './store/server-error';
import { discardPrompt } from './ui/discard';
import type { ConfirmDiscard } from './ui/discard';
import { HostState } from './ui/host-state';
import { ViewportNarrow } from './ui/responsive';
import type { OrganizeTab } from './components/hv-organize-dialog';
import type { OverflowMenuEntry } from './components/hv-overflow-menu';
import './components/hv-column-picker';
import './components/hv-confirm';
import './components/hv-organize-dialog';
import './components/hv-import-sheet';
import './components/hv-diagnostics-panel';

interface ConfirmSpec {
  heading: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** What these surfaces show; changed only through `HostState.set`, which renders. */
interface SurfaceState {
  /** The full view's table columns. */
  columns: ColumnKey[];
  /** When the caches were last known-good, for the diagnostics "since" tile. */
  lastRefresh: string | null;
  refreshBusy: boolean;
  pickerOpen: boolean;
  confirmSpec: ConfirmSpec | null;
  organizeOpen: boolean;
  organizeTab: OrganizeTab;
  diagnosticsOpen: boolean;
  importOpen: boolean;
  importPreview: ImportPreview | null;
  importSummary: ImportSummary | null;
  importBusy: boolean;
  importError: string | null;
}

/** The ways a host differs; everything else in these surfaces is identical. */
interface SurfaceHooks {
  /**
   * A confirmed delete has been sent. The host closes any editor or sheet still
   * pointing at the item, before the store broadcasts its disappearance.
   */
  onItemDeleted?: (itemId: string) => void;
  /** The organize dialog handed back a filtered view to go look at. */
  onBrowse?: () => void;
}

/**
 * Every surface `hv-full-view` can raise but not answer itself: the column
 * choice, exports, and the confirm/organize/import/diagnostics dialogs, which
 * must outlive the surface that asked. Held by the card shell and the sidebar
 * panel alike, with the ⋮ menu contents, so the two cannot drift apart.
 */
export class HostSurfaces {
  /** How a file reaches the user's disk; a test seam. */
  download: (filename: string, text: string) => void = triggerDownload;

  private readonly getStore: () => Store | undefined;
  private readonly hooks: SurfaceHooks;
  /** Measured against the viewport, not the card: these dialogs are `position: fixed`. */
  private readonly viewport: ViewportNarrow;
  private readonly ui: HostState<SurfaceState>;

  constructor(host: ReactiveControllerHost, getStore: () => Store | undefined, hooks: SurfaceHooks = {}) {
    this.getStore = getStore;
    this.hooks = hooks;
    this.viewport = new ViewportNarrow(host);
    this.ui = new HostState<SurfaceState>(host, {
      columns: loadColumnPrefs(),
      lastRefresh: null,
      refreshBusy: false,
      pickerOpen: false,
      confirmSpec: null,
      organizeOpen: false,
      organizeTab: 'locations',
      diagnosticsOpen: false,
      importOpen: false,
      importPreview: null,
      importSummary: null,
      importBusy: false,
      importError: null,
    });
  }

  /** The full view's table columns. Feed this to `hv-full-view.columns`. */
  get columns(): ColumnKey[] {
    return this.ui.value.columns;
  }

  /** When the caches were last known-good, for the diagnostics "since" tile. */
  get lastRefresh(): string | null {
    return this.ui.value.lastRefresh;
  }

  get refreshBusy(): boolean {
    return this.ui.value.refreshBusy;
  }

  /** Run a menu action if a surface here owns it; `false` leaves it to the host. */
  handleAction(id: string, tab?: OrganizeTab): boolean {
    switch (id) {
      case 'columns':
        this.ui.set({ pickerOpen: true });
        return true;
      case 'export-all':
        void this.exportDownload('all');
        return true;
      case 'export-view':
        void this.exportDownload('view');
        return true;
      case 'organize':
        this.ui.set({ organizeTab: tab ?? 'locations', organizeOpen: true });
        return true;
      case 'import':
        this.ui.set({ importPreview: null, importSummary: null, importError: null, importOpen: true });
        return true;
      case 'diagnostics':
        this.ui.set({ diagnosticsOpen: true });
        return true;
      case 'refresh':
        void this.refresh();
        return true;
      default:
        return false;
    }
  }

  /** Ask before doing something irreversible. One prompt at a time. */
  confirm(spec: ConfirmSpec): void {
    this.ui.set({ confirmSpec: spec });
  }

  /** The one place the card asks whether typed edits may be thrown away; a bound field, so it can be passed down. */
  readonly confirmDiscard: ConfirmDiscard = (onConfirm) => {
    this.confirm({ ...discardPrompt(), onConfirm });
  };

  /** The delete flow: look the item up, ask, then send version-checked delete. */
  requestDeleteById(itemId: string): void {
    const store = this.getStore();
    const item = store?.state.value.items.find((i) => i.id === itemId);
    if (!item) return;
    this.confirm({
      heading: t('hv.surfaces.delete.heading', { name: item.name }),
      message: t('hv.surfaces.delete.message'),
      confirmLabel: t('hv.action.delete'),
      destructive: true,
      onConfirm: () => {
        this.hooks.onItemDeleted?.(item.id);
        void store?.deleteItem(item.id, item.version);
      },
    });
  }

  async refresh(): Promise<void> {
    this.ui.set({ refreshBusy: true });
    try {
      await this.getStore()?.refreshAll();
      this.ui.set({ lastRefresh: new Date().toISOString() });
    } finally {
      this.ui.set({ refreshBusy: false });
    }
  }

  /** The full view's ⋮ menu. Every hint line is `·`-separated segments, each capitalized. */
  menuEntries(): OverflowMenuEntry[] {
    const st = this.getStore()?.state.value ?? null;
    const total = st?.statsCounts?.items_total ?? null;
    const filtered = st?.total ?? null;
    const filtersOn = !!st && activeFilterCount(st.filters) > 0;
    return [
      { id: 'select-items', label: t('hv.surfaces.menu.selectItems'), glyph: 'select' },
      {
        id: 'organize',
        label: t('hv.surfaces.menu.organize'),
        glyph: 'mapMarker',
        meta: t('hv.surfaces.menu.organizeMeta'),
      },
      { id: 'columns', label: t('hv.surfaces.menu.columns'), glyph: 'viewColumn' },
      { divider: true },
      {
        id: 'refresh',
        label: t('hv.surfaces.menu.refresh'),
        glyph: 'refresh',
        meta: t('hv.surfaces.menu.refreshMeta'),
      },
      {
        id: 'diagnostics',
        label: t('hv.diagnostics.title'),
        glyph: 'alertCircle',
        ...(st?.degraded.connectionLost ? { badge: t('hv.surfaces.badge.offline') } : {}),
      },
      { divider: true },
      { caption: t('hv.surfaces.menu.data') },
      {
        id: 'export-all',
        label: t('hv.surfaces.menu.exportAll'),
        glyph: 'download',
        sub: total === null ? t('hv.surfaces.menu.exportAllSub') : tn('hv.surfaces.menu.exportAllCount', total),
      },
      // Unfiltered, the current view is the whole inventory offered above.
      ...(filtersOn
        ? [
            {
              id: 'export-view',
              label: t('hv.surfaces.menu.exportView'),
              glyph: 'download' as const,
              sub:
                filtered === null
                  ? t('hv.surfaces.menu.exportViewSub')
                  : tn('hv.surfaces.exportView.filtered', filtered),
            },
          ]
        : []),
      { id: 'import', label: t('hv.surfaces.menu.import'), glyph: 'upload' },
    ];
  }

  /** Every dialog these surfaces own. Render once, after the host's main UI. */
  renderSurfaces(): TemplateResult {
    const st = this.getStore()?.state.value ?? null;
    const ui = this.ui.value;
    const mobile = this.viewport.narrow;
    return html`
      <hv-column-picker
        data-testid="host-columns"
        .open=${ui.pickerOpen}
        ?mobile=${mobile}
        .columns=${ui.columns}
        heading=${t('hv.surfaces.columnsHeading')}
        @change=${(e: HvEvent<'hv-column-picker', 'change'>) => this.setColumns(e.detail.columns)}
        @cancel=${() => this.ui.set({ pickerOpen: false })}
      ></hv-column-picker>

      <hv-confirm
        data-testid="host-confirm"
        ?open=${ui.confirmSpec !== null}
        ?mobile=${mobile}
        .heading=${ui.confirmSpec?.heading ?? ''}
        .message=${ui.confirmSpec?.message ?? ''}
        .confirmLabel=${ui.confirmSpec?.confirmLabel ?? t('hv.action.delete')}
        .destructive=${ui.confirmSpec?.destructive ?? true}
        @confirm=${() => {
          ui.confirmSpec?.onConfirm();
          this.ui.set({ confirmSpec: null });
        }}
        @cancel=${() => this.ui.set({ confirmSpec: null })}
      ></hv-confirm>

      <hv-organize-dialog
        data-testid="host-organize"
        ?open=${ui.organizeOpen}
        ?mobile=${mobile}
        .tab=${ui.organizeTab}
        .store=${this.getStore()}
        @cancel=${() => this.ui.set({ organizeOpen: false })}
        @browse=${() => this.hooks.onBrowse?.()}
      ></hv-organize-dialog>

      <hv-import-sheet
        data-testid="host-import"
        ?open=${ui.importOpen}
        ?mobile=${mobile}
        .preview=${ui.importPreview}
        .summary=${ui.importSummary}
        .busy=${ui.importBusy}
        .errorMessage=${ui.importError}
        @preview=${(e: HvEvent<'hv-import-sheet', 'preview'>) => void this.onImportPreview(e)}
        @execute=${(e: HvEvent<'hv-import-sheet', 'execute'>) => void this.onImportExecute(e)}
        @invalidate-preview=${() => this.ui.set({ importPreview: null, importError: null })}
        @cancel=${() =>
          this.ui.set({ importOpen: false, importPreview: null, importSummary: null, importError: null })}
      ></hv-import-sheet>

      <hv-diagnostics-panel
        data-testid="host-diagnostics"
        ?open=${ui.diagnosticsOpen}
        ?mobile=${mobile}
        .counts=${st?.statsCounts ?? null}
        .version=${st?.versionInfo ?? null}
        .degraded=${st?.degraded ?? null}
        .connected=${st?.connected ?? null}
        .loadedItems=${st?.items.length ?? 0}
        .lastRefresh=${ui.lastRefresh}
        .busy=${ui.refreshBusy}
        @refresh=${() => void this.refresh()}
        @cancel=${() => this.ui.set({ diagnosticsOpen: false })}
      ></hv-diagnostics-panel>
    `;
  }

  private setColumns(columns: ColumnKey[]): void {
    this.ui.set({ columns });
    saveColumnPrefs(columns);
  }

  private async exportDownload(scope: 'all' | 'view'): Promise<void> {
    try {
      const doc = await this.getStore()?.exportDocument(scope);
      if (!doc) return;
      const json = JSON.stringify(doc, null, 2);
      const stamp = (doc.exported_at ?? '').replace(/[:]/g, '-') || 'backup';
      this.download(`haventory-export-${stamp}.json`, json);
    } catch (err: unknown) {
      console.error('HAventory export failed', err);
    }
  }

  private async onImportPreview(e: HvEvent<'hv-import-sheet', 'preview'>): Promise<void> {
    const { document, policy } = e.detail;
    this.ui.set({ importBusy: true, importError: null, importSummary: null });
    try {
      this.ui.set({ importPreview: (await this.getStore()?.previewImport(document, policy)) ?? null });
    } catch (err) {
      this.ui.set({
        importPreview: null,
        importError: serverErrorText(err, t('hv.surfaces.importCheckFailed')),
      });
    } finally {
      this.ui.set({ importBusy: false });
    }
  }

  private async onImportExecute(e: HvEvent<'hv-import-sheet', 'execute'>): Promise<void> {
    const { document, policy } = e.detail;
    this.ui.set({ importBusy: true, importError: null });
    try {
      const summary = (await this.getStore()?.executeImport(document, policy)) ?? null;
      this.ui.set({ importSummary: summary, lastRefresh: new Date().toISOString() });
    } catch (err) {
      const anyErr = err as {
        code?: string;
        message?: string;
        data?: { errors?: { path: string; message: string }[] };
      };
      if (anyErr?.code === 'validation_error' && anyErr.data?.errors?.length) {
        // A rejected document shows its structured list, not one message.
        this.ui.set({
          importPreview: {
            valid: false,
            errors: anyErr.data.errors,
            policy,
            document: {
              haventory_export_version: null,
              schema_version: null,
              exported_at: null,
              integration_version: null,
            },
            items: { add: [], update: [], conflict: [], unchanged: [] },
            locations: { add: [], update: [], conflict: [], unchanged: [] },
            counts: {},
          },
        });
      } else {
        this.ui.set({ importError: serverErrorText(err, t('hv.surfaces.importFailed')) });
      }
    } finally {
      this.ui.set({ importBusy: false });
    }
  }
}

function triggerDownload(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
