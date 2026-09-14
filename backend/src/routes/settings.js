import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { CURRENCIES } from '../lib/currency.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Local file storage is completely disabled for serverless (Vercel) deployments.
// Images are instead encoded as Base64 Data URIs and stored directly in the database.

// 1 MB. Base64 inflates by ~33%, and the encoded string is stored in the database
// and travels in JSON bodies, so this must stay comfortably under the express.json
// limit below it. A logo or stamp is a few tens of KB in practice.
const MAX_UPLOAD_BYTES = 1024 * 1024;

// Extension is chosen by us from the detected mime type, never taken from the
// uploaded filename: express.static sets Content-Type from the extension, so an
// attacker-supplied ".html" would become stored XSS on the API origin.
const ALLOWED_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      const err = new Error('Only PNG, JPEG, WebP or SVG images can be uploaded');
      err.status = 415;
      return cb(err);
    }
    cb(null, true);
  },
});

const router = Router();

const settingsSchema = z.object({
  companyName: z.string().optional(),
  abn: z.string().optional().nullable(),
  acn: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  fax: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  stampUrl: z.string().optional().nullable(),
  // The legacy single bank block. It is still written so nothing that reads
  // CompanySettings breaks, but the invoice takes its details from BankAccount,
  // which holds one set per currency.
  bankName: z.string().optional().nullable(),
  bankSwift: z.string().optional().nullable(),
  bankAccountNo: z.string().optional().nullable(),
  bankBsb: z.string().optional().nullable(),
  bankAddress: z.string().optional().nullable(),
  beneficiary: z.string().optional().nullable(),
});

const bankAccountSchema = z.object({
  bankName: z.string().optional().nullable(),
  swift: z.string().optional().nullable(),
  accountNo: z.string().optional().nullable(),
  bsb: z.string().optional().nullable(),
  bankAddress: z.string().optional().nullable(),
  beneficiary: z.string().optional().nullable(),
});

/**
 * GET /api/settings/public — unauthenticated, deliberately.
 *
 * The sign-in screen needs the trading name and contact line to identify itself,
 * but nobody is signed in yet. Only fields that already appear on every printed
 * invoice are exposed here — no bank details, no logo payload, nothing private.
 */
router.get(
  '/public',
  asyncHandler(async (req, res) => {
    const settings = await prisma.companySettings.findUnique({
      where: { id: 'singleton' },
      select: { companyName: true, address: true, abn: true, phone: true },
    });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ branding: settings ?? null });
  })
);

// GET — any logged-in user can read (needed to render logo on docket/invoice screens)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = await prisma.companySettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
    res.json({ settings });
  })
);

// PATCH — admin only, this includes bank details
router.patch(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const parsed = settingsSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const settings = await prisma.companySettings.upsert({
      where: { id: 'singleton' },
      update: parsed.data,
      create: { id: 'singleton', ...parsed.data },
    });
    res.json({ settings });
  })
);

/**
 * GET /api/settings/bank-accounts — admin only, these are payment details.
 *
 * Always returns a row per supported currency, inventing an empty one where none
 * has been saved, so the settings screen can render a form for each without
 * having to know which exist.
 */
router.get(
  '/bank-accounts',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.bankAccount.findMany();
    const byCurrency = Object.fromEntries(rows.map((r) => [r.currency, r]));
    res.json({
      bankAccounts: CURRENCIES.map(
        (currency) => byCurrency[currency] ?? { currency, bankName: null, swift: null, accountNo: null, bsb: null, bankAddress: null, beneficiary: null }
      ),
    });
  })
);

// PUT /api/settings/bank-accounts/:currency — admin only.
router.put(
  '/bank-accounts/:currency',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const currency = String(req.params.currency).toUpperCase();
    if (!CURRENCIES.includes(currency)) {
      return res.status(400).json({ error: `Unsupported currency ${currency}` });
    }
    const parsed = bankAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const bankAccount = await prisma.bankAccount.upsert({
      where: { currency },
      update: parsed.data,
      create: { currency, ...parsed.data },
    });
    res.json({ bankAccount });
  })
);

// POST — upload logo or stamp
router.post(
  '/upload',
  requireAuth,
  requireRole('ADMIN'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { type } = req.body;
    if (type !== 'logo' && type !== 'stamp') {
      return res.status(400).json({ error: 'Invalid upload type (must be logo or stamp)' });
    }

    const base64Data = req.file.buffer.toString('base64');
    const fileUrl = `data:${req.file.mimetype};base64,${base64Data}`;

    const updateData = type === 'logo' ? { logoUrl: fileUrl } : { stampUrl: fileUrl };

    const settings = await prisma.companySettings.upsert({
      where: { id: 'singleton' },
      update: updateData,
      create: { id: 'singleton', ...updateData },
    });

    res.json({ settings, fileUrl });
  })
);

export default router;
