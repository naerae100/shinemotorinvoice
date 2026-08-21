import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { computeTotals, round2, discountSchema } from '../lib/money.js';
import { dateFilter, numberFilter, pagination } from '../lib/query.js';

const router = Router();

// How many times to retry if two terminals grab the same docket number at once.
const DOCKET_NUMBER_ATTEMPTS = 6;

const lineItemSchema = z.object({
  materialId: z.string(),
  netWeight: z.number().positive(),
  price: z.number().nonnegative(), // snapshot price at time of sale
});

const docketSchema = z.object({
  type: z.enum(['TAX_INVOICE', 'PURCHASE_DOCKET']).default('PURCHASE_DOCKET'),
  date: z.string().datetime().optional(),
  supplierId: z.string(),
  vehicleReg: z.string().optional().nullable(),
  vehicleModel: z.string().optional().nullable(),
  vehicleVin: z.string().optional().nullable(),
  paygStatement: z
    .enum(['PRIVATE_HOBBY', 'TAX_EXEMPT', 'SCRAP_CODE_NO_ABN', 'NOT_APPLICABLE'])
    .optional()
    .nullable(),
  notes: z.string().optional().nullable(),
  lineItems: z.array(lineItemSchema).min(1, 'At least one material line is required'),
  ...discountSchema,
});

const DETAIL_INCLUDE = {
  supplier: true,
  lineItems: { include: { material: true } },
  createdBy: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
};

/** GST is a property of the document type, not a client-supplied flag. */
const appliesGst = (type) => type === 'TAX_INVOICE';

const buildLines = (lineItems) =>
  lineItems.map((li) => ({
    materialId: li.materialId,
    netWeight: li.netWeight,
    price: li.price,
    value: round2(li.netWeight * li.price),
  }));

const totalsFor = (lines, type, data) =>
  computeTotals({
    lineValues: lines.map((l) => l.value),
    discountType: data.discountType,
    discountValue: data.discountValue,
    applyGst: appliesGst(type),
  });

// GET /api/dockets?search=&type=&supplierId=&materialId=&from=&to=&status=&page=&pageSize=
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      search,
      type,
      supplierId,
      materialId,
      from,
      to,
      status,
      minTotal,
      maxTotal,
      page = '1',
      pageSize = '25',
    } = req.query;

    const where = {
      ...(type ? { type: String(type) } : {}),
      ...(supplierId ? { supplierId: String(supplierId) } : {}),
      // Default view hides voided records; pass status=ALL or status=VOID to see them.
      ...(status === 'ALL' ? {} : { status: status ? String(status) : 'ACTIVE' }),
      ...(materialId ? { lineItems: { some: { materialId: String(materialId) } } } : {}),
      ...(dateFilter(from, to) ? { date: dateFilter(from, to) } : {}),
      ...(numberFilter(minTotal, maxTotal) ? { total: numberFilter(minTotal, maxTotal) } : {}),
      ...(search
        ? {
            OR: [
              { supplier: { name: contains(String(search)) } },
              { supplier: { phone: contains(String(search)) } },
              { notes: contains(String(search)) },
              ...(Number.isFinite(Number(search)) ? [{ docketNumber: Number(search) }] : []),
            ],
          }
        : {}),
    };

    const { take, skip, page: currentPage } = pagination(page, pageSize);

    const [dockets, totalCount, sum] = await Promise.all([
      prisma.docket.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { date: 'desc' },
        take,
        skip,
      }),
      prisma.docket.count({ where }),
      // Sum across the whole filtered set, not just the current page.
      prisma.docket.aggregate({
        where: { ...where, status: 'ACTIVE' },
        _sum: { total: true, subtotal: true, gst: true },
      }),
    ]);

    res.json({
      dockets,
      totalCount,
      page: currentPage,
      pageSize: take,
      filteredTotals: {
        total: Number(sum._sum.total ?? 0),
        subtotal: Number(sum._sum.subtotal ?? 0),
        gst: Number(sum._sum.gst ?? 0),
      },
    });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const docket = await prisma.docket.findUnique({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    if (!docket) return res.status(404).json({ error: 'Docket not found' });
    res.json({ docket });
  })
);

// POST /api/dockets
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = docketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const data = parsed.data;

    const linesWithValue = buildLines(data.lineItems);
    const totals = totalsFor(linesWithValue, data.type, data);

    const baseData = {
      type: data.type,
      date: data.date ? new Date(data.date) : undefined,
      supplierId: data.supplierId,
      vehicleReg: data.vehicleReg,
      vehicleModel: data.vehicleModel,
      vehicleVin: data.vehicleVin,
      paygStatement: data.paygStatement,
      notes: data.notes,
      ...totals,
      createdById: req.user.id,
      lineItems: { create: linesWithValue },
    };

    // SQLite has no sequence on non-id columns, so the number is allocated here.
    // Two terminals saving at once can pick the same number; the unique index
    // rejects the loser, which then retries with the next one.
    for (let attempt = 1; attempt <= DOCKET_NUMBER_ATTEMPTS; attempt++) {
      const lastDocket = await prisma.docket.findFirst({
        orderBy: { docketNumber: 'desc' },
        select: { docketNumber: true },
      });

      try {
        const docket = await prisma.docket.create({
          data: { ...baseData, docketNumber: (lastDocket?.docketNumber ?? 0) + 1 },
          include: DETAIL_INCLUDE,
        });
        return res.status(201).json({ docket });
      } catch (err) {
        const isNumberCollision =
          err?.code === 'P2002' &&
          String(err.meta?.target ?? '').includes('docketNumber');
        if (!isNumberCollision || attempt === DOCKET_NUMBER_ATTEMPTS) throw err;
      }
    }
  })
);

// PATCH /api/dockets/:id
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = docketSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const data = parsed.data;

    const existing = await prisma.docket.findUnique({
      where: { id: req.params.id },
      select: { id: true, type: true, status: true, discountType: true, discountValue: true },
    });
    if (!existing) return res.status(404).json({ error: 'Docket not found' });
    if (existing.status === 'VOID') {
      return res
        .status(409)
        .json({ error: 'This docket is voided. Restore it before making changes.' });
    }

    const effectiveType = data.type ?? existing.type;
    const discount = {
      discountType: data.discountType ?? existing.discountType,
      discountValue:
        data.discountValue !== undefined ? data.discountValue : Number(existing.discountValue),
    };

    const docket = await prisma.$transaction(async (tx) => {
      const updateData = {
        ...(data.type ? { type: data.type } : {}),
        ...(data.date ? { date: new Date(data.date) } : {}),
        ...(data.supplierId ? { supplierId: data.supplierId } : {}),
        ...(data.vehicleReg !== undefined ? { vehicleReg: data.vehicleReg } : {}),
        ...(data.vehicleModel !== undefined ? { vehicleModel: data.vehicleModel } : {}),
        ...(data.vehicleVin !== undefined ? { vehicleVin: data.vehicleVin } : {}),
        ...(data.paygStatement !== undefined ? { paygStatement: data.paygStatement } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        editedById: req.user.id,
      };

      // Totals must be recomputed whenever the lines, the type (which drives GST)
      // or the discount change.
      const totalsAffected =
        data.lineItems ||
        (data.type && data.type !== existing.type) ||
        data.discountType !== undefined ||
        data.discountValue !== undefined;

      if (totalsAffected) {
        let lineValues;
        if (data.lineItems) {
          const linesWithValue = buildLines(data.lineItems);
          await tx.docketLineItem.deleteMany({ where: { docketId: req.params.id } });
          updateData.lineItems = { create: linesWithValue };
          lineValues = linesWithValue.map((l) => l.value);
        } else {
          const lines = await tx.docketLineItem.findMany({
            where: { docketId: req.params.id },
            select: { value: true },
          });
          lineValues = lines.map((l) => Number(l.value));
        }
        Object.assign(
          updateData,
          computeTotals({
            lineValues,
            ...discount,
            applyGst: appliesGst(effectiveType),
          })
        );
      }

      return tx.docket.update({
        where: { id: req.params.id },
        data: updateData,
        include: DETAIL_INCLUDE,
      });
    });

    res.json({ docket });
  })
);

// POST /api/dockets/:id/void — reversible cancellation, keeps the audit trail
router.post(
  '/:id/void',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reason = z.string().min(1).safeParse(req.body?.reason);
    if (!reason.success) {
      return res.status(400).json({ error: 'A reason is required to void a docket' });
    }
    const existing = await prisma.docket.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Docket not found' });
    if (existing.status === 'VOID') {
      return res.status(409).json({ error: 'This docket is already voided' });
    }

    const docket = await prisma.docket.update({
      where: { id: req.params.id },
      data: {
        status: 'VOID',
        voidReason: reason.data,
        voidedAt: new Date(),
        voidedById: req.user.id,
      },
      include: DETAIL_INCLUDE,
    });
    res.json({ docket });
  })
);

// POST /api/dockets/:id/restore — undo a void
router.post(
  '/:id/restore',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.docket.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!existing) return res.status(404).json({ error: 'Docket not found' });
    if (existing.status !== 'VOID') {
      return res.status(409).json({ error: 'This docket is not voided' });
    }

    const docket = await prisma.docket.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE', voidReason: null, voidedAt: null, voidedById: null },
      include: DETAIL_INCLUDE,
    });
    res.json({ docket });
  })
);

// DELETE /api/dockets/:id — permanent, admin only. Void is the normal path;
// this exists for genuine mistakes such as a test entry.
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.docket.findUnique({
      where: { id: req.params.id },
      select: { id: true, docketNumber: true },
    });
    if (!existing) return res.status(404).json({ error: 'Docket not found' });

    await prisma.$transaction([
      prisma.docketLineItem.deleteMany({ where: { docketId: req.params.id } }),
      prisma.docket.delete({ where: { id: req.params.id } }),
    ]);
    console.warn(
      `Docket #${existing.docketNumber} permanently deleted by ${req.user.email || req.user.id}`
    );
    res.json({ deleted: true, docketNumber: existing.docketNumber });
  })
);

export default router;
