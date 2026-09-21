import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { dateFilter, pagination } from '../lib/query.js';
import { round3 } from '../lib/money.js';
import { audit, diff } from '../lib/audit.js';
import { versionSchema, guardedWhere, isStaleWrite } from '../lib/concurrency.js';

const router = Router();

/**
 * Field collections — what a contractor picked up, and what it weighed.
 *
 * No price, no GST, no payment. The contractor agrees nothing on the yard's
 * behalf; they weigh what is there and record it, and pricing is a decision
 * made later by someone who can make it.
 *
 * Everything here is reachable by a contractor, and almost nothing else is —
 * see CONTRACTOR_ALLOWED in middleware/auth.js. Voiding is the exception and
 * stays with an admin, because a pickup that vanishes is the one change that
 * cannot be noticed by looking at the list.
 */

const lineSchema = z
  .object({
    materialId: z.string().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    grossWeight: z.coerce.number().nonnegative('Weights cannot be negative'),
    tareWeight: z.coerce.number().nonnegative('Weights cannot be negative').default(0),
  })
  .refine((l) => l.materialId || l.description?.trim(), {
    message: 'Choose a grade or type what it is',
  })
  .refine((l) => l.tareWeight <= l.grossWeight, {
    message: 'Tare cannot be more than the gross weight',
    path: ['tareWeight'],
  });

const bodySchema = z.object({
  localSupplierId: z.string().min(1, 'Choose who it came from'),
  date: z.string().datetime().optional(),
  notes: z.string().trim().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'Add at least one grade'),
  ...versionSchema,
});

const DETAIL_INCLUDE = {
  localSupplier: true,
  lines: { include: { material: { select: { id: true, description: true, unit: true } } } },
  createdBy: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
};

/**
 * net = gross − tare, at the three decimals this yard works in.
 *
 * Handed to Prisma as fixed strings, not as JS numbers, because writing a JS
 * number into a Decimal column does not round-trip. Measured on this schema:
 *
 *   { grossWeight: 86.4 }       reads back as 86.40000000000001
 *   { grossWeight: '86.400' }   reads back as 86.4
 *
 * Note it is the write path that does this, not Decimal itself — building
 * `new Prisma.Decimal(86.4)` in process gives a clean 86.4, so the obvious
 * check says there is no problem. round3 had already run; the value was clean
 * when it left this file and noisy when it came back, and it would have been
 * read off a screen as a weight.
 *
 * A fixed string says exactly what is meant and nothing reinterprets it.
 */
const toWeight = (n) => round3(n).toFixed(3);

const withNet = (l) => ({
  materialId: l.materialId || null,
  description: l.description?.trim() || null,
  grossWeight: toWeight(l.grossWeight),
  tareWeight: toWeight(l.tareWeight ?? 0),
  netWeight: toWeight(l.grossWeight - (l.tareWeight ?? 0)),
});

/**
 * GET /api/collections/materials
 *
 * Its own catalogue (kind COLLECTION), not the buying price list.
 *
 * The grades called for in a driveway are not the set the weighbridge buys
 * on, and the field list is deliberately flat — no codes, no categories —
 * because a contractor scrolling for "ICW 42%" should not have to know which
 * category it was filed under.
 *
 * No price is returned either way, and /api/materials, which carries
 * currentPrice on every row, stays closed to this role.
 */
router.get(
  '/materials',
  requireAuth,
  asyncHandler(async (req, res) => {
    const materials = await prisma.material.findMany({
      where: { active: true, kind: 'COLLECTION' },
      select: { id: true, description: true, unit: true },
      orderBy: { description: 'asc' },
    });
    res.json({ materials });
  })
);

/** GET /api/collections?search=&from=&to=&localSupplierId=&status=&page= */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search, from, to, localSupplierId, status, page, pageSize } = req.query;

    const where = {
      ...(status === 'ALL' ? {} : { status: status ? String(status) : 'ACTIVE' }),
      ...(localSupplierId ? { localSupplierId: String(localSupplierId) } : {}),
      ...(dateFilter(from, to) ? { date: dateFilter(from, to) } : {}),
      ...(search
        ? {
            OR: [
              { localSupplier: { name: contains(String(search)) } },
              { localSupplier: { suburb: contains(String(search)) } },
              { notes: contains(String(search)) },
              ...(Number.isFinite(Number(search))
                ? [{ collectionNumber: Number(search) }]
                : []),
            ],
          }
        : {}),
    };

    const { take, skip, page: currentPage } = pagination(page, pageSize);

    const [collections, totalCount, lineAgg] = await Promise.all([
      prisma.collection.findMany({
        where,
        include: DETAIL_INCLUDE,
        orderBy: { date: 'desc' },
        take,
        skip,
      }),
      prisma.collection.count({ where }),
      // The weight the filtered list adds up to. There is no money to total.
      prisma.collectionLine.aggregate({
        where: { collection: where },
        _sum: { netWeight: true, grossWeight: true },
      }),
    ]);

    res.json({
      collections,
      totalCount,
      page: currentPage,
      filteredTotals: {
        netWeight: round3(Number(lineAgg._sum.netWeight ?? 0)),
        grossWeight: round3(Number(lineAgg._sum.grossWeight ?? 0)),
      },
    });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const collection = await prisma.collection.findUnique({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    if (!collection) return res.status(404).json({ error: 'Not found' });
    res.json({ collection });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = bodySchema.parse(req.body);

    const seller = await prisma.localSupplier.findUnique({
      where: { id: data.localSupplierId },
      select: { id: true },
    });
    if (!seller) return res.status(400).json({ error: 'That local supplier no longer exists' });

    // The number is taken inside the transaction that writes the row, the same
    // way a docket number is, so two contractors saving at once cannot be
    // handed the same one.
    const collection = await prisma.$transaction(async (tx) => {
      const last = await tx.collection.findFirst({
        orderBy: { collectionNumber: 'desc' },
        select: { collectionNumber: true },
      });
      return tx.collection.create({
        data: {
          collectionNumber: (last?.collectionNumber ?? 0) + 1,
          date: data.date ? new Date(data.date) : new Date(),
          localSupplierId: data.localSupplierId,
          notes: data.notes || null,
          createdById: req.user.id,
          lines: { create: data.lines.map(withNet) },
        },
        include: DETAIL_INCLUDE,
      });
    });

    await audit({
      req,
      action: 'CREATE',
      entity: 'Collection',
      entityId: collection.id,
      label: `Collection #${collection.collectionNumber}`,
      after: { localSupplier: collection.localSupplier.name, lines: collection.lines.length },
    });

    res.status(201).json({ collection });
  })
);

/**
 * PATCH /api/collections/:id
 *
 * A contractor may correct their own entry — a weight typed with the wrong
 * digit while standing next to a truck is the ordinary case, and the
 * alternative is a phone call to the office. What matters is that the change
 * is visible afterwards, so the record carries who last touched it and the
 * full before/after goes to the audit trail.
 */
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = bodySchema.partial().parse(req.body);

    const before = await prisma.collection.findUnique({
      where: { id: req.params.id },
      include: DETAIL_INCLUDE,
    });
    if (!before) return res.status(404).json({ error: 'Not found' });
    if (before.status === 'VOID') {
      return res.status(409).json({ error: 'This collection has been voided and cannot be edited' });
    }

    try {
      const collection = await prisma.$transaction(async (tx) => {
        if (data.lines) {
          await tx.collectionLine.deleteMany({ where: { collectionId: req.params.id } });
        }
        return tx.collection.update({
          where: guardedWhere(req.params.id, data.expectedUpdatedAt),
          data: {
            ...(data.localSupplierId ? { localSupplierId: data.localSupplierId } : {}),
            ...(data.date ? { date: new Date(data.date) } : {}),
            ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
            ...(data.lines ? { lines: { create: data.lines.map(withNet) } } : {}),
            editedById: req.user.id,
            editedAt: new Date(),
          },
          include: DETAIL_INCLUDE,
        });
      });

      const summarise = (c) => ({
        localSupplier: c.localSupplier?.name,
        notes: c.notes,
        weights: c.lines
          .map((l) => `${l.material?.description ?? l.description}: ${l.netWeight}`)
          .join(', '),
      });
      const changed = diff(summarise(before), summarise(collection), [
        'localSupplier',
        'notes',
        'weights',
      ]);
      if (changed) {
        await audit({
          req,
          action: 'UPDATE',
          entity: 'Collection',
          entityId: collection.id,
          label: `Collection #${collection.collectionNumber}`,
          ...changed,
        });
      }

      res.json({ collection });
    } catch (err) {
      if (isStaleWrite(err)) {
        return res.status(409).json({
          error: 'Somebody else changed this collection while you were editing it. Reopen it.',
        });
      }
      throw err;
    }
  })
);

/**
 * Voiding stays with an admin.
 *
 * Every other change a contractor makes is visible in the list afterwards. A
 * pickup that disappears is the one that is not, so it needs the person who
 * reconciles the yard rather than the person on the road.
 */
router.post(
  '/:id/void',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim();
    const collection = await prisma.collection.update({
      where: { id: req.params.id },
      data: {
        status: 'VOID',
        voidReason: reason || null,
        voidedAt: new Date(),
        voidedById: req.user.id,
      },
      include: DETAIL_INCLUDE,
    });
    await audit({
      req,
      action: 'VOID',
      entity: 'Collection',
      entityId: collection.id,
      label: `Collection #${collection.collectionNumber}`,
      after: { reason: reason || null },
    });
    res.json({ collection });
  })
);

router.post(
  '/:id/restore',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const collection = await prisma.collection.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE', voidReason: null, voidedAt: null, voidedById: null },
      include: DETAIL_INCLUDE,
    });
    await audit({
      req,
      action: 'RESTORE',
      entity: 'Collection',
      entityId: collection.id,
      label: `Collection #${collection.collectionNumber}`,
    });
    res.json({ collection });
  })
);

export default router;
