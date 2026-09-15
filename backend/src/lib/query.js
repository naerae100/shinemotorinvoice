import { boundaryInstant } from './timezone.js';

/**
 * Query-string values arrive as arbitrary strings. Passing `Number('abc')` (NaN)
 * or `new Date('nonsense')` (Invalid Date) straight into a Prisma filter makes it
 * throw, so a mistyped URL becomes an error response instead of simply being
 * ignored. These helpers drop anything that isn't usable.
 */

export function numberFilter(min, max) {
  const lo = Number(min);
  const hi = Number(max);
  const filter = {
    ...(min !== undefined && min !== '' && Number.isFinite(lo) ? { gte: lo } : {}),
    ...(max !== undefined && max !== '' && Number.isFinite(hi) ? { lte: hi } : {}),
  };
  return Object.keys(filter).length ? filter : undefined;
}

export function dateFilter(from, to) {
  // Bare dates are business dates, resolved against the yard's timezone rather
  // than the server's. `new Date('2026-09-16')` parses as UTC midnight, which on
  // a UTC host put everything recorded before 10am Sydney into the day before —
  // see src/lib/timezone.js.
  const start = boundaryInstant(from, 'start');
  const end = boundaryInstant(to, 'end');

  const filter = {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
  return Object.keys(filter).length ? filter : undefined;
}

/** Page/pageSize that can't go negative or ask for the whole table. */
export function pagination(page, pageSize, { maxSize = 100, defaultSize = 25 } = {}) {
  const take = Math.min(Math.max(Number(pageSize) || defaultSize, 1), maxSize);
  const current = Math.max(Number(page) || 1, 1);
  return { take, skip: (current - 1) * take, page: current };
}
