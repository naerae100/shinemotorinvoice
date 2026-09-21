/**
 * The field grade list, as written on the pad.
 *
 * Transcribed from the yard's handwritten sheet. Flat and alphabetical on
 * screen — no codes, no categories, no prices — because a contractor picking
 * "ICW 42%" in a driveway should not have to know which category it was filed
 * under, and nothing here is bought at a price.
 *
 * Idempotent: matched on description within kind COLLECTION, so running it
 * twice adds nothing and running it after someone has renamed a grade leaves
 * their rename alone rather than resurrecting the original.
 *
 *   node prisma/seed-collection-materials.js            # against DATABASE_URL
 *   node prisma/seed-collection-materials.js --dry-run  # show, change nothing
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * In the order they were written, left column then right.
 *
 * Three came from arrows pencilled beside another grade rather than from a
 * line of their own — Painted Brass (beside Mix Brass), Carwire (beside the
 * ICW block) and Irony Cast Aluminium (beside Cast Aluminium). They are here
 * as grades in their own right, which is the reading that loses nothing: a
 * wrong one is deleted in a click, a missing one has to be noticed first.
 *
 * Spelling is tidied where the pad plainly meant the standard name —
 * "STAINLEES" to Stainless, "ALUMIUN" to Aluminium.
 */
const GRADES = [
  // Left column
  'Shiny',
  'No.1 Copper',
  'No.2 Copper',
  'Tint Copper',
  'Premium Brass',
  'Mix Brass',
  'Painted Brass',
  'Coast Brass',
  'Carwire',
  'ICW 30%',
  'ICW 42%',
  'ICW 55%',
  'ICW 65%',
  'ICW 75%',
  'ICW 83%',
  'ICW Steel Arm',
  'Tint Wire',
  'Aluminium Extrusion',
  'Wheels',
  'Cast Aluminium',
  'Irony Cast Aluminium',
  'Aluminium Cable',
  'Domestic Aluminium',

  // Right column
  'Aluminium Sheets',
  'Stainless 304',
  'Stainless 316',
  'ACR',
  'ACRI',
  'Lead',
  'Black Compressor',
  'Electric Motor',
  'Starter Motor',
  'Car Compressor',
  'Transformer',
  'LGEM',
  'Irony Aluminium',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const existing = await prisma.material.findMany({
    where: { kind: 'COLLECTION' },
    select: { description: true },
  });
  const have = new Set(existing.map((m) => m.description.trim().toLowerCase()));
  const missing = GRADES.filter((g) => !have.has(g.trim().toLowerCase()));

  console.log(`  already present : ${existing.length}`);
  console.log(`  to add          : ${missing.length}`);
  for (const g of missing) console.log(`      + ${g}`);

  if (dryRun) {
    console.log('\n  --dry-run: nothing written.');
    return;
  }
  if (missing.length === 0) {
    console.log('\n  Nothing to do.');
    return;
  }

  await prisma.material.createMany({
    data: missing.map((description) => ({
      description,
      kind: 'COLLECTION',
      // Everything in the field is weighed, so kilograms throughout. No price
      // and no category: the column is not nullable, so zero stands for "not
      // priced" rather than the schema being loosened for every material.
      unit: 'KG',
      currentPrice: 0,
      category: null,
      code: null,
      active: true,
    })),
  });

  const total = await prisma.material.count({ where: { kind: 'COLLECTION' } });
  console.log(`\n  Added ${missing.length}. The field list now has ${total} grades.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
