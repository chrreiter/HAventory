import { describe, it, expect } from 'vitest';
import { makeItem, mountStore } from '../test.utils';

/** An export document as an import receives it. */
function incomingDocument(items: ReturnType<typeof makeItem>[]) {
  return { haventory_export_version: 1, schema_version: 4, items, locations: [] };
}

describe('Store import/export', () => {
  it('exports a versioned document of the current inventory', async () => {
    const items = [makeItem({ id: '1', name: 'Hammer' }), makeItem({ id: '2', name: 'Nails' })];
    const { store } = await mountStore({ items });

    const doc = await store.exportDocument();
    expect(doc.haventory_export_version).toBe(1);
    expect(doc.items.length).toBe(2);
  });

  it('previews an import without mutating the current list', async () => {
    const existing = [makeItem({ id: '1', name: 'Existing' })];
    const { store } = await mountStore({ items: existing });

    const incoming = incomingDocument([makeItem({ id: 'x', name: 'Fresh' })]);
    const preview = await store.previewImport(incoming, 'merge');
    expect(preview.valid).toBe(true);
    expect(preview.counts.items?.add).toBe(1);
    // The live list is untouched by a preview.
    expect(store.state.value.items.map((i) => i.id)).toEqual(['1']);
  });

  it('executes an import and reloads the list to reflect the new dataset', async () => {
    const { store } = await mountStore({ items: [makeItem({ id: '1', name: 'Old' })] });

    const incoming = incomingDocument([
      makeItem({ id: 'a', name: 'Imported A' }),
      makeItem({ id: 'b', name: 'Imported B' }),
    ]);
    const summary = await store.executeImport(incoming, 'replace');
    expect(summary.applied).toBe(true);
    expect(summary.totals.items_total).toBe(2);
    // reloadAll ran: the list now reflects the imported items.
    const names = store.state.value.items.map((i) => i.name).sort();
    expect(names).toEqual(['Imported A', 'Imported B']);
  });
});
