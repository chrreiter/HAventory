import type { Item, ItemCreate, ItemUpdate, ScalarValue } from '../store/types';

/**
 * Form model and payload building for the item edit surfaces.
 *
 * Kept as pure functions so the desktop inline expander and the mobile detail
 * sheet share one definition of what a field means, and so the fiddly parts —
 * typed custom fields and the set/unset diff on save — are testable without a
 * DOM.
 */

export type CustomFieldType = 'string' | 'number' | 'boolean' | 'date';

export interface CustomFieldRow {
  /** Stable row identity so re-ordering does not scramble inputs. */
  id: number;
  key: string;
  type: CustomFieldType;
  value: string;
}

export interface ItemFormModel {
  name: string;
  description: string;
  quantity: number;
  lowStock: number | null;
  category: string;
  tags: string[];
  locationId: string | null;
  checkedOut: boolean;
  dueDate: string;
  inspectionDate: string;
  customFields: CustomFieldRow[];
}

/** A validation problem, scoped to the field that caused it. */
export interface FieldError {
  field: 'name' | 'quantity' | 'lowStock' | string;
  message: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let rowSeq = 0;

export function newCustomFieldRow(partial: Partial<CustomFieldRow> = {}): CustomFieldRow {
  rowSeq += 1;
  return { id: rowSeq, key: '', type: 'string', value: '', ...partial };
}

/** Best guess at the editor type for a stored scalar. */
export function inferType(value: ScalarValue): CustomFieldType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && DATE_RE.test(value)) return 'date';
  return 'string';
}

function valueToString(value: ScalarValue): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Build the editable model for an item, or a blank one for "add item". */
export function formFromItem(item: Item | null): ItemFormModel {
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    quantity: item?.quantity ?? 1,
    lowStock: item?.low_stock_threshold ?? null,
    category: item?.category ?? '',
    tags: [...(item?.tags ?? [])],
    locationId: item?.location_id ?? null,
    checkedOut: !!item?.checked_out,
    dueDate: item?.due_date ?? '',
    inspectionDate: item?.inspection_date ?? '',
    customFields: Object.entries(item?.custom_fields ?? {}).map(([key, value]) =>
      newCustomFieldRow({ key, type: inferType(value), value: valueToString(value) }),
    ),
  };
}

/** Every problem with the model, in field order. Empty means it is saveable. */
export function validateForm(model: ItemFormModel): FieldError[] {
  const errors: FieldError[] = [];
  if (!model.name.trim()) {
    errors.push({ field: 'name', message: 'Name is required.' });
  } else if (model.name.trim().length > 120) {
    errors.push({ field: 'name', message: 'Name is limited to 120 characters.' });
  }
  if (!Number.isFinite(model.quantity) || !Number.isInteger(model.quantity) || model.quantity < 0) {
    errors.push({ field: 'quantity', message: "Quantity can't be negative." });
  }
  if (model.lowStock !== null && (!Number.isFinite(model.lowStock) || model.lowStock < 0)) {
    errors.push({ field: 'lowStock', message: 'Low-stock threshold must be 0 or more, or empty.' });
  }
  const seen = new Set<string>();
  for (const row of model.customFields) {
    const key = row.key.trim();
    if (!key) continue;
    if (seen.has(key)) {
      errors.push({ field: `custom:${row.id}`, message: `"${key}" is used twice.` });
      continue;
    }
    seen.add(key);
    if (row.type === 'number' && (row.value.trim() === '' || !Number.isFinite(Number(row.value)))) {
      errors.push({ field: `custom:${row.id}`, message: `"${key}" must be a number.` });
    }
    if (row.type === 'date' && row.value.trim() !== '' && !DATE_RE.test(row.value.trim())) {
      errors.push({ field: `custom:${row.id}`, message: `"${key}" must be a date.` });
    }
  }
  return errors;
}

/**
 * The custom-field map the form describes. Rows with a blank key are treated as
 * unfinished and dropped; a row with a key and a blank value is kept, because
 * clearing a value is how the design says you unset a field.
 */
export function customFieldsFrom(model: ItemFormModel): Record<string, ScalarValue> {
  const out: Record<string, ScalarValue> = {};
  for (const row of model.customFields) {
    const key = row.key.trim();
    if (!key) continue;
    if (row.type === 'number') {
      const n = Number(row.value);
      if (row.value.trim() === '' || !Number.isFinite(n)) continue;
      out[key] = n;
    } else if (row.type === 'boolean') {
      out[key] = row.value === 'true';
    } else {
      if (row.value.trim() === '') continue; // cleared -> unset on save
      out[key] = row.value;
    }
  }
  return out;
}

/** Tags as the backend stores them: trimmed, lowercased, deduplicated, in order. */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function commonFields(model: ItemFormModel) {
  return {
    name: model.name.trim(),
    description: model.description.trim() || null,
    quantity: model.quantity,
    low_stock_threshold: model.lowStock,
    category: model.category.trim() || null,
    tags: normalizeTags(model.tags),
    location_id: model.locationId,
    checked_out: model.checkedOut,
    // A due date is only meaningful while an item is out; checking in clears it.
    due_date: model.checkedOut ? model.dueDate || null : null,
    inspection_date: model.inspectionDate || null,
  };
}

export function toCreatePayload(model: ItemFormModel): ItemCreate {
  return { ...commonFields(model), custom_fields: customFieldsFrom(model) };
}

/**
 * The update payload, including the explicit set/unset semantics the backend
 * wants: everything the form describes goes in `custom_fields_set`, and any key
 * the item had that the form no longer describes goes in `custom_fields_unset`.
 */
export function toUpdatePayload(model: ItemFormModel, original: Item): ItemUpdate {
  const set = customFieldsFrom(model);
  const unset = Object.keys(original.custom_fields ?? {}).filter((key) => !(key in set));
  const payload: ItemUpdate = { ...commonFields(model), custom_fields_set: set };
  if (unset.length) payload.custom_fields_unset = unset;
  return payload;
}

/** True when the form differs from the item it was built from. */
export function isDirty(model: ItemFormModel, original: Item | null): boolean {
  const baseline = formFromItem(original);
  if (
    model.name !== baseline.name ||
    model.description !== baseline.description ||
    model.quantity !== baseline.quantity ||
    model.lowStock !== baseline.lowStock ||
    model.category !== baseline.category ||
    model.locationId !== baseline.locationId ||
    model.checkedOut !== baseline.checkedOut ||
    model.dueDate !== baseline.dueDate ||
    model.inspectionDate !== baseline.inspectionDate
  ) {
    return true;
  }
  if (normalizeTags(model.tags).join(' ') !== normalizeTags(baseline.tags).join(' ')) return true;
  return JSON.stringify(customFieldsFrom(model)) !== JSON.stringify(customFieldsFrom(baseline));
}
