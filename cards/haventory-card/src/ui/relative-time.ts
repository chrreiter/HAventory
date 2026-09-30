/**
 * Compact relative times ("2 hr. ago") and short dates, from `Intl` in the
 * language in force. `numeric: 'always'` so "1 day ago" never reads "yesterday"
 * beside "2 days ago".
 */

import { language, t } from '../i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/** `Intl` formatters are costly and asked for per row, so each is kept per language. */
const formatters = new Map<string, Intl.RelativeTimeFormat | Intl.DateTimeFormat>();

function cached<T extends Intl.RelativeTimeFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let formatter = formatters.get(key) as T | undefined;
  if (!formatter) formatters.set(key, (formatter = make()));
  return formatter;
}

function relativeFormatter(): Intl.RelativeTimeFormat {
  const lang = language();
  return cached(`rel:${lang}`, () => new Intl.RelativeTimeFormat(lang, { numeric: 'always', style: 'short' }));
}

function dateFormatter(withYear: boolean): Intl.DateTimeFormat {
  const lang = language();
  return cached(`date:${lang}:${withYear}`, () =>
    new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }),
  );
}

/** Parse an ISO timestamp, returning null for missing or unparsable input. */
export function parseTs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Format `iso` relative to `now`; an em dash for missing or unparsable input. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const ms = parseTs(iso);
  if (ms === null) return '—';

  const delta = now - ms;
  // Under a minute, and anything the clock says is still to come: a row saved
  // on another device with a slightly fast clock is not "in 3 seconds".
  if (delta < MINUTE) return t('hv.time.justNow');
  const format = relativeFormatter();
  if (delta < HOUR) return format.format(-Math.floor(delta / MINUTE), 'minute');
  if (delta < DAY) return format.format(-Math.floor(delta / HOUR), 'hour');
  if (delta < WEEK) return format.format(-Math.floor(delta / DAY), 'day');
  if (delta < YEAR) return format.format(-Math.floor(delta / WEEK), 'week');
  return format.format(-Math.floor(delta / YEAR), 'year');
}

/**
 * A `YYYY-MM-DD` date short, with the year only outside the current one. An em
 * dash when unset; anything that is not a real date is shown as stored.
 */
export function formatDate(date: string | null | undefined, now: number = Date.now()): string {
  if (!date) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  // From the parts: `Date.parse` reads a bare date as UTC, the previous day west of Greenwich.
  const parsed = new Date(Number(y), Number(mo) - 1, Number(d));
  // `Date` rolls 31 February forward into March.
  if (parsed.getMonth() !== Number(mo) - 1 || parsed.getDate() !== Number(d)) return date;
  return dateFormatter(Number(y) !== new Date(now).getFullYear()).format(parsed);
}

/** True when a due date has passed. Undated items are never overdue. */
export function isOverdue(dueDate: string | null | undefined, now: number = Date.now()): boolean {
  return !!dueDate && dueDate < toIsoDate(now);
}

/** True once a date has come round, today included: the inclusive twin of `isOverdue`. */
export function isDue(date: string | null | undefined, now: number = Date.now()): boolean {
  if (!date) return false;
  return date <= toIsoDate(now);
}

/** `YYYY-MM-DD` for a timestamp, in local time (matches how users read dates). */
export function toIsoDate(ms: number = Date.now()): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` offset by whole days from `from` — powers the quick-offset chips. */
export function addDays(days: number, from: number = Date.now()): string {
  return toIsoDate(from + days * DAY);
}

/** The quick offsets every forward-dating control offers: a week, a month, a quarter. */
export function quickDayOffsets(): readonly { days: number; label: string }[] {
  return [7, 30, 90].map((days) => ({ days, label: t('hv.date.offsetDays', { days }) }));
}

/** What a "+X days" field starts at when it is first opened. */
export const DEFAULT_CUSTOM_DAYS = 14;
