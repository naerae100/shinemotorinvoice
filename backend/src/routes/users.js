import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

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
  role: z.enum(['ADMIN', 'STAFF']).default('STAFF'),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(['ADMIN', 'STAFF']).optional(),
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
        _count: { select: { docketsCreated: true, invoicesCreated: true } },
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
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      },
      select: SAFE_FIELDS,
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

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 10) },
    });
    res.json({ changed: true });
  })
);

export default router;
