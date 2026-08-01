import { html } from 'lit';
import type { TemplateResult } from 'lit';
import type { ColumnKey } from './store/columns';
import { loadColumnPrefs, saveColumnPrefs } from './store/columns';
import type { Store } from './store/store';
import './components/hv-column-picker';

/** All that these surfaces need from the element hosting them. */
interface SurfaceHost {
  requestUpdate(): void;
}

/**
 * The two surfaces that belong to the browser rather than to the inventory.
 *
 * Every menu inside the card names them, but neither can be answered where the
 * name is raised: the column choice is a per-browser preference with no home on
 * the server, and an export has to leave the page as a file. Both bubble out to
 * whichever element Home Assistant instantiated — the Lovelace card and the
 * sidebar panel are each one of those — so the handling lives here, held by the
 * host rather than repeated in it.
 */
export class HostSurfaces {
  /** The full view's table columns. Feed this to `hv-full-view.columns`. */
  columns: ColumnKey[] = loadColumnPrefs();

  /**
   * How a file reaches the user's disk. A seam: a test can replace it, and
   * nothing else has a reason to.
   */
  download: (filename: string, text: string) => void = triggerDownload;

  private readonly host: SurfaceHost;
  private readonly getStore: () => Store | undefined;
  private pickerOpen = false;

  constructor(host: SurfaceHost, getStore: () => Store | undefined) {
    this.host = host;
    this.getStore = getStore;
  }

  /**
   * Run a menu action if it is one of these two, and say whether it was. An id
   * this does not know belongs to the host, which must not treat a `false` as
   * "handled" and drop it on the floor.
   */
  handleAction(id: string): boolean {
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
      default:
        return false;
    }
  }

  /** The picker itself. Render it as a sibling of the surface that opens it. */
  renderColumnPicker(): TemplateResult {
    return html`
      <hv-column-picker
        .open=${this.pickerOpen}
        .columns=${this.columns}
        heading="Full view columns"
        @change=${(e: CustomEvent) => this.setColumns((e.detail as { columns: ColumnKey[] }).columns)}
        @cancel=${() => {
          this.pickerOpen = false;
          this.host.requestUpdate();
        }}
      ></hv-column-picker>
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
