import { makeItem } from '../test.utils';
import {
  customFieldsFrom,
  formFromItem,
  inferType,
  isDirty,
  newCustomFieldRow,
  normalizeTags,
  reminderIntervalFrom,
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

  // That these caps hold the *same* numbers as the backend is checked across the
  // language boundary, in `tests/test_item_form_caps.py`. This covers the other
  // half: that the editor actually enforces each one before the round trip.
  it('refuses input past every size cap', () => {
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

  // The caps refuse growth past the stored item, never the stored item itself —
  // so an over-cap item already in the store can be saved, including by the
  // edit that trims some of the excess, and only what an edit adds is capped.
  describe('with a stored item as baseline', () => {
    const legacyDescription = 'd'.repeat(4500);
    const legacyTags = Array.from({ length: 55 }, (_, i) => `tag-${i}`);
    const legacyFields = { note: 'v'.repeat(1200), ['k'.repeat(70)]: 'x' };
    const legacy = () =>
      makeItem({
        name: 'Legacy',
        description: legacyDescription,
        tags: legacyTags,
        custom_fields: legacyFields,
      });

    it('accepts the untouched form of a legacy over-cap item', () => {
      expect(validateForm(formFromItem(legacy()), legacy())).toEqual([]);
    });

    it('accepts the edit that trims the excess without clearing it', () => {
      const model = {
        ...formFromItem(legacy()),
        description: legacyDescription.slice(0, 4200),
        tags: legacyTags.slice(0, 52),
      };
      expect(validateForm(model, legacy())).toEqual([]);
    });

    it('still refuses what the edit adds past the stored value', () => {
      const item = legacy();
      const grown = validateForm(
        { ...formFromItem(item), description: legacyDescription + 'x' },
        item,
      );
      expect(grown.map((e) => e.field)).toEqual(['description']);

      const moreTags = validateForm(
        { ...formFromItem(item), tags: [...legacyTags, 'one-more'] },
        item,
      );
      expect(moreTags.map((e) => e.field)).toEqual(['tags']);

      const newLongTag = validateForm(
        { ...formFromItem(item), tags: [...legacyTags.slice(0, 10), 'x'.repeat(65)] },
        item,
      );
      expect(newLongTag.map((e) => e.field)).toEqual(['tags']);
    });

    it('grandfathers stored custom-field keys and values but not new ones', () => {
      const item = legacy();
      expect(validateForm(formFromItem(item), item)).toEqual([]);

      const model = formFromItem(item);
      const grownValue = model.customFields.map((row) =>
        row.key === 'note' ? { ...row, value: 'v'.repeat(1300) } : row,
      );
      expect(
        validateForm({ ...model, customFields: grownValue }, item).some((e) =>
          e.field.startsWith('custom:'),
        ),
      ).toBe(true);

      const newLongKey = [
        ...model.customFields,
        newCustomFieldRow({ key: 'n'.repeat(65), value: 'v' }),
      ];
      expect(
        validateForm({ ...model, customFields: newLongKey }, item).some((e) =>
          e.field.startsWith('custom:'),
        ),
      ).toBe(true);
    });

    it('applies the caps absolutely on the add-item form', () => {
      expect(
        validateForm({ ...base(), name: 'A', description: 'd'.repeat(4001) }).map((e) => e.field),
      ).toEqual(['description']);
    });
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

  it('rides along on both save payloads when the edit picked one', () => {
    const item = makeItem({ status: 'ok' });
    const model = { ...formFromItem(item), status: 'missing' };
    expect(toUpdatePayload(model, item).status).toBe('missing');
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
      reminder_date: null,
      reminder_interval: null,
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
  // A form is filled from one copy of the item and saved against another: while
  // it was open, another member's edit reached the card and moved the version
  // the save is checked against, so the write is accepted. A field nobody here
  // touched must stay out of the payload — sending the form's copy of it puts
  // their change back the way it was, with nothing for either side to notice.
  it('carries the fields this edit changed and nothing else', () => {
    const item = makeItem({ name: 'Multimeter', description: 'mine', quantity: 10, tags: ['meter'] });
    const model = { ...formFromItem(item), description: 'mine, typo fixed' };

    expect(toUpdatePayload(model, item)).toEqual({ description: 'mine, typo fixed' });
  });

  it('sends nothing for a form nobody typed into', () => {
    const item = makeItem({
      name: 'A',
      quantity: 10,
      category: 'Tools',
      tags: ['meter'],
      custom_fields: { serial: 'a' },
    });

    expect(toUpdatePayload(formFromItem(item), item)).toEqual({});
  });

  it('sends null for a field cleared to empty', () => {
    const item = makeItem({ description: 'Fluke 117', category: 'Tools' });
    const model = { ...formFromItem(item), description: '   ', category: '' };

    const payload = toUpdatePayload(model, item);
    expect(payload.description).toBe(null);
    expect(payload.category).toBe(null);
  });

  it('clears the due date with the check-in that made it meaningless', () => {
    const item = makeItem({ checked_out: true, due_date: '2026-07-31' });
    const model = { ...formFromItem(item), checkedOut: false };

    expect(toUpdatePayload(model, item)).toEqual({ checked_out: false, due_date: null });
  });

  it('sets exactly the custom fields this edit wrote', () => {
    const item = makeItem({ custom_fields: { serial: 'a', price: 1 } });
    const model = formFromItem(item);
    model.customFields = model.customFields.map((r) => (r.key === 'price' ? { ...r, value: '2' } : r));

    const payload = toUpdatePayload(model, item);
    expect(payload.custom_fields_set).toEqual({ price: 2 });
    expect(payload.custom_fields_unset).toBeUndefined();
  });

  it('sends neither half for a custom-field map nobody touched', () => {
    const item = makeItem({ custom_fields: { serial: 'a', price: 1 } });

    const payload = toUpdatePayload(formFromItem(item), item);
    expect(payload.custom_fields_set).toBeUndefined();
    expect(payload.custom_fields_unset).toBeUndefined();
  });

  it('unsets exactly the custom fields the form no longer describes', () => {
    const item = makeItem({ custom_fields: { serial: 'a', price: 1, gone: 'x' } });
    const model = formFromItem(item);
    model.customFields = model.customFields.filter((r) => r.key !== 'gone');

    const payload = toUpdatePayload(model, item);
    expect(payload.custom_fields_unset).toEqual(['gone']);
    expect(payload.custom_fields_set).toBeUndefined();
  });

  it('treats a cleared value as an unset', () => {
    const item = makeItem({ custom_fields: { serial: 'a' } });
    const model = formFromItem(item);
    model.customFields = model.customFields.map((r) => ({ ...r, value: '' }));

    const payload = toUpdatePayload(model, item);
    expect(payload.custom_fields_unset).toEqual(['serial']);
    expect(payload.custom_fields_set).toBeUndefined();
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

describe('reminders', () => {
  it('reads a stored reminder onto the form', () => {
    const item = makeItem({
      reminder_date: '2026-09-01',
      reminder_interval: { unit: 'months', count: 3 },
    });
    expect(formFromItem(item)).toMatchObject({
      reminderDate: '2026-09-01',
      reminderCount: 3,
      reminderUnit: 'months',
    });
  });

  it('opens on a blank count so a single date needs nothing cleared', () => {
    expect(base()).toMatchObject({ reminderDate: '', reminderCount: null, reminderUnit: 'months' });
  });

  it('sends no interval for a one-off', () => {
    const payload = toCreatePayload({ ...base(), name: 'A', reminderDate: '2026-09-01' });
    expect(payload.reminder_date).toBe('2026-09-01');
    expect(payload.reminder_interval).toBe(null);
  });

  it('sends the interval the form describes', () => {
    const payload = toCreatePayload({
      ...base(),
      name: 'A',
      reminderDate: '2026-09-01',
      reminderCount: 2,
      reminderUnit: 'weeks',
    });
    expect(payload.reminder_interval).toEqual({ unit: 'weeks', count: 2 });
  });

  it('drops the interval when the date is cleared, because the backend refuses the pair', () => {
    const payload = toCreatePayload({
      ...base(),
      name: 'A',
      reminderDate: '',
      reminderCount: 3,
      reminderUnit: 'months',
    });
    expect(payload.reminder_date).toBe(null);
    expect(payload.reminder_interval).toBe(null);
  });

  it('ignores a repeat left behind by clearing the date', () => {
    // The repeat is disabled without a date and dropped from the payload, so
    // refusing the save would trap the one edit that clears it.
    expect(validateForm({ ...base(), name: 'A', reminderCount: 3 })).toEqual([]);
    expect(toCreatePayload({ ...base(), name: 'A', reminderCount: 3 }).reminder_interval).toBe(
      null,
    );
  });

  it.each([0, -1, 1001, 1.5])('refuses a repeat of %s', (count) => {
    const errors = validateForm({
      ...base(),
      name: 'A',
      reminderDate: '2026-09-01',
      reminderCount: count,
    });
    expect(errors.map((e) => e.field)).toContain('reminder');
  });

  it('accepts a date with no repeat, and a date with a valid one', () => {
    expect(validateForm({ ...base(), name: 'A', reminderDate: '2026-09-01' })).toEqual([]);
    expect(
      validateForm({ ...base(), name: 'A', reminderDate: '2026-09-01', reminderCount: 3 }),
    ).toEqual([]);
  });

  it('counts a changed reminder as dirty', () => {
    const item = makeItem({ reminder_date: '2026-09-01' });
    expect(isDirty(formFromItem(item), item)).toBe(false);
    expect(isDirty({ ...formFromItem(item), reminderDate: '2026-10-01' }, item)).toBe(true);
    expect(isDirty({ ...formFromItem(item), reminderCount: 3 }, item)).toBe(true);
  });

  it('does not count a unit change with no count as dirty', () => {
    // It describes the same one-off it started as, so saving would be a no-op
    // that still bumps the item's version.
    const item = makeItem({ reminder_date: '2026-09-01' });
    expect(isDirty({ ...formFromItem(item), reminderUnit: 'days' }, item)).toBe(false);
  });

  it('builds no interval without both halves', () => {
    expect(reminderIntervalFrom({ ...base(), reminderDate: '2026-09-01' })).toBe(null);
    expect(reminderIntervalFrom({ ...base(), reminderCount: 3 })).toBe(null);
  });
});
