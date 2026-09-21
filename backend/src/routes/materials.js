import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { sendCsv, money, isoDate } from '../lib/csv.js';
import { audit, diff } from '../lib/audit.js';

const router = Router();

/**
 * The price list is where a docket's rates come from, so a change to it is a
 * change to what the yard pays — even though the docket keeps a snapshot and
 * old records are untouched. "Why did we pay 2.99 on Tuesday and 2.75 on
 * Wednesday" is a question with an answer now.
 */
const AUDITED_FIELDS = ['description', 'code', 'category', 'unit', 'currentPrice', 'active', 'kind'];

const materialSchema = z.object({
  // "PURCHASE" is the 33-item price list the yard buys on; "EXPORT" is the
  // trade-grade catalogue it sells under.
  // COLLECTION is the field list: the grades a contractor can pick from
  // when weighing scrap at a seller's place. They are weighed, never priced,
  // which is why currentPrice below is optional for them and required for the
  // other two — a buying price should always be a deliberate act.
  kind: z.enum(['PURCHASE', 'EXPORT', 'COLLECTION']).default('PURCHASE'),
  code: z.number().int().optional().nullable(),
  description: z.string().min(1),
  category: z.string().optional().nullable(),
  unit: z.enum(['KG', 'TONNE', 'UNIT']).default('KG'),
  currentPrice: z.number().nonnegative().optional(),
  active: z.boolean().optional(),
});

/**
 * A price is still required for anything bought or sold.
 *
 * Making currentPrice optional at the field level was for COLLECTION grades,
 * which have no price at all. Without this it would also have quietly stopped
 * requiring one on the buying list, where a missing price means a docket line
 * worth nothing.
 */
const createSchema = materialSchema.superRefine((m, ctx) => {
  if (m.kind !== 'COLLECTION' && m.currentPrice == null) {
    ctx.addIssue({ code: 'custom', path: ['currentPrice'], message: 'A price is required' });
  }
});

// GET /api/materials — everyone can view (needed for docket entry)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { includeInactive, kind } = req.query;
    const materials = await prisma.material.findMany({
      where: {
        ...(includeInactive === 'true' ? {} : { active: true }),
        // Buying names and selling names are different vocabularies; a caller
        // asks for the one it is going to print. Omitting `kind` returns both,
        // which is what the price-list screen wants.
        ...(kind ? { kind: String(kind) } : {}),
      },
      // Export grades have no code, so they order by category then name.
      // Collection grades have neither a code nor a category — the field
      // list is deliberately flat — so they are simply alphabetical.
      orderBy:
        kind === 'EXPORT'
          ? [{ category: 'asc' }, { description: 'asc' }]
          : kind === 'COLLECTION'
            ? [{ description: 'asc' }]
            : [{ code: 'asc' }, { description: 'asc' }],
    });
    res.json({ materials });
  })
);

// GET /api/materials/export — the price list as a spreadsheet
router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const materials = await prisma.material.findMany({
      where: {
        ...(req.query.includeInactive === 'true' ? {} : { active: true }),
        ...(req.query.kind ? { kind: String(req.query.kind) } : {}),
      },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });
    // The two catalogues must not land on the same filename — downloading both
    // would silently overwrite the first.
    const isExport = String(req.query.kind) === 'EXPORT';
    sendCsv(res, isExport ? 'shine-export-grades' : 'shine-price-list', [
      { label: 'Code', get: (m) => m.code ?? '' },
      { label: 'Material', get: (m) => m.description },
      { label: 'Category', get: (m) => m.category ?? '' },
      { label: 'Unit', get: (m) => m.unit },
      { label: 'Rate (AUD)', get: (m) => money(m.currentPrice) },
      { label: 'Active', get: (m) => (m.active ? 'Yes' : 'Retired') },
      { label: 'Rate updated', get: (m) => isoDate(m.updatedAt) },
    ], materials);
  })
);

// POST /api/materials — admin only, manual price entry
router.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    // The column is not nullable. A collection grade has no price, so it
    // stores zero rather than the column being loosened for every material.
    const material = await prisma.material.create({
      data: { ...parsed.data, currentPrice: parsed.data.currentPrice ?? 0 },
    });
    await audit({
      req,
      action: 'CREATE',
      entity: 'Material',
      entityId: material.id,
      label: material.description,
      after: { currentPrice: String(material.currentPrice), unit: material.unit, kind: material.kind },
    });
    res.status(201).json({ material });
  })
);

// PATCH /api/materials/:id — admin only, this is how prices get updated as market moves
router.patch(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const parsed = materialSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const existing = await prisma.material.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: parsed.data,
    });

    const changed = diff(existing, material, AUDITED_FIELDS);
    if (changed) {
      await audit({
        req,
        action: 'UPDATE',
        entity: 'Material',
        entityId: material.id,
        label: 'currentPrice' in changed.after
          ? `${material.description} — rate ${changed.before.currentPrice} → ${changed.after.currentPrice}`
          : material.description,
        before: changed.before,
        after: changed.after,
      });
    }
    res.json({ material });
  })
);

// DELETE /api/materials/:id — soft delete via active flag, never hard-delete
// (dockets reference materials; deleting would break historical records)
router.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.material.findUnique({
      where: { id: req.params.id },
      select: { id: true, description: true, active: true },
    });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    await audit({
      req,
      action: 'UPDATE',
      entity: 'Material',
      entityId: material.id,
      label: `${material.description} — retired`,
      before: { active: existing.active },
      after: { active: false },
    });
    res.json({ material });
  })
);

export default router;
