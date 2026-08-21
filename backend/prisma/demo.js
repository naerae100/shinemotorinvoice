/**
 * Demo data — generates or removes a realistic sample of trading history so the
 * system can be explored before real records exist.
 *
 * Everything it creates is prefixed "DEMO " (suppliers, buyers) or "DEMO-"
 * (invoice numbers), which is exactly how `--clear` finds it again. Nothing you
 * enter yourself is ever touched.
 *
 *   npm run demo         generate ~90 days of trading
 *   npm run demo:clear   remove every DEMO record
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const clear = process.argv.includes('--clear');

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const round2 = (n) => Math.round(n * 100) / 100;

async function clearDemo() {
  const suppliers = await prisma.supplier.findMany({ where: { name: { startsWith: 'DEMO ' } } });
  let dockets = 0;
  for (const s of suppliers) {
    const list = await prisma.docket.findMany({ where: { supplierId: s.id }, select: { id: true } });
    for (const d of list) {
      await prisma.docketLineItem.deleteMany({ where: { docketId: d.id } });
      await prisma.docket.delete({ where: { id: d.id } });
      dockets++;
    }
    await prisma.supplier.delete({ where: { id: s.id } });
  }

  const invoices = await prisma.exportInvoice.findMany({
    where: { invoiceNumber: { startsWith: 'DEMO-' } },
    select: { id: true },
  });
  for (const inv of invoices) {
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: inv.id } });
    await prisma.exportInvoice.delete({ where: { id: inv.id } });
  }
  const buyers = await prisma.consignee.deleteMany({ where: { name: { startsWith: 'DEMO ' } } });

  console.log(
    `Removed ${dockets} dockets, ${suppliers.length} suppliers, ${invoices.length} invoices, ${buyers.count} buyers.`
  );
}

async function generate() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('No admin user — run `npm run seed` first.');

  const materials = await prisma.material.findMany({ where: { active: true } });
  if (materials.length === 0) throw new Error('No materials — run `npm run seed` first.');

  const suppliers = [];
  for (const [name, saleType] of [
    ['DEMO Riverside Demolition', 'BUSINESS'],
    ['DEMO K&M Auto Wreckers', 'BUSINESS'],
    ['DEMO Parramatta Plumbing', 'BUSINESS'],
    ['DEMO Ingleburn Electrical', 'BUSINESS'],
    ['DEMO Southwest Roofing', 'BUSINESS'],
    ['DEMO T. Nguyen', 'PRIVATE'],
    ['DEMO Blacktown Metals', 'BUSINESS'],
  ]) {
    suppliers.push(
      await prisma.supplier.create({
        data: { name, saleType, suburb: 'Sydney', phone: `02${Math.floor(rnd(10000000, 99999999))}` },
      })
    );
  }

  const buyers = [];
  for (const [name, country] of [
    ['DEMO Hanoi Metals Trading', 'Vietnam'],
    ['DEMO Guangzhou Recycling Ltd', 'China'],
    ['DEMO Chennai Alloys Pvt', 'India'],
  ]) {
    buyers.push(await prisma.consignee.create({ data: { name, country } }));
  }

  let nextNumber =
    ((await prisma.docket.findFirst({ orderBy: { docketNumber: 'desc' }, select: { docketNumber: true } }))
      ?.docketNumber ?? 0) + 1;

  const today = new Date();
  let dockets = 0;
  let invoices = 0;

  for (let daysAgo = 88; daysAgo >= 0; daysAgo--) {
    const day = new Date(today);
    day.setDate(day.getDate() - daysAgo);
    if (day.getDay() === 0) continue; // closed Sundays

    for (let i = 0; i < (Math.random() < 0.25 ? 0 : Math.floor(rnd(1, 5))); i++) {
      const date = new Date(day);
      date.setHours(8 + Math.floor(rnd(0, 9)), Math.floor(rnd(0, 60)));

      const lines = Array.from({ length: Math.floor(rnd(1, 4)) }, () => {
        const m = pick(materials);
        const netWeight = round2(rnd(5, 900));
        const price = round2(rnd(0.4, 12));
        return { materialId: m.id, netWeight, price, value: round2(netWeight * price) };
      });

      const type = Math.random() < 0.3 ? 'TAX_INVOICE' : 'PURCHASE_DOCKET';
      const subtotal = round2(lines.reduce((s, l) => s + l.value, 0));
      const usesDiscount = Math.random() < 0.12;
      const discountValue = usesDiscount ? pick([2, 5, 7.5]) : 0;
      const discountAmount = round2((subtotal * discountValue) / 100);
      const taxable = round2(subtotal - discountAmount);
      const gst = type === 'TAX_INVOICE' ? round2(taxable * 0.1) : 0;

      await prisma.docket.create({
        data: {
          docketNumber: nextNumber++,
          type,
          date,
          supplierId: pick(suppliers).id,
          subtotal,
          discountType: usesDiscount ? 'PERCENT' : 'NONE',
          discountValue,
          discountAmount,
          gst,
          total: round2(taxable + gst),
          createdById: admin.id,
          lineItems: { create: lines },
        },
      });
      dockets++;
    }

    // A container goes out roughly every ten days
    if (daysAgo % 10 === 3) {
      const lines = Array.from({ length: Math.floor(rnd(2, 5)) }, () => {
        const m = pick(materials);
        const weightTonnes = round2(rnd(2, 12));
        const pricePerMt = round2(rnd(600, 12000));
        return {
          materialId: m.id,
          description: m.description,
          weightTonnes,
          pricePerMt,
          totalAud: round2(weightTonnes * pricePerMt),
        };
      });
      const subtotalAud = round2(lines.reduce((s, l) => s + l.totalAud, 0));

      await prisma.exportInvoice.create({
        data: {
          invoiceNumber: `DEMO-${1000 + invoices}`,
          date: day,
          consigneeId: pick(buyers).id,
          shippingTerm: pick(['FOB', 'CIF', 'FAS']),
          fasPort: 'Port Botany, Sydney',
          modeOfTransport: 'Sea',
          containerType: pick(['20ft GP', '40ft HC']),
          containerNo: `TEMU ${Math.floor(rnd(100000, 999999))}-1`,
          subtotalAud,
          applyGst: false,
          gstAud: 0,
          totalAud: subtotalAud,
          createdById: admin.id,
          lineItems: { create: lines },
        },
      });
      invoices++;
    }
  }

  console.log(`Generated ${dockets} dockets and ${invoices} invoices across 89 days.`);
  console.log('Remove it all again with: npm run demo:clear');
}

(clear ? clearDemo() : generate())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
