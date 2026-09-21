import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { isConfigured } from '../lib/photoStorage.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * Connecting Google Drive, once.
 *
 * The app uploads as a person rather than as a service account, because a
 * service account has no Drive quota and cannot own files — see
 * lib/photoStorage.js. So somebody has to approve it once, and this is the
 * two-step that turns that approval into a refresh token.
 *
 *   1. An admin opens /api/drive/auth and is sent to Google.
 *   2. Google returns here, and the code is exchanged for a refresh token,
 *      which is then put into the environment by hand.
 *
 * The token is deliberately NOT written to the database. It is the single
 * credential that can read and write every file this app has ever created,
 * and the environment is where the other credential of that weight — the JWT
 * secret — already lives.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * Where Google sends the browser back to.
 *
 * Derived from config.siteOrigins, not from FRONTEND_URL directly: that
 * variable is not set in Vercel — the deployment's own domain is used
 * instead, see config/env.js — so reading it here produced
 * http://localhost:4000/api/drive/callback in production, which Google
 * would refuse and which would send an approval to nobody.
 *
 * GOOGLE_REDIRECT_URI still overrides, for a custom domain.
 */
const redirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI ||
  `${config.siteOrigins[0].replace(/\/$/, '')}/api/drive/callback`;

/**
 * Google hands the browser back to the callback with no session — it is a
 * plain redirect — so the callback cannot be behind requireAuth. The state
 * parameter carries the proof instead: signed with JWT_SECRET, good for ten
 * minutes, so only somebody who was an admin a moment ago can start a flow
 * that this server will finish.
 */
/**
 * Thirty minutes, not ten.
 *
 * This is a one-time setup that runs alongside configuring the Google Cloud
 * console — registering a redirect URI, publishing a consent screen — and
 * ten minutes ran out mid-way through that more than once. The state is
 * CSRF protection for a flow only an admin can start, so a longer window
 * costs little; a window too short to finish the task costs the task.
 */
const STATE_TTL_SECONDS = 30 * 60;

const signState = () => {
  const expires = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const mac = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`drive:${expires}`)
    .digest('base64url');
  return `${expires}.${mac}`;
};

const verifyState = (state) => {
  const [expires, mac] = String(state ?? '').split('.');
  if (!expires || !mac) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`drive:${expires}`)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const page = (title, body) => `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1.25rem;color:#0F172A}
  code,pre{font-family:ui-monospace,monospace}
  pre{background:#F1F5F9;padding:1rem;border-radius:.5rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
  .warn{background:#FBEAE7;color:#C0392B;padding:.75rem 1rem;border-radius:.5rem}
</style>
<h1>${title}</h1>${body}`;

/** Where to send an admin to approve the app. */
router.get(
  '/auth',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({
        error:
          'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set yet. Add them first, then start here.',
      });
    }
    const url =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: SCOPE,
        // offline + consent together are what actually return a refresh
        // token. Without prompt=consent Google gives one only on the very
        // first approval ever, so a second attempt silently yields nothing
        // and looks like the flow is broken.
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: signState(),
      });
    res.json({ url, redirectUri: redirectUri() });
  })
);

router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    if (!verifyState(req.query.state)) {
      return res.status(403).send(
        page(
          'That link has expired',
          `<p>Approval links are good for thirty minutes. Generate a fresh one and
            open it straight away — it is the last step, so do the Google Cloud
            console parts first.</p>`
        )
      );
    }
    if (req.query.error) {
      return res.status(400).send(page('Google refused', `<p><code>${req.query.error}</code></p>`));
    }

    const body = await (
      await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(req.query.code ?? ''),
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }),
      })
    ).json();

    if (!body.refresh_token) {
      return res.status(400).send(
        page(
          'No refresh token came back',
          `<p>Google returned an access token but no refresh token. That happens when the app
           has been approved before — revoke it at
           <a href="https://myaccount.google.com/permissions">Google account permissions</a>
           and try again.</p><pre>${JSON.stringify(body, null, 2)}</pre>`
        )
      );
    }

    res.send(
      page(
        'Google Drive connected',
        `<p>Put this in the environment as <code>GOOGLE_REFRESH_TOKEN</code>, then redeploy.</p>
         <pre>${body.refresh_token}</pre>
         <p class="warn">Treat this like a password. It can read and write every file this app
         creates in that Drive, and it does not expire on its own.</p>
         <p>Close this tab once it is saved — it is not shown again.</p>`
      )
    );
  })
);

router.get(
  '/status',
  requireAuth,
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({
      configured: isConfigured(),
      hasClient: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      hasRefreshToken: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
      rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || null,
      redirectUri: redirectUri(),
    });
  })
);

export default router;
