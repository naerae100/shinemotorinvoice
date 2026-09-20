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

export const config = {
  port: Number(process.env.PORT) || 4000,
  isProduction: process.env.NODE_ENV === 'production',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
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
