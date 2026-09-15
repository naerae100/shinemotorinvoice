import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { sendCsv, money, isoDate } from '../lib/csv.js';

const router = Router();

const optionalEmail = z.string().email().optional().nullable().or(z.literal(''));

const consigneeSchema = z.object({
  name: z.string().min(1),
  // The single-blob address kept for the imported archive; the parts below are
  // what gets filled in from here on.
  address: z.string().optional().nullable(),
  street: z.string().optional().nullable(),
  suburb: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  email: optionalEmail,
  phone: z.string().optional().nullable(),
  country: z.string().optional().nullable(),

  // The buyer this billing entity belongs to, where one buyer bills through
  // several — PT Daiki through Indonesia, Thailand and Malaysia.
  groupName: z.string().optional().nullable(),
  abn: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  extraEmails: z.array(z.string().email()).optional(),
  extraPhones: z.array(z.string()).optional(),
  defaultCurrency: z.enum(['AUD', 'USD']).optional().nullable(),
  defaultShippingTerm: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const consignees = await prisma.consignee.findMany({
      where: search
        ? {
            OR: [
              { name: contains(String(search)) },
              { groupName: contains(String(search)) },
            ],
          }
        : {},
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
      include: {
        invoices: {
          where: { status: 'ACTIVE' },
          select: { total: true, date: true, currency: true },
        },
      },
      take: 20000,
    });
    // Lifetime value has to be reported per currency: a buyer invoiced in both
    // AUD and USD has no single meaningful total without an exchange rate, and
    // we deliberately do not hold one.
    const totalIn = (c, currency) =>
      c.invoices.reduce((a, i) => (i.currency === currency ? a + Number(i.total) : a), 0);
    const last = (c) =>
      c.invoices.length
        ? new Date(Math.max(...c.invoices.map((i) => new Date(i.date))))
        : null;

    sendCsv(res, 'shine-buyers', [
      { label: 'Name', get: (c) => c.name },
      { label: 'Group', get: (c) => c.groupName ?? '' },
      { label: 'Country', get: (c) => c.country ?? '' },
      { label: 'Email', get: (c) => c.email ?? '' },
      { label: 'Other emails', get: (c) => c.extraEmails.join('; ') },
      { label: 'Phone', get: (c) => c.phone ?? '' },
      { label: 'Other phones', get: (c) => c.extraPhones.join('; ') },
      { label: 'Address', get: (c) => c.address ?? '' },
      { label: 'Street', get: (c) => c.street ?? '' },
      { label: 'Suburb / city', get: (c) => c.suburb ?? '' },
      { label: 'State', get: (c) => c.state ?? '' },
      { label: 'Postcode', get: (c) => c.postcode ?? '' },
      { label: 'ABN', get: (c) => c.abn ?? '' },
      { label: 'Website', get: (c) => c.website ?? '' },
      { label: 'Default currency', get: (c) => c.defaultCurrency ?? '' },
      { label: 'Default shipping term', get: (c) => c.defaultShippingTerm ?? '' },
      { label: 'Invoices', get: (c) => c.invoices.length },
      { label: 'Lifetime value (AUD)', get: (c) => money(totalIn(c, 'AUD')) },
      { label: 'Lifetime value (USD)', get: (c) => money(totalIn(c, 'USD')) },
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
