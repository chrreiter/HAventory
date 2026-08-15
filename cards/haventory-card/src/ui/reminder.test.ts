import { canBumpReminder, formatInterval, hasReminder, isReminderDue, reminderSummary } from './reminder';
import { makeItem } from '../test.utils';

const AUG_15_2026 = new Date('2026-08-15T12:00:00').getTime();

describe('formatInterval', () => {
  it('says a repeat the way a household does', () => {
    expect(formatInterval({ unit: 'months', count: 3 })).toBe('every 3 months');
    expect(formatInterval({ unit: 'days', count: 1 })).toBe('every day');
    expect(formatInterval({ unit: 'weeks', count: 1 })).toBe('every week');
    expect(formatInterval({ unit: 'months', count: 1 })).toBe('every month');
  });

  it('has nothing to say about a one-off', () => {
    expect(formatInterval(null)).toBe(null);
    expect(formatInterval(undefined)).toBe(null);
  });
});

describe('reminderSummary', () => {
  it('carries the repeat beside the date for a series', () => {
    const item = makeItem({ reminder_date: '2026-08-31', reminder_interval: { unit: 'months', count: 3 } });
    expect(reminderSummary(item, AUG_15_2026)).toBe('Aug 31 · every 3 months');
  });

  // The date alone is what a one-off is; adding a repeat would invent one.
  it('is the date alone for a one-off', () => {
    const item = makeItem({ reminder_date: '2026-08-31', reminder_interval: null });
    expect(reminderSummary(item, AUG_15_2026)).toBe('Aug 31');
  });

  it('is nothing when there is no reminder', () => {
    expect(reminderSummary(makeItem({ reminder_date: null }), AUG_15_2026)).toBe(null);
    expect(hasReminder(makeItem({ reminder_date: null }))).toBe(false);
  });
});

describe('isReminderDue', () => {
  // Inclusive of today, unlike a due date: a reminder names the day it is
  // asking about, so "check the smoke detector today" is due today.
  it('counts today, and the past, and not the future', () => {
    expect(isReminderDue(makeItem({ reminder_date: '2026-08-15' }), AUG_15_2026)).toBe(true);
    expect(isReminderDue(makeItem({ reminder_date: '2026-08-14' }), AUG_15_2026)).toBe(true);
    expect(isReminderDue(makeItem({ reminder_date: '2026-08-16' }), AUG_15_2026)).toBe(false);
  });

  it('is false with no reminder at all', () => {
    expect(isReminderDue(makeItem({ reminder_date: null }), AUG_15_2026)).toBe(false);
  });
});

describe('canBumpReminder', () => {
  // The backend refuses a bump on a one-off, so offering it would be an error
  // the household could not have predicted.
  it('is true only for a series', () => {
    expect(
      canBumpReminder(makeItem({ reminder_date: '2026-08-31', reminder_interval: { unit: 'days', count: 7 } })),
    ).toBe(true);
    expect(canBumpReminder(makeItem({ reminder_date: '2026-08-31', reminder_interval: null }))).toBe(false);
    expect(
      canBumpReminder(makeItem({ reminder_date: null, reminder_interval: { unit: 'days', count: 7 } })),
    ).toBe(false);
  });
});
