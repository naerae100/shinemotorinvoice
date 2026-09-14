import { prisma } from '../config/prisma.js';

/**
 * Append-only record of who changed what.
 *
 * Deliberately never throws into the caller: an audit write failing must not
 * roll back the business action a user just completed successfully. It is
 * logged loudly instead, because a silent gap in the trail is worse than a
 * noisy one.
 */
export async function audit({ req, action, entity, entityId, label, before, after }) {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: req?.user?.id ?? null,
        actorEmail: req?.user?.email ?? null,
        action,
        entity,
        entityId: String(entityId),
        label: label ?? null,
        before: before ?? undefined,
        after: after ?? undefined,
        ip: clientIp(req),
      },
    });
  } catch (err) {
    console.error(`AUDIT WRITE FAILED ${action} ${entity} ${entityId}:`, err.message);
  }
}

/** Behind Vercel the socket address is the proxy, so prefer the forwarded header. */
function clientIp(req) {
  if (!req) return null;
  const fwd = req.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip ?? null;
}

/**
 * The fields that actually changed, so the trail stays smaller than the data.
 * Decimals arrive from Prisma as objects, hence the String() comparison.
 */
export function diff(before, after, fields) {
  const b = {};
  const a = {};
  for (const f of fields) {
    const was = before?.[f];
    const now = after?.[f];
    if (was === undefined && now === undefined) continue;
    if (String(was ?? '') === String(now ?? '')) continue;
    b[f] = was ?? null;
    a[f] = now ?? null;
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
