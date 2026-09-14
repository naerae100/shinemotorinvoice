import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { config } from '../config/env.js';
import { requireAuth, forgetUser } from '../middleware/auth.js';
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

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        tokenVersion: user.tokenVersion,
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

export default router;
