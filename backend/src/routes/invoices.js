import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { computeTotals, round3, discountSchema } from '../lib/money.js';
import { CURRENCIES } from '../lib/currency.js';
import { dateFilter, numberFilter, pagination } from '../lib/query.js';
import { sendCsv, money, isoDate, isoDateTime } from '../lib/csv.js';
import { pushSalesInvoiceToXero } from './xero.js';
import { invalidateDashboardCache } from './reports.js';
import { audit, diff } from '../lib/audit.js';
import {
  versionSchema,
  guardedWhere,
  isStaleWrite,
  STALE_WRITE_MESSAGE,
} from '../lib/concurrency.js';

const router = Router();

// Sales figures feed the same cached dashboard as purchases; see dockets.js.
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode < 400) invalidateDashboardCache();
  });
  next();
});



const invoiceLineSchema = z
  .object({
    // A line may name a material from the price list, or just describe itself.
    // Requiring one of the two is what stops a blank row reaching the document.
    materialId: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    packageCount: z.string().optional().nullable(),

    // Index into this request's `containers` array, not a database id — the
    // containers may not exist yet when the invoice is being created.
    containerIndex: z.number().int().nonnegative().optional().nullable(),

    grossWeightMt: z.number().nonnegative().optional().nullable(),
    tareWeightMt: z.number().nonnegative().optional().nullable(),
    netWeightMt: z.number().positive(),
    pricePerMt: z.number().nonnegative(),
  })
  .refine((li) => li.materialId || (li.description && li.description.trim()), {
    message: 'A line needs either a material or a description',
    path: ['description'],
  })
  .refine(
    (li) =>
      li.grossWeightMt == null ||
      li.tareWeightMt == null ||
      round3(li.grossWeightMt - li.tareWeightMt) === round3(li.netWeightMt),
    {
      message: 'Net weight must equal gross minus tare',
      path: ['netWeightMt'],
    }
  );

const containerSchema = z.object({
  containerNo: z.string().optional().nullable(),
  seal: z.string().optional().nullable(),
  containerType: z.string().optional().nullable(),
});

const invoiceBase = z.object({
  invoiceNumber: z.string().min(1),
  date: z.string().datetime().optional(),
  consigneeId: z.string(),
  currency: z.enum(CURRENCIES).default('AUD'),
  // Which stage this record is at. A packing slip carries weights and no
  // prices; pricing it is what turns it into an invoice.
  stage: z.enum(['PACKING_SLIP', 'INVOICED']).default('INVOICED'),
  shippingTerm: z.string().optional().nullable(),
  fasPort: z.string().optional().nullable(),
  poNumber: z.string().optional().nullable(),
  contractNo: z.string().optional().nullable(),
  modeOfTransport: z.string().optional().nullable(),
  containers: z.array(containerSchema).default([]),
  // Exports are GST-free; a local sale on the same document is not.
  applyGst: z.boolean().default(false),
  lineItems: z.array(invoiceLineSchema).min(1),
  ...discountSchema,
  ...versionSchema,
});

/** A line may only point at a container the same request supplied. */
const containerRefsResolve = (d) =>
  !d.lineItems ||
  !d.containers ||
  d.lineItems.every((li) => li.containerIndex == null || li.containerIndex < d.containers.length);
const CONTAINER_REF_ERROR = {
  message: 'A line points at a container that was not supplied',
  path: ['lineItems'],
};

const invoiceSchema = invoiceBase.refine(containerRefsResolve, CONTAINER_REF_ERROR);

// PATCH accepts any subset. `.partial()` has to be taken on the plain object —
// a refined schema is a ZodEffects and no longer offers it — so the refinement
// is re-applied afterwards.
const invoicePatchSchema = invoiceBase.partial().refine(containerRefsResolve, CONTAINER_REF_ERROR);

const DETAIL_INCLUDE = {
  consignee: true,
  containers: { orderBy: { position: 'asc' } },
  // `container` as well as `material`: the invoice names the container a line
  // travelled in, and without this include that name silently never printed.
  lineItems: { include: { material: true, container: true }, orderBy: { position: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
};

/**
 * Line values, in document order. `containerIds` maps this request's container
 * indexes onto the rows that were just created; it is absent when the caller
 * sent no containers, in which case every line simply has none.
 */
const buildLines = (lineItems, containerIds = []) =>
  lineItems.map((li, position) => ({
    materialId: li.materialId ?? null,
    containerId: li.containerIndex == null ? null : (containerIds[li.containerIndex] ?? null),
    description: li.description ?? null,
    packageCount: li.packageCount ?? null,
    grossWeightMt: li.grossWeightMt ?? null,
    tareWeightMt: li.tareWeightMt ?? null,
    netWeightMt: li.netWeightMt,
    pricePerMt: li.pricePerMt,
    total: round3(li.netWeightMt * li.pricePerMt),
    position,
  }));

/** Totals are in the invoice's own currency; nothing is converted. */
function invoiceTotals(lines, data) {
  const t = computeTotals({
    lineValues: lines.map((l) => l.total),
    discountType: data.discountType,
    discountValue: data.discountValue,
    applyGst: data.applyGst,
  });
  return {
    subtotal: t.subtotal,
    discountType: t.discountType,
    discountValue: t.discountValue,
    discountAmount: t.discountAmount,
    applyGst: Boolean(data.applyGst),
    gst: t.gst,
    total: t.total,
  };
}

/**
 * bankSnapshot is a TEXT column (SQLite has no JSON type), stored as a JSON string
 * and expanded on the way out so callers always see an object.
 *
 * The account is chosen by the invoice's currency: AUD collects at one Westpac
 * account and USD at another, and paying the wrong one misroutes an
 * international wire. Snapshotting it means a later change to the account
 * details cannot rewrite an invoice the buyer has already been sent.
 */
async function bankSnapshotFor(currency) {
  const account = await prisma.bankAccount.findUnique({ where: { currency } });
  if (!account) return null;
  return JSON.stringify({
    currency: account.currency,
    bankName: account.bankName,
    bankSwift: account.swift,
    bankAccountNo: account.accountNo,
    bankBsb: account.bsb,
    bankAddress: account.bankAddress,
    beneficiary: account.beneficiary,
  });
}

/** True when the account for this currency has not been filled in yet. */
async function bankAccountIsBlank(currency) {
  const a = await prisma.bankAccount.findUnique({ where: { currency } });
  return !a || !(a.accountNo || a.bsb || a.swift);
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

/** Shared by the list, its totals and the CSV export. */
/** See issuedFilter in routes/dockets.js — same idea, same three states. */
const issuedFilter = (issued) =>
  issued === 'no'
    ? { issuedAt: null }
    : issued === 'yes'
      ? { issuedAt: { not: null } }
      : {};

function buildInvoiceWhere(query) {
  const { search, consigneeId, materialId, from, to, status, stage, issued } = query;
  return {
    ...issuedFilter(issued),
    // Packing slips and invoices live in one table but are two different
    // screens. Defaulting to INVOICED keeps unpriced slips out of the sales
    // list, its totals and its CSV, where a row worth 0 would read as a sale
    // that earned nothing.
    ...(stage === 'ALL' ? {} : { stage: stage ? String(stage) : 'INVOICED' }),
    ...(consigneeId ? { consigneeId: String(consigneeId) } : {}),
    ...(status === 'ALL' ? {} : { status: status ? String(status) : 'ACTIVE' }),
    ...(materialId ? { lineItems: { some: { materialId: String(materialId) } } } : {}),
    ...(dateFilter(from, to) ? { date: dateFilter(from, to) } : {}),
    ...(search
      ? {
          OR: [
            { invoiceNumber: contains(String(search)) },
            { containers: { some: { containerNo: contains(String(search)) } } },
            { contractNo: contains(String(search)) },
            { poNumber: contains(String(search)) },
            { consignee: { name: contains(String(search)) } },
          ],
        }
      : {}),
  };
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

    const where = buildInvoiceWhere(req.query);

    const [invoices, totalCount, sum] = await Promise.all([
      prisma.exportInvoice.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { date: 'desc' },
        take,
        skip,
      }),
      prisma.exportInvoice.count({ where }),
      // Grouped by currency, never summed across it: adding a USD invoice to an
      // AUD one produces a figure that means nothing without an exchange rate,
      // and we deliberately hold none.
      prisma.exportInvoice.groupBy({
        by: ['currency'],
        where: { ...where, status: 'ACTIVE' },
        _sum: { total: true, subtotal: true, gst: true },
      }),
    ]);

    res.json({
      invoices: invoices.map(withParsedSnapshot),
      totalCount,
      page: currentPage,
      pageSize: take,
      filteredTotals: sum.map((row) => ({
        currency: row.currency,
        total: Number(row._sum.total ?? 0),
        subtotal: Number(row._sum.subtotal ?? 0),
        gst: Number(row._sum.gst ?? 0),
      })),
    });
  })
);

// Declared before '/:id' so Express does not read "export" as an invoice id.
/**
 * GET /api/invoices/:id/export — one shipment as a spreadsheet.
 *
 * One row per line, with the invoice, buyer and container repeated on every row,
 * for the same reason as the docket export: every row has to stand on its own
 * to be sortable and summable.
 *
 * Serves a packing slip too. An unpriced slip exports with its weights and
 * blank money columns rather than columns of zeroes, because a zero is a price
 * that was agreed and nothing is what a slip actually says.
 */
router.get(
  '/:id/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const found = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    if (!found) return res.status(404).json({ error: 'Invoice not found' });

    const inv = withParsedSnapshot(found);
    const isSlip = inv.stage === 'PACKING_SLIP';
    const cur = inv.currency || 'AUD';
    const bank = inv.bankSnapshot;
    const rows = inv.lineItems.length ? inv.lineItems : [null];
    const containerOf = (li) =>
      li?.container ?? inv.containers.find((c) => c.id === li?.containerId) ?? null;
    // Blank, not 0.00, while the shipment is still only weighed.
    const cash = (v) => (isSlip ? '' : money(v));

    sendCsv(
      res,
      `shine-${isSlip ? 'packing-slip' : 'invoice'}-${inv.invoiceNumber}`,
      [
        { label: 'Document', get: () => (isSlip ? 'Packing slip' : 'Commercial invoice') },
        { label: 'Invoice no.', get: () => inv.invoiceNumber },
        { label: 'Status', get: () => inv.status },
        { label: 'Date', get: () => isoDate(inv.date) },
        { label: 'Issued', get: () => (inv.issuedAt ? isoDateTime(inv.issuedAt) : '') },
        { label: 'Contract no.', get: () => inv.contractNo ?? '' },
        { label: 'PO no.', get: () => inv.poNumber ?? '' },

        { label: 'Buyer', get: () => inv.consignee?.name ?? '' },
        { label: 'Buyer country', get: () => inv.consignee?.country ?? '' },
        { label: 'Buyer email', get: () => inv.consignee?.email ?? '' },
        { label: 'Buyer phone', get: () => inv.consignee?.phone ?? '' },
        { label: 'Buyer address', get: () =>
            [inv.consignee?.street || inv.consignee?.address, inv.consignee?.suburb,
             inv.consignee?.state, inv.consignee?.postcode, inv.consignee?.country]
              .filter(Boolean).join(', ') },

        { label: 'Shipping term', get: () => inv.shippingTerm ?? '' },
        { label: 'Port', get: () => inv.fasPort ?? '' },
        { label: 'Mode of transport', get: () => inv.modeOfTransport ?? '' },
        { label: 'Country of origin', get: () => 'Australia' },

        { label: 'Line', get: (li) => (li ? inv.lineItems.indexOf(li) + 1 : '') },
        { label: 'Container no.', get: (li) => containerOf(li)?.containerNo ?? '' },
        { label: 'Seal', get: (li) => containerOf(li)?.seal ?? '' },
        { label: 'Container type', get: (li) => containerOf(li)?.containerType ?? '' },
        { label: 'Grade', get: (li) => (li ? li.description || li.material?.description || '' : '') },
        { label: 'Category', get: (li) => li?.material?.category ?? '' },
        { label: 'Packages', get: (li) => li?.packageCount ?? '' },
        { label: 'Gross weight (MT)', get: (li) => (li?.grossWeightMt == null ? '' : money(li.grossWeightMt)) },
        { label: 'Tare weight (MT)', get: (li) => (li?.tareWeightMt == null ? '' : money(li.tareWeightMt)) },
        { label: 'Net weight (MT)', get: (li) => (li ? money(li.netWeightMt) : '') },
        { label: `Price per MT (${cur})`, get: (li) => (li ? cash(li.pricePerMt) : '') },
        { label: `Line amount (${cur})`, get: (li) => (li ? cash(li.total) : '') },

        { label: 'Currency', get: () => (isSlip ? '' : cur) },
        { label: `Invoice subtotal (${cur})`, get: () => cash(inv.subtotal) },
        { label: `Invoice discount (${cur})`, get: () => cash(inv.discountAmount) },
        { label: `Invoice GST (${cur})`, get: () => cash(inv.gst) },
        { label: `Invoice total (${cur})`, get: () => cash(inv.total) },

        { label: 'Pay to bank', get: () => bank?.bankName ?? '' },
        { label: 'Pay to BSB', get: () => bank?.bankBsb ?? '' },
        { label: 'Pay to account no.', get: () => bank?.bankAccountNo ?? '' },
        { label: 'Pay to SWIFT', get: () => bank?.bankSwift ?? '' },

        { label: 'Raised by', get: () => inv.createdBy?.name ?? '' },
        { label: 'Amended by', get: () => inv.editedBy?.name ?? '' },
        { label: 'Void reason', get: () => inv.voidReason ?? '' },
      ],
      rows
    );
  })
);

router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = buildInvoiceWhere(req.query);
    const byLine = String(req.query.detail) === 'lines';
    // Packing slips and invoices are two different lists, so they must not land
    // on the same filename — exporting both would overwrite the first.
    const slips = String(req.query.stage) === 'PACKING_SLIP';
    const base = slips ? 'shine-packing-slips' : 'shine-sales';

    const invoices = await prisma.exportInvoice.findMany({
      where,
      include: {
        consignee: true,
        containers: { orderBy: { position: 'asc' } },
        lineItems: { include: { material: true, container: true }, orderBy: { position: 'asc' } },
        createdBy: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
      take: 20000,
    });

    if (byLine) {
      const rows = invoices.flatMap((i) => i.lineItems.map((li) => ({ i, li })));
      return sendCsv(res, `${base}-by-material`, [
        { label: 'Invoice no.', get: (r) => r.i.invoiceNumber },
        { label: 'Status', get: (r) => r.i.status },
        { label: 'Date', get: (r) => isoDate(r.i.date) },
        { label: 'Buyer', get: (r) => r.i.consignee?.name },
        { label: 'Country', get: (r) => r.i.consignee?.country ?? '' },
        { label: 'Material', get: (r) => r.li.material?.description },
        { label: 'Description', get: (r) => r.li.description ?? '' },
        { label: 'Container', get: (r) => r.li.container?.containerNo ?? '' },
        { label: 'Packages', get: (r) => r.li.packageCount ?? '' },
        { label: 'Gross (MT)', get: (r) => (r.li.grossWeightMt == null ? '' : money(r.li.grossWeightMt)) },
        { label: 'Tare (MT)', get: (r) => (r.li.tareWeightMt == null ? '' : money(r.li.tareWeightMt)) },
        { label: 'Net weight (MT)', get: (r) => money(r.li.netWeightMt) },
        { label: 'Currency', get: (r) => r.i.currency },
        { label: 'Price/MT', get: (r) => money(r.li.pricePerMt) },
        { label: 'Line total', get: (r) => money(r.li.total) },
      ], rows);
    }

    sendCsv(res, base, [
      { label: 'Invoice no.', get: (i) => i.invoiceNumber },
      { label: 'Status', get: (i) => i.status },
      { label: 'Date', get: (i) => isoDate(i.date) },
      { label: 'Buyer', get: (i) => i.consignee?.name },
      { label: 'Country', get: (i) => i.consignee?.country ?? '' },
      { label: 'Buyer email', get: (i) => i.consignee?.email ?? '' },
      { label: 'PO number', get: (i) => i.poNumber ?? '' },
      { label: 'Shipping term', get: (i) => i.shippingTerm ?? '' },
      { label: 'Port', get: (i) => i.fasPort ?? '' },
      { label: 'Transport', get: (i) => i.modeOfTransport ?? '' },
      { label: 'Contract no.', get: (i) => i.contractNo ?? '' },
      { label: 'Containers', get: (i) => i.containers.length },
      { label: 'Container type', get: (i) => i.containers.map((c) => c.containerType).filter(Boolean).join('; ') },
      { label: 'Container no.', get: (i) => i.containers.map((c) => c.containerNo).filter(Boolean).join('; ') },
      { label: 'Seal', get: (i) => i.containers.map((c) => c.seal).filter(Boolean).join('; ') },
      { label: 'Lines', get: (i) => i.lineItems.length },
      { label: 'Total weight (MT)', get: (i) => money(i.lineItems.reduce((s, li) => s + Number(li.netWeightMt), 0)) },
      { label: 'Currency', get: (i) => i.currency },
      { label: 'Subtotal', get: (i) => money(i.subtotal) },
      { label: 'Discount', get: (i) => money(i.discountAmount) },
      { label: 'GST', get: (i) => money(i.gst) },
      { label: 'Total', get: (i) => money(i.total) },
      { label: 'Raised by', get: (i) => i.createdBy?.name ?? '' },
      { label: 'Void reason', get: (i) => i.voidReason ?? '' },
    ], invoices);
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

    const bankSnapshot = await bankSnapshotFor(data.currency);

    // Containers are created first so their ids can be attached to the lines
    // that travelled in them; both happen in one transaction so a failure
    // halfway cannot leave an invoice with orphaned containers.
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.exportInvoice.create({
        data: {
          invoiceNumber: data.invoiceNumber,
          date: data.date ? new Date(data.date) : undefined,
          consigneeId: data.consigneeId,
          currency: data.currency,
          stage: data.stage,
          shippingTerm: data.shippingTerm,
          fasPort: data.fasPort,
          poNumber: data.poNumber,
          contractNo: data.contractNo,
          modeOfTransport: data.modeOfTransport,
          ...invoiceTotals(buildLines(data.lineItems), data),
          bankSnapshot,
          createdById: req.user.id,
          containers: {
            create: data.containers.map((c, position) => ({ ...c, position })),
          },
        },
        include: { containers: { orderBy: { position: 'asc' } } },
      });

      const containerIds = created.containers.map((c) => c.id);
      await tx.invoiceLineItem.createMany({
        data: buildLines(data.lineItems, containerIds).map((l) => ({
          ...l,
          invoiceId: created.id,
        })),
      });

      return tx.exportInvoice.findUnique({ where: { id: created.id }, include: DETAIL_INCLUDE });
    });

    // A packing slip is not a sale. Pushing one would raise a zero-value sales
    // invoice in Xero for goods nobody has been billed for yet. It reaches Xero
    // when it is priced, which is an update that carries stage INVOICED.
    if (invoice.stage !== 'PACKING_SLIP') await pushSalesInvoiceToXero(invoice);

    await audit({
      req,
      action: 'CREATE',
      entity: 'ExportInvoice',
      entityId: invoice.id,
      label: `${invoice.stage === 'PACKING_SLIP' ? 'Packing slip' : 'Invoice'} ${invoice.invoiceNumber}`,
      after: {
        stage: invoice.stage,
        currency: invoice.currency,
        total: String(invoice.total),
        consigneeId: invoice.consigneeId,
      },
    });

    // Saved either way — refusing would lose the operator's typing — but the
    // document would print with no account for the buyer to pay into, so say so.
    const warnings = (await bankAccountIsBlank(data.currency))
      ? [`No ${data.currency} bank account is set up in Settings, so this invoice has no payment details.`]
      : undefined;

    res.status(201).json({ invoice: withParsedSnapshot(invoice), warnings });
  })
);

// PATCH /api/invoices/:id — the bank snapshot is deliberately not refreshed when
// the account details change: it records them as they stood when the invoice was
// issued, and the buyer may already have paid against them. Changing the invoice's
// *currency* is the one exception, because the snapshot then names an account in
// the wrong currency entirely.
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = invoicePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const data = parsed.data;

    const existing = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        stage: true,
        currency: true,
        issuedAt: true,
        applyGst: true,
        discountType: true,
        discountValue: true,
        total: true,
      },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status === 'VOID') {
      return res
        .status(409)
        .json({ error: 'This invoice is voided. Restore it before making changes.' });
    }
    if (existing.issuedAt) {
      return res.status(409).json({
        error:
          'This invoice has been issued to the buyer and can no longer be edited. Void it and raise a replacement.',
      });
    }

    // Stage only ever moves forward. A priced invoice can still be opened and
    // edited through its packing-slip view — it is one record, so the slip and
    // the invoice are always the same figures — but saving from that view must
    // not push it back to PACKING_SLIP, which would drop a real sale out of
    // every total, report and buyer ranking without anyone being told.
    if (existing.stage === 'INVOICED' && data.stage === 'PACKING_SLIP') {
      return res.status(409).json({
        error:
          'This shipment has already been priced into an invoice. Edit it here and the packing list updates with it; it cannot be turned back into an unpriced slip.',
      });
    }

    const settled = {
      applyGst: data.applyGst ?? existing.applyGst,
      discountType: data.discountType ?? existing.discountType,
      discountValue:
        data.discountValue !== undefined ? data.discountValue : Number(existing.discountValue),
    };

    // When lines are replaced without also replacing the containers, their
    // containerIndex refers to the containers already on the invoice.
    if (data.lineItems && !data.containers) {
      const have = await prisma.invoiceContainer.count({ where: { invoiceId: req.params.id } });
      const dangling = data.lineItems.some(
        (li) => li.containerIndex != null && li.containerIndex >= have
      );
      if (dangling) {
        return res.status(400).json({
          error: `A line points at container #${have + 1}, but this invoice has ${have}.`,
        });
      }
    }

    const currencyChanged = data.currency && data.currency !== existing.currency;
    const rebankedSnapshot = currencyChanged ? await bankSnapshotFor(data.currency) : undefined;

    let invoice;
    try {
      invoice = await prisma.$transaction(async (tx) => {
        const updateData = {
          ...(data.invoiceNumber ? { invoiceNumber: data.invoiceNumber } : {}),
          ...(data.date ? { date: new Date(data.date) } : {}),
          ...(data.consigneeId ? { consigneeId: data.consigneeId } : {}),
          ...(data.currency ? { currency: data.currency } : {}),
          // The packing slip becoming an invoice is this one field changing.
          ...(data.stage ? { stage: data.stage } : {}),
          ...(currencyChanged ? { bankSnapshot: rebankedSnapshot } : {}),
          ...(data.shippingTerm !== undefined ? { shippingTerm: data.shippingTerm } : {}),
          ...(data.fasPort !== undefined ? { fasPort: data.fasPort } : {}),
          ...(data.poNumber !== undefined ? { poNumber: data.poNumber } : {}),
          ...(data.contractNo !== undefined ? { contractNo: data.contractNo } : {}),
          ...(data.modeOfTransport !== undefined ? { modeOfTransport: data.modeOfTransport } : {}),
          editedById: req.user.id,
        };

        // Lines go first: they reference containers, and replacing the container
        // list would otherwise blank the links of lines about to be replaced anyway.
        if (data.lineItems) {
          await tx.invoiceLineItem.deleteMany({ where: { invoiceId: req.params.id } });
        }

        let containerIds;
        if (data.containers) {
          await tx.invoiceContainer.deleteMany({ where: { invoiceId: req.params.id } });
          for (const [position, c] of data.containers.entries()) {
            const row = await tx.invoiceContainer.create({
              data: { ...c, position, invoiceId: req.params.id },
            });
            (containerIds ??= []).push(row.id);
          }
          containerIds ??= [];
        } else {
          const stored = await tx.invoiceContainer.findMany({
            where: { invoiceId: req.params.id },
            orderBy: { position: 'asc' },
            select: { id: true },
          });
          containerIds = stored.map((c) => c.id);
        }

        const totalsAffected =
          data.lineItems ||
          data.applyGst !== undefined ||
          data.discountType !== undefined ||
          data.discountValue !== undefined;

        if (totalsAffected) {
          let lines;
          if (data.lineItems) {
            lines = buildLines(data.lineItems, containerIds);
            updateData.lineItems = { create: lines };
          } else {
            const stored = await tx.invoiceLineItem.findMany({
              where: { invoiceId: req.params.id },
              select: { total: true },
            });
            lines = stored.map((l) => ({ total: Number(l.total) }));
          }
          Object.assign(updateData, invoiceTotals(lines, settled));
        }

        // Scoped to the version the operator loaded. A stale save rolls the
        // whole transaction back, so the replaced lines and containers come
        // back too. See lib/concurrency.js.
        return tx.exportInvoice.update({
          where: guardedWhere(req.params.id, data.expectedUpdatedAt),
          data: updateData,
          include: DETAIL_INCLUDE,
        });
      });
    } catch (err) {
      if (isStaleWrite(err)) {
        return res.status(409).json({ error: STALE_WRITE_MESSAGE, conflict: true });
      }
      throw err;
    }

    // A packing slip is not a sale. Pushing one would raise a zero-value sales
    // invoice in Xero for goods nobody has been billed for yet. It reaches Xero
    // when it is priced, which is an update that carries stage INVOICED.
    if (invoice.stage !== 'PACKING_SLIP') await pushSalesInvoiceToXero(invoice);

    const changed = diff(existing, invoice, [
      'stage', 'currency', 'total', 'applyGst', 'discountType', 'discountValue', 'invoiceNumber',
    ]);
    await audit({
      req,
      action: 'UPDATE',
      entity: 'ExportInvoice',
      entityId: invoice.id,
      // Pricing a slip is the event most worth finding again: it is the moment
      // a weighed shipment becomes money owed.
      label:
        existing.stage === 'PACKING_SLIP' && invoice.stage === 'INVOICED'
          ? `Invoice ${invoice.invoiceNumber} — priced from packing slip`
          : `Invoice ${invoice.invoiceNumber}`,
      before: changed?.before,
      after: changed?.after,
    });

    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

/**
 * POST /api/invoices/:id/issue — send the invoice to the buyer.
 *
 * The PATCH above has always refused to edit an issued invoice, and the CSV has
 * always had an "Issued" column — but nothing ever set `issuedAt`, so the lock
 * described an event that could not happen and an export invoice stayed
 * editable for ever, including after the buyer had paid against it. A docket
 * freezes when it is handed over; a commercial invoice is the same promise to a
 * different party, and it now freezes the same way.
 *
 * One-way, like the docket: un-issuing would make the lock meaningless. A
 * correction after issue is a void and a replacement, which is what leaves the
 * buyer and the auditor with a coherent pair of documents.
 */
router.post(
  '/:id/issue',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await prisma.exportInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, invoiceNumber: true, status: true, stage: true, issuedAt: true },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status === 'VOID') {
      return res.status(409).json({ error: 'A voided invoice cannot be issued.' });
    }
    if (existing.stage === 'PACKING_SLIP') {
      return res.status(409).json({
        error:
          'This is still an unpriced packing slip. Price the lines first — issuing would send the buyer an invoice for nothing.',
      });
    }
    if (existing.issuedAt) {
      return res.status(409).json({ error: 'This invoice has already been issued.' });
    }

    const invoice = await prisma.exportInvoice.update({
      where: { id: req.params.id },
      data: { issuedAt: new Date() },
      include: DETAIL_INCLUDE,
    });
    await audit({
      req,
      action: 'ISSUE',
      entity: 'ExportInvoice',
      entityId: invoice.id,
      label: `Invoice ${invoice.invoiceNumber}`,
      after: { issuedAt: invoice.issuedAt, total: String(invoice.total), currency: invoice.currency },
    });
    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

router.post(
  '/:id/void',
  requireAuth,
  // Voiding reverses a financial record — see the note on the docket route.
  requireRole('ADMIN'),
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
    await audit({
      req,
      action: 'VOID',
      entity: 'ExportInvoice',
      entityId: invoice.id,
      label: `Invoice ${invoice.invoiceNumber}`,
      before: { status: 'ACTIVE', total: String(invoice.total) },
      after: { status: 'VOID', voidReason: reason.data },
    });
    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

router.post(
  '/:id/restore',
  requireAuth,
  requireRole('ADMIN'),
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
    await audit({
      req,
      action: 'RESTORE',
      entity: 'ExportInvoice',
      entityId: invoice.id,
      label: `Invoice ${invoice.invoiceNumber}`,
      before: { status: 'VOID' },
      after: { status: 'ACTIVE' },
    });
    res.json({ invoice: withParsedSnapshot(invoice) });
  })
);

/**
 * DELETE is deliberately not implemented — see dockets.js. A commercial invoice
 * may already be with a buyer, a bank or a customs broker; it is voided, never
 * erased.
 */
router.delete('/:id', requireAuth, (req, res) => {
  res.status(405).json({
    error: 'Invoices cannot be deleted. Void it instead — the number and history are kept.',
  });
});

export default router;
