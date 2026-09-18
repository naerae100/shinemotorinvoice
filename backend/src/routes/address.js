import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * Address suggestions without an account anywhere.
 *
 * This is the fallback for when no WattleAddr key is configured. It reads
 * OpenStreetMap through Photon, which is free and needs no registration.
 *
 * Be clear about what that costs. OSM's Australian coverage is contributed, not
 * authoritative: a street may exist with no house numbers on it, and a search
 * that cannot find the number sometimes answers with a different street in a
 * similarly-named suburb rather than nothing at all. "12 Smithfield Road,
 * Liverpool" comes back as Percival Road, Smithfield. WattleAddr reads G-NAF,
 * the official file, and does not have that problem — which is the argument for
 * spending two minutes on a key.
 *
 * So suggestions from here are a typing aid, never an authority. The operator
 * still sees every field and can overwrite any of it.
 *
 * Proxied rather than called from the browser because Photon's public instance
 * asks to be able to identify who is calling, which means a User-Agent a page
 * cannot set; and because one cache here serves every terminal in the yard.
 */

const PHOTON_URL = 'https://photon.komoot.io/api/';
// Australia, so a partial street name cannot answer with Bangladesh.
const AU_BBOX = '112,-44,154,-10';
const UA = 'shine-metals-docket/1.0 (+https://shinemotorinvoice.vercel.app)';

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

/** One Photon feature, in the shape the address block already fills. */
function toSuggestion(feature) {
  const p = feature?.properties ?? {};
  const street = [p.housenumber, p.street || p.name].filter(Boolean).join(' ').trim();

  // `district` is the suburb where OSM has one; `city` is often the greater
  // metropolitan name, which is not what goes on a docket — Ingleburn, not
  // Sydney.
  const suburb = p.district || p.city || p.county || '';

  return {
    street,
    suburb,
    state: p.state || '',
    postcode: p.postcode || '',
    // What the operator reads in the list.
    label: [street || p.name, suburb, p.state, p.postcode].filter(Boolean).join(', '),
    // Nothing without a street is worth offering on a docket.
    usable: Boolean(street && suburb),
  };
}

// GET /api/address/search?q=
router.get(
  '/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.json({ suggestions: [], source: 'photon' });

    const key = q.toLowerCase();
    const cached = cacheGet(key);
    if (cached) return res.json({ suggestions: cached, source: 'photon', cached: true });

    let features = [];
    try {
      const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=6&bbox=${AU_BBOX}&lang=en`;
      const response = await fetch(url, {
        headers: { 'User-Agent': UA },
        // A typing aid must never be the reason the form feels stuck.
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`Photon returned ${response.status}`);
      features = (await response.json())?.features ?? [];
    } catch {
      // Silent and empty: the operator types the address, as they always could.
      return res.json({ suggestions: [], source: 'photon', unavailable: true });
    }

    const suggestions = features
      .map(toSuggestion)
      .filter((s) => s.usable)
      .slice(0, 6);

    cacheSet(key, suggestions);
    res.json({ suggestions, source: 'photon' });
  })
);

export default router;
