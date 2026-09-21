import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import {
  boundaryInstant,
  zonedInstant,
  zonedParts,
  zonedDayKey,
  zonedMonthKey,
  zonedWeekKey,
} from '../lib/timezone.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { round3 } from '../lib/money.js';

const router = Router();

const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Australia/Sydney';

/**
 * A stored timestamp as business-local wall clock.
 *
 * Prisma maps DateTime to `timestamp without time zone`, and the values in it
 * are UTC instants. `"date" AT TIME ZONE 'Australia/Sydney'` on such a column
 * does the opposite of what it looks like: it *interprets* the naive value as
 * Sydney wall clock rather than converting a UTC instant into one. The result
 * is the UTC calendar day wearing a Sydney label.
 *
 * At UTC+10/+11 that means every docket written before 10am — most of a
 * morning at a scrap yard — was filed under the previous day. It did not just
 * shift a bar: buildSeries drops any row whose bucket key is not in the
 * requested window, so a docket bought this morning counted in the tile above
 * the chart and was silently absent from the chart itself. Same for the
 * payables ageing, and the activity heatmap was plotting UTC hours, so a 9am
 * load appeared at 23:00.
 *
 * Attaching UTC first and then converting is the whole fix. It is also why
 * this returns a naive timestamp rather than a timestamptz: the result no
 * longer depends on the database session's own TimeZone setting, which is
 * Sydney on this laptop and UTC on the server.
 */
const localTime = (column) =>
  Prisma.sql`(${Prisma.raw(`"${column}"`)} AT TIME ZONE 'UTC' AT TIME ZONE ${BUSINESS_TZ})`;

/**
 * The same stored timestamp as a true instant, for comparing against a bound
 * Date.
 *
 * $queryRaw binds a JS Date as `timestamptz`. Comparing that to a naive column
 * makes Postgres read the column in the database session's own TimeZone — so
 * the identical window returned different rows depending on where the query
 * ran. Measured: for 18 September, prisma.findMany matched three dockets and
 * the raw query matched none, because this laptop's session is Sydney while
 * the server's is UTC.
 *
 * Attaching UTC to the column puts both sides of the comparison on real
 * instants, and the answer stops depending on the connection.
 */
const utcInstant = (column) =>
  Prisma.sql`(${Prisma.raw(`"${column}"`)} AT TIME ZONE 'UTC')`;

/**
 * Everything here reports on ACTIVE records only — a voided docket must not
 * appear in a total the operator is reconciling against the bank.
 */
const ACTIVE = { status: 'ACTIVE' };

/**
 * Reporting only ever means priced sales. A packing slip is an ExportInvoice row
 * too, but it has no prices yet, so counting one would add a zero-value sale to
 * every average, count and buyer ranking on the dashboard.
 */
const SALES = { status: 'ACTIVE', stage: 'INVOICED' };

/**
 * Shipments grouped by the contract they were shipped under.
 *
 * The contract number is the reference a buyer files and pays against, and one
 * contract routinely covers two or three separate container shipments. Totals
 * are kept per currency and never added together: a contract part-shipped in
 * AUD and part in USD has two totals, and one number claiming to be their sum
 * would be a fiction.
 *
 * Shipments with no contract number are collected under a null key rather than
 * dropped — they are still the buyer's shipments.
 */
function buildContracts(shipments) {
  const byContract = new Map();
  for (const s of shipments) {
    const key = s.contractNo || null;
    if (!byContract.has(key)) {
      byContract.set(key, {
        contractNo: key,
        shipments: [],
        totals: {},
        netWeightMt: 0,
        slipCount: 0,
        invoiceCount: 0,
      });
    }
    const c = byContract.get(key);
    const isSlip = s.stage === 'PACKING_SLIP' || s.netWeightMt !== undefined;
    const net =
      s.netWeightMt ??
      (s.lineItems ?? []).reduce((sum, li) => sum + Number(li.netWeightMt), 0);
    c.netWeightMt += net;
    if (isSlip) {
      c.slipCount += 1;
    } else {
      c.invoiceCount += 1;
      const cur = s.currency || 'AUD';
      c.totals[cur] = (c.totals[cur] ?? 0) + Number(s.total ?? 0);
    }
    c.shipments.push({
      id: s.id,
      invoiceNumber: s.invoiceNumber,
      date: s.date,
      stage: isSlip ? 'PACKING_SLIP' : 'INVOICED',
      currency: s.currency ?? null,
      total: isSlip ? null : Number(s.total ?? 0),
      netWeightMt: net,
    });
  }
  return [...byContract.values()].sort((a, b) => {
    if (a.contractNo === null) return 1;
    if (b.contractNo === null) return -1;
    return a.contractNo.localeCompare(b.contractNo);
  });
}

/**
 * Small in-process cache so flicking between date ranges doesn't re-query.
 * It is per-instance and short-lived by design — this is a latency smoother,
 * not a source of truth. Bounded because the key includes an arbitrary date
 * range: without eviction, a user dragging the date picker grows it forever.
 */
const CACHE_TTL_MS = 15_000;
const CACHE_MAX_ENTRIES = 50;
const dashboardCache = new Map();

function cacheGet(key) {
  const hit = dashboardCache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expires) {
    dashboardCache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  // Drop anything already expired, then the oldest, to keep the map bounded.
  for (const [k, v] of dashboardCache) {
    if (Date.now() >= v.expires) dashboardCache.delete(k);
  }
  while (dashboardCache.size >= CACHE_MAX_ENTRIES) {
    dashboardCache.delete(dashboardCache.keys().next().value);
  }
  dashboardCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Drop every cached window after a write.
 *
 * The cache is keyed by date range, so there is no way to tell which entries a
 * given docket or invoice touched without re-deriving its range. Clearing all
 * of it is correct and cheap — the map holds at most CACHE_MAX_ENTRIES. Without
 * this, voiding a docket left its value sitting in the dashboard totals for up
 * to CACHE_TTL_MS, which reads as the money never having left.
 */
export function invalidateDashboardCache() {
  dashboardCache.clear();
}

function parseRange(query) {
  const now = new Date();
  const here = zonedParts(now);

  // Bounds are business dates in the yard's timezone, not the server's. See
  // src/lib/timezone.js for why that distinction moved a whole day of trading.
  let to = boundaryInstant(query.to, 'end');
  let from = boundaryInstant(query.from, 'start');

  // Fall back to the current month rather than erroring on a mistyped date.
  if (!to) to = zonedInstant(here.year, here.month, here.day, 23, 59, 59, 999);
  if (!from) from = zonedInstant(here.year, here.month, 1);

  return { from, to };
}
// Business quarters start Jul 1, Oct 1, Jan 1, Apr 1
function currentBasQuarter(nowInstant) {
  const p = zonedParts(nowInstant);
  let qStartMonth;
  let qName;
  if (p.month >= 7 && p.month <= 9) { qStartMonth = 7; qName = 'Jul–Sep'; }
  else if (p.month >= 10 && p.month <= 12) { qStartMonth = 10; qName = 'Oct–Dec'; }
  else if (p.month >= 1 && p.month <= 3) { qStartMonth = 1; qName = 'Jan–Mar'; }
  else { qStartMonth = 4; qName = 'Apr–Jun'; }
  
  return {
    name: qName,
    start: zonedInstant(p.year, qStartMonth, 1),
    end: zonedInstant(p.year, qStartMonth + 3, 0, 23, 59, 59, 999) // Last day of month before next quarter
  };
}
// Bucket keys are business days too. Computing them from the server clock put
// a 9am Sydney docket in the previous day's column, so the chart disagreed with
// the docket it was drawn from.
const dayKey = zonedDayKey;
const monthKey = zonedMonthKey;
const weekKey = zonedWeekKey;

const KEY_FOR = { day: dayKey, week: weekKey, month: monthKey };

/**
 * Buckets rows into a continuous series — including empty periods, so a chart
 * shows the gap on a quiet Tuesday rather than joining Monday to Wednesday.
 */
export function buildSeries(from, to, granularity, datasets) {
  const keyFn = KEY_FOR[granularity] || dayKey;
  const buckets = new Map();

  // Walk business days, not server days. Midday is used as each step's instant
  // so a daylight-saving change — 2am on a Sunday in April and October — cannot
  // push a step onto the wrong side of midnight and drop or repeat a column.
  //
  // The walk starts at the beginning of the period the range starts in, not at
  // the range's own first day. Stepping seven days from an arbitrary start
  // landed every week bucket on that weekday — a range beginning on a
  // Wednesday produced Wednesday keys — while the SQL groups by date_trunc,
  // which is always a Monday. The keys only had to differ for a row to be
  // dropped: anything whose period is not already a bucket is skipped below.
  // The visible symptom was the last week of a range going missing, because
  // the final step overshot `to` before that Monday was ever created.
  const start = zonedParts(from);
  let cursor = zonedInstant(start.year, start.month, start.day, 12);
  if (granularity === 'month') {
    cursor = zonedInstant(start.year, start.month, 1, 12);
  } else if (granularity === 'week') {
    // Back up to Monday, the same anchor Postgres uses and the same one
    // zonedWeekKey uses when it labels a row.
    const dow = new Date(cursor).getUTCDay(); // relative to the noon instant
    const backTo = zonedParts(cursor);
    cursor = zonedInstant(backTo.year, backTo.month, backTo.day - ((dow + 6) % 7), 12);
  }

  while (cursor <= to) {
    const key = keyFn(cursor);
    if (!buckets.has(key)) {
      buckets.set(key, Object.fromEntries(Object.keys(datasets).flatMap((n) => [[n, 0], [`${n}Count`, 0]])));
    }
    const at = zonedParts(cursor);
    // Date.UTC normalises overflow, so day 32 and month 13 roll over correctly.
    if (granularity === 'month') cursor = zonedInstant(at.year, at.month + 1, 1, 12);
    else if (granularity === 'week') cursor = zonedInstant(at.year, at.month, at.day + 7, 12);
    else cursor = zonedInstant(at.year, at.month, at.day + 1, 12);
  }

  for (const [name, rows] of Object.entries(datasets)) {
    for (const row of rows) {
      // If the row is pre-bucketed by SQL, it has a period string. Otherwise fallback to the date.
      const key = row.period ? row.period : keyFn(new Date(row.date));
      if (!buckets.has(key)) continue;
      const b = buckets.get(key);
      b[name] += Number(row.value);
      b[`${name}Count`] += Number(row.count ?? 1);
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, values]) => ({
      period,
      ...Object.fromEntries(
        // round3, like every other money figure in the system. At two decimals
        // the chart's own table printed USD 316,611.880 directly underneath a
        // tile reading USD 316,611.879, off by a tenth of a cent — the same
        // number twice on one screen, disagreeing.
        Object.entries(values).map(([k, v]) => [k, typeof v === 'number' ? round3(v) : v])
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
    const invoiceWhere = { ...SALES, date: dateRange };

    // The equivalent window immediately before this one, so every headline
    // number can be read as a movement rather than a bare figure. A total means
    // little on its own; "up 18% on the previous 21 days" means something.
    const spanMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    const prevRange = { gte: prevFrom, lte: prevTo };

    const basQuarter = currentBasQuarter(new Date());
    const qtdRange = { gte: basQuarter.start, lte: new Date() };

    const cacheKey = `${from.toISOString()}_${to.toISOString()}_${granularity}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json(cached);
    }

    // One wave, not six. Every query is a network round trip, so issuing these
    // sequentially cost ~6x the latency for no benefit — none of them depend on
    // each other. Prisma queues internally to its own connection limit, so this
    // does not overwhelm the pgBouncer pool.
    const results = await Promise.all([
      prisma.docket.aggregate({
        where: docketWhere,
        _count: { _all: true },
        _sum: { total: true, subtotal: true, gst: true, discountAmount: true },
      }),
      prisma.exportInvoice.groupBy({
        by: ['currency'],
        where: invoiceWhere,
        _count: { _all: true },
        _sum: { total: true, subtotal: true, gst: true, discountAmount: true },
      }),
      prisma.docket.count({ where: { status: 'VOID', date: dateRange } }),
      prisma.$queryRaw`
        SELECT 
          to_char(date_trunc(${granularity}::text, ${localTime('date')}), ${granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}) AS period,
          SUM(total) as value,
          CAST(COUNT(*) AS INTEGER) as count
        FROM "Docket"
        WHERE status = 'ACTIVE' AND ${utcInstant('date')} >= ${from} AND ${utcInstant('date')} <= ${to}
        GROUP BY period
      `,
      // Grouped by currency, not filtered to one.
      //
      // This was `currency = 'AUD'`, which meant a container sold in USD —
      // most of them — was simply absent from the chart and from the table
      // behind it. The tiles above already reported USD on their own card, so
      // the dashboard said the yard had sold something and then drew a flat
      // line underneath it.
      //
      // Currencies are still never added together; they become separate series
      // downstream, each with its own scale and its own label.
      prisma.$queryRaw`
        SELECT 
          to_char(date_trunc(${granularity}::text, ${localTime('date')}), ${granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD'}) AS period,
          COALESCE(currency, 'AUD') AS currency,
          SUM(total) as value,
          CAST(COUNT(*) AS INTEGER) as count
        FROM "ExportInvoice"
        WHERE status = 'ACTIVE' AND stage = 'INVOICED' AND ${utcInstant('date')} >= ${from} AND ${utcInstant('date')} <= ${to}
        GROUP BY period, COALESCE(currency, 'AUD')
      `,
      prisma.docketLineItem.groupBy({
        by: ['materialId'],
        _sum: { netWeight: true, value: true },
        where: { docket: docketWhere },
        orderBy: { _sum: { value: 'desc' } },
        take: 8,
      }),
      prisma.invoiceLineItem.groupBy({
        by: ['materialId'],
        _sum: { netWeightMt: true, total: true },
        // A one-off line typed straight onto an invoice has no material to rank,
        // so it is excluded rather than grouped under a null heading.
        where: { invoice: invoiceWhere, materialId: { not: null } },
        orderBy: { _sum: { total: 'desc' } },
        take: 8,
      }),
      prisma.docket.groupBy({
        by: ['supplierId'],
        _sum: { total: true },
        _count: { _all: true },
        where: docketWhere,
        orderBy: { _sum: { total: 'desc' } },
        take: 8,
      }),
      // Grouped by currency as well as consignee. Grouped by consignee alone
      // it summed a USD invoice and an AUD one into a figure that is neither —
      // the two are never converted anywhere else in this system, and a
      // ranking is not the place to start.
      prisma.exportInvoice.groupBy({
        by: ['consigneeId', 'currency'],
        _sum: { total: true },
        _count: { _all: true },
        where: invoiceWhere,
        orderBy: { _sum: { total: 'desc' } },
        take: 12,
      }),
      prisma.docket.findMany({
        where: ACTIVE,
        orderBy: { date: 'desc' },
        take: 6,
        include: { supplier: { select: { id: true, name: true } } },
      }),
      prisma.exportInvoice.findMany({
        where: SALES,
        orderBy: { date: 'desc' },
        take: 6,
        include: { consignee: { select: { id: true, name: true } } },
      }),
      prisma.docket.aggregate({
        where: { ...ACTIVE, date: prevRange },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.exportInvoice.aggregate({
        where: { ...SALES, date: prevRange, currency: 'AUD' },
        _count: { _all: true },
        _sum: { total: true },
      }),
      // New operational queries
      prisma.docket.aggregate({
        where: { status: 'ACTIVE', paymentStatus: 'UNPAID' },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.$queryRaw`
        SELECT 
          CASE
            WHEN (CURRENT_TIMESTAMP AT TIME ZONE ${BUSINESS_TZ})::date - (${localTime('date')})::date <= 2 THEN '0-2'
            WHEN (CURRENT_TIMESTAMP AT TIME ZONE ${BUSINESS_TZ})::date - (${localTime('date')})::date <= 7 THEN '3-7'
            WHEN (CURRENT_TIMESTAMP AT TIME ZONE ${BUSINESS_TZ})::date - (${localTime('date')})::date <= 14 THEN '8-14'
            ELSE '15+'
          END as bucket,
          CAST(COUNT(*) AS INTEGER) as count,
          SUM(total) as total
        FROM "Docket"
        WHERE status = 'ACTIVE' AND "paymentStatus" = 'UNPAID'
        GROUP BY bucket
      `,
      prisma.docket.findFirst({
        where: { status: 'ACTIVE', paymentStatus: 'UNPAID' },
        orderBy: { date: 'asc' },
        select: { id: true, docketNumber: true, date: true, total: true },
      }),
      prisma.docket.count({ where: { status: 'ACTIVE', issuedAt: null } }),
      prisma.exportInvoice.count({ where: { status: 'ACTIVE', stage: 'PACKING_SLIP' } }),
      prisma.exportInvoice.count({ where: { status: 'ACTIVE', stage: 'INVOICED', issuedAt: null } }),
      prisma.docketLineItem.aggregate({
        where: { docket: { status: 'ACTIVE', date: dateRange } },
        _sum: { netWeight: true }
      }),
      prisma.invoiceLineItem.aggregate({
        where: { invoice: { status: 'ACTIVE', stage: 'INVOICED', date: dateRange } },
        _sum: { netWeightMt: true }
      }),
      prisma.$queryRaw`
        SELECT 
          CAST(EXTRACT(ISODOW FROM ${localTime('createdAt')}) AS INTEGER) as weekday,
          CAST(EXTRACT(HOUR FROM ${localTime('createdAt')}) AS INTEGER) as hour,
          CAST(COUNT(*) AS INTEGER) as count
        FROM "Docket"
        WHERE status = 'ACTIVE' AND ${utcInstant('date')} >= ${from} AND ${utcInstant('date')} <= ${to}
        GROUP BY weekday, hour
      `,
      prisma.docket.groupBy({
        by: ['createdById'],
        where: { status: 'ACTIVE', date: dateRange },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } }
      }),
      prisma.docket.aggregate({
        where: { status: 'ACTIVE', date: qtdRange },
        _sum: { gst: true }
      }),
      prisma.exportInvoice.aggregate({
        where: { status: 'ACTIVE', stage: 'INVOICED', currency: 'AUD', date: qtdRange },
        _sum: { gst: true }
      })
    ]);

    const [
      purchaseAgg,
      salesAgg,
      voidCount,
      docketRows,
      invoiceRows,
      topBought,
      topSold,
      topSuppliers,
      topConsignees,
      recentDockets,
      recentInvoices,
      prevPurchaseAgg,
      prevSalesAgg,
      unpaidAgg,
      agingBuckets,
      oldestUnpaid,
      unissuedDockets,
      unpricedSlips,
      unissuedInvoices,
      kgBoughtAgg,
      mtSoldAgg,
      heatmapData,
      operatorActivity,
      qtdPaidAgg,
      qtdCollectedAgg,
    ] = results;

    // Second wave — these genuinely depend on the groupBy results above, so they
    // cannot join the first. Skipped entirely when there is nothing to resolve.
    const materialIds = [
      ...new Set([...topBought, ...topSold].map((r) => r.materialId).filter(Boolean)),
    ];
    const supplierIds = topSuppliers.map((r) => r.supplierId);
    const consigneeIds = topConsignees.map((r) => r.consigneeId);
    const operatorIds = operatorActivity.map((r) => r.createdById);

    const [materials, suppliers, consignees, users] = await Promise.all([
      materialIds.length
        ? prisma.material.findMany({ where: { id: { in: materialIds } } })
        : [],
      supplierIds.length
        ? prisma.supplier.findMany({ where: { id: { in: supplierIds } } })
        : [],
      consigneeIds.length
        ? prisma.consignee.findMany({ where: { id: { in: consigneeIds } } })
        : [],
      operatorIds.length
        ? prisma.user.findMany({
            where: { id: { in: operatorIds } },
            select: { id: true, name: true }
          })
        : [],
    ]);

    const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
    const materialMap = byId(materials);
    const supplierMap = byId(suppliers);
    const consigneeMap = byId(consignees);
    const userMap = byId(users);

    const purchasesTotal = sumOf(purchaseAgg, 'total');
    // salesAgg is now one row per currency. `salesIn` reads a single currency's
    // figures; the AUD row drives every headline, and the rest are reported
    // beside it rather than being folded in.
    const salesIn = (currency) => salesAgg.find((r) => r.currency === currency);
    const salesFigures = (row) => ({
      count: row?._count._all ?? 0,
      total: Number(row?._sum.total ?? 0),
      subtotal: Number(row?._sum.subtotal ?? 0),
      gst: Number(row?._sum.gst ?? 0),
      discount: Number(row?._sum.discountAmount ?? 0),
    });
    const salesTotal = Number(salesIn('AUD')?._sum.total ?? 0);

    // Every currency the chart has rows for, AUD first and the rest
    // alphabetical. Taken from the series rows themselves rather than from
    // salesAgg, so the keys promised to the chart and the data behind them
    // cannot disagree. AUD is always present even in a period with no AUD
    // sales, because purchases are AUD and the chart pairs the two.
    const seriesCurrencies = [
      'AUD',
      ...[...new Set(invoiceRows.map((r) => r.currency))]
        .filter((c) => c && c !== 'AUD')
        .sort(),
    ];

    // Deliberately NOT s-maxage. This response is per-account financial data
    // behind requireAuth, and a shared CDN keys its cache on the URL, not on the
    // Authorization header — so an edge-cached copy could be served to a request
    // that never presented a token. The in-process cache above provides the speed
    // without publishing the figures to a shared cache.
    res.setHeader('Cache-Control', 'private, no-store');

    const responseData = {
      range: { from, to, granularity },
      purchases: {
        count: purchaseAgg._count._all,
        total: purchasesTotal,
        subtotal: sumOf(purchaseAgg, 'subtotal'),
        gst: sumOf(purchaseAgg, 'gst'),
        discount: sumOf(purchaseAgg, 'discountAmount'),
      },
      // AUD, to sit alongside purchases in the same currency.
      sales: salesFigures(salesIn('AUD')),
      // Every currency actually invoiced in the window, AUD included, so the
      // dashboard can show USD trade without it being added to anything.
      salesByCurrency: salesAgg
        .map((row) => ({ currency: row.currency, ...salesFigures(row) }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      // AUD sales minus AUD purchases over the same window. A cash-movement
      // figure, not accounting profit — stock bought this month may not be sold
      // until next, so a negative number is normal in a buying month. USD sales
      // are excluded rather than converted at an invented rate.
      grossMargin: round3(salesTotal - purchasesTotal),
      gst: {
        paid: sumOf(purchaseAgg, 'gst'),
        collected: Number(salesIn('AUD')?._sum.gst ?? 0)
      },
      bas: {
        quarter: basQuarter.name,
        paid: Number(qtdPaidAgg._sum.gst ?? 0),
        collected: Number(qtdCollectedAgg._sum.gst ?? 0)
      },
      payables: {
        count: unpaidAgg._count._all,
        total: Number(unpaidAgg._sum.total ?? 0),
        buckets: agingBuckets.map(b => ({ bucket: b.bucket, count: b.count, total: Number(b.total ?? 0) })),
        oldest: oldestUnpaid
      },
      pipeline: {
        unissuedDockets,
        unpricedSlips,
        unissuedInvoices
      },
      weightFlow: {
        kgBought: Number(kgBoughtAgg._sum.netWeight ?? 0),
        mtSold: Number(mtSoldAgg._sum.netWeightMt ?? 0)
      },
      heatmap: heatmapData,
      operatorActivity: operatorActivity
        .filter((r) => userMap[r.createdById])
        .map((r) => ({
          user: userMap[r.createdById],
          count: r._count._all
        })),
      previous: {
        from: prevFrom,
        to: prevTo,
        purchases: {
          count: prevPurchaseAgg._count._all,
          total: sumOf(prevPurchaseAgg, 'total'),
        },
        sales: {
          count: prevSalesAgg._count._all,
          total: sumOf(prevSalesAgg, 'total'),
        },
        grossMargin:
          Math.round((sumOf(prevSalesAgg, 'total') - sumOf(prevPurchaseAgg, 'total')) * 100) /
          100,
      },
      voidedInRange: voidCount,
      series: buildSeries(from, to, granularity, {
        purchases: docketRows,
        // `sales` stays the AUD figure, because the tiles and sparklines beside
        // the chart are AUD and must not silently start including USD.
        sales: invoiceRows.filter((r) => r.currency === 'AUD'),
        // One extra dataset per foreign currency, keyed sales_USD, sales_NZD …
        ...Object.fromEntries(
          seriesCurrencies
            .filter((c) => c !== 'AUD')
            .map((c) => [`sales_${c}`, invoiceRows.filter((r) => r.currency === c)])
        ),
      }),
      // Which sales series the rows above actually carry, in a stable order, so
      // the chart does not have to guess at key names or scan every row.
      seriesCurrencies,
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
          weight: Number(r._sum.netWeightMt ?? 0),
          value: Number(r._sum.total ?? 0),
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
          value: Number(r._sum.total ?? 0),
          currency: r.currency || 'AUD',
        })),
      recentDockets,
      recentInvoices,
    };

    // Cache in-memory for 15 seconds to prevent spamming the database
    cacheSet(cacheKey, responseData);

    res.json(responseData);
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

    // Issued together rather than one after another — these were six separate
    // round trips, which on a remote database is six times the latency for no
    // reason, since none of them depend on each other.
    const [rangeAgg, lifetimeAgg, materials, rows, dockets, firstDocket] = await Promise.all([
      prisma.docket.aggregate({
        where: inRange,
        _count: { _all: true },
        _sum: { total: true, gst: true },
      }),
      prisma.docket.aggregate({
        where: { ...ACTIVE, supplierId: supplier.id },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.docketLineItem.groupBy({
        by: ['materialId'],
        _sum: { netWeight: true, value: true },
        _count: { _all: true },
        where: { docket: inRange },
        orderBy: { _sum: { value: 'desc' } },
      }),
      prisma.docket.findMany({ where: inRange, select: { date: true, total: true } }),
      prisma.docket.findMany({
        where: { supplierId: supplier.id },
        include: { lineItems: { include: { material: true } } },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      prisma.docket.findFirst({
        where: { ...ACTIVE, supplierId: supplier.id },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);

    const materialIds = materials.map((m) => m.materialId).filter(Boolean);
    const materialRows = materialIds.length
      ? await prisma.material.findMany({ where: { id: { in: materialIds } } })
      : [];
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

    const inRange = { ...SALES, consigneeId: consignee.id, date: { gte: from, lte: to } };

    // One wave rather than five sequential round trips — see the supplier route.
    const [rangeAgg, lifetimeAgg, materials, rows, invoices, slips] = await Promise.all([
      prisma.exportInvoice.aggregate({
        where: inRange,
        _count: { _all: true },
        _sum: { total: true, gst: true },
      }),
      prisma.exportInvoice.aggregate({
        where: { ...SALES, consigneeId: consignee.id },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.invoiceLineItem.groupBy({
        by: ['materialId'],
        _sum: { netWeightMt: true, total: true },
        _count: { _all: true },
        // One-off lines have no material to break down by; see the overview.
        where: { invoice: inRange, materialId: { not: null } },
        orderBy: { _sum: { total: 'desc' } },
      }),
      prisma.exportInvoice.findMany({ where: inRange, select: { date: true, total: true } }),
      prisma.exportInvoice.findMany({
        where: { ...SALES, consigneeId: consignee.id },
        include: { lineItems: { include: { material: true } } },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      // Every shipment for this buyer, priced or not. A packing slip is work in
      // progress on their account and belongs on their page next to the
      // invoices, not hidden until someone prices it.
      prisma.exportInvoice.findMany({
        where: { status: 'ACTIVE', stage: 'PACKING_SLIP', consigneeId: consignee.id },
        include: { lineItems: { select: { netWeightMt: true } }, containers: true },
        orderBy: { date: 'desc' },
        take: 50,
      }),
    ]);

    const materialIds = materials.map((m) => m.materialId).filter(Boolean);
    const materialRows = materialIds.length
      ? await prisma.material.findMany({ where: { id: { in: materialIds } } })
      : [];
    const materialMap = Object.fromEntries(materialRows.map((m) => [m.id, m]));

    res.json({
      consignee,
      range: { from, to },
      inRange: {
        count: rangeAgg._count._all,
        total: Number(rangeAgg._sum.total ?? 0),
        gst: Number(rangeAgg._sum.gst ?? 0),
      },
      lifetime: {
        count: lifetimeAgg._count._all,
        total: Number(lifetimeAgg._sum.total ?? 0),
      },
      series: buildSeries(from, to, 'month', {
        sales: rows.map((d) => ({ date: d.date, value: d.total })),
      }),
      materials: materials
        .filter((m) => materialMap[m.materialId])
        .map((m) => ({
          material: materialMap[m.materialId],
          lines: m._count._all,
          weight: Number(m._sum.netWeightMt ?? 0),
          value: Number(m._sum.total ?? 0),
        })),
      invoices,
      slips: slips.map((s) => ({
        id: s.id,
        invoiceNumber: s.invoiceNumber,
        date: s.date,
        contractNo: s.contractNo,
        poNumber: s.poNumber,
        containers: s.containers.length,
        netWeightMt: s.lineItems.reduce((sum, li) => sum + Number(li.netWeightMt), 0),
      })),
      // The contract is what the buyer files against, and one contract often
      // covers two or three shipments. Grouping here rather than in the page
      // keeps the arithmetic — which is per currency, never summed across —
      // next to the query that produced it.
      contracts: buildContracts([...invoices, ...slips]),
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
