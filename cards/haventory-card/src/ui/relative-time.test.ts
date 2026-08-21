import { setLanguage } from '../i18n';
import {
  addDays,
  formatDate,
  isDue,
  isOverdue,
  parseTs,
  quickDayOffsets,
  relativeTime,
  toIsoDate,
} from './relative-time';

const NOW = Date.parse('2026-07-24T12:00:00Z');

describe('parseTs', () => {
  it('parses canonical Z timestamps and event ts with microseconds and offset', () => {
    expect(parseTs('2026-07-24T12:00:00Z')).toBe(NOW);
    // Event `ts` from ws.py is `datetime.now(UTC).isoformat()` — microseconds + +00:00.
    expect(parseTs('2026-07-24T12:00:00.123456+00:00')).toBe(NOW + 123);
  });

  it('returns null for missing or unparsable input', () => {
    expect(parseTs(null)).toBe(null);
    expect(parseTs(undefined)).toBe(null);
    expect(parseTs('')).toBe(null);
    expect(parseTs('not a date')).toBe(null);
  });
});

describe('relativeTime', () => {
  it('picks one bucket per span and names it', () => {
    expect(relativeTime('2026-07-24T11:59:30Z', NOW)).toBe('just now');
    expect(relativeTime('2026-07-24T11:45:00Z', NOW)).toBe('15 min. ago');
    expect(relativeTime('2026-07-24T10:00:00Z', NOW)).toBe('2 hr. ago');
    expect(relativeTime('2026-07-21T12:00:00Z', NOW)).toBe('3 days ago');
    expect(relativeTime('2026-07-17T12:00:00Z', NOW)).toBe('1 wk. ago');
    expect(relativeTime('2024-07-24T12:00:00Z', NOW)).toBe('2 yr. ago');
  });

  it('names the same spans in the language in force', () => {
    setLanguage('de');
    expect(relativeTime('2026-07-24T11:59:30Z', NOW)).toBe('gerade eben');
    expect(relativeTime('2026-07-24T11:45:00Z', NOW)).toBe('vor 15 Min.');
    expect(relativeTime('2026-07-24T10:00:00Z', NOW)).toBe('vor 2 Std.');
    expect(relativeTime('2026-07-21T12:00:00Z', NOW)).toBe('vor 3 Tagen');
    expect(relativeTime('2024-07-24T12:00:00Z', NOW)).toBe('vor 2 Jahren');
  });

  it('degrades to an em dash for unusable input and clamps future stamps', () => {
    expect(relativeTime(null, NOW)).toBe('—');
    expect(relativeTime('garbage', NOW)).toBe('—');
    expect(relativeTime('2026-07-25T12:00:00Z', NOW)).toBe('just now');
  });
});

describe('formatDate', () => {
  it('omits the year within the current year and keeps it otherwise', () => {
    expect(formatDate('2026-07-31', NOW)).toBe('Jul 31');
    expect(formatDate('2025-12-01', NOW)).toBe('Dec 1, 2025');
  });

  it('writes the date the way the language does', () => {
    setLanguage('de');
    expect(formatDate('2026-07-31', NOW)).toBe('31. Juli');
    expect(formatDate('2025-12-01', NOW)).toBe('1. Dez. 2025');
  });

  it('passes through anything that is not YYYY-MM-DD, and dashes empties', () => {
    expect(formatDate(null, NOW)).toBe('—');
    expect(formatDate('whenever', NOW)).toBe('whenever');
    // A month a calendar does not have. `Date` would roll it into next
    // January; the stored string is the honest answer.
    expect(formatDate('2026-13-01', NOW)).toBe('2026-13-01');
    expect(formatDate('2026-02-30', NOW)).toBe('2026-02-30');
  });
});

describe('quickDayOffsets', () => {
  it('offers a week, a month and a quarter, labelled in the language in force', () => {
    expect(quickDayOffsets().map((o) => o.days)).toEqual([7, 30, 90]);
    expect(quickDayOffsets()[0].label).toBe('+7 days');
    setLanguage('de');
    expect(quickDayOffsets()[0].label).toBe('+7 Tage');
  });
});

describe('isOverdue', () => {
  it('is true only for dates strictly before today', () => {
    const today = toIsoDate(NOW);
    expect(isOverdue(today, NOW)).toBe(false);
    expect(isOverdue(addDays(-1, NOW), NOW)).toBe(true);
    expect(isOverdue(addDays(1, NOW), NOW)).toBe(false);
  });

  it('treats undated items as never overdue', () => {
    expect(isOverdue(null, NOW)).toBe(false);
    expect(isOverdue(undefined, NOW)).toBe(false);
  });
});

describe('isDue', () => {
  it('counts today, which is the whole difference from isOverdue', () => {
    const today = toIsoDate(NOW);
    expect(isDue(today, NOW)).toBe(true);
    expect(isOverdue(today, NOW)).toBe(false);
    expect(isDue(addDays(-1, NOW), NOW)).toBe(true);
    expect(isDue(addDays(1, NOW), NOW)).toBe(false);
  });

  it('treats undated items as never due', () => {
    expect(isDue(null, NOW)).toBe(false);
    expect(isDue(undefined, NOW)).toBe(false);
  });
});

describe('addDays', () => {
  it('produces the +1/+7/+30 check-out suggestions as YYYY-MM-DD', () => {
    expect(addDays(7, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const base = Date.parse('2026-07-24T00:00:00');
    expect(addDays(7, base)).toBe('2026-07-31');
    expect(addDays(30, base)).toBe('2026-08-23');
  });
});
