import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { config } from '../config/env.js';
import { requireAuth, forgetUser, forgetSession } from '../middleware/auth.js';
import { describeDevice } from '../lib/device.js';
import { sessionTtlMs, clientIp } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email or password format' });
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      // Same error for "not found" and "wrong password" — don't leak which emails exist
      await audit({
        req,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: email,
        label: email,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await audit({
        req,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        label: user.email,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // One row per sign-in, so this device can later be seen and ended on its
    // own. Created before the token because the token has to carry its id.
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        userAgent: req.headers['user-agent']?.slice(0, 512) || null,
        ip: clientIp(req),
        expiresAt: new Date(Date.now() + sessionTtlMs()),
      },
      select: { id: true },
    });

    // Expired rows are dead weight and nobody looks at them. Sign-in is the
    // natural moment to clear them: it is infrequent, and it is already
    // writing to this table.
    prisma.session
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch(() => {});

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        tokenVersion: user.tokenVersion,
        sid: session.id,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    await audit({
      req,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      label: user.email,
    });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })
);

/**
 * POST /api/auth/sign-out-everywhere — invalidate every token for this account.
 *
 * The only way to withdraw a JWT already in the wild: raise the version every
 * existing token was signed with. Use it when a device is lost.
 */
router.post(
  '/sign-out-everywhere',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true, email: true, tokenVersion: true },
    });
    // tokenVersion already kills every token. Marking the rows too keeps the
    // device list honest — otherwise it would go on showing sessions that
    // cannot be used, and the one thing this screen has to be is truthful.
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: user.id },
    });
    forgetUser(user.id); // take effect on this instance immediately
    await audit({
      req,
      action: 'SIGN_OUT_EVERYWHERE',
      entity: 'User',
      entityId: user.id,
      label: user.email,
      after: { tokenVersion: user.tokenVersion },
    });
    res.json({ signedOut: true });
  })
);

// GET /api/auth/me — used by frontend on load to check session validity
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Account no longer active' });
    }
    res.json({ user });
  })
);

/**
 * GET /api/auth/sessions — the devices signed in as me.
 *
 * Everyone can see their own, not just admins. Somebody noticing a sign-in
 * they do not recognise is the fastest detection this system has, and it
 * only works if they can see the list without asking anyone.
 */
router.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ sessions: await listSessions(req.user.id, req.user.sid) });
  })
);

/** DELETE /api/auth/sessions/:id — end one of my own devices. */
router.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, revokedAt: true, userAgent: true },
    });
    // Same answer for "not yours" as for "does not exist": a different one
    // would confirm that a given session id belongs to somebody.
    if (!session || session.userId !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    await revokeSession(req, session);
    res.json({ signedOut: true });
  })
);

export async function listSessions(userId, currentSid) {
  const rows = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      ip: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    device: describeDevice(r.userAgent),
    ip: r.ip,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    expiresAt: r.expiresAt,
    // So the UI never offers "sign out" on the device you are reading it on
    // without saying what that will do.
    current: r.id === currentSid,
  }));
}

export async function revokeSession(req, session) {
  if (!session.revokedAt) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedById: req.user.id },
    });
  }
  forgetSession(session.id); // immediate on this instance
  await audit({
    req,
    action: 'SESSION_REVOKED',
    entity: 'Session',
    entityId: session.id,
    label: describeDevice(session.userAgent),
    before: { userId: session.userId },
  });
}

export default router;
