import { api } from './api';

/**
 * Company settings are read on every docket and invoice screen but change
 * perhaps twice a year — and the payload now carries the logo and stamp as
 * base64 data URIs (~90 KB), so refetching per page view was costing a slow
 * round trip and a large body for data that had not changed.
 *
 * Cached for the tab's lifetime; writes invalidate it explicitly.
 */
let cached = null;
let inflight = null;

export function getSettings() {
  if (cached) return Promise.resolve(cached);
  // Share one request if several components ask at the same moment.
  if (!inflight) {
    inflight = api
      .get('/settings')
      .then((res) => {
        cached = res.data.settings;
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Call after any write so the next read picks up the change. */
export function setCachedSettings(settings) {
  cached = settings ?? null;
}

export function invalidateSettings() {
  cached = null;
}

/**
 * Public trading identity for the sign-in screen. Separate from getSettings()
 * because that endpoint requires a token, and nobody has one yet at login —
 * calling it there produced a guaranteed 401 on every page load.
 */
let brandingCache = null;

export function getPublicBranding() {
  if (brandingCache) return Promise.resolve(brandingCache);
  return api
    .get('/settings/public')
    .then((res) => {
      brandingCache = res.data.branding;
      return brandingCache;
    })
    .catch(() => null);
}
