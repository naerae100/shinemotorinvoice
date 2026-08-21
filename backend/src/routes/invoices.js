import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { computeTotals, round2, discountSchema } from '../lib/money.js';
import { dateFilter, pagination } from '../lib/query.js';

const router = Router();

const invoiceLineSchema = z.object({
  materialId: z.string(),
  description: z.string().optional().nullable(),
  weightTonnes: z.number().positive(),
  pricePerMt: z.number().nonnegative(),
});

const invoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  date: z.string().datetime().optional(),
  consigneeId: z.string(),
  shippingTerm: z.string().optional().nullable(),
  fasPort: z.string().optional().nullable(),
  poNumber: z.string().optional().nullable(),
  containerNo: z.string().optional().nullable(),
  seal: z.string().optional().nullable(),
  modeOfTransport: z.string().optional().nullable(),
  containerType: z.string().optional().nullable(),
  // Exports are GST-free; a local sale on the same document is not.
  applyGst: z.boolean().default(false),
  lineItems: z.array(invoiceLineSchema).min(1),
  ...discountSchema,
});

const DETAIL_INCLUDE = {
  consignee: true,
  lineItems: { include: { material: true } },
  createdBy: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
};

const buildLines = (lineItems) =>
  lineItems.map((li) => ({
    materialId: li.materialId,
    description: li.description,
    weightTonnes: li.weightTonnes,
    pricePerMt: li.pricePerMt,
    totalAud: round2(li.weightTonnes * li.pricePerMt),
  }));

/** computeTotals speaks in subtotal/gst/total; the invoice columns are AUD-suffixed. */
function invoiceTotals(lines, data) {
  const t = computeTotals({
    lineValues: lines.map((l) => l.totalAud),
    discountType: data.discountType,
    discountValue: data.discountValue,
    applyGst: data.applyGst,
  });
  return {
    subtotalAud: t.subtotal,
    discountType: t.discountType,
    discountValue: t.discountValue,
    discountAmount: t.discountAmount,
    applyGst: Boolean(data.applyGst),
    gstAud: t.gst,
    totalAud: t.total,
  };
}

/**
 * bankSnapshot is a TEXT column (SQLite has no JSON type), stored as a JSON string
 * and expanded on the way out so callers always see an object.
 */
function serialiseBankSnapshot(settings) {
  if (!settings) return null;
  return JSON.stringify({
    bankName: settings.bankName,
    bankSwift: settings.bankSwift,
    bankAccountNo: settings.bankAccountNo,
    bankBsb: settings.bankBsb,
    bankAddress: settings.bankAddress,
    beneficiary: settings.beneficiary,
  });
}

function withParsedSnapshot(invoice) {
  if (!invoice) return invoice;
  let bankSnapshot = null;
  if (invoice.bankSnapshot) {
    try {
      bankSnapshot = JSON.parse(invoice.bankSnapshot);
    } catch {
      console.error(`Invoice ${invoice.id} has an unreadable bankSnapshot`);
    }
  }
  return { ...invoice, bankSnapshot };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      search,
      consigneeId,
      materialId,
      from,
      to,
      status,
      page = '1',
      pageSize = '25',
    } = req.query;
    const { take, skip, page: currentPage } = pagination(page, pageSize);

    const where = {
      ...(consigneeId ? { consigneeId: String(consigneeId) } : {}),
      ...(status === 'ALL' ? {} : { status: status ? String(status) : 'ACTIVE' }),
      ...(materialId ? { lineItems: { some: { materialId: String(materialId) } } } : {}),
      ...(dateFilter(from, to) ? { date: dateFilter(from, to) } : {}),
      ...(search
        ? {
            OR: [
              { invoiceNumber: contains(String(search)) },
              { containerNo: contains(String(search)) },
              { poNumber: contains(String(search)) },
              { consignee: { name: contains(String(search)) } },
            ],
          }
        : {}),
    };

    const [invoices, totalCount, sum] = await Promise.all([
      prisma.exportInvoice.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { date: 'desc' },
        take,
        skip,
      }),
      prisma.exportInvoice.count({ where }),
      prisma.exportInvoice.aggregate({
        where: { ...where, status: 'ACTIVE' },
        _sum: { totalAud: true, subtotalAud: true, gstAud: true },
      }),
    ]);

    res.json({
      invoices: invoices.map(withParsedSnapshot),
      totalCount,
      page: currentPage,
      pageSize: take,
      filteredTotals: {
        total: Number(sum._sum.totalAud ?? 0),
        subtotal: Number(sum._sum.subtotalAud ?? 0),
        gst: Number(sum._sum.gstAud ?? 0),
      },
    });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const invoice = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

// POST /api/invoices — snapshots current company bank details onto the invoice
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = invoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const data = parsed.data;

    const existing = await prisma.exportInvoice.findUnique({
      where: { invoiceNumber: data.invoiceNumber },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ error: 'Invoice number already exists' });
    }

    const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } });
    const lines = buildLines(data.lineItems);

    const invoice = await prisma.exportInvoice.create({
      data: {
        invoiceNumber: data.invoiceNumber,
        date: data.date ? new Date(data.date) : undefined,
        consigneeId: data.consigneeId,
        shippingTerm: data.shippingTerm,
        fasPort: data.fasPort,
        poNumber: data.poNumber,
        containerNo: data.containerNo,
        seal: data.seal,
        modeOfTransport: data.modeOfTransport,
        containerType: data.containerType,
        ...invoiceTotals(lines, data),
        bankSnapshot: serialiseBankSnapshot(settings),
        createdById: req.user.id,
        lineItems: { create: lines },
      },
      include: DETAIL_INCLUDE,
    });

    res.status(201).json({ invoice: withParsedSnapshot(invoice) });
  })
);

// PATCH /api/invoices/:id — the bank snapshot is deliberately never updated:
// it records the details as they stood when the invoice was issued, and the
// buyer may already have paid against them.
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = invoiceSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const data = parsed.data;

    const existing = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        applyGst: true,
        discountType: true,
        discountValue: true,
      },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status === 'VOID') {
      return res
        .status(409)
        .json({ error: 'This invoice is voided. Restore it before making changes.' });
    }

    const settled = {
      applyGst: data.applyGst ?? existing.applyGst,
      discountType: data.discountType ?? existing.discountType,
      discountValue:
        data.discountValue !== undefined ? data.discountValue : Number(existing.discountValue),
    };

    const invoice = await prisma.$transaction(async (tx) => {
      const updateData = {
        ...(data.invoiceNumber ? { invoiceNumber: data.invoiceNumber } : {}),
        ...(data.date ? { date: new Date(data.date) } : {}),
        ...(data.consigneeId ? { consigneeId: data.consigneeId } : {}),
        ...(data.shippingTerm !== undefined ? { shippingTerm: data.shippingTerm } : {}),
        ...(data.fasPort !== undefined ? { fasPort: data.fasPort } : {}),
        ...(data.poNumber !== undefined ? { poNumber: data.poNumber } : {}),
        ...(data.containerNo !== undefined ? { containerNo: data.containerNo } : {}),
        ...(data.seal !== undefined ? { seal: data.seal } : {}),
        ...(data.modeOfTransport !== undefined ? { modeOfTransport: data.modeOfTransport } : {}),
        ...(data.containerType !== undefined ? { containerType: data.containerType } : {}),
        editedById: req.user.id,
      };

      const totalsAffected =
        data.lineItems ||
        data.applyGst !== undefined ||
        data.discountType !== undefined ||
        data.discountValue !== undefined;

      if (totalsAffected) {
        let lines;
        if (data.lineItems) {
          lines = buildLines(data.lineItems);
          await tx.invoiceLineItem.deleteMany({ where: { invoiceId: req.params.id } });
          updateData.lineItems = { create: lines };
        } else {
          const stored = await tx.invoiceLineItem.findMany({
            where: { invoiceId: req.params.id },
            select: { totalAud: true },
          });
          lines = stored.map((l) => ({ totalAud: Number(l.totalAud) }));
        }
        Object.assign(updateData, invoiceTotals(lines, settled));
      }

      return tx.exportInvoice.update({
        where: { id: req.params.id },
        data: updateData,
        include: DETAIL_INCLUDE,
      });
    });

    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

router.post(
  '/:id/void',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reason = z.string().min(1).safeParse(req.body?.reason);
    if (!reason.success) {
      return res.status(400).json({ error: 'A reason is required to void an invoice' });
    }
    const existing = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status === 'VOID') {
      return res.status(409).json({ error: 'This invoice is already voided' });
    }

    const invoice = await prisma.exportInvoice.update({
      where: { id: req.params.id },
      data: {
        status: 'VOID',
        voidReason: reason.data,
        voidedAt: new Date(),
        voidedById: req.user.id,
      },
      include: DETAIL_INCLUDE,
    });
    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

router.post(
  '/:id/restore',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status !== 'VOID') {
      return res.status(409).json({ error: 'This invoice is not voided' });
    }

    const invoice = await prisma.exportInvoice.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE', voidReason: null, voidedAt: null, voidedById: null },
      include: DETAIL_INCLUDE,
    });
    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, invoiceNumber: true },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    await prisma.$transaction([
      prisma.invoiceLineItem.deleteMany({ where: { invoiceId: req.params.id } }),
      prisma.exportInvoice.delete({ where: { id: req.params.id } }),
    ]);
    console.warn(
      `Invoice ${existing.invoiceNumber} permanently deleted by ${req.user.email || req.user.id}`
    );
    res.json({ deleted: true, invoiceNumber: existing.invoiceNumber });
  })
);

export default router;
