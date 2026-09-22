/**
 * How long a session row should live.
 *
 * It has to match the token's own lifetime, or the two disagree: a row that
 * outlives its token shows a device as signed in when it is not, and a row
 * that dies first signs somebody out early. JWT_EXPIRES_IN is the single
 * source, expressed the way jsonwebtoken takes it — "14d", "12h", "30m".
 *
 * Read from the environment directly rather than through config/env.js: that
 * module exits the process when DATABASE_URL is absent, which is right for a
 * server starting up and fatal for a unit test importing one helper.
 */
const DEFAULT = '14d';

export function sessionTtlMs(spec = process.env.JWT_EXPIRES_IN || DEFAULT) {
  const m = /^(\d+)\s*([smhd])?$/.exec(String(spec ?? '').trim());
  // Anything unparseable falls back to the documented default rather than to
  // zero, which would sign everyone out on their first request.
  if (!m) return 14 * 24 * 60 * 60 * 1000;

  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * ms;
}

/**
 * The client's address, as best this can be known behind a proxy.
 *
 * Express fills req.ip from X-Forwarded-For when `trust proxy` is set, which
 * index.js does in production only. It is a header, so it is a hint and not
 * evidence — it is here to help somebody recognise their own sign-in, never
 * to authorise anything.
 *
 * IPv6-mapped IPv4 (::ffff:203.0.113.4) is unwrapped, because nobody
 * recognises their own address in that form.
 */
export function clientIp(req) {
  const raw = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  // Loopback is what a developer's own machine reports, and "::1" on a device
  // list is noise that looks like a bug. Nothing is better than nonsense.
  if (!raw || raw === '::1' || raw === '127.0.0.1') return null;
  return raw.slice(0, 64);
}
