import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { sendCsv, money, isoDate } from '../lib/csv.js';

const router = Router();

const materialSchema = z.object({
  code: z.number().int().optional().nullable(),
  description: z.string().min(1),
  category: z.string().optional().nullable(),
  unit: z.enum(['KG', 'TONNE', 'UNIT']).default('KG'),
  currentPrice: z.number().nonnegative(),
  active: z.boolean().optional(),
});

// GET /api/materials — everyone can view (needed for docket entry)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { includeInactive } = req.query;
    const materials = await prisma.material.findMany({
      where: includeInactive === 'true' ? {} : { active: true },
      orderBy: [{ code: 'asc' }, { description: 'asc' }],
    });
    res.json({ materials });
  })
);

// GET /api/materials/export — the price list as a spreadsheet
router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const materials = await prisma.material.findMany({
      where: req.query.includeInactive === 'true' ? {} : { active: true },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
    sendCsv(res, 'shine-price-list', [
      { label: 'Code', get: (m) => m.code ?? '' },
      { label: 'Material', get: (m) => m.description },
      { label: 'Category', get: (m) => m.category ?? '' },
      { label: 'Unit', get: (m) => m.unit },
      { label: 'Rate (AUD)', get: (m) => money(m.currentPrice) },
      { label: 'Active', get: (m) => (m.active ? 'Yes' : 'Retired') },
      { label: 'Rate updated', get: (m) => isoDate(m.updatedAt) },
    ], materials);
  })
);

// POST /api/materials — admin only, manual price entry
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const parsed = materialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const material = await prisma.material.create({ data: parsed.data });
    res.status(201).json({ material });
  })
);

// PATCH /api/materials/:id — admin only, this is how prices get updated as market moves
router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const parsed = materialSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const existing = await prisma.material.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ material });
  })
);

// DELETE /api/materials/:id — soft delete via active flag, never hard-delete
// (dockets reference materials; deleting would break historical records)
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.material.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    res.json({ material });
  })
);

export default router;
