import './hv-import-sheet';
import type { HVImportSheet } from './hv-import-sheet';
import type { ImportPreview, ImportSummary } from '../store/types';
import { all, mountComponent, q, settle } from '../test.utils';
// The clipboard itself is `ui/clipboard`'s own test; what this sheet owes is
// asking the helper and believing its answer, which needs both answers.
vi.mock('../ui/clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/clipboard')>()),
  copyText: vi.fn(async () => true),
}));
import { copyText } from '../ui/clipboard';

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
  const { el } = await mountComponent<HVImportSheet>('hv-import-sheet', { open: true, ...props });
  return el;
}

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
    expect(policies[1].textContent).toContain("Overwrite items matched by id with the file's version");
  });

  it('says what an item is matched on, because it is the id and not the name', async () => {
    // A user who reads "matching" as matching by name will rebuild entities by
    // hand and expect a restore to merge onto them; it adds duplicates instead.
    const el = await mount();
    for (const policy of all(el, '[data-testid="import-policy"]')) {
      expect(policy.textContent).toMatch(/\bid\b/);
    }
  });

  it('promises no deletion, because no policy deletes', async () => {
    // `replace` overwrites the ids the file carries and leaves every other item
    // alone; a user who reads it as a whole-inventory swap would import a small
    // file expecting a prune and silently keep everything else.
    const el = await mount();
    for (const policy of all(el, '[data-testid="import-policy"]')) {
      expect(policy.textContent?.toLowerCase()).not.toMatch(/delete|remove|wipe|erase/);
    }
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

  // The wire value is not what the user pressed, and the preview is quoting
  // their choice back at them.
  it('names the policy the way the card offered it', async () => {
    const merge = await mount({ preview: preview() });
    const sub = merge.shadowRoot?.querySelector('.head .sub')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(sub).toContain('policy Merge');
    expect(sub).not.toContain('policy merge');

    const skip = await mount({ preview: preview({ policy: 'skip' }) });
    expect(skip.shadowRoot?.querySelector('.head .sub')?.textContent).toContain('Skip');
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

  it('flags an incoming name a different id already answers to', async () => {
    const el = await mount({
      preview: preview({
        warnings: [
          {
            code: 'name_collision',
            path: 'items[0]',
            message:
              '"Hammer" would be added while an item here already goes by that name, under a different id.',
            name: 'Hammer',
            existing_ids: ['abc'],
          },
        ],
      }),
    });
    const block = q(el, '[data-testid="import-warnings"]');
    expect(block?.textContent).toContain('1 name clash');
    expect(block?.textContent).toContain('"Hammer" would be added while an item here already goes by');
  });

  it('warns without gating: the import button stays enabled either way', async () => {
    const withWarnings = await mount({
      preview: preview({
        warnings: [{ code: 'name_collision', path: 'items[0]', message: 'a clash' }],
      }),
    });
    expect((q(withWarnings, '[data-testid="import-execute"]') as HTMLButtonElement).disabled).toBe(false);

    const without = await mount({ preview: preview() });
    expect((q(without, '[data-testid="import-execute"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('hides the warning block when there are none, and when the backend sends none', async () => {
    const empty = await mount({ preview: preview({ warnings: [] }) });
    expect(q(empty, '[data-testid="import-warnings"]')).toBe(null);

    // A backend that predates warnings omits the key entirely.
    const absent = await mount({ preview: preview() });
    expect(absent.preview?.warnings).toBeUndefined();
    expect(q(absent, '[data-testid="import-warnings"]')).toBe(null);
  });

  it('lists the first few clashes and counts the rest', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      code: 'name_collision',
      path: `items[${i}]`,
      message: `clash ${i}`,
    }));
    const el = await mount({ preview: preview({ warnings: many }) });
    const text = el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('8 name clashes');
    expect(text).toContain('clash 4');
    expect(text).not.toContain('clash 5');
    expect(text).toContain('and 3 more');
  });

  it('says how many attachments name files this install does not hold', async () => {
    // An export carries attachment metadata and not the bytes, so restoring one
    // onto a fresh machine leaves every reference pointing at nothing. The
    // count is already on the wire; not showing it is the difference between a
    // decision and a surprise.
    const el = await mount({ preview: preview({ attachments: { referenced: 14, missing: 7 } }) });
    const text =
      q(el, '[data-testid="import-attachments-missing"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('7 of 14 attachments name files this install does not have');
    expect(text).toContain('those photos and manuals will show as missing after the import');
    // The full-fidelity path, since this one cannot be.
    expect(text).toContain('Home Assistant backup carries the files as well');
  });

  it('counts a single missing attachment in the singular', async () => {
    const el = await mount({ preview: preview({ attachments: { referenced: 3, missing: 1 } }) });
    const text =
      q(el, '[data-testid="import-attachments-missing"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('1 of 3 attachments names a file this install does not have');
    expect(text).toContain('that photo or manual');
  });

  it('says nothing about attachments when every referenced file is here', async () => {
    const present = await mount({ preview: preview({ attachments: { referenced: 14, missing: 0 } }) });
    expect(q(present, '[data-testid="import-attachments-missing"]')).toBe(null);

    // A backend that predates the count omits the key entirely.
    const absent = await mount({ preview: preview() });
    expect(absent.preview?.attachments).toBeUndefined();
    expect(q(absent, '[data-testid="import-attachments-missing"]')).toBe(null);
  });

  it('puts the attachment caveat below the name clashes and above the button', async () => {
    const el = await mount({
      preview: preview({
        warnings: [{ code: 'name_collision', path: 'items[0]', message: 'a clash' }],
        attachments: { referenced: 2, missing: 2 },
      }),
    });
    expect(all(el, '.alert').map((a) => a.dataset.testid)).toEqual([
      'import-warnings',
      'import-attachments-missing',
    ]);
  });

  it('states the all-or-nothing behaviour and what it costs other clients', async () => {
    const el = await mount({ preview: preview() });
    const text = el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('all-or-nothing');
    expect(text).toContain('every connected card reloads its data');
  });

  it('labels the import button with what will actually be written', async () => {
    const el = await mount({ preview: preview() });
    expect(q(el, '[data-testid="import-execute"]')?.textContent).toContain(
      'Import 192 items · 6 locations',
    );
  });

  it('names only the kind a document actually writes', async () => {
    const locationsOnly = await mount({
      preview: preview({
        counts: {
          items: { total: 5, add: 0, update: 0, conflict: 0, unchanged: 5 },
          locations: { total: 4, add: 4, update: 0, conflict: 0, unchanged: 0 },
        },
      }),
    });
    expect(q(locationsOnly, '[data-testid="import-execute"]')?.textContent).toContain(
      'Import 4 locations',
    );
    expect(q(locationsOnly, '[data-testid="import-execute"]')?.textContent).not.toContain('item');

    const itemsOnly = await mount({
      preview: preview({
        counts: {
          items: { total: 5, add: 1, update: 0, conflict: 0, unchanged: 4 },
          locations: { total: 4, add: 0, update: 0, conflict: 0, unchanged: 4 },
        },
      }),
    });
    expect(q(itemsOnly, '[data-testid="import-execute"]')?.textContent).toContain('Import 1 item');
    expect(q(itemsOnly, '[data-testid="import-execute"]')?.textContent).not.toContain('location');
  });

  it('says so when the document would change nothing', async () => {
    const el = await mount({
      preview: preview({
        counts: { items: { total: 5, add: 0, update: 0, conflict: 0, unchanged: 5 } },
      }),
    });
    expect(q(el, '[data-testid="import-nothing-to-do"]')).toBeTruthy();
    expect(q(el, '[data-testid="import-execute"]')?.textContent?.trim()).toBe('Import');
  });

  it('does not claim nothing would change when only locations would', async () => {
    // A backup restored onto a hand-rebuilt tree: locations to write, no items.
    const el = await mount({
      preview: preview({
        counts: {
          items: { total: 5, add: 0, update: 0, conflict: 0, unchanged: 5 },
          locations: { total: 4, add: 4, update: 0, conflict: 0, unchanged: 0 },
        },
      }),
    });
    expect(q(el, '[data-testid="import-nothing-to-do"]')).toBe(null);
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
    await settle(el);
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('items[14].quantity'));
    expect(copy.textContent).toContain('Copied');
  });

  // Home Assistant on the LAN over plain http:// is not a secure context, and
  // an old browser there has no fallback either. Saying "Copied" would send the
  // household off to paste whatever was on the clipboard before.
  it('says nothing about a copy the browser refused', async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    const el = await mount({ preview: invalid });
    const copy = q(el, '[data-testid="import-copy-errors"]') as HTMLButtonElement;

    copy.click();
    await settle(el);

    expect(copy.textContent).toContain('Copy errors');
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
      'Added 128 items and 4 locations, updated 64 items.',
    );
    expect(el.shadowRoot?.textContent?.replace(/\s+/g, ' ')).toContain('250 items across 13 locations');

    (q(el, '[data-testid="import-done"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });

  // The result sentence has a slot for location updates, or a locations-only
  // document completes with every number on the screen at zero.
  it('reports a locations-only import instead of a row of zeros', async () => {
    const s = summary();
    s.items = { total: 0, add: 0, update: 0, conflict: 0, unchanged: 0 };
    s.locations = { total: 1, add: 0, update: 1, conflict: 0, unchanged: 0 };
    const el = await mount({ summary: s });

    expect(q(el, '[data-testid="import-summary"]')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Updated 1 location.',
    );
  });

  it('says in words when nothing needed changing', async () => {
    const s = summary();
    s.items = { total: 2, add: 0, update: 0, conflict: 0, unchanged: 2 };
    s.locations = { total: 1, add: 0, update: 0, conflict: 0, unchanged: 1 };
    const el = await mount({ summary: s });

    expect(q(el, '[data-testid="import-summary"]')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Nothing needed changing',
    );
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

describe('hv-import-sheet: keyboard and focus', () => {
  it('announces itself as a modal dialog', async () => {
    const el = await mount();
    const sheet = q(el, '[data-testid="import-sheet"]') as HTMLElement;
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBe('Import backup');
  });

  it('takes focus on open so Escape reaches its handler', async () => {
    const el = await mount();
    expect(el.shadowRoot?.activeElement).toBe(q(el, '[data-testid="import-sheet"]'));
  });

  it('closes on Escape', async () => {
    const el = await mount();
    let cancels = 0;
    el.addEventListener('cancel', () => { cancels += 1; });

    (q(el, '[data-testid="import-sheet"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await el.updateComplete;

    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});
