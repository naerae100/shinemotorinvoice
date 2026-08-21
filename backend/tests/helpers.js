import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PORT = 4123;
export const BASE = `http://localhost:${PORT}/api`;

const ADMIN_PASSWORD = 'TestAdmin12345';

/**
 * The API tests need a real PostgreSQL database, because that is what the schema
 * targets — a SQLite file will not do. Point TEST_DATABASE_URL at a scratch
 * database; it is wiped and recreated on every run, so it must never be the
 * production one.
 *
 *   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test --name shine-test postgres:16
 *   export TEST_DATABASE_URL="postgresql://postgres:test@localhost:5433/postgres"
 *   npm test
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

if (hasTestDatabase && /supabase|amazonaws|\.com/.test(TEST_DATABASE_URL) &&
    !/localhost|127\.0\.0\.1/.test(TEST_DATABASE_URL)) {
  throw new Error(
    'TEST_DATABASE_URL looks like a hosted database. Tests DROP AND RECREATE the ' +
      'schema — point it at a local scratch database only.'
  );
}

const env = {
  ...process.env,
  DATABASE_URL: TEST_DATABASE_URL,
  DIRECT_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'test-secret-that-is-definitely-long-enough-for-the-check',
  SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
  NODE_ENV: 'test',
  PORT: String(PORT),
};

let server;

export async function startTestServer() {
  if (!hasTestDatabase) throw new Error('TEST_DATABASE_URL is not set');

  // --force-reset drops everything first, so each run starts from a known state.
  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss', '--force-reset'],
    { cwd: ROOT, env, stdio: 'pipe' }
  );
  execFileSync('node', ['prisma/seed.js'], { cwd: ROOT, env, stdio: 'pipe' });

  server = spawn('node', ['src/index.js'], { cwd: ROOT, env, stdio: 'pipe' });
  server.stderr.on('data', (d) => {
    const text = String(d);
    if (!text.includes('prisma:')) process.stderr.write(`[server] ${text}`);
  });

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Test server did not start');
}

export async function stopTestServer() {
  server?.kill('SIGKILL');
}

/** True while the process is still answering — used to prove errors don't kill it. */
export async function serverAlive() {
  try {
    return (await fetch(`${BASE}/health`)).ok;
  } catch {
    return false;
  }
}

export async function api(method, endpoint, { body, token } = {}) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, body: json, raw: text };
}

export async function loginAdmin() {
  const res = await api('POST', '/auth/login', {
    body: { email: 'admin@shinemotor.com.au', password: ADMIN_PASSWORD },
  });
  if (!res.body?.token) throw new Error(`Admin login failed: ${res.raw}`);
  return res.body.token;
}

export const ADMIN_CREDENTIALS = { email: 'admin@shinemotor.com.au', password: ADMIN_PASSWORD };

/** Convenience fixtures shared by several suites. */
export async function fixtures(token) {
  const materials = (await api('GET', '/materials', { token })).body.materials;
  const supplier = (
    await api('POST', '/suppliers', { token, body: { name: `Supplier ${Date.now()}` } })
  ).body.supplier;
  const consignee = (
    await api('POST', '/consignees', { token, body: { name: `Buyer ${Date.now()}` } })
  ).body.consignee;
  return { materials, supplier, consignee };
}
