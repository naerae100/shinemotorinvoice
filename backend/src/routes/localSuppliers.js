import { Router } from 'express';
import { z } from 'zod';
import * as v from '../lib/validators.js';
import { prisma } from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
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

export default router;
