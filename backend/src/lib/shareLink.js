import crypto from 'node:crypto';

/**
 * Read-only share links for a collection.
 *
 * The seller has no account and never will — they are somebody the truck
 * visited once. Emailing a PDF attachment means the numbers they hold and the
 * numbers we hold drift apart the moment anything is corrected, so the link
 * points at the record rather than a copy of it.
 *
 * The token is signed, not stored: an HMAC over the collection id and an
 * expiry, keyed on JWT_SECRET. No table, no cleanup job, nothing to leak if
 * the row is read — and forging one needs the same secret that mints
 * sessions. The trade is that a link cannot be revoked one at a time before
 * it expires; voiding the collection closes it, and rotating JWT_SECRET
 * closes all of them at once. For a weighbridge slip that is the right side
 * of the trade.
 *
 * Ninety days: long enough that a link in an email still opens when a
 * disagreement surfaces a month later, short enough that it is not forever.
 */
const TTL_SECONDS = 90 * 24 * 60 * 60;

const digest = (id, expires) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`share:collection:${id}:${expires}`)
    .digest('base64url');

/** @returns {{ token: string, expiresAt: Date }} */
export function signShareToken(id) {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return {
    token: `${id}.${expires}.${digest(id, expires)}`,
    expiresAt: new Date(expires * 1000),
  };
}

/** @returns {string|null} the collection id, or null if the token is no good. */
export function readShareToken(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;

  const [id, expires, signature] = parts;
  const exp = Number(expires);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

  // Constant time: a fast rejection leaks how much of a guess was right.
  const a = Buffer.from(signature);
  const b = Buffer.from(digest(id, expires));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return id;
}
