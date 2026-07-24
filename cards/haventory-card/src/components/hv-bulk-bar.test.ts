import './hv-bulk-bar';
import { makeItem } from '../test.utils';
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
  const el = document.createElement('hv-bulk-bar') as HVBulkBar;
  el.selectedCount = 42;
  el.locationTree = tree;
  el.distinct = {
    categories: [{ value: 'Hardware', count: 3 }],
    tags: [{ value: 'metric', count: 2 }],
    custom_field_keys: [],
  };
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const q = (el: HVBulkBar, sel: string) => el.shadowRoot?.querySelector(sel) as HTMLElement | null;
const all = (el: HVBulkBar, sel: string) => [...(el.shadowRoot?.querySelectorAll(sel) ?? [])] as HTMLElement[];

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

  it('runs the immediate actions straight away', async () => {
    const el = await mount();
    const seen = runs(el);
    (q(el, '[data-action="check-in"]') as HTMLButtonElement).click();
    (q(el, '[data-action="check-out"]') as HTMLButtonElement).click();
    (q(el, '[data-action="delete"]') as HTMLButtonElement).click();

    expect(seen).toEqual([
      { action: 'check-in' },
      { action: 'check-out', dueDate: null },
      { action: 'delete' },
    ]);
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
      treeEl.shadowRoot?.querySelector('[data-testid="tree-select"][data-id="workshop"]') as HTMLButtonElement
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
        failed: [failure('a', 'conflict'), failure('b', 'rate_limited')],
      },
    });

    expect(q(el, '[data-testid="bulk-result-title"]')?.textContent).toContain('finished with errors');
    expect(q(el, '[data-testid="bulk-result-summary"]')?.textContent).toContain('39 of 41 succeeded');

    const failures = all(el, '[data-testid="bulk-failure"]').map((f) => f.textContent?.replace(/\s+/g, ' ').trim());
    expect(failures[0]).toContain('Multimeter');
    expect(failures[0]).toContain('Conflict');
    expect(failures[1]).toContain('Hex Key Set');
    expect(failures[1]).toContain('Rate limited');
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
    expect(describeFailure(failure('a', 'rate_limited'))).toContain('try again in a few seconds');
    expect(describeFailure(failure('a', 'storage_error'))).toContain('failed to write to storage');
    expect(describeFailure(failure('a', 'validation_error', 'quantity must be >= 0'))).toContain(
      'quantity must be >= 0',
    );
  });

  it('passes an unknown code through with its message', () => {
    expect(describeFailure(failure('a', 'something_new', 'odd'))).toBe('odd');
  });
});
