import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';

const router = Router();

const consigneeSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const consignees = await prisma.consignee.findMany({
      where: search ? { name: contains(String(search)) } : {},
      orderBy: { name: 'asc' },
    });
    res.json({ consignees });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const consignee = await prisma.consignee.findUnique({ where: { id: req.params.id } });
    if (!consignee) return res.status(404).json({ error: 'Consignee not found' });
    res.json({ consignee });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = consigneeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const consignee = await prisma.consignee.create({ data: parsed.data });
    res.status(201).json({ consignee });
  })
);

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = consigneeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const existing = await prisma.consignee.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Consignee not found' });

    const consignee = await prisma.consignee.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ consignee });
  })
);

export default router;
