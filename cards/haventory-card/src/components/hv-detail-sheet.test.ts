import './hv-detail-sheet';
import {
  all,
  componentCss,
  makeAttachment,
  makeItem,
  makeManual,
  makeMediaBindings,
  mountComponent,
  q,
  settle as settleEl,
} from '../test.utils';
import { DISCARD_PROMPT } from '../ui/discard';
import { MEDIA_NAME_TOKEN_PARAM, attachmentNameToken } from '../ui/media';
import type { HVDetailSheet } from './hv-detail-sheet';
import type { HVBottomSheet } from './hv-bottom-sheet';
import type { Item } from '../store/types';

async function mount(item: Partial<Item>, props: Partial<HVDetailSheet> = {}) {
  const { el } = await mountComponent<HVDetailSheet>(
    'hv-detail-sheet',
    { item: makeItem(item), open: true, ...props },
    { renders: 2 },
  );
  return el;
}

/**
 * The lightbox is a component of its own — shared with the edit form on every
 * host — so its panel sits one shadow root below this sheet's.
 */
const lightbox = (el: HVDetailSheet, sel = '[data-testid="lightbox"]') =>
  (q(el, 'hv-lightbox')?.shadowRoot?.querySelector(sel) ?? null) as HTMLElement | null;
/**
 * A host's own update does not carry its children's, and the sheet renders the
 * lightbox as a child — so anything that opens or moves it needs the child's
 * update too.
 */
const settle = async (el: HVDetailSheet) => {
  await settleEl(el);
  await q<HTMLElement & { updateComplete?: Promise<unknown> }>(el, 'hv-lightbox')?.updateComplete;
};

/** jsdom lays out no shadow DOM, so type sizes are asserted on the sheet. */
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

  // Naming a root location after the room it stands in is the ordinary thing to
  // do, and it put "Kitchen Kitchen" on the crumb. The card's rows and the
  // table's Location cell answer this the same way; the crumb is a clipped
  // one-line chip like both of them, and the pairing it drops stays readable in
  // full in its title.
  const KITCHEN = [{ id: 'area-kitchen', name: 'Kitchen' }];
  const rooted = (display_path: string) => ({
    id_path: [],
    name_path: [],
    display_path,
    sort_key: '',
  });

  it('drops the area mark when the path already opens with that name', async () => {
    for (const path of ['Kitchen', 'Kitchen / Pantry']) {
      const el = await mount(
        { effective_area_id: 'area-kitchen', location_path: rooted(path) },
        { areas: KITCHEN },
      );
      const crumb = q(el, '[data-testid="sheet-path"]');

      expect(crumb?.querySelector('[data-testid="area-chip"]'), path).toBe(null);
      expect(crumb?.textContent?.replace(/\s+/g, ' ').trim(), path).toBe(path.replace(' / ', ' › '));
      expect(crumb?.getAttribute('title'), path).toBe(`Area: Kitchen · ${path.replace(' / ', ' › ')}`);
      el.remove();
    }
  });

  // A segment deeper down that happens to share the area's name is a different
  // place inside it, so the mark still has something to say.
  it('keeps the mark when the area only reappears further down the path', async () => {
    const el = await mount(
      { effective_area_id: 'area-kitchen', location_path: rooted('Cellar / Kitchen') },
      { areas: KITCHEN },
    );
    const crumb = q(el, '[data-testid="sheet-path"]');
    expect(crumb?.querySelector('.hv-area-chip')?.textContent).toContain('Kitchen');
    expect(crumb?.textContent).toContain('Cellar › Kitchen');
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
      '#electric',
      '#meter',
    ]);
  });

  // Same row, same size, same shape: without a marker on the chip itself,
  // "Tools" and "electric" are one control wearing one fill and only a
  // household that already knows its own vocabulary can tell which is which.
  it('tells a category chip from a tag chip without reading either label', async () => {
    const el = await mount({ category: 'Tools', tags: ['electric'] });
    const category = q(el, '[data-testid="sheet-category"]')!;
    const tag = q(el, '[data-testid="sheet-tag"]')!;

    expect(tag.classList.contains('tag')).toBe(true);
    expect(category.classList.contains('tag')).toBe(false);
    // The mark carries the distinction in greyscale; the hue is the second signal.
    expect(tag.querySelector('.hv-tag-mark')?.textContent).toBe('#');
    expect(category.querySelector('.hv-tag-mark')).toBe(null);
    // Decoration, not part of the value: a reader is told "electric", not "hash electric".
    expect(tag.querySelector('.hv-tag-mark')?.getAttribute('aria-hidden')).toBe('true');
  });

  // The "Checked out" chip takes the same blue, so the two must not collapse
  // into one another in the row they share.
  it('keeps the checked-out chip out of the tag vocabulary', async () => {
    const el = await mount({ checked_out: true, tags: ['electric'] });
    const out = q(el, '[data-testid="sheet-out"]')!;

    expect(out.classList.contains('state')).toBe(true);
    expect(out.classList.contains('tag')).toBe(false);
    expect(out.querySelector('.hv-tag-mark')).toBe(null);
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
    const css = componentCss('hv-detail-sheet');
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

  // The facts list mixes these with "Due" and "Next inspection", where a raw
  // "purchase_price" read as debug output rather than as a fact about the item.
  it('writes a custom field key for reading and keeps the key on the row', async () => {
    const el = await mount({ custom_fields: { purchase_price: 64.57, serial_number: 'SN-363905' } });
    const fact = (key: string) =>
      all(el, '[data-testid="sheet-fact"]').find((f) => f.dataset.key === key);

    expect(fact('purchase_price')?.textContent?.replace(/\s+/g, ' ')).toContain('Purchase price');
    expect(fact('purchase_price')?.textContent).not.toContain('purchase_price');
    expect(fact('serial_number')?.textContent?.replace(/\s+/g, ' ')).toContain('Serial number');

    // The key is the stored identity, so it stays addressable on the row.
    expect(fact('purchase_price')).toBeTruthy();
    expect(fact('serial_number')).toBeTruthy();
  });

  // Display formatting is the read surface's business alone: the editor writes
  // the key back, so a label there would rename the field on save.
  it('leaves the editor showing the key exactly as it is stored', async () => {
    const el = await mount({ custom_fields: { purchase_price: 64.57 } });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = el.shadowRoot?.querySelector('hv-item-editor') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    // On a phone the custom fields sit behind the editor's "More" disclosure.
    (editor.shadowRoot?.querySelector('[data-testid="editor-more-toggle"]') as HTMLButtonElement).click();
    await editor.updateComplete;

    const keys = [...(editor.shadowRoot?.querySelectorAll('[data-testid="editor-cf-key"]') ?? [])].map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(keys).toContain('purchase_price');
    expect(keys).not.toContain('Purchase price');
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
    await settle(el);
    // Nothing is checked out until the date step is answered.
    expect(seen).toEqual(['request-delete']);
    expect(q(el, '[data-testid="sheet-checkout"]')).toBeTruthy();

    const step = q(el, '[data-testid="sheet-checkout"]') as HTMLElement;
    (step.shadowRoot?.querySelector('[data-testid="checkout-no-date"]') as HTMLButtonElement).click();
    await settle(el);
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
    await settle(el);

    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
    // Still one sheet.
    expect(all(el, 'hv-bottom-sheet')).toHaveLength(1);
    // The read view is gone, not stacked underneath.
    expect(q(el, '[data-testid="sheet-qty"]')).toBe(null);
  });

  it('reaches the form from "Edit details" too', async () => {
    const el = await mount({ id: '1' });
    (q(el, '[data-testid="sheet-edit-details"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
  });

  it('goes back to the read view', async () => {
    const el = await mount({ id: '1' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    (q(el, '[data-testid="sheet-back"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });

  it('drives the embedded editor from the sheet header Save', async () => {
    const el = await mount({ id: 'item-1', name: 'Old' });
    const saves: unknown[] = [];
    el.addEventListener('save', (e) => saves.push((e as CustomEvent).detail));

    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'New';
    name.dispatchEvent(new Event('input'));
    await settle(el);

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
    await settle(el);

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
    await settle(el);
    expect(el.dirty).toBe(false);

    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'B';
    name.dispatchEvent(new Event('input'));
    await settle(el);
    expect(el.dirty).toBe(true);
  });

  it('returns to the read view when a different item is loaded', async () => {
    const el = await mount({ id: '1', name: 'A' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    el.item = makeItem({ id: '2', name: 'B' });
    await settle(el);
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });

  // On a phone every attachment mutation broadcasts, and the host re-binds
  // `.item` from the fresh copy — closing the form the user is standing in.
  it('stays in the edit form when the same item comes back with a new version', async () => {
    const el = await mount({ id: '1', name: 'A', version: 3 });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    el.item = makeItem({ id: '1', name: 'A', version: 4 });
    await settle(el);

    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();
    expect(q(el, '[data-testid="sheet-qty"]')).toBeNull();
  });

  it('returns to the read view when the sheet is re-opened on the same item', async () => {
    const el = await mount({ id: '1', name: 'A' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);

    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });
});

// The sheet published a `dirty` getter and nothing read it: a scrim tap, a
// swipe-down or the Back arrow took the typing with them. The sheet answers for
// the form it hosts — a host outside cannot see into this shadow root.
describe('hv-detail-sheet: a dirty form is asked about before it goes', () => {
  /** Open the edit form and type into it. */
  async function dirtySheet() {
    const el = await mount({ id: '1', name: 'A' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    const name = editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement;
    name.value = 'A longer name';
    name.dispatchEvent(new Event('input'));
    await settle(el);
    expect(el.dirty).toBe(true);
    return el;
  }

  const guard = (el: HVDetailSheet) =>
    q(el, '[data-testid="sheet-discard-confirm"]') as HTMLElement & { open: boolean };
  const press = (el: HVDetailSheet, testid: 'confirm-accept' | 'confirm-cancel') =>
    (guard(el).shadowRoot?.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();

  /** The three ways out, each landing on the sheet's own cancel path. */
  const dismissals = {
    scrim: (el: HVDetailSheet) =>
      ((q(el, 'hv-bottom-sheet') as HVBottomSheet).shadowRoot?.querySelector('.scrim') as HTMLElement).click(),
    escape: (el: HVDetailSheet) =>
      (
        (q(el, 'hv-bottom-sheet') as HVBottomSheet).shadowRoot?.querySelector(
          '[data-testid="bottom-sheet"]',
        ) as HTMLElement
      ).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    swipe: (el: HVDetailSheet) => {
      const sheet = q(el, 'hv-bottom-sheet') as HVBottomSheet;
      const node = sheet.shadowRoot?.querySelector('[data-testid="sheet-grip"]') as HTMLElement | null;
      // Edit mode hides the grip, so the swipe is raised on the panel the
      // gesture handlers would have received it through.
      if (!node) return;
      node.setPointerCapture = () => {};
      for (const [type, clientY] of [
        ['pointerdown', 100],
        ['pointermove', 480],
        ['pointerup', 480],
      ] as const) {
        node.dispatchEvent(new MouseEvent(type, { clientY, bubbles: true }));
      }
    },
  } as const;

  it.each(['scrim', 'escape'] as const)('%s asks, and the sheet stays up until it is answered', async (how) => {
    const el = await dirtySheet();
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    dismissals[how](el);
    await settle(el);

    expect(guard(el).open).toBe(true);
    expect(cancels).toBe(0);
    expect(el.open).toBe(true);
    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();

    press(el, 'confirm-accept');
    await settle(el);
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });

  it.each(['scrim', 'escape'] as const)('%s keeps the form when the question is declined', async (how) => {
    const el = await dirtySheet();
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    dismissals[how](el);
    await settle(el);
    press(el, 'confirm-cancel');
    await settle(el);

    expect(cancels).toBe(0);
    expect(el.open).toBe(true);
    const editor = q(el, '[data-testid="sheet-editor"]') as HTMLElement;
    expect((editor.shadowRoot?.querySelector('[data-testid="editor-name"]') as HTMLInputElement).value).toBe(
      'A longer name',
    );
  });

  // The grip is hidden in edit mode, so the drag is exercised on the read view:
  // clean there, and it must not start asking about nothing.
  it('dismisses a clean read view on a swipe without a question', async () => {
    const el = await mount({ id: '1', name: 'A' });
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    dismissals.swipe(el);
    await settle(el);

    expect(guard(el).open).toBe(false);
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });

  it('asks before the Back arrow drops the form for the read view', async () => {
    const el = await dirtySheet();

    (q(el, '[data-testid="sheet-back"]') as HTMLButtonElement).click();
    await settle(el);
    expect(guard(el).open).toBe(true);
    expect(q(el, '[data-testid="sheet-editor"]')).toBeTruthy();

    press(el, 'confirm-accept');
    await settle(el);
    // Back lands on the read view; the sheet itself stays up.
    expect(el.open).toBe(true);
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });

  it('asks the same question the form asks itself', async () => {
    const el = await dirtySheet();
    dismissals.scrim(el);
    await settle(el);

    const panel = guard(el).shadowRoot as ShadowRoot;
    expect(panel.querySelector('[data-testid="confirm-dialog"]')?.getAttribute('aria-label')).toBe(
      DISCARD_PROMPT.heading,
    );
    expect(panel.querySelector('[data-testid="confirm-message"]')?.textContent).toContain(
      DISCARD_PROMPT.message,
    );
    expect(panel.querySelector('[data-testid="confirm-accept"]')?.textContent).toContain(
      DISCARD_PROMPT.confirmLabel,
    );
  });

  // Every cancel in the card is composed. Backing out of the date step used to
  // reach the host as "the sheet closed" and took the item down with it.
  it('keeps the sheet up when the check-out date step is backed out of', async () => {
    const el = await mount({ id: '1', name: 'A' });
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    (q(el, '[data-testid="sheet-check-out"]') as HTMLButtonElement).click();
    await settle(el);
    const step = q(el, '[data-testid="sheet-checkout"]') as HTMLElement;
    (step.shadowRoot?.querySelector('[data-testid="checkout-cancel"]') as HTMLButtonElement).click();
    await settle(el);

    expect(cancels).toBe(0);
    expect(el.open).toBe(true);
    expect(q(el, '[data-testid="sheet-checkout"]')).toBe(null);
    expect(q(el, '[data-testid="sheet-qty"]')).toBeTruthy();
  });

  it('closes a clean form on the scrim without asking', async () => {
    const el = await mount({ id: '1', name: 'A' });
    (q(el, '[data-testid="sheet-edit"]') as HTMLButtonElement).click();
    await settle(el);
    let cancels = 0;
    el.addEventListener('cancel', () => {
      cancels += 1;
    });

    dismissals.scrim(el);
    await settle(el);

    expect(guard(el).open).toBe(false);
    expect(cancels).toBe(1);
    expect(el.open).toBe(false);
  });
});

describe('hv-detail-sheet: pictures', () => {
  const shots = () => [makeAttachment({ id: 'att-1' }), makeAttachment({ id: 'att-2' })];

  it('renders one figure per picture', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);

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
    await settle(el);

    expect(q(el, '[data-testid="sheet-gallery"]')).toBeNull();
  });

  it('opens the lightbox on the picture that was tapped', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);

    all(el, '[data-testid="sheet-photo-open"]')[1].click();
    await settle(el);

    const panel = lightbox(el);
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('aria-label')).toBe('Drill — photo 2 of 2');
  });

  it('closes the lightbox on Escape and returns focus to the opener', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);

    const opener = all(el, '[data-testid="sheet-photo-open"]')[0];
    opener.focus();
    opener.click();
    await settle(el);
    expect(lightbox(el)).toBeTruthy();

    lightbox(el)?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle(el);

    expect(lightbox(el)).toBeNull();
    expect(el.shadowRoot?.activeElement).toBe(opener);
  });

  // The bottom sheet under it closes on Escape too; without stopping the event
  // the photo and the whole item would go at once.
  it('does not let the sheet close on the Escape that closes the lightbox', async () => {
    const el = await mount(
      { id: 'i-1', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);
    const seen = captured(el, ['cancel']);

    all(el, '[data-testid="sheet-photo-open"]')[0].click();
    await settle(el);
    lightbox(el)?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle(el);

    expect(seen).toEqual([]);
  });

  it('closes the lightbox from its own close button', async () => {
    const el = await mount(
      { id: 'i-1', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);

    all(el, '[data-testid="sheet-photo-open"]')[0].click();
    await settle(el);
    lightbox(el, '[data-testid="lightbox-close"]')?.click();
    await settle(el);

    expect(lightbox(el)).toBeNull();
  });

  it('drops the lightbox when the sheet moves to another item', async () => {
    const el = await mount(
      { id: 'i-1', attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);
    all(el, '[data-testid="sheet-photo-open"]')[0].click();
    await settle(el);

    el.item = makeItem({ id: 'i-2' });
    await settle(el);

    expect(lightbox(el)).toBeNull();
  });

  // Setting a cover or removing another photo re-broadcasts the same item; the
  // photo on screen has no reason to go with it.
  it('keeps the lightbox open when the same item comes back with a new version', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', version: 3, attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);
    all(el, '[data-testid="sheet-photo-open"]')[1].click();
    await settle(el);

    el.item = makeItem({ id: 'i-1', name: 'Drill', version: 4, attachments: shots() });
    await settle(el);
    await settle(el);

    const panel = lightbox(el);
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('aria-label')).toBe('Drill — photo 2 of 2');
  });

  // The lightbox outlives a same-item refresh, and one of those refreshes is
  // the photo it is showing being deleted from another surface.
  it('falls back to the last photo when the strip shrinks under an open lightbox', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', version: 3, attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);
    all(el, '[data-testid="sheet-photo-open"]')[1].click();
    await settle(el);

    el.item = makeItem({
      id: 'i-1',
      name: 'Drill',
      version: 4,
      attachments: [makeAttachment({ id: 'att-1' })],
    });
    await settle(el);
    await settle(el);

    const panel = lightbox(el);
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('aria-label')).toBe('Photo of Drill');
  });

  it('closes the lightbox when the last photo is removed under it', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', version: 3, attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);
    all(el, '[data-testid="sheet-photo-open"]')[0].click();
    await settle(el);

    el.item = makeItem({ id: 'i-1', name: 'Drill', version: 4, attachments: [] });
    await settle(el);
    await settle(el);

    expect(lightbox(el)).toBeNull();
  });

  // That close takes the thumbnail focus would have gone back to with it, so
  // there is nothing left to return to and focus falls out of the sheet —
  // onto <body>, where the sheet's own Escape can no longer reach it.
  it('keeps focus in the sheet when the photo it would return to is gone', async () => {
    const el = await mount(
      { id: 'i-1', name: 'Drill', version: 3, attachments: shots() },
      { media: makeMediaBindings() },
    );
    await settle(el);
    const opener = all(el, '[data-testid="sheet-photo-open"]')[0];
    opener.focus();
    opener.click();
    await settle(el);

    el.item = makeItem({ id: 'i-1', name: 'Drill', version: 4, attachments: [] });
    await settle(el);
    await settle(el);

    expect(opener.isConnected).toBe(false);
    const sheet = q(el, 'hv-bottom-sheet') as HVBottomSheet;
    const panel = sheet.shadowRoot?.querySelector('[data-testid="bottom-sheet"]');
    expect(document.activeElement).not.toBe(document.body);
    expect(sheet.shadowRoot?.activeElement).toBe(panel);
  });
});

describe('hv-detail-sheet: lightbox navigation', () => {
  const shots = () => [
    makeAttachment({ id: 'att-1' }),
    makeAttachment({ id: 'att-2' }),
    makeAttachment({ id: 'att-3' }),
  ];

  async function opened(index: number, attachments = shots()) {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments }, { media: makeMediaBindings() });
    await settle(el);
    all(el, '[data-testid="sheet-photo-open"]')[index].click();
    await settle(el);
    return el;
  }

  const shown = (el: HVDetailSheet) =>
    (lightbox(el, '[data-testid="lightbox"] img') as HTMLImageElement | null)?.getAttribute('alt');
  const counter = (el: HVDetailSheet) =>
    lightbox(el, '[data-testid="lightbox-counter"]')?.textContent?.trim();
  const press = async (el: HVDetailSheet, key: string) => {
    lightbox(el)?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true }),
    );
    await settle(el);
  };

  it('counts the photo out of the strip it belongs to', async () => {
    const el = await opened(1);
    expect(counter(el)).toBe('2 of 3');
    // A changed dialog label is not re-announced; the counter is.
    expect(lightbox(el, '[data-testid="lightbox-counter"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('steps forward and back from the tap-edge buttons', async () => {
    const el = await opened(0);
    expect(shown(el)).toBe('Drill — photo 1 of 3');

    (lightbox(el, '[data-testid="lightbox-next"]') as HTMLButtonElement).click();
    await settle(el);
    expect(shown(el)).toBe('Drill — photo 2 of 3');
    expect(counter(el)).toBe('2 of 3');

    (lightbox(el, '[data-testid="lightbox-prev"]') as HTMLButtonElement).click();
    await settle(el);
    expect(shown(el)).toBe('Drill — photo 1 of 3');
    expect(counter(el)).toBe('1 of 3');
  });

  // Every press does something: no control disables itself under the finger
  // that pressed it, which would drop focus out of the dialog.
  it('wraps at both ends rather than stopping', async () => {
    const el = await opened(0);
    (lightbox(el, '[data-testid="lightbox-prev"]') as HTMLButtonElement).click();
    await settle(el);
    expect(counter(el)).toBe('3 of 3');

    (lightbox(el, '[data-testid="lightbox-next"]') as HTMLButtonElement).click();
    await settle(el);
    expect(counter(el)).toBe('1 of 3');
  });

  // The backdrop closes on click and the buttons sit on top of it.
  it('does not close the lightbox when a nav button is pressed', async () => {
    const el = await opened(0);
    (lightbox(el, '[data-testid="lightbox-next"]') as HTMLButtonElement).click();
    await settle(el);
    expect(lightbox(el)).toBeTruthy();
  });

  it('moves with the arrow keys', async () => {
    const el = await opened(0);
    await press(el, 'ArrowRight');
    expect(shown(el)).toBe('Drill — photo 2 of 3');
    await press(el, 'ArrowLeft');
    expect(shown(el)).toBe('Drill — photo 1 of 3');
    await press(el, 'ArrowLeft');
    expect(shown(el)).toBe('Drill — photo 3 of 3');
  });

  it('leaves the sheet under it alone on an arrow key', async () => {
    const el = await opened(0);
    const seen = captured(el, ['cancel']);
    await press(el, 'ArrowRight');
    expect(seen).toEqual([]);
    expect(el.open).toBe(true);
  });

  it('offers no navigation for a single photo', async () => {
    const el = await opened(0, [makeAttachment({ id: 'att-1' })]);
    expect(lightbox(el, '[data-testid="lightbox-prev"]')).toBeNull();
    expect(lightbox(el, '[data-testid="lightbox-next"]')).toBeNull();
    expect(lightbox(el, '[data-testid="lightbox-counter"]')).toBeNull();
    // The arrow key has nowhere to go and must not be swallowed by a dialog
    // that cannot act on it.
    await press(el, 'ArrowRight');
    expect(shown(el)).toBe('Photo of Drill');
  });

  it('still closes on Escape with the navigation on screen', async () => {
    const el = await mount({ id: 'i-1', name: 'Drill', attachments: shots() }, { media: makeMediaBindings() });
    await settle(el);
    const opener = all(el, '[data-testid="sheet-photo-open"]')[1];
    opener.focus();
    opener.click();
    await settle(el);
    const seen = captured(el, ['cancel']);

    await press(el, 'Escape');

    expect(lightbox(el)).toBeNull();
    expect(seen).toEqual([]);
    expect(el.shadowRoot?.activeElement).toBe(opener);
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
    await settle(el);

    const titles = all(el, '[data-testid="sheet-document-title"]').map((n) => n.textContent?.trim());
    expect(titles).toEqual(['Dishwasher manual (EN)', 'warranty.pdf']);
    expect(all(el, '[data-testid="sheet-document"]')[0].textContent).toContain('2.4 MB');
  });

  // The title falls back to the filename, so an untitled document printed the
  // same string as its own subtitle — the state every upload starts in.
  it('names the file under a title only when the two differ', async () => {
    serve(206);
    const el = await mount({ id: 'i-1', attachments: docs() }, { media: makeMediaBindings() });
    await settle(el);

    const [titled, untitled] = all(el, '[data-testid="sheet-document-meta"]').map((n) =>
      n.textContent?.trim(),
    );
    expect(titled).toContain('bosch.pdf');
    expect(untitled).not.toContain('warranty.pdf');
    // What the filename was standing beside is still there.
    expect(untitled).toContain('180 KB');
    expect(untitled).toContain('added');
  });

  it('renders no section at all for an item with no documents', async () => {
    serve(206);
    const el = await mount(
      { attachments: [makeAttachment({ id: 'att-1' })] },
      { media: makeMediaBindings() },
    );
    await settle(el);

    expect(q(el, '[data-testid="sheet-documents"]')).toBeNull();
  });

  // An anchor rather than a click handler: the URL must be on the element
  // before the tap, or the new tab is blocked as an unrequested popup.
  it('opens a document in a new tab through the signed URL', async () => {
    serve(206);
    const el = await mount({ id: 'i-1', attachments: docs() }, { media: makeMediaBindings() });
    await settle(el);

    const open = all(el, '[data-testid="sheet-document-open"]')[0] as HTMLAnchorElement;
    // Versioned by the served name, so a retitle cannot be answered from the
    // browser's cache with the filename this document used to carry.
    expect(open.getAttribute('href')).toBe(
      `/api/haventory/media/i-1/m-1?${MEDIA_NAME_TOKEN_PARAM}=${attachmentNameToken(docs()[0])}&authSig=test`,
    );
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
  });

  it('marks a reference whose file is gone instead of offering a dead link', async () => {
    serve(404);
    const el = await mount({ id: 'i-1', attachments: docs() }, { media: makeMediaBindings() });
    for (let i = 0; i < 4; i += 1) await settle(el);

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
    for (let i = 0; i < 4; i += 1) await settle(el);

    expect(q(el, '[data-testid="sheet-document-missing"]')).toBeNull();
    expect(all(el, '[data-testid="sheet-document-open"]')).toHaveLength(2);
  });

  // jsdom computes no layout, so the widths these two rules produce are only
  // observable on a real phone. What is pinned here is the pair of declarations
  // that keeps a row inside the list: without them the single track sizes itself
  // to the widest row, whose tail (the Open link, the "File missing" chip) does
  // not shrink, and `overflow: hidden` clips exactly those two away.
  it('sizes the documents track off the list rather than off its widest row', () => {
    const css = componentCss('hv-detail-sheet');
    const rule = (selector: string) =>
      new RegExp(`${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    expect(rule('\\.documents ul')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rule('\\.documents li')).toContain('min-width: 0');
  });

  // The row shrinking into its track is only worth anything if the two elements
  // it was cutting off are the ones that keep their size.
  it('leaves the Open link and the missing-file chip unshrinkable', () => {
    const css = componentCss('hv-detail-sheet');
    const rule = (selector: string) =>
      new RegExp(`${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    expect(rule('\\.documents \\.doc-open')).toContain('flex: none');
    expect(rule('\\.documents \\.doc-text')).toContain('min-width: 0');
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
    await settle(el);

    expect(all(el, '[data-testid="sheet-document-title"]').map((n) => n.textContent?.trim())).toEqual(
      ['First', 'Second'],
    );
  });
  // A reminder was set-only before: the editor could write one and no surface
  // read it back, so a household could not see which of its things had one.
  describe('the reminder row', () => {
    const MONTHLY = { unit: 'months' as const, count: 3 };

    it('says nothing at all when the item carries no reminder', async () => {
      const el = await mount({ reminder_date: null });
      expect(q(el, '[data-testid="sheet-reminder"]')).toBe(null);
      expect(q(el, '[data-testid="sheet-reminder-bump"]')).toBe(null);
    });

    // The date alone cannot tell a series from a one-off, and the difference is
    // what Mark done means.
    it('reads the date and the repeat together for a series', async () => {
      const el = await mount({ reminder_date: '2026-08-31', reminder_interval: MONTHLY });
      expect(q(el, '[data-testid="sheet-reminder"]')?.textContent).toContain('every 3 months');
      expect(q(el, '[data-testid="sheet-reminder"]')?.textContent).toContain('Aug 31');
    });

    it('reads a one-off as its date alone', async () => {
      const el = await mount({ reminder_date: '2026-08-31', reminder_interval: null });
      expect(q(el, '[data-testid="sheet-reminder"]')?.textContent?.trim()).toBe('Aug 31');
    });

    // The backend refuses a bump on a one-off — there is no next occurrence to
    // move to — so the action is only offered where it would succeed.
    it('offers Mark done for a series and withholds it from a one-off', async () => {
      const series = await mount({ reminder_date: '2026-08-31', reminder_interval: MONTHLY });
      expect(q(series, '[data-testid="sheet-reminder-bump"]')).toBeTruthy();

      const oneOff = await mount({ reminder_date: '2026-08-31', reminder_interval: null });
      expect(q(oneOff, '[data-testid="sheet-reminder-bump"]')).toBe(null);
    });

    it('raises reminder-bump with the item it belongs to', async () => {
      const el = await mount({ id: 'i-7', reminder_date: '2026-08-31', reminder_interval: MONTHLY });
      let detail: { itemId?: string } | null = null;
      el.addEventListener('reminder-bump', (e) => {
        detail = (e as CustomEvent<{ itemId: string }>).detail;
      });

      q<HTMLButtonElement>(el, '[data-testid="sheet-reminder-bump"]')!.click();

      expect(detail).toEqual({ itemId: 'i-7' });
    });

    // Same amber the Inspection row uses, and on the inclusive rule: a reminder
    // names the day it is asking about, so today already counts.
    it('marks a reminder that has come round, today included', async () => {
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
        today.getDate(),
      ).padStart(2, '0')}`;
      const due = await mount({ reminder_date: iso, reminder_interval: MONTHLY });
      expect(q(due, '[data-testid="sheet-reminder"]')?.classList.contains('late')).toBe(true);

      const later = await mount({ reminder_date: '2099-01-01', reminder_interval: MONTHLY });
      expect(q(later, '[data-testid="sheet-reminder"]')?.classList.contains('late')).toBe(false);
    });
  });
});
