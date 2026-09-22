import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { listSessions, revokeSession } from './auth.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { forgetUser } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();

const SAFE_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
};

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // CONTRACTOR is the field role: it reaches collections and local suppliers
  // and nothing else at all — see CONTRACTOR_ALLOWED in middleware/auth.js.
  role: z.enum(['ADMIN', 'STAFF', 'CONTRACTOR']).default('STAFF'),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['ADMIN', 'STAFF', 'CONTRACTOR']).optional(),
  active: z.boolean().optional(),
});

router.get(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      select: {
        ...SAFE_FIELDS,
        // Collections count too. A contractor writes nothing else, so
        // without this every contractor showed "0 documents" no matter how
        // much work they had done.
        _count: {
          select: { docketsCreated: true, invoicesCreated: true, collectionsCreated: true },
        },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    res.json({ users });
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { name, email, password, role } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const user = await prisma.user.create({
      data: { name, email, role, passwordHash: await bcrypt.hash(password, 10) },
      select: SAFE_FIELDS,
    });
    res.status(201).json({ user });
  })
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const data = parsed.data;

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true, active: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Guard against locking everyone out: the last active admin cannot be
    // demoted or deactivated, including by themselves.
    const losingAdmin =
      target.role === 'ADMIN' &&
      ((data.role && data.role !== 'ADMIN') || data.active === false);
    if (losingAdmin) {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (activeAdmins <= 1) {
        return res
          .status(409)
          .json({ error: 'This is the last active administrator — promote someone else first' });
      }
    }

    const { password, ...rest } = data;
    // A password reset or a deactivation must take effect now, not whenever the
    // existing token happens to expire.
    const endsSessions = Boolean(password) || rest.active === false || rest.role !== undefined;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
        ...(endsSessions ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: SAFE_FIELDS,
    });
    if (endsSessions) forgetUser(user.id);
    await audit({
      req,
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      label: user.email,
      after: {
        ...(password ? { passwordChanged: true } : {}),
        ...(rest.role !== undefined ? { role: rest.role } : {}),
        ...(rest.active !== undefined ? { active: rest.active } : {}),
      },
    });
    res.json({ user });
  })
);

// Users are never deleted — dockets and invoices reference them for the audit
// trail. Deactivating blocks login while keeping "created by" intact.
router.post(
  '/:id/deactivate',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (target.role === 'ADMIN') {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (activeAdmins <= 1) {
        return res
          .status(409)
          .json({ error: 'This is the last active administrator — promote someone else first' });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { active: false },
      select: SAFE_FIELDS,
    });
    res.json({ user });
  })
);

// Any signed-in user can change their own password.
router.post(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Changing a password signs out every other device holding an old token.
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        passwordHash: await bcrypt.hash(parsed.data.newPassword, 10),
        tokenVersion: { increment: 1 },
      },
      select: { id: true, name: true, email: true, role: true, tokenVersion: true },
    });
    forgetUser(updated.id);

    // Every other device is now signed out, so their rows should say so —
    // and this device's row must survive, because the token handed back
    // below still names it.
    await prisma.session.updateMany({
      where: { userId: updated.id, revokedAt: null, id: { not: req.user.sid } },
      data: { revokedAt: new Date(), revokedById: updated.id },
    });

    await audit({
      req,
      action: 'PASSWORD_CHANGE',
      entity: 'User',
      entityId: updated.id,
      label: updated.email,
    });

    // The caller's own token was just invalidated along with the rest, so hand
    // back a fresh one — otherwise changing your password logs you out of the
    // device you changed it on.
    const token = jwt.sign(
      {
        id: updated.id,
        role: updated.role,
        name: updated.name,
        email: updated.email,
        tokenVersion: updated.tokenVersion,
        // Still this device. Without the session id the replacement token is
        // refused on its first use, and changing your password would sign you
        // out of the device you changed it on — the exact thing the fresh
        // token exists to prevent.
        sid: req.user.sid,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    res.json({ changed: true, token });
  })
);

/**
 * GET /api/users/:id/sessions — which devices this person is signed in on.
 *
 * Admin only, and the reason it exists: a contractor rings up to say the
 * phone is gone. Without this the only lever is "sign out everywhere" on
 * their account, which is fine, or a password change, which is not — and
 * neither tells anybody what was actually signed in.
 */
router.get(
  '/:id/sessions',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: 'Not found' });

    // An admin looking at somebody else's list has no "this device" in it;
    // looking at their own, they should.
    res.json({ sessions: await listSessions(user.id, req.user.sid) });
  })
);

/** DELETE /api/users/:id/sessions/:sessionId — end one device. */
router.delete(
  '/:id/sessions/:sessionId',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      select: { id: true, userId: true, revokedAt: true, userAgent: true },
    });
    if (!session || session.userId !== req.params.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    await revokeSession(req, session);
    res.json({ signedOut: true });
  })
);

export default router;
