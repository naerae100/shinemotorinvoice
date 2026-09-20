import { Router } from 'express';
import { z } from 'zod';
import * as v from '../lib/validators.js';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { sendCsv, money, isoDate } from '../lib/csv.js';
import { audit, diff } from '../lib/audit.js';

const router = Router();

/**
 * Every field worth naming in the trail — with the bank block first, because
 * that is the one that moves money.
 *
 * Writing suppliers stays open to STAFF on purpose: a pay-later docket is
 * settled from the account details taken at the weighbridge, so the operator
 * writing the docket is the person who has to record them. Locking the fields
 * to an admin would mean either no pay-later dockets after hours, or the
 * details going onto a sticky note — both worse than what this replaces.
 *
 * What was missing was not a lock but a record. "Change a supplier's BSB, then
 * mark the docket paid" is the cheapest way to misdirect money in this system,
 * and until now it left no trace at all. It is now the loudest thing in the
 * trail.
 */
const AUDITED_FIELDS = [
  'bankAccountName',
  'bankBsb',
  'bankAccountNo',
  'payId',
  'name',
  'abn',
  'phone',
  'email',
  'saleType',
  'licenceNo',
  'address',
  'suburb',
  'state',
  'postcode',
  'country',
];

const BANK_FIELDS = ['bankAccountName', 'bankBsb', 'bankAccountNo', 'payId'];

const supplierSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  suburb: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  phone: v.phone,
  // Blank is allowed — plenty of walk-in sellers have no email at all — but a
  // value that is present must actually look like one.
  email: v.optionalEmail,
  saleType: z.enum(['PRIVATE', 'BUSINESS']).default('PRIVATE'),
  abn: v.abn,
  licenceNo: z.string().optional().nullable(),

  // Where they get paid, and therefore the fields worth checking hardest: a
  // BSB one digit out does not bounce, it pays somebody else.
  bankAccountName: z.string().optional().nullable(),
  bankBsb: v.bsb,
  bankAccountNo: v.accountNumber,
  payId: v.payId,
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
      { label: 'State', get: (s) => s.state ?? '' },
      { label: 'Postcode', get: (s) => s.postcode ?? '' },
      { label: 'Country', get: (s) => s.country ?? '' },
      { label: 'ABN', get: (s) => s.abn ?? '' },
      { label: 'Driver licence', get: (s) => s.licenceNo ?? '' },
      // Where they get paid. The whole point of holding these is settling a
      // docket later, so an export that omits them cannot be used to pay anyone.
      { label: 'Account name', get: (s) => s.bankAccountName ?? '' },
      { label: 'BSB', get: (s) => s.bankBsb ?? '' },
      { label: 'Account number', get: (s) => s.bankAccountNo ?? '' },
      { label: 'PayID', get: (s) => s.payId ?? '' },
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
    await audit({
      req,
      action: 'CREATE',
      entity: 'Supplier',
      entityId: supplier.id,
      label: supplier.name,
      after: Object.fromEntries(
        AUDITED_FIELDS.filter((f) => supplier[f] != null && supplier[f] !== '').map((f) => [f, supplier[f]])
      ),
    });
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
    // The whole row, not just the id: the trail records what a field was
    // before it changed, and a `select: { id: true }` cannot tell you that.
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });

    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: parsed.data,
    });

    const changed = diff(existing, supplier, AUDITED_FIELDS);
    if (changed) {
      const bankChanged = BANK_FIELDS.some((f) => f in changed.after);
      await audit({
        req,
        action: 'UPDATE',
        entity: 'Supplier',
        entityId: supplier.id,
        // Flagged in the label so a reviewer scanning the trail sees it without
        // having to open the row.
        label: bankChanged ? `${supplier.name} — PAYMENT DETAILS CHANGED` : supplier.name,
        before: changed.before,
        after: changed.after,
      });
    }
    res.json({ supplier });
  })
);

export default router;
