import { describe, it, expect } from 'vitest';
import { Store } from './store';
import { makeMockHass, makeItem } from '../test.utils';

describe('Store import/export', () => {
  it('exports a versioned document of the current inventory', async () => {
    const items = [makeItem({ id: '1', name: 'Hammer' }), makeItem({ id: '2', name: 'Nails' })];
    const store = new Store(makeMockHass({ items }));
    await store.init();

    const doc = await store.exportDocument();
    expect(doc.haventory_export_version).toBe(1);
    expect(doc.items.length).toBe(2);
  });

  it('previews an import without mutating the current list', async () => {
    const existing = [makeItem({ id: '1', name: 'Existing' })];
    const store = new Store(makeMockHass({ items: existing }));
    await store.init();

    const incoming = {
      haventory_export_version: 1,
      schema_version: 4,
      items: [makeItem({ id: 'x', name: 'Fresh' })],
      locations: [],
    };
    const preview = await store.previewImport(incoming, 'merge');
    expect(preview.valid).toBe(true);
    expect(preview.counts.items?.add).toBe(1);
    // The live list is untouched by a preview.
    expect(store.state.value.items.map((i) => i.id)).toEqual(['1']);
  });

  it('executes an import and reloads the list to reflect the new dataset', async () => {
    const store = new Store(makeMockHass({ items: [makeItem({ id: '1', name: 'Old' })] }));
    await store.init();

    const incoming = {
      haventory_export_version: 1,
      schema_version: 4,
      items: [makeItem({ id: 'a', name: 'Imported A' }), makeItem({ id: 'b', name: 'Imported B' })],
      locations: [],
    };
    const summary = await store.executeImport(incoming, 'replace');
    expect(summary.applied).toBe(true);
    expect(summary.totals.items_total).toBe(2);
    // reloadAll ran: the list now reflects the imported items.
    const names = store.state.value.items.map((i) => i.name).sort();
    expect(names).toEqual(['Imported A', 'Imported B']);
  });
});
