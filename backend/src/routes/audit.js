import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { pagination } from '../lib/query.js';
import { sendCsv, isoDateTime } from '../lib/csv.js';

const router = Router();

/**
 * The trail is read-only over HTTP — there is no POST, PATCH or DELETE here by
 * design. Restricted to admins because it records IP addresses and failed
 * sign-in attempts.
 */

// GET /api/audit?entity=&entityId=&actorId=&action=&page=&pageSize=
router.get(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { entity, entityId, actorId, action, page = '1', pageSize = '50' } = req.query;
    const { take, skip, page: currentPage } = pagination(page, pageSize);

    const where = {
      ...(entity ? { entity: String(entity) } : {}),
      ...(entityId ? { entityId: String(entityId) } : {}),
      ...(actorId ? { actorId: String(actorId) } : {}),
      ...(action ? { action: String(action) } : {}),
    };

    const [events, totalCount] = await Promise.all([
      prisma.auditEvent.findMany({ where, orderBy: { at: 'desc' }, take, skip }),
      prisma.auditEvent.count({ where }),
    ]);

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ events, totalCount, page: currentPage, pageSize: take });
  })
);

// GET /api/audit/export — the whole filtered trail, for an accountant or auditor.
router.get(
  '/export',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { entity, entityId, action } = req.query;
    const events = await prisma.auditEvent.findMany({
      where: {
        ...(entity ? { entity: String(entity) } : {}),
        ...(entityId ? { entityId: String(entityId) } : {}),
        ...(action ? { action: String(action) } : {}),
      },
      orderBy: { at: 'asc' },
      take: 50000,
    });

    sendCsv(res, 'shine-audit-trail', [
      { label: 'When', get: (e) => isoDateTime(e.at) },
      { label: 'Who', get: (e) => e.actorEmail ?? '' },
      { label: 'Action', get: (e) => e.action },
      { label: 'Record', get: (e) => e.label ?? `${e.entity} ${e.entityId}` },
      { label: 'Before', get: (e) => (e.before ? JSON.stringify(e.before) : '') },
      { label: 'After', get: (e) => (e.after ? JSON.stringify(e.after) : '') },
      { label: 'IP', get: (e) => e.ip ?? '' },
    ], events);
  })
);

export default router;
