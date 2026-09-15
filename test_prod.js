import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.uwffzdnjejdsciumsvvr:Z*er6ALpQNFN25b@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
    }
  }
});

async function main() {
  try {
    const slips = await prisma.exportInvoice.findMany({
      where: { stage: 'PACKING_SLIP' }
    });
    console.log("Slips found:", slips.length);
  } catch (e) {
    console.error("Prisma error:", e);
  }
}
main();
