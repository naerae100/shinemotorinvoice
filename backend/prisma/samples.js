import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Generating sample data...');

  const admin = await prisma.user.findUnique({ where: { email: 'admin@shinemotor.com.au' } });
  if (!admin) throw new Error('Admin not found');

  const materials = await prisma.material.findMany();
  if (materials.length === 0) throw new Error('No materials found');

  // Helper to get a material by name (loose match)
  const getMat = (query) => materials.find(m => m.description.toLowerCase().includes(query.toLowerCase())) || materials[0];

  await prisma.exportInvoice.deleteMany();
  await prisma.docket.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.consignee.deleteMany();

  // 1. Create a Sample Purchase Docket
  const supplier1 = await prisma.supplier.create({
    data: {
      name: 'John Smith',
      address: '12 Fake St',
      suburb: 'Liverpool',
      phone: '0412345678',
      licenceNo: 'LIC123456',
      saleType: 'PRIVATE',
    }
  });

  await prisma.docket.create({
    data: {
      docketNumber: 9944122, // Match the paper pad example
      type: 'PURCHASE_DOCKET',
      supplierId: supplier1.id,
      date: new Date(),
      vehicleReg: 'ABC123',
      vehicleModel: 'Toyota Camry',
      paygStatement: 'PRIVATE_HOBBY',
      subtotal: 6.77,
      gst: 0,
      total: 6.77,
      createdById: admin.id,
      lineItems: {
        create: [
          { materialId: getMat('Bright Copper').id, netWeight: 0.5, price: 8.5, value: 4.25 },
          { materialId: getMat('Car Wire').id, netWeight: 1.2, price: 2.1, value: 2.52 },
        ]
      }
    }
  });

  // 2. Create a Sample Tax Invoice
  const supplier2 = await prisma.supplier.create({
    data: {
      name: 'ABC Scrap Metal Pty Ltd',
      address: '99 Industrial Rd',
      suburb: 'Wetherill Park',
      phone: '0298765432',
      saleType: 'BUSINESS',
      abn: '12 345 678 901',
    }
  });

  await prisma.docket.create({
    data: {
      docketNumber: 9944123,
      type: 'TAX_INVOICE',
      supplierId: supplier2.id,
      date: new Date(),
      vehicleReg: 'XYZ987',
      paygStatement: 'NOT_APPLICABLE',
      subtotal: 7.20,
      gst: 0.72,
      total: 7.92,
      createdById: admin.id,
      lineItems: {
        create: [
          { materialId: getMat('Aluminium Rims').id, netWeight: 2.5, price: 1.8, value: 4.5 },
          { materialId: getMat('Batteries').id, netWeight: 3.0, price: 0.9, value: 2.7 },
        ]
      }
    }
  });

  // 3. Create a Sample Export Invoice
  const consignee = await prisma.consignee.create({
    data: {
      name: 'Shine Pacific (HK) Limited',
      address: 'Room 1013, New Commerce Centre, 19 On Sum Street, Shatin, New Territories, Hong Kong',
      email: 'logistics@shinepacificlimited.com',
      phone: '00852 8228 3234',
    }
  });

  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } });

  await prisma.exportInvoice.create({
    data: {
      invoiceNumber: 'SM992692',
      date: new Date(),
      consigneeId: consignee.id,
      shippingTerm: 'PO',
      fasPort: 'SPP-260605',
      containerNo: 'SEGU2184...',
      seal: '163560',
      modeOfTransport: 'BY SEA',
      containerType: '1X20',
      createdById: admin.id,
      subtotalAud: 268226.61, // Just dummy amounts for the sample
      totalAud: 268226.61,
      bankSnapshot: JSON.stringify({
        bankName: settings.bankName,
        bankSwift: settings.bankSwift,
        bankAccountNo: settings.bankAccountNo,
        bankBsb: settings.bankBsb,
        bankAddress: settings.bankAddress,
        beneficiary: settings.beneficiary,
      }),
      lineItems: {
        create: [
          {
            materialId: getMat('Copper').id || materials[0].id,
            description: 'Millberry - Grade B',
            weightTonnes: 19.479,
            pricePerMt: 13770.04,
            totalAud: 268226.61,
          }
        ]
      }
    }
  });

  console.log('Sample data generated successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
