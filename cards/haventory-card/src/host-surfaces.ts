import { html } from 'lit';
import type { ReactiveControllerHost, TemplateResult } from 'lit';
import type { ColumnKey } from './store/columns';
import { loadColumnPrefs, saveColumnPrefs } from './store/columns';
import { activeFilterCount } from './store/store';
import type { Store } from './store/store';
import type { ImportPolicy, ImportPreview, ImportSummary } from './store/types';
import { t, tn } from './i18n';
import { discardPrompt } from './ui/discard';
import type { ConfirmDiscard } from './ui/discard';
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
  /** The full view's table columns. Feed this to `hv-full-view.columns`. */
  columns: ColumnKey[] = loadColumnPrefs();

  /** How a file reaches the user's disk; a test seam. */
  download: (filename: string, text: string) => void = triggerDownload;

  /** When the caches were last known-good, for the diagnostics "since" tile. */
  lastRefresh: string | null = null;
  refreshBusy = false;

  private readonly host: ReactiveControllerHost;
  private readonly getStore: () => Store | undefined;
  private readonly hooks: SurfaceHooks;
  /** Measured against the viewport, not the card: these dialogs are `position: fixed`. */
  private readonly viewport: ViewportNarrow;
  private pickerOpen = false;
  private confirmSpec: ConfirmSpec | null = null;
  private organizeOpen = false;
  private organizeTab: OrganizeTab = 'locations';
  private diagnosticsOpen = false;
  private importOpen = false;
  private importPreview: ImportPreview | null = null;
  private importSummary: ImportSummary | null = null;
  private importBusy = false;
  private importError: string | null = null;

  constructor(host: ReactiveControllerHost, getStore: () => Store | undefined, hooks: SurfaceHooks = {}) {
    this.host = host;
    this.getStore = getStore;
    this.hooks = hooks;
    this.viewport = new ViewportNarrow(host);
  }

  /** Run a menu action if a surface here owns it; `false` leaves it to the host. */
  handleAction(id: string, tab?: OrganizeTab): boolean {
    switch (id) {
      case 'columns':
        this.pickerOpen = true;
        this.host.requestUpdate();
        return true;
      case 'export-all':
        void this.exportDownload('all');
        return true;
      case 'export-view':
        void this.exportDownload('view');
        return true;
      case 'organize':
        this.organizeTab = tab ?? 'locations';
        this.organizeOpen = true;
        this.host.requestUpdate();
        return true;
      case 'import':
        this.importPreview = null;
        this.importSummary = null;
        this.importError = null;
        this.importOpen = true;
        this.host.requestUpdate();
        return true;
      case 'diagnostics':
        this.diagnosticsOpen = true;
        this.host.requestUpdate();
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
    this.confirmSpec = spec;
    this.host.requestUpdate();
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
    this.refreshBusy = true;
    this.host.requestUpdate();
    try {
      await this.getStore()?.refreshAll();
      this.lastRefresh = new Date().toISOString();
    } finally {
      this.refreshBusy = false;
      this.host.requestUpdate();
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
        sub:
          total === null
            ? t('hv.surfaces.menu.exportAllSub')
            : tn('hv.surfaces.menu.exportAllCount', total),
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
    const mobile = this.viewport.narrow;
    return html`
      <hv-column-picker
        data-testid="host-columns"
        .open=${this.pickerOpen}
        ?mobile=${mobile}
        .columns=${this.columns}
        heading=${t('hv.surfaces.columnsHeading')}
        @change=${(e: CustomEvent) => this.setColumns((e.detail as { columns: ColumnKey[] }).columns)}
        @cancel=${() => {
          this.pickerOpen = false;
          this.host.requestUpdate();
        }}
      ></hv-column-picker>

      <hv-confirm
        data-testid="host-confirm"
        ?open=${this.confirmSpec !== null}
        ?mobile=${mobile}
        .heading=${this.confirmSpec?.heading ?? ''}
        .message=${this.confirmSpec?.message ?? ''}
        .confirmLabel=${this.confirmSpec?.confirmLabel ?? t('hv.action.delete')}
        .destructive=${this.confirmSpec?.destructive ?? true}
        @confirm=${() => {
          this.confirmSpec?.onConfirm();
          this.confirmSpec = null;
          this.host.requestUpdate();
        }}
        @cancel=${() => {
          this.confirmSpec = null;
          this.host.requestUpdate();
        }}
      ></hv-confirm>

      <hv-organize-dialog
        data-testid="host-organize"
        ?open=${this.organizeOpen}
        ?mobile=${mobile}
        .tab=${this.organizeTab}
        .store=${this.getStore()}
        @cancel=${() => {
          this.organizeOpen = false;
          this.host.requestUpdate();
        }}
        @browse=${() => this.hooks.onBrowse?.()}
      ></hv-organize-dialog>

      <hv-import-sheet
        data-testid="host-import"
        ?open=${this.importOpen}
        ?mobile=${mobile}
        .preview=${this.importPreview}
        .summary=${this.importSummary}
        .busy=${this.importBusy}
        .errorMessage=${this.importError}
        @preview=${(e: CustomEvent) => void this.onImportPreview(e)}
        @execute=${(e: CustomEvent) => void this.onImportExecute(e)}
        @invalidate-preview=${() => {
          this.importPreview = null;
          this.importError = null;
          this.host.requestUpdate();
        }}
        @cancel=${() => {
          this.importOpen = false;
          this.importPreview = null;
          this.importSummary = null;
          this.importError = null;
          this.host.requestUpdate();
        }}
      ></hv-import-sheet>

      <hv-diagnostics-panel
        data-testid="host-diagnostics"
        ?open=${this.diagnosticsOpen}
        ?mobile=${mobile}
        .counts=${st?.statsCounts ?? null}
        .version=${st?.versionInfo ?? null}
        .degraded=${st?.degraded ?? null}
        .connected=${st?.connected ?? null}
        .loadedItems=${st?.items.length ?? 0}
        .lastRefresh=${this.lastRefresh}
        .busy=${this.refreshBusy}
        @refresh=${() => void this.refresh()}
        @cancel=${() => {
          this.diagnosticsOpen = false;
          this.host.requestUpdate();
        }}
      ></hv-diagnostics-panel>
    `;
  }

  private setColumns(columns: ColumnKey[]): void {
    this.columns = columns;
    saveColumnPrefs(columns);
    this.host.requestUpdate();
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

  private async onImportPreview(e: CustomEvent): Promise<void> {
    const { document, policy } = e.detail as { document: unknown; policy: ImportPolicy };
    this.importBusy = true;
    this.importError = null;
    this.importSummary = null;
    this.host.requestUpdate();
    try {
      this.importPreview = (await this.getStore()?.previewImport(document, policy)) ?? null;
    } catch (err) {
      this.importPreview = null;
      this.importError =
        (err as { message?: string })?.message ?? t('hv.surfaces.importCheckFailed');
    } finally {
      this.importBusy = false;
      this.host.requestUpdate();
    }
  }

  private async onImportExecute(e: CustomEvent): Promise<void> {
    const { document, policy } = e.detail as { document: unknown; policy: ImportPolicy };
    this.importBusy = true;
    this.importError = null;
    this.host.requestUpdate();
    try {
      this.importSummary = (await this.getStore()?.executeImport(document, policy)) ?? null;
      this.lastRefresh = new Date().toISOString();
    } catch (err) {
      const anyErr = err as {
        code?: string;
        message?: string;
        data?: { errors?: { path: string; message: string }[] };
      };
      if (anyErr?.code === 'validation_error' && anyErr.data?.errors?.length) {
        // A rejected document shows its structured list, not one message.
        this.importPreview = {
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
        };
      } else {
        this.importError = anyErr?.message ?? t('hv.surfaces.importFailed');
      }
    } finally {
      this.importBusy = false;
      this.host.requestUpdate();
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
