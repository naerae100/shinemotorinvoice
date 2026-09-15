/**
 * Dates belong to the yard, not to the server.
 *
 * The API runs on Vercel, where the process timezone is UTC. Every date in this
 * system is a business date — the day a load was weighed, the day an invoice was
 * raised, the BAS quarter it falls in — and those are Sydney days. Reading them
 * as UTC days shifts everything by ten or eleven hours, which is not a rounding
 * error but a whole-day error for anything recorded before 10am:
 *
 *   docket written 16 Sep 09:10 Sydney  ==  15 Sep 23:10 UTC
 *
 * so it vanished from "today" and appeared under "yesterday". The same shift put
 * a load weighed on the morning of 1 July into the previous financial year.
 *
 * `new Date('2026-09-16')` is the specific trap: a date-only ISO string is
 * defined to parse as UTC midnight, while `new Date(2026, 8, 16)` is local. The
 * helpers here take a plain calendar date and resolve it against the business
 * timezone instead of either.
 */

export const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Australia/Sydney';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The wall-clock calendar/time in the business timezone for a given instant. */
export function zonedParts(date) {
  const out = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) {
    if (type !== 'literal') out[type] = Number(value);
  }
  // Some engines render midnight as hour 24 under hour12:false.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** How far the business timezone is ahead of UTC at this instant, in ms. */
function offsetMs(date) {
  const p = zonedParts(date);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Strip sub-second noise so the comparison is exact.
  return asIfUTC - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which a given wall-clock time occurs in the business timezone.
 *
 * Two passes: the first offset is looked up at roughly the right moment, the
 * second corrects it when that guess landed on the wrong side of a daylight
 * saving change — which in Sydney happens at 2am on a Sunday in April and
 * October, and would otherwise move a whole day's takings by an hour.
 */
export function zonedInstant(year, month, day, h = 0, m = 0, s = 0, ms = 0) {
  const wall = Date.UTC(year, month - 1, day, h, m, s, ms);
  const firstPass = new Date(wall - offsetMs(new Date(wall)));
  return new Date(wall - offsetMs(firstPass));
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Turn a filter bound into a real instant.
 *
 * A bare "2026-09-16" is a business date and becomes either the first or the
 * last millisecond of that day in the yard's timezone. Anything carrying a time
 * is already unambiguous and is passed through untouched.
 */
export function boundaryInstant(value, edge = 'start') {
  if (value == null || value === '') return null;
  const raw = String(value);
  const m = DATE_ONLY.exec(raw);
  if (m) {
    const [, y, mo, d] = m.map(Number);
    return edge === 'end'
      ? zonedInstant(y, mo, d, 23, 59, 59, 999)
      : zonedInstant(y, mo, d, 0, 0, 0, 0);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const pad = (n) => String(n).padStart(2, '0');

/** "2026-09-16" for the business day an instant falls in. */
export function zonedDayKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2026-09" for the business month. */
export function zonedMonthKey(date) {
  const p = zonedParts(date);
  return `${p.year}-${pad(p.month)}`;
}

/** The Monday of the business week an instant falls in, as a day key. */
export function zonedWeekKey(date) {
  const p = zonedParts(date);
  // Midday avoids any chance of a DST shift moving the date while we walk back.
  const noon = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
  noon.setUTCDate(noon.getUTCDate() - ((noon.getUTCDay() + 6) % 7));
  return `${noon.getUTCFullYear()}-${pad(noon.getUTCMonth() + 1)}-${pad(noon.getUTCDate())}`;
}
