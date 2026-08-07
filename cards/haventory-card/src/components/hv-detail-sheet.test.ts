import './hv-detail-sheet';
import { makeAttachment, makeItem, makeManual, makeMediaBindings } from '../test.utils';
import type { HVDetailSheet } from './hv-detail-sheet';
import type { Item } from '../store/types';

async function mount(item: Partial<Item>, props: Partial<HVDetailSheet> = {}) {
  const el = document.createElement('hv-detail-sheet') as HVDetailSheet;
  el.item = makeItem(item);
  el.open = true;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  await el.updateComplete;
  return el;
}

const q = (el: HVDetailSheet, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVDetailSheet, sel: string) =>
  [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

/** jsdom lays out no shadow DOM, so type sizes are asserted on the sheet. */
const sheetCss = () => {
  const styles = (customElements.get('hv-detail-sheet') as typeof HVDetailSheet).styles;
  return (Array.isArray(styles) ? styles : [styles])
    .map((s) => String(s.cssText))
    .join('\n')
    .replace(/\s+/g, ' ');
};

function captured(el: HVDetailSheet, names: string[]) {
  const seen: string[] = [];
  for (const name of names) el.addEventListener(name, () => seen.push(name));
  return seen;
}

describe('hv-detail-sheet: area', () => {
  const AREAS = [{ id: 'area-garage', name: 'Garage' }];

  it('names the room on the path crumb', async () => {
    const el = await mount(
      {
        effective_area_id: 'area-garage',
        location_path: { id_path: [], name_path: [], display_path: 'Workbench / Shelf B', sort_key: '' },
      },
      { areas: AREAS },
    );
    const crumb = q(el, '[data-testid="sheet-path"]');
    expect(crumb?.querySelector('.hv-area-chip')?.textContent).toContain('Garage');
    expect(crumb?.textContent).toContain('Workbench › Shelf B');
  });

  it('says only "No location" for an item filed nowhere', async () => {
    // The backend derives the area from the location, so one cannot outlive
    // the other.
    const el = await mount({ location_id: null }, { areas: AREAS });
    const crumb = q(el, '[data-testid="sheet-path"]');
    expect(crumb?.textContent?.trim()).toBe('No location');
    expect(crumb?.querySelector('.hv-area-chip')).toBe(null);
  });
});

describe('hv-detail-sheet: read view', () => {
  it('leads with the name, path and state chips', async () => {
    const el = await mount({
      name: 'Multimeter',
      category: 'Tools',
      tags: ['electric', 'meter'],
      checked_out: true,
      due_date: '2099-07-31',
      location_path: { id_path: [], name_path: [], display_path: 'Garage / Shelf B', sort_key: '' },
    });

    expect(q(el, '[data-testid="sheet-name"]')?.textContent).toContain('Multimeter');
    expect(q(el, '[data-testid="sheet-path"]')?.textContent).toContain('Garage › Shelf B');
    // "Out" read as out of stock — the opposite of what a checked-out item is.
    expect(q(el, '[data-testid="sheet-out"]')?.textContent).toContain('Checked out · due Jul 31');
    expect(q(el, '[data-testid="sheet-category"]')?.textContent).toContain('Tools');
    expect(all(el, '[data-testid="sheet-tag"]').map((t) => t.textContent?.trim())).toEqual([
      'electric',
      'meter',
    ]);
  });

  it('marks an overdue check-out and low stock', async () => {
    const el = await mount({ checked_out: true, due_date: '2020-01-01', quantity: 1, low_stock_threshold: 5 });
    expect(q(el, '[data-testid="sheet-out"]')?.textContent).toContain('Overdue');
    expect(q(el, '[data-testid="sheet-low"]')).toBeTruthy();
  });

  it('makes quantity the primary action, with the threshold as a caption', async () => {
    const el = await mount({ quantity: 2, low_stock_threshold: 8 });
    expect(q(el, '[data-testid="sheet-qty"]')?.textContent).toBe('2');
    expect(q(el, '[data-testid="sheet-qty"]')?.classList.contains('low')).toBe(true);
    expect(q(el, '[data-testid="sheet-threshold"]')?.textContent).toContain('low-stock at 8');
  });

  // The two things this view exists to show were 2.7 sizes apart: the location
  // path at 12.5px was the smallest text on the sheet, while the quantity at
  // 34px was half again bigger than the item's own name.
  it('sizes the path and the quantity off one scale', () => {
    const css = sheetCss();
    const size = (selector: string) => {
      const rule = new RegExp(`${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      return Number(/font-size: ([\d.]+)px/.exec(rule)?.[1]);
    };
    const path = size('\\.bar \\.crumb');
    const qty = size('\\.hero \\.qty');
    const name = size('\\.title h2');

    // Body size, like the description under it — not the smallest text here.
    expect(path).toBe(13.5);
    // Still the biggest number on the surface, but no louder than the item it
    // belongs to.
    expect(qty).toBeLessThanOrEqual(name);
    expect(qty / path).toBeLessThan(2);
  });

  it('emits quantity changes', async () => {
    const el = await mount({ id: 'item-1', quantity: 5 });
    const seen = captured(el, ['increment', 'decrement']);
    (q(el, '[data-testid="sheet-increment"]') as HTMLButtonElement).click();
    (q(el, '[data-testid="sheet-decrement"]') as HTMLButtonElement).click();
    expect(seen).toEqual(['increment', 'decrement']);
  });

  it('disables the stepper for a checked-out item and at zero', async () => {
    const out = await mount({ checked_out: true, quantity: 3 });
    expect((q(out, '[data-testid="sheet-increment"]') as HTMLButtonElement).disabled).toBe(true);

    const zero = await mount({ quantity: 0 });
    expect((q(zero, '[data-testid="sheet-decrement"]') as HTMLButtonElement).disabled).toBe(true);
    expect((q(zero, '[data-testid="sheet-increment"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reads out custom fields as facts, typed', async () => {
    const el = await mount({
      custom_fields: { serial: '44210-887', purchase_price: 189, calibrated: true, checked: '2019-02-01' },
    });
    const facts = Object.fromEntries(
      all(el, '[data-testid="sheet-fact"]').map((f) => [f.dataset.key, f.textContent?.replace(/\s+/g, ' ').trim()]),
    );
    expect(facts.serial).toContain('44210-887');
    expect(facts.purchase_price).toContain('189');
    expect(facts.calibrated).toContain('Yes');
    // Dates render through the same formatter as the rest of the card.
    expect(facts.checked).toContain('Feb 1, 2019');
  });

  it('says "Not set" rather than hiding an empty date', async () => {
    const el = await mount({ due_date: null, inspection_date: null });
    const facts = all(el, '[data-testid="sheet-fact"]');
    expect(facts.find((f) => f.dataset.key === 'due')?.textContent).toContain('Not set');
    expect(facts.find((f) => f.dataset.key === 'inspection')?.textContent).toContain('Not set');
  });

  // The row used to read "Last inspected" while the editor's field called the
  // same value an inspection date — two readings of one stored date.
  it('names the inspection fact for the date it holds', async () => {
    const el = await mount({ inspection_date: '2099-03-04' });
    const fact = all(el, '[data-testid="sheet-fact"]').find((f) => f.dataset.key === 'inspection');
    expect(fact?.textContent).toContain('Next inspection');
    expect(fact?.textContent).not.toContain('Last inspected');
    expect(q(el, '[data-testid="sheet-inspection-due"]')).toBe(null);
  });

  it('chips an inspection that has come due, and marks the fact', async () => {
    const el = await mount({ inspection_date: '2020-05-06' });
    expect(q(el, '[data-testid="sheet-inspection-due"]')?.textContent).toContain('Inspection due');
    const fact = all(el, '[data-testid="sheet-fact"]').find((f) => f.dataset.key === 'inspection');
    expect(fact?.querySelector('.value')?.classList.contains('late')).toBe(true);
  });

  it('shows the version alongside when it was updated', async () => {
    const el = await mount({ version: 14 });
    expect(q(el, '[data-testid="sheet-updated"]')?.textContent).toContain('v14');
  });

  it('chips a flagged status and stays quiet for ok', async () => {
    const flagged = await mount({ status: 'missing' });
    expect(q(flagged, '[data-testid="sheet-status"]')?.textContent?.trim()).toBe('Missing');

    // ok explicitly, and absent (an older backend's payload) — quiet both ways.
    const ok = await mount({ status: 'ok' });
    expect(q(ok, '[data-testid="sheet-status"]')).toBe(null);
    const absent = await mount({});
    expect(q(absent, '[data-testid="sheet-status"]')).toBe(null);
  });

  it('offers check out or check in depending on the state', async () => {
    const inStock = await mount({ checked_out: false });
    expect(q(inStock, '[data-testid="sheet-check-out"]')).toBeTruthy();
    expect(q(inStock, '[data-testid="sheet-check-in"]')).toBe(null);

    const out = await mount({ checked_out: true });
    expect(q(out, '[data-testid="sheet-check-in"]')).toBeTruthy();
    expect(q(out, '[data-testid="sheet-check-out"]')).toBe(null);
  });

  it('emits delete straight away, but routes check-out through the date step', async () => {
    const el = await mount({ id: 'item-1' });
    const seen = captured(el, ['check-out-confirmed', 'request-delete']);

    (q(el, '[data-testid="sheet-delete"]') as HTMLButtonElement).click();
    expect(seen).toEqual(['request-delete']);

    (q(el, '[data-testid="sheet-check-out"]') as HTMLButtonElement).click();
    await el.updateComplete;
    // Nothing is checked out until the date step is answered.
    expect(seen).toEqual(['request-delete']);
    expect(q(el, '[data-testid="sheet-checkout"]')).toBeTruthy();

    const step = q(el, '[data-testid="sheet-checkout"]') as HTMLElement;
    (step.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(seen).toEqual(['request-delete', 'check-out-confirmed']);
    expect(q(el, '[data-testid="sheet-checkout"]')).toBe(null);
  });

  it('closes from the ✕', async () => {
    const el = await mount({ id: '1' });
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });
    (q(el, '[data-testid="sheet-close"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});

describe('hv-detail-sheet: edit view', () => {
  it('swaps to the form in the same sheet, never a second dialog', async () => {
    const el = await mount({ id: '1', name: 'Multimeter' });
    expect(q(el, '[data-testid="sheet-editor"]')).toBe(null);

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
    // Still one sheet.
    expect(all(el, 'hv-bottom-sheet')).toHaveLength(1);
    // The read view is gone, not stacked underneath.
    expect(q(el, '[data-testid="sheet-qty"]')).toBe(null);
  });

  it('reaches the form from "Edit details" too', async () => {
    const el = await mount({ id: '1' });
    (q(el, '[data-testid="sheet-edit-details"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
  });

  it('goes back to the read view', async () => {
    const el = await mount({ id: '1' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    (q(el, '[data-testid="sheet-back"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });

  it('drives the embedded editor from the sheet header Save', async () => {
    const el = await mount({ id: 'item-1', name: 'Old' });
    const saves: unknown[] = [];
    el.addEventListener('save', (e) => saves.push((e as CustomEvent).detail));

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'New';
    name.dispatchEvent(new Event('input'));
    await el.updateComplete;

    (q(el, '[data-testid="sheet-save"]') as HTMLButtonElement).click();
    expect(saves).toHaveLength(1);
    expect((saves[0] as { changes: { name: string } }).changes.name).toBe('New');
  });

  // The form carries a Delete of its own. Every other host of the editor
  // forwarded it; this sheet did not, so the button was inert.
  it('forwards the form’s own Delete as one request-delete', async () => {
    const el = await mount({ id: 'item-1', name: 'Multimeter' });
    const seen = captured(el, ['request-delete', 'delete-item']);

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    (editor.shadowRoot?.querySelector('[data-testid="editor-delete"]') as HTMLButtonElement).click();

    // One event, and the same one the read view's Delete sends — the host has a
    // single confirmation path to hang off.
    expect(seen).toEqual(['request-delete']);
  });

  it('reports whether the form has unsaved changes', async () => {
    const el = await mount({ id: '1', name: 'A' });
    expect(el.dirty).toBe(false);

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.dirty).toBe(false);

    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'B';
    name.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect(el.dirty).toBe(true);
  });

  it('returns to the read view when a different item is loaded', async () => {
    const el = await mount({ id: '1', name: 'A' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    el.item = makeItem({ id: '2', name: 'B' });
    await el.updateComplete;
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });

  // On a phone every attachment mutation broadcasts, and the host re-binds
  // `.item` from the fresh copy — closing the form the user is standing in.
  it('stays in the edit form when the same item comes back with a new version', async () => {
    const el = await mount({ id: '1', name: 'A', version: 3 });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    el.item = makeItem({ id: '1', name: 'A', version: 4 });
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
    expect(q(el, '[data-testid="sheet-qty"]')).toBeNull();
  });

  it('returns to the read view when the sheet is re-opened on the same item', async () => {
    const el = await mount({ id: '1', name: 'A' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await el.updateComplete;

    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });
});

describe('hv-detail-sheet: pictures', () => {
  const shots = () => [makeAttachment({ id: 'att-1' }), makeAttachment({ id: 'att-2' })];

  it('renders one figure per picture', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    const figures = all(el, '[data-testid="sheet-photo"]');
    expect(figures).toHaveLength(2);
    const images = all(el, '[data-testid="sheet-gallery"] img') as HTMLImageElement[];
    expect(images.map((i) => i.getAttribute('alt'))).toEqual([
      'Drill — photo 1 of 2',
      'Drill — photo 2 of 2',
    ]);
  });

  it('renders no gallery at all for an item with no pictures', async () => {
    const el = await mount({ name: 'Screws' }, { media: makeMediaBindings() });

    expect(q(el, '[data-testid="sheet-gallery"]')).toBeNull();
  });

  it('leaves a manual out of the picture strip', async () => {
    const el = await mount(
      { attachments: [makeAttachment({ kind: 'manual', mime: 'application/pdf' })] },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-gallery"]')).toBeNull();
  });

  it('opens the lightbox on the picture that was tapped', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    all(el, '[data-testid="sheet-photo-open"]')[1].click();
    await el.updateComplete;

    const lightbox = q(el, '[data-testid="sheet-lightbox"]');
    expect(lightbox).toBeTruthy();
    expect(lightbox?.getAttribute('aria-label')).toBe('Drill — photo 2 of 2');
  });

  it('closes the lightbox on Escape and returns focus to the opener', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    const opener = all(el, '[data-testid="sheet-photo-open"]')[0];
    opener.focus();
    opener.click();
    await el.updateComplete;
    expect(q(el, '[data-testid="sheet-lightbox"]')).toBeTruthy();

    q(el, '[data-testid="sheet-lightbox"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-lightbox"]')).toBeNull();
    expect(el.shadowRoot?.activeElement).toBe(opener);
  });

  // The bottom sheet under it closes on Escape too; without stopping the event
  // the photo and the whole item would go at once.
  it('does not let the sheet close on the Escape that closes the lightbox', async () => {
    const el = await mount(
      { id: 'i-1', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    const seen = captured(el, ['cancel']);

    all(el, '[data-testid="sheet-photo-open"]')[0].click();
    await el.updateComplete;
    q(el, '[data-testid="sheet-lightbox"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await el.updateComplete;

    expect(seen).toEqual([]);
  });

  it('closes the lightbox from its own close button', async () => {
    const el = await mount(
      { id: 'i-1', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    all(el, '[data-testid="sheet-photo-open"]')[0].click();
    await el.updateComplete;
    q(el, '[data-testid="sheet-lightbox-close"]')?.click();
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-lightbox"]')).toBeNull();
  });

  it('drops the lightbox when the sheet moves to another item', async () => {
    const el = await mount(
      { id: 'i-1', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    all(el, '[data-testid="sheet-photo-open"]')[0].click();
    await el.updateComplete;

    el.item = makeItem({ id: 'i-2' });
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-lightbox"]')).toBeNull();
  });

  // Setting a cover or removing another photo re-broadcasts the same item; the
  // photo on screen has no reason to go with it.
  it('keeps the lightbox open when the same item comes back with a new version', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', version: 3, attachments: shots() },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;
    all(el, '[data-testid="sheet-photo-open"]')[1].click();
    await el.updateComplete;

    el.item = makeItem({ id: 'i-1', name: 'Drill', version: 4, attachments: shots() });
    await el.updateComplete;
    await el.updateComplete;

    const lightbox = q(el, '[data-testid="sheet-lightbox"]');
    expect(lightbox).toBeTruthy();
    expect(lightbox?.getAttribute('aria-label')).toBe('Drill — photo 2 of 2');
  });
});

describe('hv-detail-sheet: documents', () => {
  /** Answers every liveness probe the section makes; 206 is a live file. */
  function serve(status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status })),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const docs = () => [
    makeManual({ id: 'm-1', title: 'Dishwasher manual (EN)', filename: 'bosch.pdf', size: 2516582 }),
    makeManual({ id: 'm-2', filename: 'warranty.pdf', size: 184320 }),
  ];

  it('lists each manual with its title, falling back to the filename', async () => {
    serve(206);
    const el = await mount({ id: 'i-1', attachments: docs() }, { media: makeMediaBindings() });
    await el.updateComplete;

    const titles = all(el, '[data-testid="sheet-document-title"]').map((n) => n.textContent?.trim());
    expect(titles).toEqual(['Dishwasher manual (EN)', 'warranty.pdf']);
    expect(all(el, '[data-testid="sheet-document"]')[0].textContent).toContain('2.4 MB');
  });

  it('renders no section at all for an item with no documents', async () => {
    serve(206);
    const el = await mount(
      { attachments: [makeAttachment({ id: 'att-1' })] },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    expect(q(el, '[data-testid="sheet-documents"]')).toBeNull();
  });

  // An anchor rather than a click handler: the URL must be on the element
  // before the tap, or the new tab is blocked as an unrequested popup.
  it('opens a document in a new tab through the signed URL', async () => {
    serve(206);
    const el = await mount({ id: 'i-1', attachments: docs() }, { media: makeMediaBindings() });
    await el.updateComplete;

    const open = all(el, '[data-testid="sheet-document-open"]')[0] as HTMLAnchorElement;
    expect(open.getAttribute('href')).toBe('/api/haventory/media/i-1/m-1?authSig=test');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
  });

  it('marks a reference whose file is gone instead of offering a dead link', async () => {
    serve(404);
    const el = await mount({ id: 'i-1', attachments: docs() }, { media: makeMediaBindings() });
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(all(el, '[data-testid="sheet-document-missing"]')).toHaveLength(2);
    expect(q(el, '[data-testid="sheet-document-open"]')).toBeNull();
    // The row still names the document: it is a record of what was attached.
    expect(all(el, '[data-testid="sheet-document-title"]')[0].textContent).toContain(
      'Dishwasher manual (EN)',
    );
  });

  it('keeps the link when the probe cannot reach the backend at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const el = await mount({ id: 'i-1', attachments: docs() }, { media: makeMediaBindings() });
    for (let i = 0; i < 4; i += 1) await el.updateComplete;

    expect(q(el, '[data-testid="sheet-document-missing"]')).toBeNull();
    expect(all(el, '[data-testid="sheet-document-open"]')).toHaveLength(2);
  });

  it('shows the documents in stored order, not the order they were uploaded', async () => {
    serve(206);
    const el = await mount(
      {
        id: 'i-1',
        attachments: [
          makeManual({ id: 'm-late', title: 'Second', order: 1 }),
          makeManual({ id: 'm-first', title: 'First', order: 0 }),
        ],
      },
      { media: makeMediaBindings() },
    );
    await el.updateComplete;

    expect(all(el, '[data-testid="sheet-document-title"]').map((n) => n.textContent?.trim())).toEqual(
      ['First', 'Second'],
    );
  });
});
