import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { sendCsv, money, isoDate } from '../lib/csv.js';

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
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const consignees = await prisma.consignee.findMany({
      orderBy: { name: 'asc' },
      include: { invoices: { where: { status: 'ACTIVE' }, select: { totalAud: true, date: true } } },
      take: 20000,
    });
    const total = (c) => c.invoices.reduce((a, i) => a + Number(i.totalAud), 0);
    const last = (c) =>
      c.invoices.length
        ? new Date(Math.max(...c.invoices.map((i) => new Date(i.date))))
        : null;

    sendCsv(res, 'shine-buyers', [
      { label: 'Name', get: (c) => c.name },
      { label: 'Country', get: (c) => c.country ?? '' },
      { label: 'Email', get: (c) => c.email ?? '' },
      { label: 'Phone', get: (c) => c.phone ?? '' },
      { label: 'Address', get: (c) => c.address ?? '' },
      { label: 'Invoices', get: (c) => c.invoices.length },
      { label: 'Lifetime value (AUD)', get: (c) => money(total(c)) },
      { label: 'Last sale', get: (c) => isoDate(last(c)) },
    ], consignees);
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
