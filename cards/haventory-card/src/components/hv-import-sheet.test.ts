import './hv-import-sheet';
import type { HVImportSheet } from './hv-import-sheet';
import type { ImportPreview, ImportSummary } from '../store/types';

const VALID_DOC = '{"haventory_export_version":1,"items":[],"locations":[]}';

function preview(patch: Partial<ImportPreview> = {}): ImportPreview {
  return {
    valid: true,
    errors: [],
    policy: 'merge',
    document: {
      haventory_export_version: 1,
      schema_version: 4,
      exported_at: null,
      integration_version: null,
    },
    items: { add: ['a'], update: ['b'], conflict: [], unchanged: [] },
    locations: { add: [], update: [], conflict: [], unchanged: [] },
    counts: {
      items: { total: 250, add: 128, update: 64, conflict: 5, unchanged: 58 },
      locations: { total: 13, add: 4, update: 2, conflict: 0, unchanged: 7 },
    },
    ...patch,
  };
}

function summary(): ImportSummary {
  return {
    applied: true,
    policy: 'merge',
    items: { total: 192, add: 128, update: 64, conflict: 0, unchanged: 0 },
    locations: { total: 4, add: 4, update: 0, conflict: 0, unchanged: 0 },
    totals: {
      items_total: 250,
      low_stock_count: 0,
      checked_out_count: 0,
      locations_total: 13,
      no_location_count: 0,
    },
  };
}

async function mount(props: Partial<HVImportSheet> = {}) {
  const el = document.createElement('hv-import-sheet') as HVImportSheet;
  el.open = true;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVImportSheet, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVImportSheet, sel: string) => [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

async function type(el: HVImportSheet, text: string) {
  const area = q(el, '[data-testid="import-text"]') as HTMLTextAreaElement;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  await el.updateComplete;
}

describe('hv-import-sheet: step 1', () => {
  it('says up front that nothing is written yet', async () => {
    const el = await mount();
    expect(el.shadowRoot?.textContent).toContain('Step 1 of 2');
    expect(el.shadowRoot?.textContent).toContain('nothing is written until you press Import');
  });

  it('defaults to merge and offers all three policies', async () => {
    const el = await mount();
    const policies = all(el, '[data-testid="import-policy"]');
    expect(policies.map((p) => p.dataset.policy)).toEqual(['merge', 'replace', 'skip']);
    expect(policies[0].getAttribute('aria-checked')).toBe('true');
    // Each explains what it does, rather than relying on the word alone.
    expect(policies[1].textContent).toContain('Delete everything not in the file');
  });

  it('cannot preview an empty document', async () => {
    const el = await mount();
    expect((q(el, '[data-testid="import-preview"]') as HTMLButtonElement).disabled).toBe(true);
    await type(el, VALID_DOC);
    expect((q(el, '[data-testid="import-preview"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports bad JSON before bothering the backend', async () => {
    const el = await mount();
    let previews = 0;
    el.addEventListener('preview', () => {
      previews += 1;
    });

    await type(el, '{ not json');
    (q(el, '[data-testid="import-preview"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(previews).toBe(0);
    expect(q(el, '[data-testid="import-parse-error"]')?.textContent).toContain('not valid JSON');
  });

  it('emits the parsed document and the chosen policy', async () => {
    const el = await mount();
    let detail: { document?: unknown; policy?: string } = {};
    el.addEventListener('preview', (e) => {
      detail = (e as CustomEvent).detail;
    });

    await type(el, VALID_DOC);
    (q(el, '[data-policy="replace"]') as HTMLButtonElement).click();
    await el.updateComplete;
    (q(el, '[data-testid="import-preview"]') as HTMLButtonElement).click();

    expect(detail.policy).toBe('replace');
    expect(detail.document).toEqual({ haventory_export_version: 1, items: [], locations: [] });
  });

  it('invalidates a stale preview when the policy changes', async () => {
    const el = await mount({ preview: preview() });
    let invalidated = 0;
    el.addEventListener('invalidate-preview', () => {
      invalidated += 1;
    });
    // Go back to the input step first, where the policy cards live.
    (q(el, '[data-testid="import-back"]') as HTMLButtonElement).click();
    el.preview = null;
    await el.updateComplete;

    (q(el, '[data-policy="skip"]') as HTMLButtonElement).click();
    expect(invalidated).toBe(2);
  });

  it('offers a file picker as well as pasting', async () => {
    const el = await mount();
    expect(q(el, '[data-testid="import-file"]')).toBe(null);
    (q(el, '[data-source="file"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="import-file"]')).toBeTruthy();
    expect(q(el, '[data-testid="import-filename"]')?.textContent).toContain('No file chosen');
  });
});

describe('hv-import-sheet: preview', () => {
  it('breaks the plan down by items and locations', async () => {
    const el = await mount({ preview: preview() });
    const counts = Object.fromEntries(
      all(el, '[data-testid="import-count"]').map((c) => [c.dataset.key, c.textContent?.replace(/\s+/g, ' ').trim()]),
    );
    expect(counts['items-add']).toContain('+128');
    expect(counts['items-update']).toContain('64');
    expect(counts['items-conflict']).toContain('5');
    expect(counts['locations-add']).toContain('+4');
  });

  it('explains what the chosen policy does with conflicts', async () => {
    const merge = await mount({ preview: preview({ items: { add: [], update: [], conflict: ['x'], unchanged: [] } }) });
    expect(q(merge, '[data-testid="import-conflicts"]')?.textContent).toContain("Merge keeps the file's values");

    const skip = await mount({
      preview: preview({ policy: 'skip', items: { add: [], update: [], conflict: ['x'], unchanged: [] } }),
    });
    expect(q(skip, '[data-testid="import-conflicts"]')?.textContent).toContain('Skip leaves them as they are');
  });

  it('hides the conflict banner when there are none', async () => {
    const el = await mount({ preview: preview() });
    expect(q(el, '[data-testid="import-conflicts"]')).toBe(null);
  });

  it('states the all-or-nothing behaviour and what it costs other clients', async () => {
    const el = await mount({ preview: preview() });
    const text = el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('all-or-nothing');
    expect(text).toContain('every connected card reloads its data');
  });

  it('labels the import button with what will actually be written', async () => {
    const el = await mount({ preview: preview() });
    expect(q(el, '[data-testid="import-execute"]')?.textContent).toContain('Import 128 + 64');
  });

  it('says so when the document would change nothing', async () => {
    const el = await mount({
      preview: preview({
        counts: { items: { total: 5, add: 0, update: 0, conflict: 0, unchanged: 5 } },
      }),
    });
    expect(q(el, '[data-testid="import-nothing-to-do"]')).toBeTruthy();
  });

  it('goes back to the input step', async () => {
    const el = await mount({ preview: preview() });
    let invalidated = 0;
    el.addEventListener('invalidate-preview', () => {
      invalidated += 1;
    });
    (q(el, '[data-testid="import-back"]') as HTMLButtonElement).click();
    expect(invalidated).toBe(1);
  });
});

describe('hv-import-sheet: invalid document', () => {
  const invalid = preview({
    valid: false,
    counts: {},
    errors: [
      { path: 'items[14].quantity', message: 'must be a number ≥ 0 (found "-3")' },
      { path: 'items[57].location_id', message: 'references unknown location "loc_attic"' },
      { path: 'locations[2].parent_id', message: 'creates a cycle: Garage → Shelf A → Garage' },
    ],
  });

  it('lists every problem with its JSON path, instead of one flat message', async () => {
    const el = await mount({ preview: invalid });
    expect(el.shadowRoot?.textContent).toContain("This file can't be imported");
    expect(el.shadowRoot?.textContent).toContain('3 problems found · nothing was changed');

    const rows = all(el, '[data-testid="import-error-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('items[14].quantity');
    expect(rows[0].textContent).toContain('must be a number');
    expect(rows[2].textContent).toContain('creates a cycle');
  });

  it('has no import action at all in this state', async () => {
    const el = await mount({ preview: invalid });
    expect(q(el, '[data-testid="import-execute"]')).toBe(null);
  });

  it('offers to copy the problems out', async () => {
    const el = await mount({ preview: invalid });
    const copy = q(el, '[data-testid="import-copy-errors"]') as HTMLButtonElement;
    expect(copy.textContent).toContain('Copy errors');
    copy.click();
    await el.updateComplete;
    expect(copy.textContent).toContain('Copied');
  });
});

describe('hv-import-sheet: summary', () => {
  it('reports what landed and closes on Done', async () => {
    const el = await mount({ summary: summary() });
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    expect(q(el, '[data-testid="import-summary"]')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Imported 128 new, updated 64',
    );
    expect(el.shadowRoot?.textContent?.replace(/\s+/g, ' ')).toContain('250 items across 13 locations');

    (q(el, '[data-testid="import-done"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});

describe('hv-import-sheet: failures that are not the document', () => {
  it('shows a storage or transport failure alongside the form', async () => {
    const el = await mount({ errorMessage: 'Storage is full' });
    expect(q(el, '[data-testid="import-error"]')?.textContent).toContain('Storage is full');
    // ...and the input is still there to retry from.
    expect(q(el, '[data-testid="import-text"]')).toBeTruthy();
  });
});
