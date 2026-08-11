/**
 * Compact relative-time formatting for list rows ("2 h ago", "3 d ago").
 *
 * Backend `created_at` / `updated_at` are canonical ISO-8601 UTC with a trailing
 * `Z`, but event `ts` values carry microseconds and a `+00:00` offset instead.
 * `Date` parses both, so nothing here needs to special-case the shape.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

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
  if (delta < 0) return 'just now';
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  if (delta < WEEK) return `${Math.floor(delta / DAY)} d ago`;
  if (delta < YEAR) return `${Math.floor(delta / WEEK)} w ago`;
  return `${Math.floor(delta / YEAR)} y ago`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a `YYYY-MM-DD` date the way the mocks do: "Jul 31" within the current
 * year, "Jul 31, 2026" otherwise. Returns an em dash when unset.
 */
export function formatDate(date: string | null | undefined, now: number = Date.now()): string {
  if (!date) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return date;
  const day = String(Number(d));
  return Number(y) === new Date(now).getFullYear() ? `${month} ${day}` : `${month} ${day}, ${y}`;
}

/** True when a due date has passed. Undated items are never overdue. */
export function isOverdue(dueDate: string | null | undefined, now: number = Date.now()): boolean {
  if (!dueDate) return false;
  const today = toIsoDate(now);
  return dueDate < today;
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
 * drift into offering different jumps for the same gesture.
 */
export const QUICK_DAY_OFFSETS: readonly { days: number; label: string }[] = [
  { days: 7, label: '+7 days' },
  { days: 30, label: '+30 days' },
  { days: 90, label: '+90 days' },
];

/** What a "+X days" field starts at when it is first opened. */
export const DEFAULT_CUSTOM_DAYS = 14;
