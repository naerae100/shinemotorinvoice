import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { isValidAbn } from '../lib/validators.js';

const router = Router();

/**
 * Who an ABN actually belongs to, from the Australian Business Register.
 *
 * The check digit already catches a mistyped ABN, but it cannot catch a
 * correctly-typed one belonging to somebody else — and a supplier reading their
 * number off a phone screen at the weighbridge is exactly where that happens.
 * This returns the registered entity name so the operator can see whether it
 * matches the person standing in front of them before the docket is written.
 *
 * It also answers the question the PAYG statement depends on: "Business sale
 * with valid ABN" is a declaration about a live registration, not about eleven
 * digits, and the ABR is the only thing that knows whether it is still active.
 *
 * Called from the server rather than the browser. The GUID is an account
 * credential and does not belong in a bundle, and the ABR does not send CORS
 * headers, so a browser could not read the response anyway.
 */

const ABR_GUID = process.env.ABR_GUID || '';
const ABR_URL = 'https://abr.business.gov.au/json/AbnDetails.aspx';

// The register changes rarely and the same handful of suppliers come back day
// after day, so a lookup is worth keeping. Bounded, because this is a
// long-lived process and an unbounded map is a slow leak.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

function cacheGet(abn) {
  const hit = cache.get(abn);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(abn);
    return null;
  }
  return hit.value;
}

function cacheSet(abn, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(abn, { at: Date.now(), value });
}

/**
 * The ABR's JSON endpoint answers with JSONP — `callback({...})` — whether or
 * not a callback was asked for, so the wrapper is stripped before parsing.
 */
function parseAbrPayload(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Unrecognised response from the ABR');
  return JSON.parse(trimmed.slice(start, end + 1));
}

// GET /api/abn/:abn
router.get(
  '/:abn',
  requireAuth,
  asyncHandler(async (req, res) => {
    const digits = String(req.params.abn).replace(/\D/g, '');

    // The check digit is free and instant; there is no point asking the ABR
    // about a number that cannot be an ABN.
    if (!isValidAbn(digits)) {
      return res.json({
        abn: digits,
        status: 'INVALID',
        message: 'Not a valid ABN — it fails the ATO check digit.',
      });
    }

    if (!ABR_GUID) {
      // Not an error. The docket has to be writable whether or not anyone has
      // registered for a GUID, so this reports plainly that the check is off
      // rather than failing the request the operator is in the middle of.
      return res.json({
        abn: digits,
        status: 'NOT_CONFIGURED',
        message: 'ABN lookup is not set up. Add ABR_GUID to check names against the register.',
      });
    }

    const cached = cacheGet(digits);
    if (cached) return res.json({ ...cached, cached: true });

    let payload;
    try {
      // The weighbridge cannot wait on a government service having a slow day.
      const response = await fetch(`${ABR_URL}?abn=${digits}&guid=${encodeURIComponent(ABR_GUID)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) throw new Error(`ABR returned ${response.status}`);
      payload = parseAbrPayload(await response.text());
    } catch (err) {
      // Deliberately a 200 with a status, not a 5xx: this is a convenience
      // lookup beside a field, and it must never be the reason a docket cannot
      // be saved.
      return res.json({
        abn: digits,
        status: 'UNAVAILABLE',
        message: 'Could not reach the ABN register just now.',
        detail: err?.message,
      });
    }

    if (payload.Message) {
      const result = { abn: digits, status: 'NOT_FOUND', message: payload.Message };
      cacheSet(digits, result);
      return res.json(result);
    }

    const result = {
      abn: payload.Abn || digits,
      status: payload.AbnStatus === 'Active' ? 'ACTIVE' : 'INACTIVE',
      abnStatus: payload.AbnStatus || null,
      entityName: payload.EntityName || null,
      entityType: payload.EntityTypeName || null,
      // A date means registered for GST from that date; the ABR sends an empty
      // string when it has never been.
      gstFrom: payload.Gst || null,
      gstRegistered: Boolean(payload.Gst),
      state: payload.AddressState || payload.State || null,
      postcode: payload.AddressPostcode || payload.Postcode || null,
      // Trading names, where the register holds any — the name on the truck is
      // often not the name on the registration.
      businessNames: Array.isArray(payload.BusinessName) ? payload.BusinessName.slice(0, 5) : [],
    };

    cacheSet(digits, result);
    res.json(result);
  })
);

export default router;
