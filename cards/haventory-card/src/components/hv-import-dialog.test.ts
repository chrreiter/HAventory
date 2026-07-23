import { describe, it, expect, afterEach } from 'vitest';
import './hv-import-dialog';
import type { ImportPreview, ImportSummary } from '../store/types';

type Dialog = HTMLElement & {
  open: boolean;
  preview: ImportPreview | null;
  summary: ImportSummary | null;
  busy: boolean;
  errorMessage: string | null;
  updateComplete?: Promise<unknown>;
};

async function mount(props: Partial<Dialog> = {}): Promise<Dialog> {
  const el = document.createElement('hv-import-dialog') as Dialog;
  document.body.appendChild(el);
  await customElements.whenDefined('hv-import-dialog');
  Object.assign(el, props);
  el.open = true;
  if (el.updateComplete) await el.updateComplete;
  return el;
}

const validDoc = JSON.stringify({
  haventory_export_version: 1,
  schema_version: 4,
  items: [],
  locations: [],
});

function validPreview(): ImportPreview {
  return {
    valid: true,
    errors: [],
    policy: 'merge',
    document: { haventory_export_version: 1, schema_version: 4, exported_at: null, integration_version: null },
    items: { add: ['a'], update: [], conflict: [], unchanged: [] },
    locations: { add: [], update: [], conflict: [], unchanged: [] },
    counts: {
      items: { total: 1, add: 1, update: 0, conflict: 0, unchanged: 0 },
      locations: { total: 0, add: 0, update: 0, conflict: 0, unchanged: 0 },
    },
  };
}

async function type(el: Dialog, text: string) {
  const ta = el.shadowRoot!.querySelector('[data-testid="import-text"]') as HTMLTextAreaElement;
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  if (el.updateComplete) await el.updateComplete;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('hv-import-dialog', () => {
  it('emits preview with the parsed document and selected policy', async () => {
    const el = await mount();
    let detail: { document: unknown; policy: string } | null = null;
    el.addEventListener('preview', (e: Event) => { detail = (e as CustomEvent).detail; });

    await type(el, validDoc);
    // Choose the "replace" policy.
    const replace = el.shadowRoot!.querySelector('[data-testid="policy-replace"]') as HTMLInputElement;
    replace.checked = true;
    replace.dispatchEvent(new Event('change', { bubbles: true }));

    (el.shadowRoot!.querySelector('[data-testid="import-preview"]') as HTMLButtonElement).click();

    expect(detail).not.toBeNull();
    expect(detail!.policy).toBe('replace');
    expect(detail!.document).toEqual(JSON.parse(validDoc));
  });

  it('shows a parse error and does not emit preview for invalid JSON', async () => {
    const el = await mount();
    let emitted = false;
    el.addEventListener('preview', () => { emitted = true; });

    await type(el, '{ not json');
    (el.shadowRoot!.querySelector('[data-testid="import-preview"]') as HTMLButtonElement).click();
    if (el.updateComplete) await el.updateComplete;

    expect(emitted).toBe(false);
    expect(el.shadowRoot!.querySelector('[data-testid="parse-error"]')).not.toBeNull();
  });

  it('disables Import until a valid preview is present', async () => {
    const el = await mount();
    const importBtn = () => el.shadowRoot!.querySelector('[data-testid="import-execute"]') as HTMLButtonElement;
    expect(importBtn().disabled).toBe(true);

    el.preview = validPreview();
    if (el.updateComplete) await el.updateComplete;
    expect(importBtn().disabled).toBe(false);

    // The summary counts are rendered from the preview.
    expect(el.shadowRoot!.querySelector('[data-testid="preview-summary"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-testid="count-items-add"]')!.textContent).toContain('1 add');
  });

  it('renders structured errors and keeps Import disabled for an invalid preview', async () => {
    const el = await mount();
    el.preview = {
      ...validPreview(),
      valid: false,
      errors: [{ path: 'items[0].id', message: 'must be a UUID v4 string' }],
    };
    if (el.updateComplete) await el.updateComplete;

    const errBox = el.shadowRoot!.querySelector('[data-testid="preview-errors"]');
    expect(errBox).not.toBeNull();
    expect(errBox!.textContent).toContain('items[0].id');
    expect((el.shadowRoot!.querySelector('[data-testid="import-execute"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits execute when Import is clicked with a valid preview', async () => {
    const el = await mount();
    await type(el, validDoc);
    el.preview = validPreview();
    if (el.updateComplete) await el.updateComplete;

    let detail: { document: unknown; policy: string } | null = null;
    el.addEventListener('execute', (e: Event) => { detail = (e as CustomEvent).detail; });
    (el.shadowRoot!.querySelector('[data-testid="import-execute"]') as HTMLButtonElement).click();

    expect(detail).not.toBeNull();
    expect(detail!.document).toEqual(JSON.parse(validDoc));
  });

  it('shows a success summary after import completes', async () => {
    const el = await mount();
    el.summary = {
      applied: true,
      policy: 'merge',
      items: { total: 2, add: 2, update: 0, conflict: 0, unchanged: 0 },
      locations: { total: 1, add: 1, update: 0, conflict: 0, unchanged: 0 },
      totals: { items_total: 2, low_stock_count: 0, checked_out_count: 0, locations_total: 1 },
    };
    if (el.updateComplete) await el.updateComplete;

    const banner = el.shadowRoot!.querySelector('[data-testid="import-summary"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('2 items');
  });

  it('closes on Cancel', async () => {
    const el = await mount();
    let cancels = 0;
    el.addEventListener('cancel', () => { cancels += 1; });
    (el.shadowRoot!.querySelector('[data-testid="import-close"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});
