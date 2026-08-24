import { setLanguage } from '../i18n';
import './hv-bulk-bar';
import { all, componentCss, makeItem, mountComponent, q } from '../test.utils';
import { describeFailure } from './hv-bulk-bar';
import type { BulkRunDetail, HVBulkBar } from './hv-bulk-bar';
import type { BulkFailure, LocationTreeNode } from '../store/types';

const tree: LocationTreeNode[] = [
  {
    id: 'workshop',
    name: 'Workshop',
    parent_id: null,
    area_id: null,
    path: { id_path: ['workshop'], name_path: ['Workshop'], display_path: 'Workshop', sort_key: 'workshop' },
    direct_item_count: 0,
    subtree_item_count: 0,
    children: [],
  },
];

function failure(itemId: string, code: string, message = 'boom'): BulkFailure {
  return {
    op: { op_id: `op:${itemId}`, kind: 'item_move', payload: { item_id: itemId } },
    error: { code, message },
    itemId,
  };
}

async function mount(props: Partial<HVBulkBar> = {}) {
  const { el } = await mountComponent<HVBulkBar>('hv-bulk-bar', {
    selectedCount: 42,
    locationTree: tree,
    distinct: {
      categories: [{ value: 'Hardware', count: 3 }],
      tags: [{ value: 'metric', count: 2 }],
      custom_field_keys: [],
    },
    ...props,
  });
  return el;
}

function runs(el: HVBulkBar) {
  const seen: BulkRunDetail[] = [];
  el.addEventListener('run', (e) => seen.push((e as CustomEvent).detail));
  return seen;
}

describe('hv-bulk-bar: actions', () => {
  it('renders nothing without a selection', async () => {
    const el = await mount({ selectedCount: 0 });
    expect(q(el, '[data-testid="bulk-bar"]')).toBe(null);
  });

  it('offers every bulk operation the backend supports', async () => {
    const el = await mount();
    expect(all(el, '[data-testid="bulk-action"]').map((b) => b.dataset.action)).toEqual([
      'move',
      'add-tags',
      'remove-tags',
      'set-category',
      'adjust-qty',
      'check-out',
      'check-in',
      'delete',
    ]);
    expect(q(el, '[data-testid="bulk-lead"]')?.textContent).toContain('Apply to 42 items');
  });

  // Every label here was a hardcoded "items", so selecting a single row read
  // "Apply to 1 items" / "Move 1 items to".
  it('agrees with a selection of one', async () => {
    const el = await mount({ selectedCount: 1 });
    expect(q(el, '[data-testid="bulk-lead"]')?.textContent).toContain('Apply to 1 item');

    (q(el, '[data-action="move"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="bulk-picker"]')?.textContent).toContain('Move 1 item to');
  });

  it('leaves for the host without an inline step', async () => {
    const el = await mount();
    const seen = runs(el);
    (q(el, '[data-action="check-in"]') as HTMLButtonElement).click();
    (q(el, '[data-action="check-out"]') as HTMLButtonElement).click();
    (q(el, '[data-action="delete"]') as HTMLButtonElement).click();

    // Check-out carries no due date: the host asks for one, and tells that
    // apart from a deliberate "no due date" by the key being absent.
    expect(seen).toEqual([{ action: 'check-in' }, { action: 'check-out' }, { action: 'delete' }]);
  });

  it('names check-out as the step it is', async () => {
    const el = await mount();
    const labels = all(el, '[data-testid="bulk-action"]').map((b) => b.textContent?.trim());
    expect(labels).toContain('Check out…');
    expect(labels).toContain('Check in');
  });
});

describe('hv-bulk-bar: inline pickers', () => {
  it('picks a move target from a tree, not a nested dialog', async () => {
    const el = await mount();
    const seen = runs(el);
    expect(q(el, '[data-testid="bulk-picker"]')).toBe(null);

    (q(el, '[data-action="move"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect((q(el, '[data-testid="bulk-picker"]') as HTMLElement).dataset.picker).toBe('move');

    const treeEl = el.shadowRoot?.querySelector('hv-location-tree') as HTMLElement;
    (
      treeEl.shadowRoot?.querySelector('[data-testid="tree-row"][data-id="workshop"]') as HTMLButtonElement
    ).click();
    expect(seen).toEqual([{ action: 'move', locationId: 'workshop' }]);
  });

  it('collects tags before running, and will not run with none', async () => {
    const el = await mount();
    const seen = runs(el);
    (q(el, '[data-action="add-tags"]') as HTMLButtonElement).click();
    await el.updateComplete;

    expect((q(el, '[data-testid="bulk-picker-apply"]') as HTMLButtonElement).disabled).toBe(true);

    const chips = el.shadowRoot?.querySelector('hv-chip-input') as HTMLElement;
    const input = chips.shadowRoot?.querySelector('[data-testid="chip-input"]') as HTMLInputElement;
    input.value = 'Metric';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    (q(el, '[data-testid="bulk-picker-apply"]') as HTMLButtonElement).click();
    expect(seen).toEqual([{ action: 'add-tags', tags: ['metric'] }]);
  });

  it('treats a blank category as clearing it', async () => {
    const el = await mount();
    const seen = runs(el);
    (q(el, '[data-action="set-category"]') as HTMLButtonElement).click();
    await el.updateComplete;

    (q(el, '[data-testid="bulk-picker-apply"]') as HTMLButtonElement).click();
    expect(seen).toEqual([{ action: 'set-category', category: null }]);
  });

  it('requires a non-zero delta before adjusting quantity', async () => {
    const el = await mount();
    const seen = runs(el);
    (q(el, '[data-action="adjust-qty"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect((q(el, '[data-testid="bulk-picker-apply"]') as HTMLButtonElement).disabled).toBe(true);

    const input = q(el, '[data-testid="bulk-delta"]') as HTMLInputElement;
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    expect((q(el, '[data-testid="bulk-picker-apply"]') as HTMLButtonElement).disabled).toBe(true);

    input.value = '-2';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    (q(el, '[data-testid="bulk-picker-apply"]') as HTMLButtonElement).click();
    expect(seen).toEqual([{ action: 'adjust-qty', delta: -2 }]);
  });

  it('closes a picker when its own button is clicked again', async () => {
    const el = await mount();
    (q(el, '[data-action="move"]') as HTMLButtonElement).click();
    await el.updateComplete;
    (q(el, '[data-action="move"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(q(el, '[data-testid="bulk-picker"]')).toBe(null);
  });
});

describe('hv-bulk-bar: progress', () => {
  it('shows determinate progress and a cancel', async () => {
    const el = await mount({ progress: { done: 24, total: 38, failed: 1, label: 'Rewriting' } });
    expect(q(el, '[data-testid="bulk-progress-label"]')?.textContent).toContain('Rewriting 24 of 38');
    expect(q(el, '[data-testid="bulk-progress-failed"]')?.textContent).toContain('1 failed');
    expect((q(el, '.fill') as HTMLElement).style.width).toBe('63%');
    // The bar itself is replaced while running.
    expect(q(el, '[data-testid="bulk-bar"]')).toBe(null);
  });

  it('emits cancel-run', async () => {
    const el = await mount({ progress: { done: 1, total: 10, failed: 0, label: 'Moving' } });
    let cancels = 0;
    el.addEventListener('cancel-run', () => {
      cancels += 1;
    });
    (q(el, '[data-testid="bulk-cancel"]') as HTMLButtonElement).click();
    expect(cancels).toBe(1);
  });
});

describe('hv-bulk-bar: per-operation result', () => {
  it('reports a clean run without a failure list', async () => {
    const el = await mount({ result: { label: 'Move', succeeded: 42, failed: [] } });
    expect(q(el, '[data-testid="bulk-result-title"]')?.textContent).toContain('Move finished');
    expect(q(el, '[data-testid="bulk-result-summary"]')?.textContent).toContain('42 of 42 succeeded');
    expect(q(el, '[data-testid="bulk-failure"]')).toBe(null);
    expect(q(el, '[data-testid="bulk-retry"]')).toBe(null);
  });

  it('names every failed row and why it failed', async () => {
    const el = await mount({
      selectedItems: [makeItem({ id: 'a', name: 'Multimeter' }), makeItem({ id: 'b', name: 'Hex Key Set' })],
      result: {
        label: 'Move',
        succeeded: 39,
        failed: [failure('a', 'conflict'), failure('b', 'storage_error')],
      },
    });

    expect(q(el, '[data-testid="bulk-result-title"]')?.textContent).toContain('finished with errors');
    expect(q(el, '[data-testid="bulk-result-summary"]')?.textContent).toContain('39 of 41 succeeded');

    const failures = all(el, '[data-testid="bulk-failure"]').map((f) => f.textContent?.replace(/\s+/g, ' ').trim());
    expect(failures[0]).toContain('Multimeter');
    expect(failures[0]).toContain('Conflict');
    expect(failures[1]).toContain('Hex Key Set');
    expect(failures[1]).toContain('failed to write to storage');
  });

  it('agrees with a single failure, irregular verb and all', async () => {
    // The only irregular-verb call site in the card (`was`/`were`), and the
    // only place `counted` is asked for "1 failed row". Both are rendered with
    // plural counts everywhere else, so nothing else would catch a regression.
    const el = await mount({
      selectedItems: [makeItem({ id: 'a', name: 'Multimeter' })],
      result: { label: 'Move', succeeded: 4, failed: [failure('a', 'conflict')] },
    });

    const summary = q(el, '[data-testid="bulk-result-summary"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(summary).toContain('1 failed and was left unchanged');
    expect(summary).not.toContain('were left unchanged');

    const foot = el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(foot).toContain('1 failed row');
    expect(foot).not.toContain('1 failed rows');
  });

  it('offers a retry scoped to the failures', async () => {
    const el = await mount({ result: { label: 'Move', succeeded: 1, failed: [failure('a', 'conflict')] } });
    let retries = 0;
    el.addEventListener('retry-failed', () => {
      retries += 1;
    });
    expect(q(el, '[data-testid="bulk-retry"]')?.textContent).toContain('Retry 1 failed');
    (q(el, '[data-testid="bulk-retry"]') as HTMLButtonElement).click();
    expect(retries).toBe(1);
  });

  it('dismisses back to the action bar', async () => {
    const el = await mount({ result: { label: 'Move', succeeded: 1, failed: [] } });
    let dismissed = 0;
    el.addEventListener('dismiss-result', () => {
      dismissed += 1;
    });
    (q(el, '[data-testid="bulk-result-dismiss"]') as HTMLButtonElement).click();
    expect(dismissed).toBe(1);
  });

  it('falls back to the item id when the row is no longer loaded', async () => {
    const el = await mount({ result: { label: 'Move', succeeded: 0, failed: [failure('ghost', 'not_found')] } });
    expect(q(el, '[data-testid="bulk-failure"]')?.textContent).toContain('ghost');
  });
});

describe('describeFailure', () => {
  it('translates each backend error class into something actionable', () => {
    expect(describeFailure(failure('a', 'conflict'))).toContain('changed by another client');
    expect(describeFailure(failure('a', 'not_found'))).toContain('deleted before this ran');
    expect(describeFailure(failure('a', 'storage_error'))).toContain('failed to write to storage');
    expect(describeFailure(failure('a', 'validation_error', 'quantity must be >= 0'))).toContain(
      'quantity must be >= 0',
    );
  });

  it('says the same things in the language in force', () => {
    // The extraction's own regression net: a literal left behind in the switch
    // would still read English here while everything around it moved.
    setLanguage('de');
    expect(describeFailure(failure('a', 'conflict'))).toContain('Konflikt');
    expect(describeFailure(failure('a', 'not_found'))).toContain('Nicht gefunden');
    expect(describeFailure(failure('a', 'storage_error'))).toContain('Nicht gespeichert');
    // The backend's own sentence rides through untranslated inside the card's
    // frame, which is what #190's notes settle for `validation_error`.
    expect(describeFailure(failure('a', 'validation_error', 'quantity must be >= 0'))).toBe(
      'Abgelehnt – quantity must be >= 0',
    );
  });

  it('passes an unknown code through with its message', () => {
    expect(describeFailure(failure('a', 'something_new', 'odd'))).toBe('odd');
  });
});

// The bar was the one surface that ignored the tokens: a hardcoded blue-grey
// band and a hardcoded red for Delete, neither of which moved with the HA
// theme — and a running batch's Cancel that was a bare native button on top of
// it, unstyled where every sibling control was a pill.
describe('hv-bulk-bar: the band belongs to the theme', () => {

  it('draws the running batch a real button', async () => {
    const el = await mount({ progress: { done: 1, total: 4, failed: 0, label: 'Moving' } });
    expect(q(el, '[data-testid="bulk-cancel"]')?.className).toContain('band-button');
    // And it no longer positions itself with an inline style per failure state.
    expect(q(el, '[data-testid="bulk-cancel"]')?.getAttribute('style')).toBe(null);
  });

  it('keeps the failure count and Cancel together at the trailing edge', async () => {
    const el = await mount({ progress: { done: 3, total: 4, failed: 1, label: 'Moving' } });
    expect(q(el, '[data-testid="bulk-progress-failed"]')?.className).toBe('failed');
    expect(componentCss('hv-bulk-bar')).toMatch(/\.progress \.spacer \{ margin-left: auto; \}/);
  });
});

describe('hv-bulk-bar: close verbs', () => {
  // A result panel is read and dismissed; "Close" is what every other surface
  // that only dismisses says.
  it('closes the result rather than dismissing it', async () => {
    const el = await mount({ result: { label: 'Move', succeeded: 2, failed: [] } });
    expect(q(el, '[data-testid="bulk-result-dismiss"]')?.textContent?.trim()).toBe('Close');
  });
});
