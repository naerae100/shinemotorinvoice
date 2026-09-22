import crypto from 'node:crypto';

/**
 * CSRF protection for an OAuth round trip.
 *
 * A provider hands the browser back to the callback with a plain redirect and
 * no session, so the callback cannot sit behind requireAuth. Without a state
 * parameter that leaves an unauthenticated endpoint that writes the company's
 * integration credentials — and anyone who completes the consent flow against
 * their *own* organisation can post the resulting code here and quietly become
 * the account this system syncs to.
 *
 * So the state carries the proof instead: an HMAC over a scope and an expiry,
 * keyed on JWT_SECRET. Only somebody who was an admin a moment ago can start a
 * flow this server will finish.
 *
 * Thirty minutes, because these are one-time setups done alongside configuring
 * a provider's console — registering a redirect URI, publishing a consent
 * screen — and ten minutes ran out mid-task more than once.
 */
const TTL_SECONDS = 30 * 60;

const mac = (scope, expires) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`${scope}:${expires}`)
    .digest('base64url');

export function signState(scope) {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return `${expires}.${mac(scope, expires)}`;
}

export function verifyState(scope, state) {
  const [expires, signature] = String(state ?? '').split('.');
  if (!expires || !signature) return false;
  if (!/^\d+$/.test(expires)) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;

  // Constant time: a fast rejection leaks how much of a guess was right.
  const a = Buffer.from(signature);
  const b = Buffer.from(mac(scope, expires));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
