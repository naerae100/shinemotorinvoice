import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * Everything here reports on ACTIVE records only — a voided docket must not
 * appear in a total the operator is reconciling against the bank.
 */
const ACTIVE = { status: 'ACTIVE' };

function parseRange(query) {
  const now = new Date();
  const valid = (d) => d && !Number.isNaN(d.getTime());

  let to = query.to ? new Date(String(query.to)) : null;
  let from = query.from ? new Date(String(query.from)) : null;
  // Fall back to the current month rather than erroring on a mistyped date.
  if (!valid(to)) to = now;
  if (!valid(from)) from = new Date(now.getFullYear(), now.getMonth(), 1);

  if (!String(query.to || '').includes('T')) to.setHours(23, 59, 59, 999);
  return { from, to };
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Monday-based ISO-ish week key, so a "week" matches how a yard thinks about it. */
function weekKey(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return dayKey(x);
}

const KEY_FOR = { day: dayKey, week: weekKey, month: monthKey };

/**
 * Buckets rows into a continuous series — including empty periods, so a chart
 * shows the gap on a quiet Tuesday rather than joining Monday to Wednesday.
 */
function buildSeries(from, to, granularity, datasets) {
  const keyFn = KEY_FOR[granularity] || dayKey;
  const buckets = new Map();

  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  if (granularity === 'month') cursor.setDate(1);
  if (granularity === 'week') cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));

  while (cursor <= to) {
    const key = keyFn(cursor);
    if (!buckets.has(key)) {
      buckets.set(key, Object.fromEntries(Object.keys(datasets).flatMap((n) => [[n, 0], [`${n}Count`, 0]])));
    }
    if (granularity === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else if (granularity === 'week') cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
  }

  for (const [name, rows] of Object.entries(datasets)) {
    for (const row of rows) {
      const key = keyFn(new Date(row.date));
      if (!buckets.has(key)) continue;
      const b = buckets.get(key);
      b[name] += Number(row.value);
      b[`${name}Count`] += 1;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, values]) => ({
      period,
      ...Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])
      ),
    }));
}

const sumOf = (agg, field) => Number(agg._sum?.[field] ?? 0);

// GET /api/reports/overview?from=&to=&granularity=day|week|month
router.get(
  '/overview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req.query);
    const granularity = ['day', 'week', 'month'].includes(String(req.query.granularity))
      ? String(req.query.granularity)
      : 'day';

    const dateRange = { gte: from, lte: to };
    const docketWhere = { ...ACTIVE, date: dateRange };
    const invoiceWhere = { ...ACTIVE, date: dateRange };

    const purchaseAgg = await prisma.docket.aggregate({
      where: docketWhere,
      _count: { _all: true },
      _sum: { total: true, subtotal: true, gst: true, discountAmount: true },
    });
    const salesAgg = await prisma.exportInvoice.aggregate({
      where: invoiceWhere,
      _count: { _all: true },
      _sum: { totalAud: true, subtotalAud: true, gstAud: true, discountAmount: true },
    });
    const docketRows = await prisma.docket.findMany({ where: docketWhere, select: { date: true, total: true } });
    const invoiceRows = await prisma.exportInvoice.findMany({ where: invoiceWhere, select: { date: true, totalAud: true } });
    const topBought = await prisma.docketLineItem.groupBy({
      by: ['materialId'],
      _sum: { netWeight: true, value: true },
      where: { docket: docketWhere },
      orderBy: { _sum: { value: 'desc' } },
      take: 8,
    });
    const topSold = await prisma.invoiceLineItem.groupBy({
      by: ['materialId'],
      _sum: { weightTonnes: true, totalAud: true },
      where: { invoice: invoiceWhere },
      orderBy: { _sum: { totalAud: 'desc' } },
      take: 8,
    });
    const topSuppliers = await prisma.docket.groupBy({
      by: ['supplierId'],
      _sum: { total: true },
      _count: { _all: true },
      where: docketWhere,
      orderBy: { _sum: { total: 'desc' } },
      take: 8,
    });
    const topConsignees = await prisma.exportInvoice.groupBy({
      by: ['consigneeId'],
      _sum: { totalAud: true },
      _count: { _all: true },
      where: invoiceWhere,
      orderBy: { _sum: { totalAud: 'desc' } },
      take: 8,
    });
    const recentDockets = await prisma.docket.findMany({
      where: ACTIVE,
      orderBy: { date: 'desc' },
      take: 6,
      include: { supplier: { select: { id: true, name: true } } },
    });
    const recentInvoices = await prisma.exportInvoice.findMany({
      where: ACTIVE,
      orderBy: { date: 'desc' },
      take: 6,
      include: { consignee: { select: { id: true, name: true } } },
    });
    const voidCount = await prisma.docket.count({ where: { status: 'VOID', date: dateRange } });

    // Resolve the grouped ids to names in one round trip each.
    const [materials, suppliers, consignees] = await Promise.all([
      prisma.material.findMany({
        where: { id: { in: [...topBought, ...topSold].map((r) => r.materialId) } },
      }),
      prisma.supplier.findMany({ where: { id: { in: topSuppliers.map((r) => r.supplierId) } } }),
      prisma.consignee.findMany({ where: { id: { in: topConsignees.map((r) => r.consigneeId) } } }),
    ]);
    const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
    const materialMap = byId(materials);
    const supplierMap = byId(suppliers);
    const consigneeMap = byId(consignees);

    const purchasesTotal = sumOf(purchaseAgg, 'total');
    const salesTotal = sumOf(salesAgg, 'totalAud');

    res.json({
      range: { from, to, granularity },
      purchases: {
        count: purchaseAgg._count._all,
        total: purchasesTotal,
        subtotal: sumOf(purchaseAgg, 'subtotal'),
        gst: sumOf(purchaseAgg, 'gst'),
        discount: sumOf(purchaseAgg, 'discountAmount'),
      },
      sales: {
        count: salesAgg._count._all,
        total: salesTotal,
        subtotal: sumOf(salesAgg, 'subtotalAud'),
        gst: sumOf(salesAgg, 'gstAud'),
        discount: sumOf(salesAgg, 'discountAmount'),
      },
      // Sales minus purchases over the same window. This is a cash-movement
      // figure, not accounting profit — stock bought this month may not be sold
      // until next, so a negative number is normal in a buying month.
      grossMargin: Math.round((salesTotal - purchasesTotal) * 100) / 100,
      voidedInRange: voidCount,
      series: buildSeries(from, to, granularity, {
        purchases: docketRows.map((d) => ({ date: d.date, value: d.total })),
        sales: invoiceRows.map((i) => ({ date: i.date, value: i.totalAud })),
      }),
      topMaterialsBought: topBought
        .filter((r) => materialMap[r.materialId])
        .map((r) => ({
          material: materialMap[r.materialId],
          weight: Number(r._sum.netWeight ?? 0),
          value: Number(r._sum.value ?? 0),
        })),
      topMaterialsSold: topSold
        .filter((r) => materialMap[r.materialId])
        .map((r) => ({
          material: materialMap[r.materialId],
          weight: Number(r._sum.weightTonnes ?? 0),
          value: Number(r._sum.totalAud ?? 0),
        })),
      topSuppliers: topSuppliers
        .filter((r) => supplierMap[r.supplierId])
        .map((r) => ({
          client: supplierMap[r.supplierId],
          count: r._count._all,
          value: Number(r._sum.total ?? 0),
        })),
      topConsignees: topConsignees
        .filter((r) => consigneeMap[r.consigneeId])
        .map((r) => ({
          client: consigneeMap[r.consigneeId],
          count: r._count._all,
          value: Number(r._sum.totalAud ?? 0),
        })),
      recentDockets,
      recentInvoices,
    });
  })
);

// GET /api/reports/supplier/:id?from=&to= — one supplier's full picture
router.get(
  '/supplier/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req.query);
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const inRange = { ...ACTIVE, supplierId: supplier.id, date: { gte: from, lte: to } };

    const rangeAgg = await prisma.docket.aggregate({
      where: inRange,
      _count: { _all: true },
      _sum: { total: true, gst: true },
    });
    const lifetimeAgg = await prisma.docket.aggregate({
      where: { ...ACTIVE, supplierId: supplier.id },
      _count: { _all: true },
      _sum: { total: true },
    });
    const materials = await prisma.docketLineItem.groupBy({
      by: ['materialId'],
      _sum: { netWeight: true, value: true },
      _count: { _all: true },
      where: { docket: inRange },
      orderBy: { _sum: { value: 'desc' } },
    });
    const rows = await prisma.docket.findMany({ where: inRange, select: { date: true, total: true } });
    const dockets = await prisma.docket.findMany({
      where: { supplierId: supplier.id },
      include: { lineItems: { include: { material: true } } },
      orderBy: { date: 'desc' },
      take: 50,
    });
    const firstDocket = await prisma.docket.findFirst({
      where: { ...ACTIVE, supplierId: supplier.id },
      orderBy: { date: 'asc' },
      select: { date: true },
    });

    const materialRows = await prisma.material.findMany({
      where: { id: { in: materials.map((m) => m.materialId) } },
    });
    const materialMap = Object.fromEntries(materialRows.map((m) => [m.id, m]));

    res.json({
      supplier,
      range: { from, to },
      inRange: {
        count: rangeAgg._count._all,
        total: Number(rangeAgg._sum.total ?? 0),
        gst: Number(rangeAgg._sum.gst ?? 0),
      },
      lifetime: {
        count: lifetimeAgg._count._all,
        total: Number(lifetimeAgg._sum.total ?? 0),
        firstDealt: firstDocket?.date ?? null,
      },
      series: buildSeries(from, to, 'month', {
        purchases: rows.map((d) => ({ date: d.date, value: d.total })),
      }),
      materials: materials
        .filter((m) => materialMap[m.materialId])
        .map((m) => ({
          material: materialMap[m.materialId],
          lines: m._count._all,
          weight: Number(m._sum.netWeight ?? 0),
          value: Number(m._sum.value ?? 0),
        })),
      dockets,
    });
  })
);

// GET /api/reports/consignee/:id?from=&to= — one buyer's full picture
router.get(
  '/consignee/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req.query);
    const consignee = await prisma.consignee.findUnique({ where: { id: req.params.id } });
    if (!consignee) return res.status(404).json({ error: 'Consignee not found' });

    const inRange = { ...ACTIVE, consigneeId: consignee.id, date: { gte: from, lte: to } };

    const rangeAgg = await prisma.exportInvoice.aggregate({
      where: inRange,
      _count: { _all: true },
      _sum: { totalAud: true, gstAud: true },
    });
    const lifetimeAgg = await prisma.exportInvoice.aggregate({
      where: { ...ACTIVE, consigneeId: consignee.id },
      _count: { _all: true },
      _sum: { totalAud: true },
    });
    const materials = await prisma.invoiceLineItem.groupBy({
      by: ['materialId'],
      _sum: { weightTonnes: true, totalAud: true },
      _count: { _all: true },
      where: { invoice: inRange },
      orderBy: { _sum: { totalAud: 'desc' } },
    });
    const rows = await prisma.exportInvoice.findMany({ where: inRange, select: { date: true, totalAud: true } });
    const invoices = await prisma.exportInvoice.findMany({
      where: { consigneeId: consignee.id },
      include: { lineItems: { include: { material: true } } },
      orderBy: { date: 'desc' },
      take: 50,
    });

    const materialRows = await prisma.material.findMany({
      where: { id: { in: materials.map((m) => m.materialId) } },
    });
    const materialMap = Object.fromEntries(materialRows.map((m) => [m.id, m]));

    res.json({
      consignee,
      range: { from, to },
      inRange: {
        count: rangeAgg._count._all,
        total: Number(rangeAgg._sum.totalAud ?? 0),
        gst: Number(rangeAgg._sum.gstAud ?? 0),
      },
      lifetime: {
        count: lifetimeAgg._count._all,
        total: Number(lifetimeAgg._sum.totalAud ?? 0),
      },
      series: buildSeries(from, to, 'month', {
        sales: rows.map((d) => ({ date: d.date, value: d.totalAud })),
      }),
      materials: materials
        .filter((m) => materialMap[m.materialId])
        .map((m) => ({
          material: materialMap[m.materialId],
          lines: m._count._all,
          weight: Number(m._sum.weightTonnes ?? 0),
          value: Number(m._sum.totalAud ?? 0),
        })),
      invoices,
    });
  })
);

// Kept for the old dashboard shape while the new one rolls out.
router.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayAgg = await prisma.docket.aggregate({
      where: { ...ACTIVE, date: { gte: today } },
      _count: { _all: true },
      _sum: { total: true },
    });
    const monthAgg = await prisma.docket.aggregate({
      where: { ...ACTIVE, date: { gte: monthStart } },
      _count: { _all: true },
      _sum: { total: true },
    });

    res.json({
      today: { docketCount: todayAgg._count._all, totalValue: Number(todayAgg._sum.total ?? 0) },
      month: { docketCount: monthAgg._count._all, totalValue: Number(monthAgg._sum.total ?? 0) },
    });
  })
);

export default router;
