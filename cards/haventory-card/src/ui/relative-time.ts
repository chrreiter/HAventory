/**
 * Compact relative-time formatting for list rows ("2 hr. ago", "3 days ago").
 *
 * Backend `created_at` / `updated_at` are canonical ISO-8601 UTC with a trailing
 * `Z`, but event `ts` values carry microseconds and a `+00:00` offset instead.
 * `Date` parses both, so nothing here needs to special-case the shape.
 *
 * The spans and the dates come from `Intl`, keyed on the language in force —
 * that is a whole vocabulary the dictionaries do not have to carry, and it is
 * one every browser already ships. `style: 'short'` because these land in table
 * cells and list rows where a full "2 Stunden" would not fit, and
 * `numeric: 'always'` so every span reads the same way: "1 day ago", not
 * "yesterday" beside "2 days ago".
 */

import { language, t } from '../i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/**
 * `Intl` formatters are expensive to construct and are asked for once per
 * rendered row, so each is built once per language and kept. The language is
 * fixed for the lifetime of a page; the cache is keyed on it anyway, because a
 * test that switches languages inside one module registry would otherwise read
 * the first one it asked for.
 */
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function relativeFormatter(): Intl.RelativeTimeFormat {
  const lang = language();
  let formatter = relativeFormatters.get(lang);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(lang, { numeric: 'always', style: 'short' });
    relativeFormatters.set(lang, formatter);
  }
  return formatter;
}

function dateFormatter(withYear: boolean): Intl.DateTimeFormat {
  const key = `${language()}:${withYear ? 'y' : ''}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language(), {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

/** Parse an ISO timestamp, returning null for missing or unparsable input. */
export function parseTs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Format `iso` relative to `now` (defaults to the current time).
 * Returns an em dash for missing or unparsable timestamps so callers can drop
 * it straight into a cell.
 */
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
 * Format a `YYYY-MM-DD` date short: the day and the month within the current
 * year, the year as well outside it. Returns an em dash when unset, and the
 * raw string for anything that is not a date, so a stored value nobody can
 * parse is still shown rather than blanked.
 */
export function formatDate(date: string | null | undefined, now: number = Date.now()): string {
  if (!date) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  // Built from the parts rather than from `Date.parse(date)`, which reads a
  // bare `YYYY-MM-DD` as UTC midnight and lands on the previous day for anyone
  // west of Greenwich.
  const parsed = new Date(Number(y), Number(mo) - 1, Number(d));
  // A `Date` rolls an impossible date forward — month 13 becomes next January,
  // 31 February becomes March — so a stored value that says something no
  // calendar does would come back out as a real date. Show it as it is stored
  // instead, the same answer anything unparsable gets.
  if (parsed.getMonth() !== Number(mo) - 1 || parsed.getDate() !== Number(d)) return date;
  return dateFormatter(Number(y) !== new Date(now).getFullYear()).format(parsed);
}

/** True when a due date has passed. Undated items are never overdue. */
export function isOverdue(dueDate: string | null | undefined, now: number = Date.now()): boolean {
  if (!dueDate) return false;
  const today = toIsoDate(now);
  return dueDate < today;
}

/**
 * True once a date has come round, today included.
 *
 * The inclusive twin of `isOverdue`, and the rule `isReminderDue` already
 * follows: a date that names the day something is being asked for is asking on
 * that day, not from the day after. An inspection date names such a day.
 */
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

/**
 * The quick offsets every forward-dating control offers: a week, a month, a
 * quarter — the round numbers a household names a span by. Nothing shorter
 * than a week: a single day is less than most borrowings ever run, and less
 * than any inspection interval worth recording.
 *
 * Shared so the check-out popover and the editor's inspection field cannot
 * drift into offering different jumps for the same gesture. A function because
 * the labels are copy, and copy is not known when this module is evaluated.
 */
export function quickDayOffsets(): readonly { days: number; label: string }[] {
  return [7, 30, 90].map((days) => ({ days, label: t('hv.date.offsetDays', { days }) }));
}

/** What a "+X days" field starts at when it is first opened. */
export const DEFAULT_CUSTOM_DAYS = 14;
