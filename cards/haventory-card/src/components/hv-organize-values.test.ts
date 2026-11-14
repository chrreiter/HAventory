/**
 * The Categories and Tags tab of the organize dialog, mounted on its own: the
 * value list, the draft values, rename, merge and remove as batch rewrites, and
 * the touch sheet. How the dialog hosts the tab is `hv-organize-dialog.test.ts`.
 */
import { setLanguage } from '../i18n';
import './hv-organize-values';
import { all, defined, makeItem, mountHost, q, settle } from '../test.utils';
import type { HVOrganizeValues } from './hv-organize-values';
import type { Item } from '../store/types';

async function mount(opts: { items?: Item[]; kind?: 'category' | 'tag'; mobile?: boolean } = {}) {
  return mountHost<HVOrganizeValues>(
    'hv-organize-values',
    { items: opts.items ?? [], locations: [], areas: [] },
    { kind: opts.kind ?? 'category', mobile: opts.mobile ?? false },
    { renders: 2 },
  );
}

describe('hv-organize-values: tags and categories', () => {
  const items = [
    makeItem({ id: '1', tags: ['battery', 'aa'], category: 'Consumables' }),
    makeItem({ id: '2', tags: ['batery'], category: 'Tools' }),
    makeItem({ id: '3', tags: ['batery'], category: 'Tools' }),
  ];

  // Two tabs of the same shape, so the chip has to say which facet is on
  // screen — the tab strip is at the top of the dialog, the rows are not.
  it('chips a tag as a tag and a category as a category', async () => {
    const tags = await mount({ items, kind: 'tag' });
    const tagChip = q(tags.sr, '[data-testid="value-row"] .hv-chip')!;
    expect(tagChip.classList.contains('tag')).toBe(true);
    expect(tagChip.textContent?.trim()).toBe('#aa');

    const categories = await mount({ items, kind: 'category' });
    const categoryChip = q(categories.sr, '[data-testid="value-row"] .hv-chip')!;
    expect(categoryChip.classList.contains('tag')).toBe(false);
    expect(categoryChip.textContent?.trim()).toBe('Consumables');
  });

  async function create(el: HVOrganizeValues, sr: ShadowRoot, name: string) {
    (q(sr, '[data-testid="organize-new-value"]') as HTMLButtonElement).click();
    await settle(el);
    const input = q(sr, '[data-testid="new-value-name"]') as HTMLInputElement;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    await settle(el);
    (q(sr, '[data-testid="new-value-create"]') as HTMLButtonElement).click();
    await settle(el);
  }

  it('names a new category, which then shows up as a suggestion', async () => {
    const { el, store, sr } = await mount({ items, kind: 'category' });
    await create(el, sr, 'Spare parts');

    const rows = all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value);
    expect(rows).toEqual(['Consumables', 'Spare parts', 'Tools']);
    // Nothing to create server-side, so it has to be honest about that.
    expect(q(sr, '[data-testid="value-draft"]')?.textContent).toContain('not saved');
    expect(store.state.value.distinctValuesCache?.categories).toContainEqual({
      value: 'Spare parts',
      count: 0,
    });
  });

  it('names a new tag the way the backend would store it', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    await create(el, sr, 'Power Tools');
    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).toContain('power tools');
  });

  it('refuses a name that is already in use', async () => {
    const { el, sr } = await mount({ items, kind: 'category' });
    await create(el, sr, 'tools');

    expect(q(sr, '[data-testid="new-value-error"]')?.textContent).toContain('already');
    expect(all(sr, '[data-testid="value-row"]')).toHaveLength(2);
  });

  it('discards a named value that never made it onto an item', async () => {
    const { el, store, sr } = await mount({ items, kind: 'tag' });
    await create(el, sr, 'seasonal');

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'seasonal')!;
    (row.querySelector('[data-testid="value-discard"]') as HTMLButtonElement).click();
    await settle(el);

    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).not.toContain('seasonal');
    expect(store.state.value.distinctValuesCache?.tags.map((t) => t.value)).not.toContain('seasonal');
  });

  it('offers no rename or merge on a value no item carries yet', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    await create(el, sr, 'seasonal');
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'seasonal')!;

    // Both rewrite every matching item, and there are none — they would look
    // like they worked and do nothing.
    expect(row.querySelector('[data-testid="value-rename"]')).toBe(null);
    expect(row.querySelector('[data-testid="value-merge"]')).toBe(null);
  });

  it('filters the value list', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    const filter = q(sr, '[data-testid="organize-filter"]') as HTMLInputElement;
    filter.value = 'bat';
    filter.dispatchEvent(new Event('input'));
    await settle(el);

    expect(all(sr, '[data-testid="value-row"]').map((r) => r.dataset.value)).toEqual(['batery', 'battery']);
  });

  /** Open one row's merge editor, which is where the target is picked. */
  async function openMerge(el: HVOrganizeValues, sr: ShadowRoot, value: string) {
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === value)!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);
  }

  const targets = (sr: ShadowRoot) =>
    all(sr, '[data-testid="value-target-option"]').map((o) => o.dataset.value);

  it('pre-fills the merge target with the closest existing value', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    await openMerge(el, sr, 'batery');

    expect(q(sr, '[data-testid="value-target"]')?.textContent?.trim()).toBe('#battery');
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain(
      'Retags 2 items, then removes "batery"',
    );
  });

  // A browser draws a `<datalist>` as chrome of its own, and the Home Assistant
  // companion app's Android WebView draws none at all: a list the browser owns
  // never opens there, so the targets have to be the card's own elements.
  it('draws the merge targets itself rather than as browser suggestions', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });

    for (const mode of ['rename', 'merge'] as const) {
      const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
      (row.querySelector(`[data-testid="value-${mode}"]`) as HTMLButtonElement).click();
      await settle(el);
      const editor = q(sr, '[data-testid="value-editor"]') as HTMLElement;
      expect(editor.dataset.mode, mode).toBe(mode);
      expect(editor.querySelector('datalist'), mode).toBe(null);
      expect(editor.querySelector('[list]'), mode).toBe(null);
    }
  });

  it('offers every other value of the tab, and never the one being merged', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    await openMerge(el, sr, 'batery');

    const trigger = q(sr, '[data-testid="value-target"]') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(targets(sr)).toEqual([]);

    trigger.click();
    await settle(el);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(targets(sr)).toEqual(['aa', 'battery']);
    // Two rows fit in the box without scrolling, so there is nothing to narrow.
    expect(q(sr, '[data-testid="value-target-filter"]')).toBe(null);
  });

  it('merges into the value picked from the list', async () => {
    const { el, store, sr } = await mount({ items, kind: 'tag' });
    // "aa" is nothing like the other two, so nothing is pre-filled and the
    // pick is the whole of what makes the merge possible.
    await openMerge(el, sr, 'aa');
    expect((q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).disabled).toBe(true);

    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);
    const option = all(sr, '[data-testid="value-target-option"]').find((o) => o.dataset.value === 'battery')!;
    option.click();
    await settle(el);

    // The pick is what the trigger says, and it shuts the list behind it.
    expect(q(sr, '[data-testid="value-target"]')?.textContent?.trim()).toBe('#battery');
    expect(q(sr, '[data-testid="value-target"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain('removes "aa"');

    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    for (let i = 0; i < 3; i += 1) await settle(el);

    const tags = store.state.value.items.flatMap((i) => i.tags);
    expect(tags).not.toContain('aa');
    expect(tags.filter((t) => t === 'battery')).toHaveLength(1);
  });

  it('narrows a long list of targets, and says when nothing is left', async () => {
    const many = [
      makeItem({ id: 'm1', tags: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] }),
      makeItem({ id: 'm2', tags: ['zeta', 'eta', 'theta', 'iota', 'kappa'] }),
    ];
    const { el, sr } = await mount({ items: many, kind: 'tag' });
    await openMerge(el, sr, 'alpha');
    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);

    expect(targets(sr)).toHaveLength(9);
    const filter = q(sr, '[data-testid="value-target-filter"]') as HTMLInputElement;
    filter.value = 'the';
    filter.dispatchEvent(new Event('input'));
    await settle(el);
    expect(targets(sr)).toEqual(['theta']);

    filter.value = 'nothing like it';
    filter.dispatchEvent(new Event('input'));
    await settle(el);
    expect(targets(sr)).toEqual([]);
    expect(q(sr, '[data-testid="value-target-none"]')?.textContent).toContain('No tags match');

    // The filter belongs to the list, not to the row: shutting it discards it.
    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="value-target"]') as HTMLButtonElement).click();
    await settle(el);
    expect((q(sr, '[data-testid="value-target-filter"]') as HTMLInputElement).value).toBe('');
    expect(targets(sr)).toHaveLength(9);
  });

  it('says so when the value is the only one there is', async () => {
    const { el, sr } = await mount({ items: [makeItem({ id: '1', tags: ['battery'] })], kind: 'tag' });
    await openMerge(el, sr, 'battery');

    expect((q(sr, '[data-testid="value-target"]') as HTMLButtonElement).disabled).toBe(true);
    expect(q(sr, '[data-testid="value-effect"]')?.textContent).toContain(
      'There are no other tags to merge into',
    );
    expect((q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('merges a tag across every affected item', async () => {
    const { el, store, sr } = await mount({ items, kind: 'tag' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    const tags = store.state.value.items.flatMap((i) => i.tags);
    expect(tags).not.toContain('batery');
    expect(tags.filter((t) => t === 'battery')).toHaveLength(3);
    // Said once, in the past tense: the count of both halves and the caveat
    // about partial application only matter when something actually failed.
    expect(q(sr, '[data-testid="rewrite-label"]')?.textContent?.trim()).toBe('Merged 2 items');
    expect(q(sr, '[data-testid="rewrite-status"]')?.textContent).not.toContain('one batch call');
  });

  it('will not apply a rename to the same value', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames a category across its items', async () => {
    const { el, store, sr } = await mount({ items, kind: 'category' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'Tools')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    const target = q(sr, '[data-testid="value-target"]') as HTMLInputElement;
    target.value = 'Instruments';
    target.dispatchEvent(new Event('input'));
    await settle(el);
    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(store.state.value.items.filter((i) => i.category === 'Instruments')).toHaveLength(2);
  });

  it('reports the rows a rewrite could not touch', async () => {
    const { el, store, sr } = await mount({ items, kind: 'tag' });
    const realBulk = store['ws'].bulk.bind(store['ws']);
    store['ws'].bulk = async (ops) => {
      const res = await realBulk(ops);
      const first = defined(ops[0], 'first op');
      res.results[first.op_id] = {
        success: false,
        error: { code: 'conflict', message: 'version conflict', context: {} },
      };
      return res;
    };

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="value-apply"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(q(sr, '[data-testid="rewrite-failed"]')?.textContent).toContain('1 failed');
    expect(q(sr, '[data-testid="rewrite-failure"]')?.textContent).toContain('changed by another client');
  });

  it('confirms before removing a value from every item', async () => {
    const { el, store, sr } = await mount({ items, kind: 'tag' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement).click();
    await settle(el);

    const confirm = q(sr, '[data-testid="organize-confirm"]') as HTMLElement & { open: boolean };
    expect(confirm.open).toBe(true);
    expect(confirm.shadowRoot?.textContent).toContain('Remove "batery" from 2 items?');

    (confirm.shadowRoot?.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    await settle(el);
    await settle(el);
    await settle(el);

    expect(store.state.value.items.flatMap((i) => i.tags)).not.toContain('batery');
  });

  // The confirmation is a dialog inside the Organize dialog's tab and reports
  // its own dismissal as `cancel` — the same event that tells the host to take
  // Organize down. An event leaving this element would pass the dialog on its
  // way there, so backing out of one tag's delete must not leave it.
  it('keeps Organize open when the remove confirmation is cancelled', async () => {
    for (const how of ['click', 'escape'] as const) {
      const { el, sr } = await mount({ items, kind: 'tag' });
      let dismissed = 0;
      el.addEventListener('cancel', () => {
        dismissed += 1;
      });

      const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
      const remove = row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement;
      remove.focus();
      remove.click();
      await settle(el);

      const confirm = q(sr, '[data-testid="organize-confirm"]') as HTMLElement & { open: boolean };
      expect(confirm.open, how).toBe(true);
      if (how === 'click') {
        (confirm.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
      } else {
        (confirm.shadowRoot?.querySelector('[data-testid="confirm-dialog"]') as HTMLElement).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      }
      await settle(el);

      expect(dismissed, how).toBe(0);
      expect(confirm.open, how).toBe(false);
      expect(q(sr, '[data-testid="value-row"]'), how).toBeTruthy();
      // Back where the question was asked from, so the next key press acts on
      // the row rather than on whatever the browser fell back to.
      expect(sr.activeElement, how).toBe(remove);
      el.remove();
    }
  });

  // What a real browser does with that return: the ✕ sits in row actions that
  // are `visibility: hidden` again once the pointer is on the confirmation,
  // and focusing an undrawn element is a silent no-op — jsdom lays nothing out
  // and accepts it, so the refusal is modelled by stubbing the button's
  // `focus`. The rescue lands on the row, whose `:focus-within` re-reveals the
  // actions, and Tab continues from the user's place in the list (#678).
  it('lands focus on the row when the browser refuses the hidden ✕', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    const remove = row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement;
    remove.focus();
    remove.click();
    await settle(el);

    remove.focus = () => undefined;
    const confirm = q(sr, '[data-testid="organize-confirm"]') as HTMLElement;
    (confirm.shadowRoot?.querySelector('[data-testid="confirm-cancel"]') as HTMLButtonElement).click();
    await settle(el);

    expect(sr.activeElement).toBe(row);
  });

  it('keeps an accepted removal from reading as the dialog answering', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    let answered = 0;
    el.addEventListener('confirm', () => {
      answered += 1;
    });

    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-remove"]') as HTMLButtonElement).click();
    await settle(el);
    (q(sr, '[data-testid="organize-confirm"]') as HTMLElement).shadowRoot
      ?.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')
      ?.click();
    await settle(el);

    expect(answered).toBe(0);
  });

  it('says so when there is nothing to organize', async () => {
    const { sr } = await mount({ items: [], kind: 'tag' });
    expect(q(sr, '[data-testid="organize-empty"]')?.textContent).toContain('No tags in use yet');
  });
});

describe('hv-organize-values: mobile value actions', () => {
  const items = [makeItem({ id: '1', tags: ['batery'] }), makeItem({ id: '2', tags: ['battery'] })];

  it('replaces hover actions with a tap-to-open action sheet', async () => {
    const { el, sr } = await mount({ items, kind: 'tag', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    expect(row.querySelector('[data-testid="value-rename"]')).toBe(null);

    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    const sheet = q(sr, '[data-testid="value-sheet"]') as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(sheet.querySelector('[data-testid="sheet-show"]')?.textContent).toContain('Show 1 item');
    // The merge row suggests the likely typo fix up front.
    expect(sheet.querySelector('[data-testid="sheet-merge-suggestion"]')?.textContent).toContain('battery');
  });

  it('opens the merge editor from the sheet', async () => {
    const { el, sr } = await mount({ items, kind: 'tag', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'batery')!;
    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    (q(sr, '[data-testid="sheet-merge"]') as HTMLButtonElement).click();
    await settle(el);

    expect((q(sr, '[data-testid="value-editor"]') as HTMLElement).dataset.mode).toBe('merge');
    expect(q(sr, '[data-testid="value-sheet"]')).toBe(null);
  });
});

// Every disclosure renders after the row that opened it, inside a `.body` that
// scrolls, so one opened from a row near the bottom lands below the fold and
// the tap reads as having done nothing.
describe('hv-organize-values: disclosures come into view', () => {
  const items = [
    makeItem({ id: '1', location_id: 'shelf-a', tags: ['battery'], category: 'Tools' }),
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

  it('brings the value editor into view and puts the caret in its target field', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="value-editor"]')]);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="value-target"]'));
  });

  // The mode is half a value editor's identity: switching a row from rename to
  // merge swaps the form under one element, and it is a different question.
  it('reveals the value editor again when the same row switches mode', async () => {
    const { el, sr } = await mount({ items, kind: 'tag' });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-rename"]') as HTMLButtonElement).click();
    await settle(el);
    (row.querySelector('[data-testid="value-merge"]') as HTMLButtonElement).click();
    await settle(el);

    const editor = q(sr, '[data-testid="value-editor"]') as HTMLElement;
    expect(editor.dataset.mode).toBe('merge');
    expect(scrolls).toHaveLength(2);
    expect(scrolls[1]?.el).toBe(editor);
    expect(sr.activeElement).toBe(q(sr, '[data-testid="value-target"]'));
  });

  it('brings the value ⋮ sheet into view', async () => {
    const { el, sr } = await mount({ items, kind: 'tag', mobile: true });
    const row = all(sr, '[data-testid="value-row"]').find((r) => r.dataset.value === 'battery')!;
    (row.querySelector('[data-testid="value-more"]') as HTMLButtonElement).click();
    await settle(el);

    expect(scrolled()).toEqual([q(sr, '[data-testid="value-sheet"]')]);
    expect(q(sr, '[data-testid="value-sheet"]')?.contains(sr.activeElement)).toBe(false);
  });
});

describe('hv-organize-values: the language in force', () => {
  it('names the button that creates a value in German too', async () => {
    setLanguage('de');
    const { el, sr } = await mount({ kind: 'tag' });
    (q(sr, '[data-testid="organize-new-value"]') as HTMLButtonElement).click();
    await settle(el);
    expect(q(sr, '[data-testid="new-value-create"]')?.textContent?.trim()).toBe('Erstellen');
  });

  it('composes the {noun} strings without an article, so both genders read right', async () => {
    // "Kategorie" is feminine and "Label" neuter; a German value carrying
    // "Ein …" or "Neues …" in front of the placeholder is wrong for one of
    // the two. The categories tab is the one that broke, so it is the pin.
    setLanguage('de');
    const { el, sr } = await mount({ kind: 'category' });
    (q(sr, '[data-testid="organize-new-value"]') as HTMLButtonElement).click();
    await settle(el);

    const input = q(sr, '[data-testid="new-value-name"]') as HTMLInputElement;
    expect(input.placeholder).toBe('Kategorie hinzufügen …');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(el);
    expect(q(sr, '[data-testid="new-value-error"]')?.textContent?.trim()).toBe(
      'Kategorie braucht einen Namen.',
    );
  });
});
