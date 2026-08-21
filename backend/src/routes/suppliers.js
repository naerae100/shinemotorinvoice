import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';

const router = Router();

const supplierSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  suburb: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  saleType: z.enum(['PRIVATE', 'BUSINESS']).default('PRIVATE'),
  abn: z.string().optional().nullable(),
  licenceNo: z.string().optional().nullable(),
});

// GET /api/suppliers?search=... — for the autocomplete when starting a new docket
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const suppliers = await prisma.supplier.findMany({
      where: search
        ? {
            OR: [
              { name: contains(String(search)) },
              { phone: contains(String(search)) },
              { abn: contains(String(search)) },
            ],
          }
        : {},
      orderBy: { name: 'asc' },
      take: 50,
    });
    res.json({ suppliers });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ supplier });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = supplierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const supplier = await prisma.supplier.create({ data: parsed.data });
    res.status(201).json({ supplier });
  })
);

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = supplierSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const existing = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });

    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ supplier });
  })
);

export default router;
