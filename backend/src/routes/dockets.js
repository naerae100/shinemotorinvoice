import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { computeTotals, round2, discountSchema } from '../lib/money.js';
import { dateFilter, numberFilter, pagination } from '../lib/query.js';
import { sendCsv, money, isoDate, isoDateTime } from '../lib/csv.js';
import { pushPurchaseDocketToXero } from './xero.js';
import { invalidateDashboardCache } from './reports.js';
import { audit, diff } from '../lib/audit.js';

const router = Router();

// Any successful write here changes figures the dashboard caches, so clear it
// on the way out. Registered as middleware rather than called from each handler
// so a route added later cannot forget to do it.
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode < 400) invalidateDashboardCache();
  });
  next();
});

// How many times to retry if two terminals grab the same docket number at once.
//
// Every concurrent writer reads the same "current maximum" and then races to
// insert; the unique index lets one through and rejects the rest, which read
// again and retry. With N terminals saving at once the unlucky one can lose up
// to N-1 times, so this ceiling has to sit comfortably above the number of
// tills that might ever hit save together, not just above the common case.
const DOCKET_NUMBER_ATTEMPTS = 25;

const lineItemSchema = z
  .object({
    // Optional: a one-off grade can be typed onto the docket without first being
    // added to the price list. One of the two must be present, or the line would
    // print as a blank row.
    materialId: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    netWeight: z.number().positive(),
    price: z.number().nonnegative(), // snapshot price at time of sale
  })
  .refine((li) => li.materialId || (li.description && li.description.trim()), {
    message: 'A line needs either a material or a description',
    path: ['description'],
  });

const docketSchema = z.object({
  type: z.enum(['TAX_INVOICE', 'PURCHASE_DOCKET']).default('PURCHASE_DOCKET'),
  // Inclusive by default: the rate quoted at the weighbridge already has GST in it.
  taxMode: z.enum(['EXCLUSIVE', 'INCLUSIVE', 'NO_TAX']).default('INCLUSIVE'),
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

const buildLines = (lineItems) =>
  lineItems.map((li) => ({
    materialId: li.materialId ?? null,
    description: li.description ?? null,
    netWeight: li.netWeight,
    price: li.price,
    value: round2(li.netWeight * li.price),
  }));

const totalsFor = (lines, data) =>
  computeTotals({
    lineValues: lines.map((l) => l.value),
    discountType: data.discountType,
    discountValue: data.discountValue,
    taxMode: data.taxMode ?? 'INCLUSIVE',
  });

/**
 * The filter used by the list, the totals and the CSV export alike. Sharing it
 * is the point: an export that quietly returned a different set from the list
 * you were looking at would be worse than no export.
 */
function buildDocketWhere(query) {
  const { search, type, supplierId, materialId, from, to, status, minTotal, maxTotal } = query;
  return {
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
}

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

    const where = buildDocketWhere(req.query);

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

/**
 * GET /api/dockets/export?<same filters as the list>&detail=lines
 *
 * Exports everything matching the current filters, not just the visible page.
 * `detail=lines` gives one row per material line instead of one per document,
 * which is what you want for working out volumes by material.
 */
/**
 * GET /api/dockets/:id/export — one docket as a spreadsheet.
 *
 * One row per material line, with the docket and supplier repeated on every
 * row. That redundancy is the point: a single-row-per-docket file with the
 * materials crammed into one cell cannot be sorted, filtered or summed, and a
 * two-section file with a header block above a table is not a table at all.
 * Every row standing on its own is what lets the file be pasted straight into
 * a return or a reconciliation.
 *
 * No route conflict with '/export' above: that is one path segment and this is
 * two, so Express never confuses the two.
 */
router.get(
  '/:id/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const d = await prisma.docket.findUnique({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    if (!d) return res.status(404).json({ error: 'Docket not found' });

    const typeName = d.type === 'TAX_INVOICE' ? 'Tax invoice' : 'Purchase docket';
    const rows = d.lineItems.length ? d.lineItems : [null];

    sendCsv(
      res,
      `shine-docket-${d.docketNumber}`,
      [
        { label: 'Docket no.', get: () => d.docketNumber },
        { label: 'Type', get: () => typeName },
        { label: 'Status', get: () => d.status },
        { label: 'Date', get: () => isoDate(d.date) },
        { label: 'Time', get: () => isoDateTime(d.createdAt).slice(11) },
        { label: 'Issued', get: () => (d.issuedAt ? isoDateTime(d.issuedAt) : '') },

        { label: 'Supplier', get: () => d.supplier?.name ?? '' },
        { label: 'Sale type', get: () => (d.supplier?.saleType === 'BUSINESS' ? 'Business' : 'Private') },
        { label: 'Supplier phone', get: () => d.supplier?.phone ?? '' },
        { label: 'Supplier email', get: () => d.supplier?.email ?? '' },
        { label: 'Supplier address', get: () =>
            [d.supplier?.address, d.supplier?.suburb, d.supplier?.state, d.supplier?.postcode]
              .filter(Boolean).join(', ') },
        { label: 'Supplier ABN', get: () => d.supplier?.abn ?? '' },
        { label: 'Driver licence', get: () => d.supplier?.licenceNo ?? '' },
        { label: 'Pay to account name', get: () => d.supplier?.bankAccountName ?? '' },
        { label: 'Pay to BSB', get: () => d.supplier?.bankBsb ?? '' },
        { label: 'Pay to account no.', get: () => d.supplier?.bankAccountNo ?? '' },
        { label: 'Pay to PayID', get: () => d.supplier?.payId ?? '' },

        { label: 'Vehicle rego', get: () => d.vehicleReg ?? '' },
        { label: 'Vehicle model', get: () => d.vehicleModel ?? '' },
        { label: 'VIN', get: () => d.vehicleVin ?? '' },
        { label: 'PAYG statement', get: () => d.paygStatement ?? '' },

        { label: 'Line', get: (li) => (li ? d.lineItems.indexOf(li) + 1 : '') },
        { label: 'Material code', get: (li) => li?.material?.code ?? '' },
        { label: 'Material', get: (li) => (li ? li.description || li.material?.description || '' : '') },
        { label: 'Category', get: (li) => li?.material?.category ?? '' },
        { label: 'Unit', get: (li) => li?.material?.unit ?? '' },
        { label: 'Net weight', get: (li) => (li ? money(li.netWeight) : '') },
        { label: 'Rate (AUD)', get: (li) => (li ? money(li.price) : '') },
        { label: 'Line value (AUD)', get: (li) => (li ? money(li.value) : '') },

        // Document totals repeat on each row. A spreadsheet summing this column
        // would double-count, so the header says so rather than leaving it to
        // be discovered.
        { label: 'Tax mode', get: () => d.taxMode ?? 'EXCLUSIVE' },
        { label: 'Docket subtotal (AUD)', get: () => money(d.subtotal) },
        { label: 'Docket discount (AUD)', get: () => money(d.discountAmount) },
        { label: 'Docket GST (AUD)', get: () => money(d.gst) },
        { label: 'Docket total (AUD)', get: () => money(d.total) },

        { label: 'Processed by', get: () => d.createdBy?.name ?? '' },
        { label: 'Amended by', get: () => d.editedBy?.name ?? '' },
        { label: 'Void reason', get: () => d.voidReason ?? '' },
        { label: 'Notes', get: () => d.notes ?? '' },
      ],
      rows
    );
  })
);

router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = buildDocketWhere(req.query);
    const byLine = String(req.query.detail) === 'lines';

    const dockets = await prisma.docket.findMany({
      where,
      include: {
        supplier: true,
        lineItems: { include: { material: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
      take: 20000,
    });

    const typeLabel = (d) => (d.type === 'TAX_INVOICE' ? 'Tax invoice' : 'Purchase docket');

    if (byLine) {
      const rows = dockets.flatMap((d) =>
        d.lineItems.map((li) => ({ d, li }))
      );
      return sendCsv(res, 'shine-purchases-by-material', [
        { label: 'Docket no.', get: (r) => r.d.docketNumber },
        { label: 'Type', get: (r) => typeLabel(r.d) },
        { label: 'Status', get: (r) => r.d.status },
        { label: 'Date', get: (r) => isoDate(r.d.date) },
        { label: 'Supplier', get: (r) => r.d.supplier?.name },
        { label: 'Material code', get: (r) => r.li.material?.code ?? '' },
        { label: 'Material', get: (r) => r.li.description || r.li.material?.description || '' },
        { label: 'Category', get: (r) => r.li.material?.category ?? '' },
        { label: 'Unit', get: (r) => r.li.material?.unit },
        { label: 'Net weight', get: (r) => money(r.li.netWeight) },
        { label: 'Rate (AUD)', get: (r) => money(r.li.price) },
        { label: 'Line value (AUD)', get: (r) => money(r.li.value) },
      ], rows);
    }

    sendCsv(res, 'shine-purchases', [
      { label: 'Docket no.', get: (d) => d.docketNumber },
      { label: 'Type', get: typeLabel },
      { label: 'Status', get: (d) => d.status },
      { label: 'Date', get: (d) => isoDate(d.date) },
      { label: 'Time', get: (d) => isoDateTime(d.createdAt).slice(11) },
      { label: 'Supplier', get: (d) => d.supplier?.name },
      { label: 'Supplier phone', get: (d) => d.supplier?.phone ?? '' },
      { label: 'Supplier email', get: (d) => d.supplier?.email ?? '' },
      { label: 'Supplier ABN', get: (d) => d.supplier?.abn ?? '' },
      { label: 'Sale type', get: (d) => (d.supplier?.saleType === 'BUSINESS' ? 'Business' : 'Private') },
      { label: 'Lines', get: (d) => d.lineItems.length },
      { label: 'Materials', get: (d) => d.lineItems.map((li) => li.description || li.material?.description || '').join('; ') },
      { label: 'Total weight', get: (d) => money(d.lineItems.reduce((s, li) => s + Number(li.netWeight), 0)) },
      { label: 'Tax mode', get: (d) => d.taxMode ?? 'EXCLUSIVE' },
      { label: 'Subtotal (AUD)', get: (d) => money(d.subtotal) },
      { label: 'Discount (AUD)', get: (d) => money(d.discountAmount) },
      { label: 'GST (AUD)', get: (d) => money(d.gst) },
      { label: 'Total (AUD)', get: (d) => money(d.total) },
      { label: 'Vehicle rego', get: (d) => d.vehicleReg ?? '' },
      { label: 'PAYG statement', get: (d) => d.paygStatement ?? '' },
      { label: 'Processed by', get: (d) => d.createdBy?.name ?? '' },
      { label: 'Void reason', get: (d) => d.voidReason ?? '' },
      { label: 'Notes', get: (d) => d.notes ?? '' },
    ], dockets);
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
    const totals = totalsFor(linesWithValue, data);

    const baseData = {
      type: data.type,
      taxMode: data.taxMode,
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
        
        // Push to Xero
        await pushPurchaseDocketToXero(docket);
        await audit({
          req,
          action: 'CREATE',
          entity: 'Docket',
          entityId: docket.id,
          label: `Docket #${docket.docketNumber}`,
          after: { total: String(docket.total), taxMode: docket.taxMode, supplierId: docket.supplierId },
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
      select: {
        id: true,
        docketNumber: true,
        type: true,
        taxMode: true,
        status: true,
        issuedAt: true,
        discountType: true,
        discountValue: true,
        total: true,
      },
    });
    if (!existing) return res.status(404).json({ error: 'Docket not found' });
    if (existing.status === 'VOID') {
      return res
        .status(409)
        .json({ error: 'This docket is voided. Restore it before making changes.' });
    }
    if (existing.issuedAt) {
      return res.status(409).json({
        error:
          'This docket has been issued to the supplier and can no longer be edited. Void it and raise a replacement.',
      });
    }

    const effectiveTaxMode = data.taxMode ?? existing.taxMode ?? 'INCLUSIVE';
    const discount = {
      discountType: data.discountType ?? existing.discountType,
      discountValue:
        data.discountValue !== undefined ? data.discountValue : Number(existing.discountValue),
    };

    const docket = await prisma.$transaction(async (tx) => {
      const updateData = {
        ...(data.type ? { type: data.type } : {}),
        ...(data.taxMode ? { taxMode: data.taxMode } : {}),
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
        (data.taxMode && data.taxMode !== existing.taxMode) ||
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
            taxMode: effectiveTaxMode,
          })
        );
      }

      return tx.docket.update({
        where: { id: req.params.id },
        data: updateData,
        include: DETAIL_INCLUDE,
      });
    });

    // Push to Xero on updates
    await pushPurchaseDocketToXero(docket);

    const changed = diff(existing, docket, ['taxMode', 'type', 'total', 'discountType', 'discountValue']);
    await audit({
      req,
      action: 'UPDATE',
      entity: 'Docket',
      entityId: docket.id,
      label: `Docket #${docket.docketNumber}`,
      before: changed?.before,
      after: changed?.after,
    });

    res.json({ docket });
  })
);

// POST /api/dockets/:id/void — reversible cancellation, keeps the audit trail
router.post(
  '/:id/void',
  requireAuth,
  // Voiding reverses a financial record. Creating and issuing a docket is the
  // yard's ordinary work, so those stay open to STAFF; undoing one is not.
  requireRole('ADMIN'),
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
    await audit({
      req,
      action: 'VOID',
      entity: 'Docket',
      entityId: docket.id,
      label: `Docket #${docket.docketNumber}`,
      before: { status: 'ACTIVE' },
      after: { status: 'VOID', voidReason: reason.data },
    });
    res.json({ docket });
  })
);

// POST /api/dockets/:id/restore — undo a void
router.post(
  '/:id/restore',
  requireAuth,
  // Admin-only for the same reason as void: this reverses the reversal.
  requireRole('ADMIN'),
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
    await audit({
      req,
      action: 'RESTORE',
      entity: 'Docket',
      entityId: docket.id,
      label: `Docket #${docket.docketNumber}`,
      before: { status: 'VOID' },
      after: { status: 'ACTIVE' },
    });
    res.json({ docket });
  })
);

/**
 * POST /api/dockets/:id/issue — hand the docket to the supplier.
 *
 * This is the point the record stops being a draft. It is one-way on purpose:
 * un-issuing would make the lock meaningless.
 */
router.post(
  '/:id/issue',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.docket.findUnique({
      where: { id: req.params.id },
      select: { id: true, docketNumber: true, status: true, issuedAt: true },
    });
    if (!existing) return res.status(404).json({ error: 'Docket not found' });
    if (existing.status === 'VOID') {
      return res.status(409).json({ error: 'A voided docket cannot be issued.' });
    }
    if (existing.issuedAt) {
      return res.status(409).json({ error: 'This docket has already been issued.' });
    }

    const docket = await prisma.docket.update({
      where: { id: req.params.id },
      data: { issuedAt: new Date() },
      include: DETAIL_INCLUDE,
    });
    await audit({
      req,
      action: 'ISSUE',
      entity: 'Docket',
      entityId: docket.id,
      label: `Docket #${docket.docketNumber}`,
      after: { issuedAt: docket.issuedAt },
    });
    res.json({ docket });
  })
);

/**
 * DELETE is deliberately not implemented.
 *
 * A docket number is a legal reference to a completed purchase; the pad it
 * replaced could not have a page torn out without leaving a stub. Voiding keeps
 * the number, the reason and the audit trail, and removes the value from every
 * total — which is what "deleting" a docket was ever meant to achieve.
 */
router.delete('/:id', requireAuth, (req, res) => {
  res.status(405).json({
    error: 'Dockets cannot be deleted. Void it instead — the number and history are kept.',
  });
});

export default router;
