import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { config } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { contains } from '../lib/search.js';
import { dateFilter, pagination } from '../lib/query.js';
import { round3 } from '../lib/money.js';
import { audit, diff } from '../lib/audit.js';
import { versionSchema, guardedWhere, isStaleWrite } from '../lib/concurrency.js';
import multer from 'multer';
import * as photoStorage from '../lib/photoStorage.js';
import { signPhotoUrl, verifyPhotoSignature } from '../lib/signedUrl.js';
import { signShareToken, readShareToken } from '../lib/shareLink.js';

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
    // Present when the line already exists. Lines are matched on it so an
    // edit updates a row rather than replacing it — see PATCH below.
    id: z.string().optional(),
    materialId: z.string().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    grossWeight: z.coerce.number().nonnegative('Weights cannot be negative'),
    tareWeight: z.coerce.number().nonnegative('Weights cannot be negative').default(0),
    // The supplier's own weighing. Optional: plenty of sellers do not weigh.
    supplierGrossWeight: z.coerce.number().nonnegative().nullish(),
    supplierTareWeight: z.coerce.number().nonnegative().nullish(),
    // About this grade in particular, not the trip.
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((l) => l.materialId || l.description?.trim(), {
    message: 'Choose a grade or type what it is',
  })
  .refine((l) => l.tareWeight <= l.grossWeight, {
    message: 'Tare cannot be more than the gross weight',
    path: ['tareWeight'],
  })
  .refine(
    (l) =>
      l.supplierGrossWeight == null ||
      (l.supplierTareWeight ?? 0) <= l.supplierGrossWeight,
    {
      message: "Their tare cannot be more than their gross weight",
      path: ['supplierTareWeight'],
    }
  );

const bodySchema = z.object({
  localSupplierId: z.string().min(1, 'Choose who it came from'),
  date: z.string().datetime().optional(),
  notes: z.string().trim().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'Add at least one grade'),
  ...versionSchema,
});

const PHOTO_SELECT = {
  id: true,
  lineId: true,
  filename: true,
  contentType: true,
  bytes: true,
  createdAt: true,
  createdBy: { select: { name: true } },
};

const DETAIL_INCLUDE = {
  localSupplier: true,
  lines: {
    include: {
      material: { select: { id: true, description: true, unit: true } },
      photos: { select: PHOTO_SELECT, orderBy: { createdAt: 'asc' } },
    },
  },
  photos: {
    // Only the ones belonging to the pickup as a whole; a line's photos are
    // already nested under the line.
    where: { lineId: null },
    select: PHOTO_SELECT,
    orderBy: { createdAt: 'asc' },
  },
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

const withNet = (l) => {
  // Their net only exists if they gave a gross. A tare with no gross is not
  // half a weighing, it is a typo.
  const hasTheirs = l.supplierGrossWeight != null;
  return {
    materialId: l.materialId || null,
    description: l.description?.trim() || null,
    notes: l.notes?.trim() || null,
    grossWeight: toWeight(l.grossWeight),
    tareWeight: toWeight(l.tareWeight ?? 0),
    netWeight: toWeight(l.grossWeight - (l.tareWeight ?? 0)),
    supplierGrossWeight: hasTheirs ? toWeight(l.supplierGrossWeight) : null,
    supplierTareWeight: hasTheirs ? toWeight(l.supplierTareWeight ?? 0) : null,
    supplierNetWeight: hasTheirs
      ? toWeight(l.supplierGrossWeight - (l.supplierTareWeight ?? 0))
      : null,
  };
};

/**
 * Photographs.
 *
 * Optional everywhere. A contractor with no signal, or nothing worth
 * photographing, saves a collection exactly as they did before — the upload
 * is a separate request, so a failed photo never costs somebody the weights
 * they just typed.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  // The browser resizes before sending — about 300KB for a phone photo — so
  // this is headroom for an odd one, not the working size. Without a cap a
  // single 12MB original from a modern phone would sit in the function's
  // memory and time the request out on a yard's signal.
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only photographs can be uploaded'), { status: 400 }));
  },
});

/**
 * Attach a signed, short-lived URL to every photo on a collection.
 *
 * Done on the way out rather than stored, because the signature expires —
 * a URL kept in the database would be wrong within the quarter hour.
 */
function withPhotoUrls(collection) {
  if (!collection) return collection;
  const sign = (p) => ({ ...p, url: signPhotoUrl(p.id) });
  return {
    ...collection,
    photos: (collection.photos ?? []).map(sign),
    lines: (collection.lines ?? []).map((l) => ({
      ...l,
      photos: (l.photos ?? []).map(sign),
    })),
  };
}

/** The Drive path a photo belongs in: supplier, then collection. */
const foldersFor = (collection) => [
  collection.localSupplier?.name || 'Unknown supplier',
  `Collection ${collection.collectionNumber}`,
];

/** POST /api/collections/:id/photos — one photo, optionally against a line. */
router.post(
  '/:id/photos',
  requireAuth,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No photo was sent' });

    const collection = await prisma.collection.findUnique({
      where: { id: req.params.id },
      include: { localSupplier: { select: { name: true } }, lines: { select: { id: true } } },
    });
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.status === 'VOID') {
      return res.status(409).json({ error: 'This collection has been voided' });
    }

    const lineId = req.body.lineId || null;
    if (lineId && !collection.lines.some((l) => l.id === lineId)) {
      return res.status(400).json({ error: 'That grade is not on this collection' });
    }

    const stored = await photoStorage.save({
      buffer: req.file.buffer,
      filename: `${Date.now()}-${req.file.originalname || 'photo.jpg'}`,
      contentType: req.file.mimetype,
      folders: foldersFor(collection),
    });

    const photo = await prisma.collectionPhoto.create({
      data: {
        collectionId: collection.id,
        lineId,
        provider: stored.provider,
        externalId: stored.externalId,
        filename: req.file.originalname || 'photo.jpg',
        contentType: req.file.mimetype,
        bytes: req.file.size,
        createdById: req.user.id,
      },
      select: PHOTO_SELECT,
    });

    await audit({
      req,
      action: 'UPDATE',
      entity: 'Collection',
      entityId: collection.id,
      label: `Collection #${collection.collectionNumber}`,
      after: { photoAdded: photo.filename, grade: lineId ? 'line' : 'collection' },
    });

    res.status(201).json({ photo: { ...photo, url: signPhotoUrl(photo.id) } });
  })
);

/**
 * GET /api/collections/photos/:photoId/content — the bytes.
 *
 * Signed rather than authenticated: see lib/signedUrl.js. The signature is
 * checked before anything is fetched, so an expired link costs a database
 * lookup and nothing more.
 */
router.get(
  '/photos/:photoId/content',
  asyncHandler(async (req, res) => {
    if (!verifyPhotoSignature(req.params.photoId, req.query.e, req.query.s)) {
      return res.status(403).json({ error: 'This photo link has expired' });
    }

    const photo = await prisma.collectionPhoto.findUnique({
      where: { id: req.params.photoId },
      select: { externalId: true, contentType: true, filename: true },
    });
    if (!photo) return res.status(404).json({ error: 'Not found' });

    const { stream, contentType } = await photoStorage.read(photo.externalId);
    res.setHeader('Content-Type', photo.contentType || contentType);
    // Private, but cacheable for the life of the signature — the same gallery
    // is scrolled up and down, and refetching every thumbnail on a yard's
    // signal is the difference between usable and not.
    res.setHeader('Cache-Control', 'private, max-age=900');
    const { Readable } = await import('node:stream');
    Readable.fromWeb(stream).pipe(res);
  })
);

/** DELETE /api/collections/photos/:photoId — admin only. */
router.delete(
  '/photos/:photoId',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const photo = await prisma.collectionPhoto.findUnique({
      where: { id: req.params.photoId },
      include: { collection: { select: { collectionNumber: true } } },
    });
    if (!photo) return res.status(404).json({ error: 'Not found' });

    // Trashed in Drive, recoverable for thirty days — see photoStorage.remove.
    await photoStorage.remove(photo.externalId).catch(() => {
      // A photo already gone from Drive should not strand the row here.
    });
    await prisma.collectionPhoto.delete({ where: { id: photo.id } });

    await audit({
      req,
      action: 'UPDATE',
      entity: 'Collection',
      entityId: photo.collectionId,
      label: `Collection #${photo.collection.collectionNumber}`,
      before: { photo: photo.filename },
    });
    res.json({ ok: true });
  })
);

/** Whether uploading will work at all, so the UI can say so before trying. */
router.get(
  '/photos/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ configured: photoStorage.isConfigured() });
  })
);

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
        _sum: { netWeight: true, grossWeight: true, supplierNetWeight: true },
      }),
    ]);

    res.json({
      collections: collections.map(withPhotoUrls),
      totalCount,
      page: currentPage,
      filteredTotals: {
        netWeight: round3(Number(lineAgg._sum.netWeight ?? 0)),
        grossWeight: round3(Number(lineAgg._sum.grossWeight ?? 0)),
        // Only across the lines where they actually weighed. Summing our net
        // against a supplier total that is missing half its lines would put a
        // difference on screen that is really just the gaps.
        supplierNetWeight: round3(Number(lineAgg._sum.supplierNetWeight ?? 0)),
      },
    });
  })
);

/**
 * GET /api/collections/shared/:token — no authentication, deliberately.
 *
 * The seller is not a user and never will be. The token is the credential:
 * signed, time limited, and good for exactly one collection. See
 * lib/shareLink.js for why it is signed rather than stored.
 *
 * A void collection is closed off. Somebody holding a link to a record that
 * has since been cancelled should be told it was cancelled, not shown the
 * numbers as though they still stand.
 */
router.get(
  '/shared/:token',
  asyncHandler(async (req, res) => {
    const id = readShareToken(req.params.token);
    if (!id) return res.status(404).json({ error: 'That link is not valid or has expired' });

    const collection = await prisma.collection.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.status === 'VOID') {
      return res.status(410).json({ error: 'This collection has been cancelled' });
    }

    // The letterhead travels with it. /api/settings/public withholds the
    // logo, which is right for the sign-in screen but leaves a document sent
    // to a seller looking like a spreadsheet. Nothing here is private —
    // every one of these fields is printed on every invoice already.
    const branding = await prisma.companySettings.findUnique({
      where: { id: 'singleton' },
      select: { companyName: true, address: true, abn: true, phone: true, logoUrl: true },
    });

    // No cache: the link points at the record, not a copy, and the whole
    // point is that a correction reaches whoever holds the link.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ collection: withPhotoUrls(collection), branding });
  })
);

/** POST /api/collections/:id/share — mint a link to hand to the seller. */
router.post(
  '/:id/share',
  requireAuth,
  asyncHandler(async (req, res) => {
    const collection = await prisma.collection.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.status === 'VOID') {
      return res.status(409).json({ error: 'A void collection cannot be shared' });
    }

    const { token, expiresAt } = signShareToken(collection.id);
    const origin = config.siteOrigins[0].replace(/\/$/, '');
    res.json({ url: `${origin}/shared/collection/${token}`, expiresAt });
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
    res.json({ collection: withPhotoUrls(collection) });
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

    res.status(201).json({ collection: withPhotoUrls(collection) });
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
          // Lines are matched on their id, not wiped and rebuilt.
          //
          // Deleting them all and recreating was simpler and about to be
          // destructive: photographs of a load hang off the line they belong
          // to, and every correction of a mistyped weight would have taken
          // the evidence with it. A line's identity has to outlive an edit,
          // because it is the thing the photo is of.
          const keep = data.lines.filter((l) => l.id).map((l) => l.id);
          await tx.collectionLine.deleteMany({
            where: { collectionId: req.params.id, id: { notIn: keep.length ? keep : ['-'] } },
          });
          for (const line of data.lines) {
            const values = withNet(line);
            if (line.id) {
              await tx.collectionLine.update({ where: { id: line.id }, data: values });
            } else {
              await tx.collectionLine.create({
                data: { ...values, collectionId: req.params.id },
              });
            }
          }
        }
        return tx.collection.update({
          where: guardedWhere(req.params.id, data.expectedUpdatedAt),
          data: {
            ...(data.localSupplierId ? { localSupplierId: data.localSupplierId } : {}),
            ...(data.date ? { date: new Date(data.date) } : {}),
            ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
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
          .map(
            (l) =>
              `${l.material?.description ?? l.description}: ${l.netWeight}` +
              (l.supplierNetWeight != null ? ` (theirs ${l.supplierNetWeight})` : '')
          )
          .join(', '),
        gradeNotes: c.lines
          .filter((l) => l.notes)
          .map((l) => `${l.material?.description ?? l.description}: ${l.notes}`)
          .join(' · '),
      });
      const changed = diff(summarise(before), summarise(collection), [
        'localSupplier',
        'notes',
        'weights',
        'gradeNotes',
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

      res.json({ collection: withPhotoUrls(collection) });
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
    res.json({ collection: withPhotoUrls(collection) });
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
    res.json({ collection: withPhotoUrls(collection) });
  })
);

export default router;
