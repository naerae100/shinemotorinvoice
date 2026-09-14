/**
 * Import the buyer master extracted from the historic export invoices.
 *
 *   node prisma/import-customers.js ~/Downloads/customers.json          # dry run
 *   node prisma/import-customers.js ~/Downloads/customers.json --commit # write
 *
 * The archive is organised by folder, and a folder is not the same thing as a
 * buyer: one buyer may bill through several entities (PT Daiki through
 * Indonesia, Thailand and Malaysia), and the same entity may appear under
 * several folders (Select Metals under three). Each *billing entity* becomes one
 * Consignee, keyed by its name, with the folder recorded as the group it trades
 * under so the picker can still offer them together.
 *
 * Nothing is guessed. Where the extraction clearly swallowed an address into a
 * company name, the record is imported as-is and listed under NEEDS REVIEW
 * rather than being silently "corrected".
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const path = process.argv[2];
const commit = process.argv.includes('--commit');
if (!path) {
  console.error('Usage: node prisma/import-customers.js <customers.json> [--commit]');
  process.exit(1);
}

/** Names that plainly ran into an address or registration number during extraction. */
const SUSPECT_NAME = /\b(Address|ADD\s*:|Plot\s*no|Office\s*No|Dorp\s+West|WATERWILGWEG|ABN\s*No|LOT$)\b/i;

const clean = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim().replace(/^["']+|["']+$/g, '');
  return t.length ? t : null;
};

// The extraction merged adjacent fields in a handful of places
// ("...@gmail.comSales@..."), which produces an address no mail server accepts.
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cleanEmail = (e) => {
  const t = clean(e)?.replace(/^\.+/, '');
  return t && VALID_EMAIL.test(t) ? t.toLowerCase() : null;
};

const cleanPhone = (p) => {
  const t = clean(p);
  // "+32-3-2540414 (16" — an unterminated bracket means the number ran into the
  // words after it. Keep the digits, drop the fragment.
  return t ? t.replace(/\s*\([^)]*$/, '').trim() || null : null;
};

const data = JSON.parse(readFileSync(path, 'utf8'));

const entities = new Map(); // normalised name -> record
const skippedFolders = [];
const needsReview = [];

for (const customer of data.customers ?? []) {
  const group = clean(customer.displayName) ?? clean(customer.folderName);

  if (!customer.consignees?.length) {
    skippedFolders.push(customer.id);
    continue;
  }

  // A buyer that traded in exactly one currency gets it as their default; one
  // that used both gets none, because guessing would put the wrong bank account
  // in front of the operator.
  const currencies = customer.trade?.currencies ?? [];
  const defaultCurrency = currencies.length === 1 ? currencies[0] : null;
  const defaultShippingTerm = clean(customer.trade?.shippingTerms?.[0]);

  for (const c of customer.consignees) {
    const name = clean(c.billTo) ?? clean(c.address)?.slice(0, 80);
    if (!name) continue;

    const emails = (c.emails ?? []).map(cleanEmail).filter(Boolean);
    const phones = (c.phones ?? []).map(cleanPhone).filter(Boolean);
    const key = name.toLowerCase();

    const existing = entities.get(key);
    const record = {
      name,
      groupName: group,
      address: clean(c.address) ?? existing?.address ?? null,
      email: emails[0] ?? existing?.email ?? null,
      extraEmails: [...new Set([...(existing?.extraEmails ?? []), ...emails.slice(1)])],
      phone: phones[0] ?? existing?.phone ?? null,
      extraPhones: [...new Set([...(existing?.extraPhones ?? []), ...phones.slice(1)])],
      abn: clean(c.abn) ?? existing?.abn ?? null,
      website: clean(c.website) ?? existing?.website ?? null,
      defaultCurrency: defaultCurrency ?? existing?.defaultCurrency ?? null,
      defaultShippingTerm: defaultShippingTerm ?? existing?.defaultShippingTerm ?? null,
      archiveFolder: existing?.archiveFolder
        ? `${existing.archiveFolder}; ${customer.folderName}`
        : customer.folderName,
    };

    // Seen under another folder already — keep the first group name so the buyer
    // does not flip about, but record both folders.
    if (existing) record.groupName = existing.groupName;
    entities.set(key, record);

    if (SUSPECT_NAME.test(name)) needsReview.push({ folder: customer.folderName, name });
  }
}

const records = [...entities.values()].sort((a, b) => a.name.localeCompare(b.name));

console.log(`Parsed ${data.customers?.length ?? 0} archive folders`);
console.log(`  → ${records.length} distinct billing entities`);
console.log(`  → ${skippedFolders.length} folders skipped (no buyer on any invoice): ${skippedFolders.join(', ')}`);
console.log(`  → ${records.filter((r) => r.email).length} with an email, ${records.filter((r) => r.abn).length} with an ABN`);

if (needsReview.length) {
  console.log(`\nNEEDS REVIEW — the name looks like it absorbed an address:`);
  for (const r of needsReview) console.log(`  ${r.folder.padEnd(34)} ${r.name}`);
}

if (!commit) {
  console.log('\nDry run. Nothing written. Re-run with --commit to import.');
  await prisma.$disconnect();
  process.exit(0);
}

let created = 0;
let updated = 0;
for (const r of records) {
  // Match on name so re-running the import tops up existing buyers instead of
  // creating a second copy of each.
  const found = await prisma.consignee.findFirst({ where: { name: r.name } });
  if (found) {
    await prisma.consignee.update({
      where: { id: found.id },
      data: {
        // Never overwrite something an operator has already typed.
        address: found.address ?? r.address,
        email: found.email ?? r.email,
        phone: found.phone ?? r.phone,
        abn: found.abn ?? r.abn,
        website: found.website ?? r.website,
        groupName: found.groupName ?? r.groupName,
        defaultCurrency: found.defaultCurrency ?? r.defaultCurrency,
        defaultShippingTerm: found.defaultShippingTerm ?? r.defaultShippingTerm,
        extraEmails: [...new Set([...found.extraEmails, ...r.extraEmails])],
        extraPhones: [...new Set([...found.extraPhones, ...r.extraPhones])],
        archiveFolder: found.archiveFolder ?? r.archiveFolder,
      },
    });
    updated += 1;
  } else {
    await prisma.consignee.create({ data: r });
    created += 1;
  }
}

console.log(`\nImported: ${created} created, ${updated} updated.`);
await prisma.$disconnect();
