import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { config } from '../config/env.js';

/**
 * A JWT is valid until it expires and cannot be withdrawn — so a tablet lost on
 * the yard keeps working for the rest of the token's life. Every token carries
 * the `tokenVersion` it was minted with; bumping the user's version (password
 * change, or "sign out everywhere") makes every existing token fail this check.
 *
 * That check needs the user's current version, which is a database read on every
 * request. At a few hundred requests an hour a short cache makes that free
 * without meaningfully weakening the control: the worst case is that a revoked
 * token keeps working for CACHE_TTL_MS longer on an instance that has not seen
 * the change. Revocation on *this* instance is immediate, because bumping the
 * version evicts the entry.
 */
const CACHE_TTL_MS = 30_000;
const userCache = new Map();

export function forgetUser(userId) {
  userCache.delete(userId);
}

async function currentUser(id) {
  const hit = userCache.get(id);
  if (hit && Date.now() < hit.expires) return hit.user;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, active: true, role: true, tokenVersion: true },
  });
  userCache.set(id, { user, expires: Date.now() + CACHE_TTL_MS });
  return user;
}

/**
 * Verifies the JWT from the Authorization header and attaches
 * { id, role, name, email } to req.user. Rejects if missing, invalid, revoked,
 * or belonging to a deactivated account.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice('Bearer '.length);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await currentUser(payload.id);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'This account is no longer active' });
    }
    // Tokens minted before tokenVersion existed carry no version; treat them as 0
    // so an existing session is not broken by the upgrade itself.
    if ((payload.tokenVersion ?? 0) !== user.tokenVersion) {
      return res.status(401).json({ error: 'This session has been signed out' });
    }
    // Trust the stored role over the token's copy, so a demotion takes effect
    // without waiting for the token to expire.
    req.user = { ...payload, role: user.role };
    issueSlidingToken(req, res, payload, user);
    next();
  } catch (err) {
    console.error('Auth check failed:', err.message);
    return res.status(503).json({ error: 'Could not verify session' });
  }
}

/**
 * Keep an in-use session alive, so the yard tablet is not logged out mid-shift.
 *
 * The tablet at the weighbridge is a dedicated device that one person picks up
 * and uses all day. A fixed expiry means it stops working at some point in the
 * afternoon and somebody types a password with a truck waiting — so the session
 * slides instead: once a token is past the halfway point of its life, the next
 * authenticated request mints a fresh one and returns it in a response header,
 * and the client swaps it in.
 *
 * Used regularly, it never expires. Left in a drawer for the full window, it
 * does — which is the property that matters, because this is a shared device in
 * a yard and a session that never ends is a key left in the door.
 *
 * Renewing is deliberately not free of the revocation check: the new token
 * carries the CURRENT tokenVersion, so "sign out everywhere" still ends it, and
 * a token already rejected above never reaches this function.
 */
function issueSlidingToken(req, res, payload, user) {
  if (!payload.exp || !payload.iat) return;

  const now = Math.floor(Date.now() / 1000);
  const life = payload.exp - payload.iat;
  const elapsed = now - payload.iat;
  if (elapsed < life / 2) return; // still fresh; nothing to do

  try {
    const fresh = jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        name: payload.name,
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      process.env.JWT_SECRET,
      { expiresIn: config.jwtExpiresIn }
    );
    res.setHeader('X-Refreshed-Token', fresh);
    // Without this a browser cannot read the header at all, and the session
    // would expire while the server believed it had renewed it.
    res.setHeader('Access-Control-Expose-Headers', 'X-Refreshed-Token');
  } catch (err) {
    // A failed renewal is not a failed request — the existing token is still
    // valid, and the operator should not be interrupted for this.
    console.error('Could not renew session token:', err.message);
  }
}

/**
 * Restricts a route to specific roles. Use after requireAuth.
 * e.g. requireRole('ADMIN')
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
