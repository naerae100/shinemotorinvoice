// Prisma's `mode: 'insensitive'` is a Postgres feature — SQLite rejects it outright.
// SQLite's LIKE is already case-insensitive for ASCII, so the flag is only needed
// once this moves to Postgres, at which point searches would otherwise silently
// become case-sensitive. Deriving it from DATABASE_URL keeps both working.
const isPostgres = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || '');

/** Builds a case-insensitive `contains` filter valid for the active provider. */
export function contains(value) {
  return isPostgres ? { contains: value, mode: 'insensitive' } : { contains: value };
}
