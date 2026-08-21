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
  const start = from ? new Date(String(from)) : null;
  const end = to ? new Date(String(to)) : null;
  const validStart = start && !Number.isNaN(start.getTime());
  const validEnd = end && !Number.isNaN(end.getTime());
  // A bare date means midnight; take the whole of the closing day.
  if (validEnd && !String(to).includes('T')) end.setHours(23, 59, 59, 999);

  const filter = {
    ...(validStart ? { gte: start } : {}),
    ...(validEnd ? { lte: end } : {}),
  };
  return Object.keys(filter).length ? filter : undefined;
}

/** Page/pageSize that can't go negative or ask for the whole table. */
export function pagination(page, pageSize, { maxSize = 100, defaultSize = 25 } = {}) {
  const take = Math.min(Math.max(Number(pageSize) || defaultSize, 1), maxSize);
  const current = Math.max(Number(page) || 1, 1);
  return { take, skip: (current - 1) * take, page: current };
}
