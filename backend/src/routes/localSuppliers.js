import { Router } from 'express';
import { z } from 'zod';
import * as v from '../lib/validators.js';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { audit, diff } from '../lib/audit.js';

const router = Router();

/**
 * Sellers the contractor visits in the field.
 *
 * A deliberately thin record: a name, somewhere to find them, a phone number.
 * No ABN, no licence, no sale type, no bank account — nothing is bought here
 * and no money moves, so none of it applies, and asking for it in a driveway
 * would only produce guesses.
 */

const AUDITED_FIELDS = ['name', 'phone', 'address', 'suburb', 'state', 'postcode', 'notes'];

const bodySchema = z.object({
  name: z.string().trim().min(1, 'A name is required'),
  phone: v.phone,
  address: z.string().trim().optional().nullable(),
  suburb: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  postcode: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

/** GET /api/local-suppliers?search= — the contractor's autocomplete. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const localSuppliers = await prisma.localSupplier.findMany({
      where: search
        ? {
            OR: [
              { name: contains(String(search)) },
              { phone: contains(String(search)) },
              { suburb: contains(String(search)) },
            ],
          }
        : {},
      orderBy: { name: 'asc' },
      take: 50,
      include: { _count: { select: { collections: true } } },
    });
    res.json({ localSuppliers });
  })
);

/** GET /api/local-suppliers/:id — the record plus everything collected from it. */
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const localSupplier = await prisma.localSupplier.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { name: true } },
        collections: {
          where: { status: 'ACTIVE' },
          orderBy: { date: 'desc' },
          include: {
            lines: { include: { material: { select: { id: true, description: true } } } },
            createdBy: { select: { name: true } },
          },
        },
      },
    });
    if (!localSupplier) return res.status(404).json({ error: 'Not found' });

    // What has come off this seller, by grade. The admin's first question
    // about a local supplier is "what do we actually get from them", and
    // answering it here saves adding up a list of pickups by hand.
    const byMaterial = new Map();
    for (const c of localSupplier.collections) {
      for (const l of c.lines) {
        const key = l.material?.id ?? `free:${l.description ?? ''}`;
        const label = l.material?.description ?? l.description ?? 'Unnamed grade';
        const row = byMaterial.get(key) ?? { label, netWeight: 0, lines: 0 };
        row.netWeight += Number(l.netWeight);
        row.lines += 1;
        byMaterial.set(key, row);
      }
    }

    res.json({
      localSupplier,
      totals: {
        collections: localSupplier.collections.length,
        netWeight: [...byMaterial.values()].reduce((a, r) => a + r.netWeight, 0),
        byMaterial: [...byMaterial.values()].sort((a, b) => b.netWeight - a.netWeight),
      },
    });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = bodySchema.parse(req.body);
    const localSupplier = await prisma.localSupplier.create({
      data: { ...data, createdById: req.user.id },
    });
    await audit({
      req,
      action: 'CREATE',
      entity: 'LocalSupplier',
      entityId: localSupplier.id,
      label: localSupplier.name,
      after: localSupplier,
    });
    res.status(201).json({ localSupplier });
  })
);

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = bodySchema.partial().parse(req.body);
    const before = await prisma.localSupplier.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Not found' });

    const localSupplier = await prisma.localSupplier.update({
      where: { id: req.params.id },
      data,
    });
    const changed = diff(before, localSupplier, AUDITED_FIELDS);
    if (changed) {
      await audit({
        req,
        action: 'UPDATE',
        entity: 'LocalSupplier',
        entityId: localSupplier.id,
        label: localSupplier.name,
        ...changed,
      });
    }
    res.json({ localSupplier });
  })
);

/**
 * DELETE /api/local-suppliers/:id — admin only.
 *
 * Refused while the supplier has collections against them. A local supplier
 * is not much of a record on its own; the reason to keep one is the pickups
 * hanging off it, and deleting the name out from under four collections
 * leaves four records that cannot say who they came from. The message says
 * how many, so the admin can decide whether to void those first.
 *
 * Hard delete rather than a flag: these rows carry no history of their own,
 * and a list of deactivated names the contractor has to scroll past is the
 * thing this page exists to avoid.
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const localSupplier = await prisma.localSupplier.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { collections: true } } },
    });
    if (!localSupplier) return res.status(404).json({ error: 'Not found' });

    const n = localSupplier._count.collections;
    if (n > 0) {
      return res.status(409).json({
        error: `${localSupplier.name} has ${n} ${n === 1 ? 'collection' : 'collections'}. Void or delete those first.`,
      });
    }

    await prisma.localSupplier.delete({ where: { id: localSupplier.id } });
    await audit({
      req,
      action: 'DELETE',
      entity: 'LocalSupplier',
      entityId: localSupplier.id,
      label: localSupplier.name,
      before: localSupplier,
    });
    res.json({ ok: true });
  })
);

export default router;
