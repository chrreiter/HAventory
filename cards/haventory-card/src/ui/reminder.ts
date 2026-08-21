/**
 * Reading a reminder off an item, for every surface that shows one.
 *
 * The detail sheet's fact row and the table's reminder column ask the same two
 * questions — what does this reminder say, and has it come round — so they ask
 * them here rather than each spelling out the date-and-interval rule.
 */

import { tn } from '../i18n';
import type { PluralKey } from '../i18n';
import type { Item, ReminderInterval, ReminderUnit } from '../store/types';
import { formatDate, toIsoDate } from './relative-time';

/** True when the item carries a reminder at all. A date is what makes one. */
export function hasReminder(item: Item): boolean {
  return !!item.reminder_date;
}

/**
 * True once the reminder's occurrence has arrived.
 *
 * Inclusive of today, unlike `isOverdue` for a due date: a reminder names the
 * day something should be done, so the day itself is when it is asking, not the
 * last day it is not. "Check the smoke detector today" is due today.
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

/** "every 3 months", "every day" — the repeat in the words a household uses. */
export function formatInterval(interval: ReminderInterval | null | undefined): string | null {
  if (!interval) return null;
  const key = UNIT_KEYS[interval.unit];
  if (!key) return null;
  return tn(key, interval.count);
}

/**
 * The whole reminder on one line, or null when there is none.
 *
 * A one-off is its date alone; a series adds the repeat, because the date on
 * its own cannot tell the two apart and the difference is what "Mark done"
 * means — a series moves on, a one-off has nowhere to go.
 */
export function reminderSummary(item: Item, now: number = Date.now()): string | null {
  if (!item.reminder_date) return null;
  const repeat = formatInterval(item.reminder_interval);
  const date = formatDate(item.reminder_date, now);
  return repeat ? `${date} · ${repeat}` : date;
}

/**
 * True when "Mark done" can do anything.
 *
 * The backend refuses a bump on a one-off — it has no next occurrence to move
 * to — so the action is only offered where it would succeed.
 */
export function canBumpReminder(item: Item): boolean {
  return !!item.reminder_date && !!item.reminder_interval;
}
