/** Reading a reminder off an item, for every surface that shows one. */

import { tn } from '../i18n';
import type { PluralKey } from '../i18n';
import type { Item, ReminderInterval, ReminderUnit } from '../store/types';
import { formatDate, toIsoDate } from './relative-time';

/** True when the item carries a reminder at all. A date is what makes one. */
export function hasReminder(item: Item): boolean {
  return !!item.reminder_date;
}

/**
 * True once the occurrence has arrived. Inclusive of today, unlike `isOverdue`:
 * a reminder names the day something should be done.
 */
export function isReminderDue(item: Item, now: number = Date.now()): boolean {
  const date = item.reminder_date;
  return !!date && date <= toIsoDate(now);
}

const UNIT_KEYS = {
  days: 'hv.reminder.every.days',
  weeks: 'hv.reminder.every.weeks',
  months: 'hv.reminder.every.months',
} as const satisfies Record<ReminderUnit, PluralKey>;

/** "every 3 months", "every day". */
export function formatInterval(interval: ReminderInterval | null | undefined): string | null {
  return interval ? tn(UNIT_KEYS[interval.unit], interval.count) : null;
}

/** The whole reminder on one line: the date, plus the repeat for a series. */
export function reminderSummary(item: Item, now: number = Date.now()): string | null {
  if (!item.reminder_date) return null;
  const repeat = formatInterval(item.reminder_interval);
  const date = formatDate(item.reminder_date, now);
  return repeat ? `${date} · ${repeat}` : date;
}

/** True when "Mark done" can do anything: the backend refuses a bump on a one-off. */
export function canBumpReminder(item: Item): boolean {
  return !!item.reminder_date && !!item.reminder_interval;
}
