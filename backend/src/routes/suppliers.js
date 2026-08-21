import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { sendCsv, money, isoDate } from '../lib/csv.js';

const router = Router();

const supplierSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  suburb: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  // Blank is allowed — plenty of walk-in sellers have no email at all — but a
  // value that is present must actually look like one.
  email: z.union([z.string().email(), z.literal('')]).optional().nullable(),
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
              { email: contains(String(search)) },
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

// Before '/:id', or Express reads "export" as a supplier id.
router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const suppliers = await prisma.supplier.findMany({
      where: search
        ? {
            OR: [
              { name: contains(String(search)) },
              { phone: contains(String(search)) },
              { email: contains(String(search)) },
              { abn: contains(String(search)) },
            ],
          }
        : {},
      orderBy: { name: 'asc' },
      // Trading history is the reason to export a client list at all — a bare
      // address book is far less useful than one that says what each is worth.
      include: {
        dockets: {
          where: { status: 'ACTIVE' },
          select: { total: true, date: true },
        },
      },
      take: 20000,
    });

    const summarise = (s) => {
      const totals = s.dockets.reduce((a, d) => a + Number(d.total), 0);
      const dates = s.dockets.map((d) => new Date(d.date)).sort((a, b) => a - b);
      return { totals, first: dates[0], last: dates[dates.length - 1] };
    };

    sendCsv(res, 'shine-clients', [
      { label: 'Name', get: (s) => s.name },
      { label: 'Type', get: (s) => (s.saleType === 'BUSINESS' ? 'Business' : 'Private') },
      { label: 'Phone', get: (s) => s.phone ?? '' },
      { label: 'Email', get: (s) => s.email ?? '' },
      { label: 'Address', get: (s) => s.address ?? '' },
      { label: 'Suburb', get: (s) => s.suburb ?? '' },
      { label: 'Postcode', get: (s) => s.postcode ?? '' },
      { label: 'ABN', get: (s) => s.abn ?? '' },
      { label: 'Driver licence', get: (s) => s.licenceNo ?? '' },
      { label: 'Dockets', get: (s) => s.dockets.length },
      { label: 'Lifetime value (AUD)', get: (s) => money(summarise(s).totals) },
      { label: 'First dealt', get: (s) => isoDate(summarise(s).first) },
      { label: 'Last dealt', get: (s) => isoDate(summarise(s).last) },
      { label: 'Added', get: (s) => isoDate(s.createdAt) },
    ], suppliers);
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
