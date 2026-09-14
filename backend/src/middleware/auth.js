import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';

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
    next();
  } catch (err) {
    console.error('Auth check failed:', err.message);
    return res.status(503).json({ error: 'Could not verify session' });
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
