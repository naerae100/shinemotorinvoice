import { PrismaClient } from '@prisma/client';
import { EXPORT_GRADES } from './export-grades.js';

const prisma = new PrismaClient();

/**
 * Idempotent: matches on the grade name within kind EXPORT, so re-running after
 * the catalogue changes adds what is new and leaves everything else — including
 * any grade the yard has added by hand — exactly as it is. Nothing is deleted;
 * a grade that leaves the website may still be named on an invoice already
 * issued under it.
 */
async function main() {
  let added = 0;
  for (const grade of EXPORT_GRADES) {
    const existing = await prisma.material.findFirst({
      where: { kind: 'EXPORT', description: grade.description },
    });
    if (existing) continue;
    await prisma.material.create({
      data: {
        kind: 'EXPORT',
        description: grade.description,
        category: grade.category,
        // Sold by the tonne, and priced per contract rather than off a list.
        unit: 'TONNE',
        currentPrice: 0,
      },
    });
    added += 1;
  }
  const total = await prisma.material.count({ where: { kind: 'EXPORT' } });
  console.log(`Export grades: ${added} added, ${total} in the catalogue.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
