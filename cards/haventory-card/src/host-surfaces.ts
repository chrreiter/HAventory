import { html } from 'lit';
import type { TemplateResult } from 'lit';
import type { ColumnKey } from './store/columns';
import { loadColumnPrefs, saveColumnPrefs } from './store/columns';
import { activeFilterCount, defaultFilters } from './store/store';
import type { Store } from './store/store';
import type { ImportPolicy, ImportPreview, ImportSummary } from './store/types';
import { tn } from './i18n';
import { counted } from './ui/plural';
import { NARROW_QUERY } from './ui/responsive';
import type { OrganizeTab } from './components/hv-organize-dialog';
import type { OverflowMenuEntry } from './components/hv-overflow-menu';
import './components/hv-column-picker';
import './components/hv-confirm';
import './components/hv-organize-dialog';
import './components/hv-import-sheet';
import './components/hv-diagnostics-panel';

/** All that these surfaces need from the element hosting them. */
interface SurfaceHost {
  requestUpdate(): void;
}

/** What a confirmation prompt needs to say and do. */
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
 * Every surface `hv-full-view` can raise but not answer itself.
 *
 * The view names these actions — from its ⋮ menu, its sidebar's "+" buttons,
 * its editor's Delete and its empty state's offers — but none of them can be
 * answered where they are raised: the column choice is a per-browser preference,
 * an export has to leave the page as a file, and the confirm/organize/import/
 * diagnostics dialogs must outlive the surface that asked for them. They bubble
 * out to whichever element Home Assistant instantiated — the Lovelace card
 * (via `hv-card-shell`) and the sidebar panel are each one of those — so the
 * state, the wiring and the ⋮ menu contents live here, held by the host rather
 * than repeated in it. The one action that stays host-specific is
 * `select-items`, which is about where selection happens, not a dialog.
 */
export class HostSurfaces {
  /** The full view's table columns. Feed this to `hv-full-view.columns`. */
  columns: ColumnKey[] = loadColumnPrefs();

  /**
   * How a file reaches the user's disk. A seam: a test can replace it, and
   * nothing else has a reason to.
   */
  download: (filename: string, text: string) => void = triggerDownload;

  /** When the caches were last known-good, for the diagnostics "since" tile. */
  lastRefresh: string | null = null;
  refreshBusy = false;

  private readonly host: SurfaceHost;
  private readonly getStore: () => Store | undefined;
  private readonly hooks: SurfaceHooks;
  /**
   * The phone predicate for every dialog here, measured against the viewport.
   *
   * Not the card's width: these are `position: fixed`, so they are laid out
   * against the window whatever the card measures. The card side used to hand
   * its own measurement in, which put the organize dialog in its full-bleed
   * phone page whenever the card sat in a normal dashboard column — on a
   * desktop monitor, from a card, from the expanded view and unchanged by
   * expanding, because the measured element was still the card underneath.
   */
  private narrowQuery: MediaQueryList | null = null;
  private narrow = false;
  private readonly onNarrowChange = (e: MediaQueryListEvent) => {
    this.narrow = e.matches;
    this.host.requestUpdate();
  };
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

  constructor(host: SurfaceHost, getStore: () => Store | undefined, hooks: SurfaceHooks = {}) {
    this.host = host;
    this.getStore = getStore;
    this.hooks = hooks;
  }

  /**
   * Start watching the viewport. Hosts call this from `connectedCallback`, and
   * `disconnect()` from the matching teardown — an instance is a plain object
   * rather than a reactive controller, so it has no lifecycle of its own, and a
   * listener left behind would keep waking a detached element.
   *
   * `matchMedia` is missing in jsdom unless a test provides one; without it the
   * dialogs take their desktop form, which is the honest default for a host
   * that cannot say how wide it is.
   */
  connect(): void {
    this.narrowQuery ??= window.matchMedia?.(NARROW_QUERY) ?? null;
    if (!this.narrowQuery) return;
    this.narrow = this.narrowQuery.matches;
    this.narrowQuery.addEventListener('change', this.onNarrowChange);
  }

  disconnect(): void {
    this.narrowQuery?.removeEventListener('change', this.onNarrowChange);
  }

  /**
   * Run a menu action if a surface here owns it, and say whether one did. An id
   * this does not know belongs to the host, which must not treat a `false` as
   * "handled" and drop it on the floor.
   */
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
        // The expanded sidebar's facet headings ask for a specific tab; the ⋮
        // menus ask for none and get Locations.
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

  /** The delete flow: look the item up, ask, then send version-checked delete. */
  requestDeleteById(itemId: string): void {
    const store = this.getStore();
    const item = store?.state.value.items.find((i) => i.id === itemId);
    if (!item) return;
    this.confirm({
      heading: `Delete "${item.name}"?`,
      message: 'This cannot be undone. The item is removed for every connected client.',
      confirmLabel: 'Delete',
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

  /**
   * The full view's ⋮ menu. Both hosts serve this same list, so the card's
   * expanded view and the sidebar panel cannot drift apart on what it offers.
   *
   * Every hint line under an entry — `meta` and `sub` alike — is a list of
   * `·`-separated segments, and each segment opens with a capital. A line that
   * reads as a sentence beside one that reads as a list makes the two look like
   * different kinds of thing when they are the same kind.
   */
  menuEntries(): OverflowMenuEntry[] {
    const st = this.getStore()?.state.value ?? null;
    const total = st?.statsCounts?.items_total ?? null;
    const filtered = st?.total ?? null;
    const filtersOn = activeFilterCount(st?.filters ?? defaultFilters()) > 0;
    return [
      { id: 'select-items', label: 'Select items…', glyph: 'select' },
      { id: 'organize', label: 'Organize…', glyph: 'mapMarker', meta: 'Locations · Tags · Categories · Statuses' },
      { id: 'columns', label: 'Columns…', glyph: 'viewColumn' },
      { divider: true },
      { id: 'refresh', label: 'Refresh data', glyph: 'refresh', meta: 'Items · Locations · Stats' },
      {
        id: 'diagnostics',
        label: 'Diagnostics',
        glyph: 'alertCircle',
        // Badge only when there is actually something wrong — otherwise it is a plain row.
        ...(this.diagnosticsBadge ? { badge: this.diagnosticsBadge } : {}),
      },
      { divider: true },
      { caption: 'Data' },
      {
        id: 'export-all',
        label: 'Export backup',
        glyph: 'download',
        sub: total === null ? 'Everything' : `All ${counted(total, 'item')} · All locations`,
      },
      // Only while a filter is on. Unfiltered, "the current view" is the whole
      // inventory that Export backup above already offers, and the entry could
      // only say so by claiming a filter that is not there.
      ...(filtersOn
        ? [
            {
              id: 'export-view',
              label: 'Export current view',
              glyph: 'download' as const,
              sub:
                filtered === null
                  ? 'Active filter · Keeps location paths'
                  : tn('hv.surfaces.exportView.filtered', filtered),
            },
          ]
        : []),
      { id: 'import', label: 'Import backup…', glyph: 'upload' },
    ];
  }

  /** Short badge for the Diagnostics menu row, or null when all is well. */
  private get diagnosticsBadge(): string | null {
    const st = this.getStore()?.state.value ?? null;
    if (!st) return null;
    const rate = st.healthCache?.rate_limit;
    const dropped = (rate?.dropped_commands ?? 0) + (rate?.dropped_events ?? 0);
    if (dropped > 0) return `${dropped} dropped`;
    const issues = st.healthCache?.issues.length ?? 0;
    if (issues > 0) return counted(issues, 'issue');
    if (st.degraded.connectionLost) return 'offline';
    return null;
  }

  /** Every dialog these surfaces own. Render once, after the host's main UI. */
  renderSurfaces(): TemplateResult {
    const st = this.getStore()?.state.value ?? null;
    const mobile = this.narrow;
    return html`
      <hv-column-picker
        data-testid="host-columns"
        .open=${this.pickerOpen}
        ?mobile=${mobile}
        .columns=${this.columns}
        heading="Full view columns"
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
        .confirmLabel=${this.confirmSpec?.confirmLabel ?? 'Delete'}
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
          // A preview is only valid for the policy it was run with.
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
        .health=${st?.healthCache ?? null}
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
      // The surface that raised the action owns the error banner; export
      // failures are rare and not worth one, so they go to the console.
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
      this.importError = (err as { message?: string })?.message ?? 'Could not check that document.';
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
        // The backend rejected the document itself — show the structured list
        // rather than flattening it into one message.
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
        this.importError = anyErr?.message ?? 'The import failed.';
      }
    } finally {
      this.importBusy = false;
      this.host.requestUpdate();
    }
  }
}

/** Trigger a browser download of the given text as a JSON file. */
export function triggerDownload(filename: string, text: string): void {
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
