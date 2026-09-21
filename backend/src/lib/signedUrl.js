import crypto from 'node:crypto';

/**
 * Short-lived signatures for photo URLs.
 *
 * An <img> tag cannot carry an Authorization header, so a private photograph
 * has to be reachable by URL alone for as long as the page is open. The three
 * obvious alternatives are worse: fetching every thumbnail in JavaScript and
 * making blob URLs loses browser caching and lazy loading; putting the JWT in
 * the query string writes a login token into server logs and browser history;
 * making the files public in Drive means anybody with the link has them
 * forever.
 *
 * So the URL carries an expiry and a signature over the photo id and that
 * expiry, keyed on JWT_SECRET. It grants one photo, for minutes, and forging
 * one needs the same secret that mints sessions.
 */
const TTL_SECONDS = 15 * 60;

const digest = (id, expires) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`photo:${id}:${expires}`)
    .digest('base64url');

export function signPhotoUrl(id) {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return `/api/collections/photos/${id}/content?e=${expires}&s=${digest(id, expires)}`;
}

export function verifyPhotoSignature(id, expires, signature) {
  const exp = Number(expires);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const expected = digest(id, expires);
  // Constant time: a fast rejection leaks how much of a guess was right.
  const a = Buffer.from(String(signature ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
