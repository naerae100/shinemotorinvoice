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
  // A session cached for this person may have just been revoked with them.
  for (const [sid, hit] of sessionCache) {
    if (hit.session?.userId === userId) sessionCache.delete(sid);
  }
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
 * The session a token belongs to.
 *
 * Cached on the same terms as the user above, and for the same reason: this
 * is a database read on the hot path of every request. The cost is that a
 * device signed out elsewhere can keep working for up to CACHE_TTL_MS on an
 * instance that has not seen the revocation — thirty seconds, against a
 * fourteen-day token. Revocation through this process is immediate, because
 * revoking evicts the entry.
 */
const sessionCache = new Map();

export function forgetSession(sessionId) {
  sessionCache.delete(sessionId);
}

async function currentSession(id) {
  const hit = sessionCache.get(id);
  if (hit && Date.now() < hit.expires) return hit.session;

  const session = await prisma.session.findUnique({
    where: { id },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true, lastSeenAt: true },
  });
  sessionCache.set(id, { session, expires: Date.now() + CACHE_TTL_MS });
  return session;
}

/**
 * How stale "last used" is allowed to be.
 *
 * Writing it on every request would put a database write in front of every
 * single API call to save a column nobody reads to the second. Five minutes
 * is close enough to answer "is this device still in use?" and costs at most
 * one write per device per five minutes.
 */
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

function touchSession(session) {
  if (Date.now() - new Date(session.lastSeenAt).getTime() < LAST_SEEN_INTERVAL_MS) return;

  const now = new Date();
  // Not awaited: the request does not depend on it, and a slow write here
  // would slow down every call the yard makes.
  prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: now } })
    .then(() => {
      const hit = sessionCache.get(session.id);
      if (hit?.session) hit.session.lastSeenAt = now;
    })
    .catch(() => {
      // A missed timestamp is not worth failing a request over.
    });
}

/**
 * Verifies the JWT from the Authorization header and attaches
 * { id, role, name, email } to req.user. Rejects if missing, invalid, revoked,
 * or belonging to a deactivated account.
 */

/**
 * What a contractor is allowed to reach.
 *
 * This codebase's default is the opposite of what this role needs. Everything
 * behind requireAuth is readable by any signed-in user — suppliers.js,
 * consignees.js and reports.js carry no role check at all — and requireRole is
 * used only to stop a staff member voiding or configuring things. A contractor
 * added to that model would get every supplier's bank details, every export
 * invoice and the whole dashboard on their first request.
 *
 * So this is an allowlist, not a denylist, and it lives inside requireAuth
 * rather than as a mounted middleware for two reasons:
 *
 *   The role is the one loaded from the database a few lines above, not the
 *   one in the token. A gate that trusted the token would let someone demoted
 *   to contractor keep their old access until it expired.
 *
 *   Every protected route already calls requireAuth. A route added next month
 *   is therefore closed to contractors by default, and someone has to come
 *   here and think about it to open one. A per-route check would have the
 *   opposite failure mode, silently.
 *
 * The price list is deliberately absent: collections offer their own grade
 * list, which returns descriptions without what the yard pays for them.
 */
const CONTRACTOR_ALLOWED = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/collections(\/|\?|$)/,
  /^\/api\/local-suppliers(\/|\?|$)/,
];

/** True if a contractor may make this request at all. */
export function contractorMayAccess(originalUrl) {
  const path = String(originalUrl || '').split('?')[0];
  return CONTRACTOR_ALLOWED.some((re) => re.test(path));
}

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

    /**
     * Every token must name a session.
     *
     * Tokens minted before this existed carry no `sid`, and they are refused
     * rather than waved through. A device list that quietly omits the live
     * tokens it cannot see is worse than useless — it is reassuring and
     * wrong. The cost is that everyone signs in once after this ships.
     */
    if (!payload.sid) {
      return res.status(401).json({ error: 'Please sign in again' });
    }

    const session = await currentSession(payload.sid);
    if (!session || session.userId !== user.id) {
      return res.status(401).json({ error: 'This session has been signed out' });
    }
    if (session.revokedAt) {
      return res.status(401).json({ error: 'This device was signed out' });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      return res.status(401).json({ error: 'This session has expired' });
    }

    touchSession(session);
    // Trust the stored role over the token's copy, so a demotion takes effect
    // without waiting for the token to expire.
    req.user = { ...payload, role: user.role };

    // Deny by default for contractors — see CONTRACTOR_ALLOWED above.
    if (user.role === 'CONTRACTOR' && !contractorMayAccess(req.originalUrl)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

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
        // The same device, not a new one. Without this a renewal would
        // orphan the session row and the next request would be refused.
        sid: payload.sid,
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
