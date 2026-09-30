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

/** Form model and payload building for the item edit surfaces, as pure functions. */

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
 * The backend's input caps from `models.py`, so the editor refuses before the
 * round trip; `tests/test_item_form_caps.py` holds both sides (and the reminder
 * constants above) equal. A cap refuses growth past the stored item only.
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
    // A one-off has no unit; the picker opens on the most common one.
    reminderUnit: item?.reminder_interval?.unit ?? 'months',
    customFields: Object.entries(item?.custom_fields ?? {}).map(([key, value]) =>
      newCustomFieldRow({ key, type: inferType(value), value: valueToString(value) }),
    ),
  };
}

/**
 * Every problem with the model, in field order; empty means saveable. Caps
 * refuse growth past `original`, as the backend does; without it they are absolute.
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
  // Counted after normalization, as the backend counts them.
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
  // Only while a date is set: without one the count is dropped from the payload.
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
 * The custom-field map the form describes. A blank key is an unfinished row; a
 * blank text or number value unsets the field.
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
  return [...new Set(tags.map((raw) => raw.trim().toLowerCase()).filter(Boolean))];
}

/** Every field a create names and an update may name, as the wire spells them. */
type CommonFields = ReturnType<typeof commonFields>;

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
    // The backend refuses an interval without a date, so clearing one clears both.
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

/** Two field values, compared the way the wire sees them rather than by identity. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The update payload: only what differs from `baseline`, the item the form was
 * built from. The save goes against a possibly newer version, so an untouched
 * field must not be written back over another member's edit. Custom fields go
 * as `custom_fields_set` / `custom_fields_unset`, patched by key.
 */
export function toUpdatePayload(model: ItemFormModel, baseline: Item): ItemUpdate {
  const before = commonFields(formFromItem(baseline));
  const after = commonFields(model);
  const payload: ItemUpdate = {};
  const changed = payload as Record<string, unknown>;
  for (const key of Object.keys(after) as (keyof CommonFields)[]) {
    if (!sameValue(after[key], before[key])) changed[key] = after[key];
  }

  const stored = baseline.custom_fields ?? {};
  const described = customFieldsFrom(model);
  const set: Record<string, ScalarValue> = {};
  for (const [key, value] of Object.entries(described)) {
    if (stored[key] !== value) set[key] = value;
  }
  const unset = Object.keys(stored).filter((key) => !(key in described));
  if (Object.keys(set).length) payload.custom_fields_set = set;
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
    // Through the built interval: a unit changed without a count is still a one-off.
    JSON.stringify(reminderIntervalFrom(model)) !==
      JSON.stringify(reminderIntervalFrom(baseline))
  ) {
    return true;
  }
  if (normalizeTags(model.tags).join(' ') !== normalizeTags(baseline.tags).join(' ')) return true;
  return JSON.stringify(customFieldsFrom(model)) !== JSON.stringify(customFieldsFrom(baseline));
}
