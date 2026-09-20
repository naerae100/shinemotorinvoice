import { z } from 'zod';

/**
 * Last write wins, silently, was the old behaviour.
 *
 * Two people open docket #412 — one on the office machine, one on the yard
 * tablet. The first corrects a weight and saves. The second, still looking at
 * the figures as they were, changes the vehicle rego and saves. The weight
 * correction is gone, nobody is told, and the only evidence is an audit event
 * neither of them will read.
 *
 * The fix costs nothing and needs no migration: every document already carries
 * `updatedAt`, maintained by Prisma. A client that loaded a record sends the
 * `updatedAt` it saw; the update is scoped to that exact value, so if the row
 * has moved on, zero rows match and Prisma raises P2025. That is turned into a
 * 409 telling the operator to reload — which is the only honest answer.
 *
 * `expectedUpdatedAt` is OPTIONAL on purpose. A client that does not send it
 * gets the old behaviour rather than a wall of 400s, so this could go in
 * without breaking anything mid-shift; the screens that edit documents all send
 * it. Millisecond collisions are not a concern — two saves inside the same
 * millisecond on the same row would need the same connection.
 */
export const versionSchema = {
  expectedUpdatedAt: z.string().datetime().optional(),
};

/**
 * The `where` clause for a guarded update: the id, plus the version the caller
 * believed it was editing.
 */
export function guardedWhere(id, expectedUpdatedAt) {
  return expectedUpdatedAt
    ? { id, updatedAt: new Date(expectedUpdatedAt) }
    : { id };
}

/** True when a Prisma error is "nothing matched", i.e. somebody got there first. */
export const isStaleWrite = (err) => err?.code === 'P2025';

export const STALE_WRITE_MESSAGE =
  'Somebody else saved this record while you had it open, so your changes were not applied. ' +
  'Reload to see theirs, then make your change again.';
