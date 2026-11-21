import { setLanguage } from '../i18n';
import './hv-organize-statuses';
import { all, makeItem, mountHost, q, settle } from '../test.utils';
import type { HVOrganizeStatuses } from './hv-organize-statuses';
import type { Item, StatusDefinition } from '../store/types';

async function mount(opts: { items?: Item[]; statuses?: StatusDefinition[] } = {}) {
  return mountHost<HVOrganizeStatuses>(
    'hv-organize-statuses',
    {
      items: opts.items ?? [],
      locations: [],
      areas: [],
      ...(opts.statuses ? { statuses: opts.statuses } : {}),
    },
    {},
    { renders: 2 },
  );
}

describe('hv-organize-statuses: the tab', () => {
  const ladder = makeItem({ id: 'i1', name: 'Ladder', status: 'missing' });

  it('lists the vocabulary in display order, with each definition its own chip', async () => {
    const { sr } = await mount();

    expect(all(sr, '[data-testid="status-row"]').map((r) => r.dataset.value)).toEqual([
      'ok',
      'missing',
      'needs_repair',
    ]);
    expect(q(sr, '[data-testid="status-chip"]')?.classList.contains('tone-green')).toBe(true);
  });

  // The chip already names each status in the household's own words; printing
  // "needs_repair" beside "Needs repair" only said the same thing in code.
  it('leaves the slug out of the list rows and keeps it in the editor', async () => {
    const { el, sr } = await mount();

    expect(all(sr, '[data-testid="status-slug"]')).toEqual([]);

    (
      all(sr, '[data-testid="status-row"]')
        .find((r) => r.dataset.value === 'needs_repair')
        ?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-slug-preview"]')?.textContent?.trim()).toBe('needs_repair');
  });

  it('counts the items on each status', async () => {
    const { sr } = await mount({ items: [ladder] });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    expect(row?.querySelector('[data-testid="status-count"]')?.textContent?.trim()).toBe('1 item');
  });

  // The count is this tab's answer to "which items?", so it has to land on
  // those items — the way a location count and a category count already do.
  it('opens the items behind a status from its count', async () => {
    const { el, store, sr } = await mount({
      items: [ladder, makeItem({ id: 'i2', name: 'Rake' })],
    });
    let browsed = 0;
    el.addEventListener('browse', () => {
      browsed += 1;
    });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-count"]') as HTMLButtonElement).click();
    await settle(el);

    expect(store.state.value.filters.status).toBe('missing');
    // Organizing happens full-screen; so should the list it hands back.
    expect(browsed).toBe(1);
  });

  it('creates a status, deriving the slug from the label', async () => {
    const { el, sr, hass } = await mount();

    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Lent out';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-slug-preview"]')?.textContent?.trim()).toBe('lent_out');

    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    const sent = hass.__messages.find((m) => m.type === 'haventory/status/create');
    expect(sent).toMatchObject({ slug: 'lent_out', label: 'Lent out' });
  });

  it('renames without touching any item', async () => {
    const { el, sr, hass } = await mount({ items: [ladder] });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Gone walkabout';
    input.dispatchEvent(new Event('input'));
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/update')).toMatchObject({
      slug: 'missing',
      label: 'Gone walkabout',
    });
    expect(hass.__messages.some((m) => m.type === 'haventory/item/update')).toBe(false);
  });

  // The command takes the whole permutation, so a partial list cannot leave two
  // definitions claiming one position.
  it('moves a status by sending every slug in the new order', async () => {
    const { el, sr, hass } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-down"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/reorder')).toMatchObject({
      slugs: ['ok', 'needs_repair', 'missing'],
    });
  });

  it('cannot move the first row up or the last row down', async () => {
    const { sr } = await mount();

    const rows = all(sr, '[data-testid="status-row"]');
    expect((rows[0]?.querySelector('[data-testid="status-up"]') as HTMLButtonElement).disabled).toBe(true);
    expect(
      (rows[rows.length - 1]?.querySelector('[data-testid="status-down"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  // The backend takes label, colour and icon changes for any slug, the default
  // included — a household that wants a quieter "OK", or one in its own
  // language, has to be able to say so. Only the delete stays withheld.
  it('withholds delete from the default status but not the rename', async () => {
    const { el, sr } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'ok');
    expect(row?.querySelector('[data-testid="status-default"]')).not.toBe(null);
    expect(row?.querySelector('[data-testid="status-remove"]')).toBe(null);

    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-editor"]')).not.toBe(null);
    expect((q(sr, '[data-testid="status-label"]') as HTMLInputElement).value).toBe('OK');
  });

  it('renames the default status without the backend hearing about any item', async () => {
    const { el, sr, hass } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'ok');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'In Ordnung';
    input.dispatchEvent(new Event('input'));
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/update')).toMatchObject({
      slug: 'ok',
      label: 'In Ordnung',
    });
  });

  // The backend refuses this regardless; the guard is the explanation, and the
  // target is what turns the refusal into a completed move.
  it('guards a delete that would orphan items, then reassigns them', async () => {
    const { el, sr, hass } = await mount({ items: [ladder] });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const guard = q(sr, '[data-testid="status-guard"]');
    expect(guard?.textContent).toContain('1 item');
    expect(hass.__messages.some((m) => m.type === 'haventory/status/delete')).toBe(false);
    const reassign = q(sr, '[data-testid="status-reassign"]') as HTMLSelectElement;
    expect(
      reassign.parentElement?.querySelector(':scope > .chevron > svg[data-icon="chevronDown"]'),
    ).toBeTruthy();

    (q(sr, '[data-testid="status-guard-confirm"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/delete')).toMatchObject({
      slug: 'missing',
      reassign_to: 'ok',
    });
  });

  // One question, one idiom, whichever branch it is: a modal for the unused
  // status beside an inline disclosure for the in-use one puts the lighter
  // ceremony on the consequential path.
  it('asks in the same disclosure when nothing carries the status', async () => {
    const { el, sr } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const guard = q(sr, '[data-testid="status-guard"]');
    expect(guard).toBeTruthy();
    expect(guard?.textContent).toContain('No item carries this status');
    // Nothing to reassign, so the select the in-use branch needs is absent...
    expect(guard?.querySelector('[data-testid="status-reassign"]')).toBe(null);
    // ...and the action says what it does rather than promising a reassign.
    expect(q(sr, '[data-testid="status-guard-confirm"]')?.textContent?.trim()).toBe('Delete');
    // No modal branch anywhere in the component: both go through the disclosure.
    expect(q(sr, '[data-testid="organize-status-confirm"]')).toBe(null);
  });

  it('deletes an unused status once the disclosure is confirmed', async () => {
    const { el, sr, hass } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="status-guard-confirm"]') as HTMLButtonElement).click();
    await settle(el);

    const deleted = hass.__messages.filter((m) => m.type === 'haventory/status/delete');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.slug).toBe('missing');
    // No reassign target travels with a status nothing carries.
    expect(deleted[0]?.reassign_to ?? null).toBe(null);
  });

  it('backs out of an unused status delete', async () => {
    const { el, sr, hass } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="status-guard-cancel"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-guard"]')).toBe(null);
    expect(hass.__messages.some((m) => m.type === 'haventory/status/delete')).toBe(false);
  });

  it('sends the colour and glyph chosen in the picker', async () => {
    const { el, sr, hass } = await mount();

    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Lent out';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    (
      all(sr, '[data-testid="status-color"]').find(
        (b) => b.dataset.value === 'blue_strong',
      ) as HTMLButtonElement
    ).click();
    (
      all(sr, '[data-testid="status-icon"]').find((b) => b.dataset.value === 'hand') as HTMLButtonElement
    ).click();
    await settle(el);
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/create')).toMatchObject({
      color: 'blue_strong',
      icon: 'hand',
    });
  });

  // A tone is a tint plus the ink that reads on it. Painting only the tint left
  // the five light tones near-identical on white and near-black in dark, where
  // they are washes never meant to stand on their own.
  it('paints each swatch as a miniature chip carrying the glyph being chosen', async () => {
    const { el, sr } = await mount();
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const swatches = all(sr, '[data-testid="status-color"]');
    expect(swatches).toHaveLength(10);
    for (const s of swatches) {
      expect(s.querySelector('svg')?.getAttribute('data-icon')).toBe('check');
    }
    // Both halves of the tone: the fill comes from the class, the ink with it.
    expect(swatches.map((s) => s.dataset.value)).toContain('amber_strong');
    expect(
      swatches.find((s) => s.dataset.value === 'amber_strong')?.classList.contains('tone-amber-strong'),
    ).toBe(true);

    (
      all(sr, '[data-testid="status-icon"]').find((b) => b.dataset.value === 'truck') as HTMLButtonElement
    ).click();
    await settle(el);

    for (const s of all(sr, '[data-testid="status-color"]')) {
      expect(s.querySelector('svg')?.getAttribute('data-icon')).toBe('truck');
    }
  });

  // The eleventh swatch is the household's own colour. It is the only control
  // on the card that produces a value the ten tokens cannot express, so what
  // matters is that the value reaches the backend as typed.
  it('sends a colour picked outside the ten as the literal it is', async () => {
    const { el, sr, hass } = await mount();

    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    const label = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    label.value = 'Lent out';
    label.dispatchEvent(new Event('input'));
    const picker = q(sr, '[data-testid="status-color-hex"]') as HTMLInputElement;
    picker.value = '#2F6F4F';
    picker.dispatchEvent(new Event('input'));
    await settle(el);

    // Folded to one spelling, so the stored colour can be compared and not
    // only rendered.
    const swatch = q(sr, '[data-testid="status-color-custom"]') as HTMLElement;
    expect(swatch.classList.contains('on')).toBe(true);
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.find((m) => m.type === 'haventory/status/create')).toMatchObject({
      color: '#2f6f4f',
    });
  });

  it('paints the custom swatch in the chosen colour, with the ink derived from it', async () => {
    const { el, sr } = await mount({
      statuses: [{ slug: 'sold', label: 'Sold', order: 0, color: '#ffe082', icon: 'check' }],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'sold');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    const custom = q(sr, '[data-testid="status-color-custom"]') as HTMLElement;
    expect(custom.style.getPropertyValue('--hv-status-bg')).toBe('#ffe082');
    expect(custom.style.getPropertyValue('--hv-status-fg')).toBe('#000000');
    // None of the ten reads as chosen while a literal colour is in force.
    expect(all(sr, '[data-testid="status-color"]').some((b) => b.classList.contains('on'))).toBe(false);
  });

  // The one element on the card that ignores the Home Assistant theme, so the
  // editor says so rather than letting a household find out on a theme switch.
  it('says a literal colour ignores the theme, and only while one is chosen', async () => {
    const { el, sr } = await mount();
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-color-custom-hint"]')).toBe(null);

    const picker = q(sr, '[data-testid="status-color-hex"]') as HTMLInputElement;
    picker.value = '#2f6f4f';
    picker.dispatchEvent(new Event('input'));
    await settle(el);

    expect((q(sr, '[data-testid="status-color-custom-hint"]') as HTMLElement).textContent).toMatch(
      /same in every Home\s+Assistant theme/,
    );

    (
      all(sr, '[data-testid="status-color"]').find((b) => b.dataset.value === 'red') as HTMLButtonElement
    ).click();
    await settle(el);

    expect(q(sr, '[data-testid="status-color-custom-hint"]')).toBe(null);
  });

  // An import can define a status naming a glyph this bundle has never carried.
  // The swatch still has to put ink on its tint, or the tone is half-shown again.
  it('letters a swatch whose glyph this bundle does not carry', async () => {
    const { el, sr } = await mount({
      statuses: [
        { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
        { slug: 'sold', label: 'Sold', order: 1, color: 'red', icon: 'not-a-glyph' },
      ],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'sold');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    for (const s of all(sr, '[data-testid="status-color"]')) {
      expect(s.querySelector('svg')).toBe(null);
      expect(s.querySelector('.letters')?.textContent).toBe('Aa');
    }
  });

  // Two statuses labelled the same are indistinguishable in every row badge,
  // filter chip and select — only the slug tells them apart, and the slug is
  // what this editor hides.
  it('warns when a label collides with one already in use, without blocking it', async () => {
    const { el, sr } = await mount();
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = '  missing ';
    input.dispatchEvent(new Event('input'));
    await settle(el);

    expect(q(sr, '[data-testid="status-duplicate-hint"]')?.textContent).toContain('Missing');
    // A warning, not a refusal: creating anyway stays available.
    expect((q(sr, '[data-testid="status-save"]') as HTMLButtonElement).disabled).toBe(false);
    // The slug dedupe stays as the backstop the backend needs.
    expect(q(sr, '[data-testid="status-slug-preview"]')?.textContent?.trim()).toBe('missing_2');
  });

  it('drops the hint once the label is its own again', async () => {
    const { el, sr } = await mount();
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Missing';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-duplicate-hint"]')).not.toBe(null);

    input.value = 'Lent out';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-duplicate-hint"]')).toBe(null);
  });

  it('does not call a status a duplicate of itself while it is being edited', async () => {
    const { el, sr } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="status-label"]') as HTMLInputElement).value).toBe('Missing');
    expect(q(sr, '[data-testid="status-duplicate-hint"]')).toBe(null);
  });

  // The preview exists for people writing automations, and it was eliding the
  // identifier it exists to show while the row still had free width.
  it('shows the derived slug in full, and titles it', async () => {
    const { el, sr } = await mount();
    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Lent out to the neighbours';
    input.dispatchEvent(new Event('input'));
    await settle(el);

    const preview = q(sr, '[data-testid="status-slug-preview"]');
    expect(preview?.textContent?.trim()).toBe('lent_out_to_the_neighbours');
    expect(preview?.getAttribute('title')).toBe('lent_out_to_the_neighbours');
  });

  // The sentence naming where 40 items are about to go carried .note's tertiary
  // grey, which measures 2.5:1 over the guard's fill. It is the guard's own
  // message, so it takes the guard's ink.
  it('inks the guard message with the guard, not with a note grey', async () => {
    const { el, sr } = await mount({
      items: [makeItem({ id: 'i8', name: 'Ladder', status: 'missing' })],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const message = q(sr, '[data-testid="status-guard-message"]');
    expect(message?.textContent).toContain('1 item');
    expect(message?.classList.contains('note')).toBe(false);
  });

  it('marks the guard so its stacking cannot reach the location guard', async () => {
    const { el, sr } = await mount({
      items: [makeItem({ id: 'i9', name: 'Ladder', status: 'missing' })],
    });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const guard = q(sr, '[data-testid="status-guard"]');
    expect(guard?.classList.contains('status-guard')).toBe(true);
    expect(guard?.querySelector('.guard-target select')).not.toBe(null);
  });

  it('draws a chevron big enough to read at the button it sits in', async () => {
    const { sr } = await mount();
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    for (const dir of ['up', 'down'] as const) {
      const glyph = row?.querySelector(`[data-testid="status-${dir}"] svg`) as SVGElement;
      expect(glyph?.getAttribute('width'), dir).toBe('18');
    }
  });
});

// Every disclosure renders after the row that opened it, inside a `.body` that
// scrolls, so one opened from a row near the bottom lands below the fold and
// the tap reads as having done nothing.
describe('hv-organize-statuses: disclosures come into view', () => {
  const items = [
    makeItem({ id: '1', tags: ['battery'], category: 'Tools' }),
    makeItem({ id: '2', tags: ['aa'], category: 'Consumables', status: 'missing' }),
  ];

  // jsdom performs no layout and implements no `scrollIntoView`, so these pin
  // the call and its options; whether the element ends up visible is a live
  // check.
  type Scrollable = { scrollIntoView?: (options?: unknown) => void };
  let scrolls: { el: Element; options: unknown }[] = [];
  beforeEach(() => {
    scrolls = [];
    (Element.prototype as Scrollable).scrollIntoView = function (this: Element, options?: unknown) {
      scrolls.push({ el: this, options });
    };
  });
  afterEach(() => {
    delete (Element.prototype as Scrollable).scrollIntoView;
    document.body.innerHTML = '';
  });

  const scrolled = () => scrolls.map((s) => s.el);

  // The destructive one: it stands between a tap and every item on a status
  // being reassigned, so rendering it off-screen makes delete look broken and
  // invites the second tap.
  it('brings the status delete guard into view', async () => {
    const { el, sr } = await mount({ items });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="status-guard"]')]);
    // 'nearest' scrolls no further than it must, so a disclosure already on
    // screen does not move; no `behavior`, so there is no motion to gate on a
    // reduced-motion preference.
    expect(scrolls[0]?.options).toEqual({ block: 'nearest' });
    // A guard announces itself through role="alert" and takes no focus.
    expect(q(sr, '[data-testid="status-guard"]')?.contains(sr.activeElement)).toBe(false);
  });

  it('brings the status editor into view and puts the caret in its label field', async () => {
    const { el, sr } = await mount({ items });
    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'ok');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="status-editor"]')]);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="status-label"]'));
  });
});

// The store keeps the built-in three in English because they are data a
// household owns and edits; the card prints the reader's word for one nobody
// has renamed. This tab is where the two meet, and the only place the
// translation could be written back by accident.
describe('hv-organize-statuses: in German', () => {
  const ladder = makeItem({ id: 'i1', name: 'Leiter', status: 'missing' });

  it('chips the three the backend seeded in German', async () => {
    setLanguage('de');
    const { sr } = await mount();

    expect(all(sr, '[data-testid="status-chip"]').map((c) => c.textContent?.trim())).toEqual([
      'OK',
      'Fehlt',
      'Reparatur nötig',
    ]);
  });

  it('names each row on the buttons a screen reader reads', async () => {
    setLanguage('de');
    const { sr } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    expect(row?.querySelector('[data-testid="status-edit"]')?.getAttribute('aria-label')).toBe(
      'Fehlt bearbeiten',
    );
    expect(row?.querySelector('[data-testid="status-remove"]')?.getAttribute('aria-label')).toBe(
      'Fehlt löschen',
    );
  });

  it('edits the stored English and shows what it prints as beside it', async () => {
    setLanguage('de');
    const { el, sr } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="status-label"]') as HTMLInputElement).value).toBe('Missing');
    expect(q(sr, '[data-testid="status-shown"]')?.textContent?.trim()).toBe('Fehlt');
  });

  // Rule two, and the reason the box holds English at all: a household that
  // opened this editor and pressed save would otherwise have renamed all three
  // for every member, in one language, permanently.
  it('saves an untouched label back exactly as stored', async () => {
    setLanguage('de');
    const { el, sr, hass } = await mount();

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="status-save"]') as HTMLButtonElement).click();
    await settle(el);

    expect(hass.__messages.filter((m) => m.type === 'haventory/status/update')).toEqual([
      expect.objectContaining({ slug: 'missing', label: 'Missing' }),
    ]);
  });

  // The stored English is on no screen, so a warning about it would name a word
  // the reader cannot see; the word they can see is the one that would leave
  // two chips reading the same thing.
  it('warns about a collision with the word on the chips, not the one in the store', async () => {
    setLanguage('de');
    const { el, sr } = await mount();

    (q(sr, '[data-testid="organize-new-status"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="status-label"]') as HTMLInputElement;
    input.value = 'Fehlt';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-duplicate-hint"]')?.textContent).toContain('Fehlt');

    input.value = 'Missing';
    input.dispatchEvent(new Event('input'));
    await settle(el);
    expect(q(sr, '[data-testid="status-duplicate-hint"]')).toBe(null);
  });

  it('offers the reassign targets in German', async () => {
    setLanguage('de');
    const { el, sr } = await mount({ items: [ladder] });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    (row?.querySelector('[data-testid="status-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const select = q(sr, '[data-testid="status-reassign"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['OK', 'Reparatur nötig']);
  });

  // A rename is the household saying what it wants these called, and it holds
  // for everyone: the box, the chip and the guard all read it back as typed.
  it('shows a renamed built-in as renamed, and stops offering a translation', async () => {
    setLanguage('de');
    const { el, sr } = await mount({
      statuses: [
        { slug: 'ok', label: 'OK', order: 0, color: 'green', icon: 'check' },
        { slug: 'missing', label: 'Verschollen', order: 1, color: 'amber', icon: 'alert' },
      ],
    });

    const row = all(sr, '[data-testid="status-row"]').find((r) => r.dataset.value === 'missing');
    expect(row?.querySelector('[data-testid="status-chip"]')?.textContent?.trim()).toBe('Verschollen');
    (row?.querySelector('[data-testid="status-edit"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="status-label"]') as HTMLInputElement).value).toBe('Verschollen');
    expect(q(sr, '[data-testid="status-shown"]')).toBe(null);
  });
});
