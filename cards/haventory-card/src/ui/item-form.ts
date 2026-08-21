import { t } from '../i18n';
import type {
  Item,
  ItemCreate,
  ItemStatus,
  ItemUpdate,
  ReminderInterval,
  ReminderUnit,
  ScalarValue,
} from '../store/types';
import { itemStatus } from './status';

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
  status: ItemStatus;
  lowStock: number | null;
  category: string;
  tags: string[];
  locationId: string | null;
  checkedOut: boolean;
  dueDate: string;
  inspectionDate: string;
  /** The reminder anchor. Empty means no reminder, whatever the interval says. */
  reminderDate: string;
  /** Empty means the reminder is a one-off; the unit only matters beside a count. */
  reminderCount: number | null;
  reminderUnit: ReminderUnit;
  customFields: CustomFieldRow[];
}

export const REMINDER_UNITS: readonly ReminderUnit[] = ['days', 'weeks', 'months'];

/** `REMINDER_COUNT_MAX` in `models.py`, held equal to it by the test named below. */
const REMINDER_COUNT_MAX = 1000;

/** A validation problem, scoped to the field that caused it. */
export interface FieldError {
  field: 'name' | 'quantity' | 'lowStock' | string;
  message: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The backend's input caps, copied here so the editor refuses before the round
 * trip rather than showing a server error on save. These are the values in
 * `models.py`, and `tests/test_item_form_caps.py` reads both files and fails
 * when they disagree — including `REMINDER_UNITS` and `REMINDER_COUNT_MAX`
 * above, and a cap added to either side alone. So they can only move together.
 *
 * The rule they are applied under moves with them: a cap refuses growth past
 * the stored item, never the stored item itself, which is how the backend
 * treats data that predates a cap.
 */
const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 4000;
const CATEGORY_MAX_LENGTH = 120;
const TAG_MAX_LENGTH = 64;
const TAGS_MAX_COUNT = 50;
const CUSTOM_FIELDS_MAX_KEYS = 50;
const CUSTOM_FIELD_KEY_MAX_LENGTH = 64;
const CUSTOM_FIELD_VALUE_MAX_LENGTH = 1000;

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
    status: item ? itemStatus(item) : 'ok',
    lowStock: item?.low_stock_threshold ?? null,
    category: item?.category ?? '',
    tags: [...(item?.tags ?? [])],
    locationId: item?.location_id ?? null,
    checkedOut: !!item?.checked_out,
    dueDate: item?.due_date ?? '',
    inspectionDate: item?.inspection_date ?? '',
    reminderDate: item?.reminder_date ?? '',
    reminderCount: item?.reminder_interval?.count ?? null,
    // A stored one-off has no unit to show, so the picker opens on the one a
    // household reaches for most rather than on a blank.
    reminderUnit: item?.reminder_interval?.unit ?? 'months',
    customFields: Object.entries(item?.custom_fields ?? {}).map(([key, value]) =>
      newCustomFieldRow({ key, type: inferType(value), value: valueToString(value) }),
    ),
  };
}

/**
 * Every problem with the model, in field order. Empty means it is saveable.
 *
 * `original` is the stored item the form was built from, and the caps refuse
 * *growth* past it, the way the backend's write path does: an item that
 * predates a cap can be saved as it is — including by the edit that trims some
 * of the excess — while anything the edit adds is held to the cap. Without
 * `original` (the "add item" form) every cap is absolute.
 */
export function validateForm(model: ItemFormModel, original: Item | null = null): FieldError[] {
  const errors: FieldError[] = [];
  if (!model.name.trim()) {
    errors.push({ field: 'name', message: t('hv.form.error.nameRequired') });
  } else if (model.name.trim().length > NAME_MAX_LENGTH) {
    errors.push({
      field: 'name',
      message: t('hv.form.error.nameTooLong', { max: NAME_MAX_LENGTH }),
    });
  }
  const storedDescription = original?.description ?? '';
  if (
    model.description.length > DESCRIPTION_MAX_LENGTH &&
    model.description.length > storedDescription.length
  ) {
    errors.push({
      field: 'description',
      message: t('hv.form.error.descriptionTooLong', { max: DESCRIPTION_MAX_LENGTH }),
    });
  }
  const storedCategory = original?.category ?? '';
  if (
    model.category.trim().length > CATEGORY_MAX_LENGTH &&
    model.category.trim().length > storedCategory.length
  ) {
    errors.push({
      field: 'category',
      message: t('hv.form.error.categoryTooLong', { max: CATEGORY_MAX_LENGTH }),
    });
  }
  if (!Number.isFinite(model.quantity) || !Number.isInteger(model.quantity) || model.quantity < 0) {
    errors.push({ field: 'quantity', message: t('hv.form.error.quantityNegative') });
  }
  if (model.lowStock !== null && (!Number.isFinite(model.lowStock) || model.lowStock < 0)) {
    errors.push({ field: 'lowStock', message: t('hv.form.error.lowStockRange') });
  }
  // Counted after normalization, the way the backend counts it: two casings of
  // one tag are one tag on both sides.
  const tags = normalizeTags(model.tags);
  const storedTags = normalizeTags(original?.tags ?? []);
  if (tags.length > TAGS_MAX_COUNT && tags.length > storedTags.length) {
    errors.push({ field: 'tags', message: t('hv.form.error.tooManyTags', { max: TAGS_MAX_COUNT }) });
  }
  if (tags.some((tag) => tag.length > TAG_MAX_LENGTH && !storedTags.includes(tag))) {
    errors.push({
      field: 'tags',
      message: t('hv.form.error.tagTooLong', { max: TAG_MAX_LENGTH }),
    });
  }
  // Only while a date is set. The repeat is disabled without one and dropped
  // from the payload, so a count left behind by clearing the date is stale
  // rather than wrong — refusing the save over it would trap the one edit that
  // gets you out of it.
  if (model.reminderDate && model.reminderCount !== null) {
    if (
      !Number.isInteger(model.reminderCount) ||
      model.reminderCount < 1 ||
      model.reminderCount > REMINDER_COUNT_MAX
    ) {
      errors.push({
        field: 'reminder',
        message: t('hv.form.error.reminderRange', { max: REMINDER_COUNT_MAX }),
      });
    }
  }
  const storedFields = original?.custom_fields ?? {};
  const seen = new Set<string>();
  for (const row of model.customFields) {
    const key = row.key.trim();
    if (!key) continue;
    if (seen.has(key)) {
      errors.push({ field: `custom:${row.id}`, message: t('hv.form.error.customFieldDuplicate', { key }) });
      continue;
    }
    seen.add(key);
    if (key.length > CUSTOM_FIELD_KEY_MAX_LENGTH && !(key in storedFields)) {
      errors.push({
        field: `custom:${row.id}`,
        message: t('hv.form.error.customFieldKeyTooLong', { max: CUSTOM_FIELD_KEY_MAX_LENGTH }),
      });
    }
    if (row.type === 'number' && (row.value.trim() === '' || !Number.isFinite(Number(row.value)))) {
      errors.push({ field: `custom:${row.id}`, message: t('hv.form.error.customFieldNotNumber', { key }) });
    }
    if (row.type === 'date' && row.value.trim() !== '' && !DATE_RE.test(row.value.trim())) {
      errors.push({ field: `custom:${row.id}`, message: t('hv.form.error.customFieldNotDate', { key }) });
    }
    const storedValue = storedFields[key];
    const storedValueLength = typeof storedValue === 'string' ? storedValue.length : 0;
    if (
      row.type === 'string' &&
      row.value.length > CUSTOM_FIELD_VALUE_MAX_LENGTH &&
      row.value.length > storedValueLength
    ) {
      errors.push({
        field: `custom:${row.id}`,
        message: t('hv.form.error.customFieldValueTooLong', {
          key,
          max: CUSTOM_FIELD_VALUE_MAX_LENGTH,
        }),
      });
    }
  }
  if (seen.size > CUSTOM_FIELDS_MAX_KEYS && seen.size > Object.keys(storedFields).length) {
    errors.push({
      field: 'customFields',
      message: t('hv.form.error.tooManyCustomFields', { max: CUSTOM_FIELDS_MAX_KEYS }),
    });
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
    status: model.status,
    low_stock_threshold: model.lowStock,
    category: model.category.trim() || null,
    tags: normalizeTags(model.tags),
    location_id: model.locationId,
    checked_out: model.checkedOut,
    // A due date is only meaningful while an item is out; checking in clears it.
    due_date: model.checkedOut ? model.dueDate || null : null,
    inspection_date: model.inspectionDate || null,
    reminder_date: model.reminderDate || null,
    // An interval with no anchor is refused by the backend, so clearing the
    // date clears the recurrence with it rather than sending a pair it rejects.
    reminder_interval: reminderIntervalFrom(model),
  };
}

/** The interval the form describes, or none for a one-off. */
export function reminderIntervalFrom(model: ItemFormModel): ReminderInterval | null {
  if (!model.reminderDate || model.reminderCount === null || model.reminderCount < 1) return null;
  return { unit: model.reminderUnit, count: model.reminderCount };
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
    model.status !== baseline.status ||
    model.lowStock !== baseline.lowStock ||
    model.category !== baseline.category ||
    model.locationId !== baseline.locationId ||
    model.checkedOut !== baseline.checkedOut ||
    model.dueDate !== baseline.dueDate ||
    model.inspectionDate !== baseline.inspectionDate ||
    model.reminderDate !== baseline.reminderDate ||
    // Compared through the built interval, not the raw fields: a unit changed
    // while no count is set describes the same one-off it started as.
    JSON.stringify(reminderIntervalFrom(model)) !==
      JSON.stringify(reminderIntervalFrom(baseline))
  ) {
    return true;
  }
  if (normalizeTags(model.tags).join(' ') !== normalizeTags(baseline.tags).join(' ')) return true;
  return JSON.stringify(customFieldsFrom(model)) !== JSON.stringify(customFieldsFrom(baseline));
}
