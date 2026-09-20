// Fail fast at boot rather than at the first request that needs a missing value.
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `Refusing to start — missing required environment variable(s): ${missing.join(', ')}.\n` +
      'Copy .env.example to .env and fill them in.'
  );
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
  console.error(
    'Refusing to start — JWT_SECRET is shorter than 32 characters. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
  process.exit(1);
}

/**
 * Refuse to talk to the decommissioned Tokyo instance.
 *
 * The database moved from ap-northeast-1 to ap-southeast-2, but a stale
 * DATABASE_URL pointing at the old host does not fail loudly — Supabase keeps
 * answering, so a migration or a query reports success against a server holding
 * data nobody reads. That has cost real time more than once. The operational
 * scripts each check for it; this makes the check unskippable, because it now
 * sits in the boot path every command shares.
 */
const DECOMMISSIONED_HOSTS = ['ap-northeast-1'];
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = process.env[key] || '';
  const dead = DECOMMISSIONED_HOSTS.find((h) => url.includes(h));
  if (dead) {
    console.error(
      `Refusing to start — ${key} points at ${dead}, the DECOMMISSIONED Tokyo instance.\n` +
        'That server still answers, so every query would succeed against dead data.\n' +
        'Use the Sydney connection string (ap-southeast-2).'
    );
    process.exit(1);
  }
}

/**
 * Every origin the browser app is served from.
 *
 * FRONTEND_URL is the explicit answer and still wins, but it is a setting
 * somebody has to remember, and forgetting it fails in the least helpful way
 * available: the API falls back to localhost, CORS rejects the real site, and
 * the only symptom is a console error in someone else's browser. It worked in
 * production purely because the site and the API happen to share an origin
 * there — so the misconfiguration was invisible right up until it wouldn't be.
 *
 * Vercel already knows the answer and puts it in the environment of every
 * deployment, so ask it rather than requiring a dashboard step:
 *
 *   VERCEL_PROJECT_PRODUCTION_URL  the production domain, always the same
 *   VERCEL_URL                     this one deployment, so previews work too
 *
 * Both arrive without a scheme. Neither is a secret, and neither is a domain
 * hardcoded in source that goes stale the day the site is renamed.
 */
function siteOrigins() {
  const origins = [];

  const add = (value) => {
    if (!value) return;
    // The Vercel variables carry a bare host; FRONTEND_URL carries a full URL.
    const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
    let origin;
    try {
      ({ origin } = new URL(withScheme));
    } catch {
      // An unparseable value is not an origin. Ignoring it beats refusing to
      // boot over a stray character in something this peripheral.
      return;
    }
    if (!origins.includes(origin)) origins.push(origin);
  };

  add(process.env.FRONTEND_URL);
  add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  add(process.env.VERCEL_URL);

  // Nothing set means a developer's machine.
  if (origins.length === 0) origins.push('http://localhost:5173');

  return origins;
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  isProduction: process.env.NODE_ENV === 'production',
  /**
   * Where the browser app lives. Used to answer CORS — see index.js.
   */
  siteOrigins: siteOrigins(),
  jwtSecret: process.env.JWT_SECRET,
  /**
   * How long a session lasts without being used.
   *
   * Twelve hours meant the yard tablet logged itself out partway through a
   * shift, and somebody typed a password with a truck on the weighbridge. The
   * session now slides — see issueSlidingToken in middleware/auth.js — so this
   * is the idle window, not a hard limit: used daily it never expires, left in
   * a drawer for a fortnight it does.
   *
   * It is not longer than a fortnight on purpose. This is a shared device in a
   * yard; a session that never ends is a key left in the door.
   */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '14d',
};
