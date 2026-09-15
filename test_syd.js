import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.ofpdmijfgpvodntespiz:p4PWW7pB%24Z%3FaXB%3F@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
    }
  }
});

async function main() {
  try {
    const slips = await prisma.exportInvoice.findMany({
      where: { stage: 'PACKING_SLIP' }
    });
    console.log("Slips found in Sydney:", slips.length);
  } catch (e) {
    console.error("Prisma error in Sydney:", e.message);
  }
}
main();
