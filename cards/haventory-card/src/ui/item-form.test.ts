import { makeItem } from '../test.utils';
import {
  customFieldsFrom,
  formFromItem,
  inferType,
  isDirty,
  newCustomFieldRow,
  normalizeTags,
  toCreatePayload,
  toUpdatePayload,
  validateForm,
} from './item-form';
import type { ItemFormModel } from './item-form';

const base = (): ItemFormModel => formFromItem(null);

describe('formFromItem', () => {
  it('starts a create form with a quantity of one and nothing else set', () => {
    const model = base();
    expect(model).toMatchObject({
      name: '',
      description: '',
      quantity: 1,
      status: 'ok',
      lowStock: null,
      category: '',
      tags: [],
      locationId: null,
      checkedOut: false,
      dueDate: '',
      inspectionDate: '',
    });
    expect(model.customFields).toEqual([]);
  });

  it('reads every editable field off an item', () => {
    const item = makeItem({
      name: 'Multimeter',
      description: 'Fluke 117',
      quantity: 1,
      low_stock_threshold: 1,
      category: 'Tools',
      tags: ['electric', 'meter'],
      location_id: 'shelf-b',
      checked_out: true,
      due_date: '2026-07-31',
      inspection_date: '2026-01-05',
      custom_fields: { serial: '44210-887', purchase_price: 189, calibrated: true, checked: '2026-02-01' },
    });
    const model = formFromItem(item);

    expect(model.name).toBe('Multimeter');
    expect(model.tags).toEqual(['electric', 'meter']);
    expect(model.checkedOut).toBe(true);
    expect(model.dueDate).toBe('2026-07-31');
    expect(model.customFields.map((r) => [r.key, r.type, r.value])).toEqual([
      ['serial', 'string', '44210-887'],
      ['purchase_price', 'number', '189'],
      ['calibrated', 'boolean', 'true'],
      ['checked', 'date', '2026-02-01'],
    ]);
  });

  it('copies tags rather than aliasing the item', () => {
    const item = makeItem({ tags: ['a'] });
    const model = formFromItem(item);
    model.tags.push('b');
    expect(item.tags).toEqual(['a']);
  });
});

describe('inferType', () => {
  it('maps a scalar to the editor type that can round-trip it', () => {
    expect(inferType(true)).toBe('boolean');
    expect(inferType(42)).toBe('number');
    expect(inferType('2026-07-31')).toBe('date');
    expect(inferType('2026-7-31')).toBe('string');
    expect(inferType('hello')).toBe('string');
  });
});

describe('validateForm', () => {
  it('accepts a minimal valid form', () => {
    expect(validateForm({ ...base(), name: 'Screws' })).toEqual([]);
  });

  it('scopes each problem to its field', () => {
    const errors = validateForm({ ...base(), name: '  ', quantity: -3, lowStock: -1 });
    expect(errors.map((e) => e.field)).toEqual(['name', 'quantity', 'lowStock']);
    expect(errors[1].message).toBe("Quantity can't be negative.");
  });

  it('enforces the backend name limit', () => {
    expect(validateForm({ ...base(), name: 'x'.repeat(121) })[0].message).toContain('120 characters');
    expect(validateForm({ ...base(), name: 'x'.repeat(120) })).toEqual([]);
  });

  it('rejects a fractional quantity', () => {
    expect(validateForm({ ...base(), name: 'A', quantity: 1.5 })[0].field).toBe('quantity');
  });

  it('rejects a non-numeric number field and a malformed date field', () => {
    const rows = [
      newCustomFieldRow({ key: 'price', type: 'number', value: 'abc' }),
      newCustomFieldRow({ key: 'checked', type: 'date', value: 'soon' }),
    ];
    const errors = validateForm({ ...base(), name: 'A', customFields: rows });
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toContain('"price" must be a number');
    expect(errors[1].message).toContain('"checked" must be a date');
  });

  it('catches a duplicated custom-field key', () => {
    const rows = [
      newCustomFieldRow({ key: 'serial', value: 'a' }),
      newCustomFieldRow({ key: 'serial', value: 'b' }),
    ];
    expect(validateForm({ ...base(), name: 'A', customFields: rows })[0].message).toContain(
      '"serial" is used twice',
    );
  });

  it('ignores a row that has not been given a key yet', () => {
    const rows = [newCustomFieldRow({ key: '  ', type: 'number', value: '' })];
    expect(validateForm({ ...base(), name: 'A', customFields: rows })).toEqual([]);
  });

  it('mirrors the backend size caps so the editor refuses before the round trip', () => {
    const over = [
      { model: { description: 'd'.repeat(4001) }, field: 'description' },
      { model: { category: 'c'.repeat(121) }, field: 'category' },
      { model: { tags: ['t'.repeat(65)] }, field: 'tags' },
      { model: { tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }, field: 'tags' },
      {
        model: { customFields: [newCustomFieldRow({ key: 'k'.repeat(65), value: 'v' })] },
        field: 'custom:',
      },
      {
        model: { customFields: [newCustomFieldRow({ key: 'k', value: 'v'.repeat(1001) })] },
        field: 'custom:',
      },
      {
        model: {
          customFields: Array.from({ length: 51 }, (_, i) =>
            newCustomFieldRow({ key: `k${i}`, value: 'v' }),
          ),
        },
        field: 'customFields',
      },
    ];
    for (const { model, field } of over) {
      const errors = validateForm({ ...base(), name: 'A', ...model });
      expect(errors.length, JSON.stringify(field)).toBeGreaterThan(0);
      expect(errors.some((e) => e.field.startsWith(field))).toBe(true);
    }
  });

  it('accepts a form sitting exactly at every cap', () => {
    const atCap = validateForm({
      ...base(),
      name: 'n'.repeat(120),
      description: 'd'.repeat(4000),
      category: 'c'.repeat(120),
      tags: ['t'.repeat(64)],
      customFields: [newCustomFieldRow({ key: 'k'.repeat(64), value: 'v'.repeat(1000) })],
    });
    expect(atCap).toEqual([]);
  });

  it('counts tags the way the backend counts them, after normalization', () => {
    // Fifty-one entries, but two are the same tag under different casings.
    const tags = ['Bolt', 'bolt', ...Array.from({ length: 49 }, (_, i) => `t${i}`)];
    expect(validateForm({ ...base(), name: 'A', tags })).toEqual([]);
  });
});

describe('customFieldsFrom', () => {
  it('coerces each row to its declared type', () => {
    const rows = [
      newCustomFieldRow({ key: 'serial', type: 'string', value: '44210' }),
      newCustomFieldRow({ key: 'price', type: 'number', value: '189' }),
      newCustomFieldRow({ key: 'calibrated', type: 'boolean', value: 'true' }),
      newCustomFieldRow({ key: 'off', type: 'boolean', value: 'false' }),
      newCustomFieldRow({ key: 'checked', type: 'date', value: '2026-02-01' }),
    ];
    expect(customFieldsFrom({ ...base(), customFields: rows })).toEqual({
      serial: '44210',
      price: 189,
      calibrated: true,
      off: false,
      checked: '2026-02-01',
    });
  });

  it('drops a cleared value so save unsets the key', () => {
    const rows = [newCustomFieldRow({ key: 'serial', value: '' })];
    expect(customFieldsFrom({ ...base(), customFields: rows })).toEqual({});
  });
});

describe('status in the form model', () => {
  it('reads the item status, treating an absent one as ok', () => {
    expect(formFromItem(makeItem({ status: 'needs_repair' })).status).toBe('needs_repair');
    expect(formFromItem(makeItem()).status).toBe('ok');
  });

  it('rides along on both save payloads', () => {
    const item = makeItem({ status: 'missing' });
    expect(toUpdatePayload(formFromItem(item), item).status).toBe('missing');
    expect(toCreatePayload({ ...base(), name: 'A', status: 'missing' }).status).toBe('missing');
  });

  it('dirties the form when it changes', () => {
    const item = makeItem({ status: 'missing' });
    expect(isDirty(formFromItem(item), item)).toBe(false);
    expect(isDirty({ ...formFromItem(item), status: 'ok' }, item)).toBe(true);
  });
});

describe('normalizeTags', () => {
  it('matches how the backend stores tags', () => {
    expect(normalizeTags([' Metric ', 'METRIC', 'M4', '', '  '])).toEqual(['metric', 'm4']);
  });
});

describe('toCreatePayload', () => {
  it('builds the create message', () => {
    const model: ItemFormModel = {
      ...base(),
      name: '  M4 Screws  ',
      description: ' box of 500 ',
      quantity: 340,
      lowStock: 50,
      category: ' Hardware ',
      tags: ['Metric', 'm4'],
      locationId: 'shelf-a',
      customFields: [newCustomFieldRow({ key: 'supplier', value: 'Acme' })],
    };
    expect(toCreatePayload(model)).toEqual({
      name: 'M4 Screws',
      description: 'box of 500',
      quantity: 340,
      status: 'ok',
      low_stock_threshold: 50,
      category: 'Hardware',
      tags: ['metric', 'm4'],
      location_id: 'shelf-a',
      checked_out: false,
      due_date: null,
      inspection_date: null,
      custom_fields: { supplier: 'Acme' },
    });
  });

  it('sends null rather than an empty string for optional text', () => {
    const payload = toCreatePayload({ ...base(), name: 'A' });
    expect(payload.description).toBe(null);
    expect(payload.category).toBe(null);
  });

  it('drops a due date when the item is not checked out', () => {
    const payload = toCreatePayload({ ...base(), name: 'A', checkedOut: false, dueDate: '2026-07-31' });
    expect(payload.due_date).toBe(null);

    const out = toCreatePayload({ ...base(), name: 'A', checkedOut: true, dueDate: '2026-07-31' });
    expect(out.due_date).toBe('2026-07-31');
  });
});

describe('toUpdatePayload', () => {
  it('unsets exactly the custom fields the form no longer describes', () => {
    const item = makeItem({ custom_fields: { serial: 'a', price: 1, gone: 'x' } });
    const model = formFromItem(item);
    model.customFields = model.customFields.filter((r) => r.key !== 'gone');

    const payload = toUpdatePayload(model, item);
    expect(payload.custom_fields_set).toEqual({ serial: 'a', price: 1 });
    expect(payload.custom_fields_unset).toEqual(['gone']);
  });

  it('omits the unset list entirely when nothing was removed', () => {
    const item = makeItem({ custom_fields: { serial: 'a' } });
    const payload = toUpdatePayload(formFromItem(item), item);
    expect(payload.custom_fields_unset).toBeUndefined();
  });

  it('treats a cleared value as an unset', () => {
    const item = makeItem({ custom_fields: { serial: 'a' } });
    const model = formFromItem(item);
    model.customFields = model.customFields.map((r) => ({ ...r, value: '' }));

    const payload = toUpdatePayload(model, item);
    expect(payload.custom_fields_set).toEqual({});
    expect(payload.custom_fields_unset).toEqual(['serial']);
  });
});

describe('isDirty', () => {
  it('is false for an untouched form', () => {
    const item = makeItem({ name: 'A', tags: ['x'], custom_fields: { k: 1 } });
    expect(isDirty(formFromItem(item), item)).toBe(false);
    expect(isDirty(formFromItem(null), null)).toBe(false);
  });

  it('notices a scalar edit, a tag edit and a custom-field edit', () => {
    const item = makeItem({ name: 'A', tags: ['x'], custom_fields: { k: 1 } });

    expect(isDirty({ ...formFromItem(item), name: 'B' }, item)).toBe(true);
    expect(isDirty({ ...formFromItem(item), tags: ['x', 'y'] }, item)).toBe(true);

    const withField = formFromItem(item);
    withField.customFields = [...withField.customFields, newCustomFieldRow({ key: 'n', value: 'v' })];
    expect(isDirty(withField, item)).toBe(true);
  });

  it('ignores a tag edit that normalizes back to the same set', () => {
    const item = makeItem({ tags: ['metric'] });
    expect(isDirty({ ...formFromItem(item), tags: ['  METRIC '] }, item)).toBe(false);
  });

  it('notices typing a name into a blank create form', () => {
    expect(isDirty({ ...formFromItem(null), name: 'New' }, null)).toBe(true);
  });
});
