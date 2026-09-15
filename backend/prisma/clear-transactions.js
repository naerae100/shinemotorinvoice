/**
 * Remove every transaction — dockets, packing slips and export invoices — while
 * leaving the things you spent time setting up.
 *
 * Deleted:  Docket, DocketLineItem, ExportInvoice, InvoiceLineItem,
 *           InvoiceContainer, and the AuditEvent rows describing them.
 * Kept:     Material prices, Supplier, Consignee, User, CompanySettings
 *           (logo and stamp), BankAccount.
 *
 * Dry run by default — it prints what it would delete and stops. Nothing is
 * removed without --confirm, because this cannot be undone and the database it
 * points at has no point-in-time recovery.
 *
 *   npm run clear:transactions:prod              show what is there
 *   npm run clear:transactions:prod -- --confirm delete it
 *
 * Take a backup first: npm run backup:prod
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const confirmed = process.argv.includes('--confirm');

// Audit rows point at their subject with a plain string entityId, not a foreign
// key, so nothing cascades to them. Left alone they would leave the audit page
// describing dockets that no longer exist.
const AUDIT_ENTITIES = ['Docket', 'ExportInvoice'];

function target() {
  const url = process.env.DATABASE_URL || '';
  const host = url.match(/@([^:/?]+)/)?.[1] ?? 'unknown host';
  if (/ap-northeast-1/.test(host)) {
    return `${host}  <-- WARNING: this is the DECOMMISSIONED Tokyo instance`;
  }
  return host;
}

async function main() {
  const [dockets, docketLines, invoices, invoiceLines, containers, auditEvents] =
    await Promise.all([
      prisma.docket.count(),
      prisma.docketLineItem.count(),
      prisma.exportInvoice.count(),
      prisma.invoiceLineItem.count(),
      prisma.invoiceContainer.count(),
      prisma.auditEvent.count({ where: { entity: { in: AUDIT_ENTITIES } } }),
    ]);

  const [slips, priced] = await Promise.all([
    prisma.exportInvoice.count({ where: { stage: 'PACKING_SLIP' } }),
    prisma.exportInvoice.count({ where: { stage: 'INVOICED' } }),
  ]);

  const [materials, suppliers, consignees, users] = await Promise.all([
    prisma.material.count(),
    prisma.supplier.count(),
    prisma.consignee.count(),
    prisma.user.count(),
  ]);

  console.log(`\nDatabase: ${target()}\n`);

  console.log('WILL BE DELETED');
  console.log(`  Dockets                      ${dockets}`);
  console.log(`    their line items           ${docketLines}`);
  console.log(`  Export invoices (priced)     ${priced}`);
  console.log(`  Packing slips (unpriced)     ${slips}`);
  console.log(`    their line items           ${invoiceLines}`);
  console.log(`    their containers           ${containers}`);
  console.log(`  Audit events for the above   ${auditEvents}`);

  console.log('\nWILL BE KEPT');
  console.log(`  Materials & prices           ${materials}`);
  console.log(`  Suppliers                    ${suppliers}`);
  console.log(`  Buyers                       ${consignees}`);
  console.log(`  Users / logins               ${users}`);
  console.log('  Company settings, logo, stamp, bank accounts');

  if (dockets + invoices === 0) {
    console.log('\nNothing to delete — there are no transactions.\n');
    return;
  }

  if (!confirmed) {
    console.log('\nDRY RUN — nothing has been deleted.');
    console.log('Back up first:   npm run backup:prod');
    console.log('Then re-run with --confirm to delete.\n');
    return;
  }

  // One transaction: a half-cleared database — invoices gone, dockets left — is
  // worse than either state, and harder to reason about afterwards.
  const result = await prisma.$transaction(async (tx) => {
    const audit = await tx.auditEvent.deleteMany({
      where: { entity: { in: AUDIT_ENTITIES } },
    });
    // Children first. The schema cascades these, but deleting them explicitly
    // means the counts below are real rather than inferred.
    const invLines = await tx.invoiceLineItem.deleteMany();
    const invContainers = await tx.invoiceContainer.deleteMany();
    const invs = await tx.exportInvoice.deleteMany();
    const dktLines = await tx.docketLineItem.deleteMany();
    const dkts = await tx.docket.deleteMany();
    return { audit, invLines, invContainers, invs, dktLines, dkts };
  });

  console.log('\nDELETED');
  console.log(`  Dockets                      ${result.dkts.count}`);
  console.log(`    line items                 ${result.dktLines.count}`);
  console.log(`  Invoices & packing slips     ${result.invs.count}`);
  console.log(`    line items                 ${result.invLines.count}`);
  console.log(`    containers                 ${result.invContainers.count}`);
  console.log(`  Audit events                 ${result.audit.count}`);

  console.log('\nNote: docket numbers are allocated as max + 1, so the next');
  console.log('docket will be #1 again. Invoice numbers are typed by hand and');
  console.log('are unaffected.\n');
}

main()
  .catch((e) => {
    console.error('\nNothing was deleted — the transaction rolled back.\n', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
