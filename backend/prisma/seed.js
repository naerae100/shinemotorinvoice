import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Transcribed directly from the Shine Metals paper docket (33 lines).
// currentPrice starts at 0 — admin fills in real rates on first login via Materials page.
const materials = [
  { code: 1, description: 'Bright Copper Wire', category: 'Copper', unit: 'KG' },
  { code: 2, description: 'No. 1 Copper', category: 'Copper', unit: 'KG' },
  { code: 3, description: 'No. 2 Copper', category: 'Copper', unit: 'KG' },
  { code: 4, description: 'Domestic Copper', category: 'Copper', unit: 'KG' },
  { code: 5, description: 'Insulated Copper Wire 20%', category: 'Copper', unit: 'KG' },
  { code: 6, description: 'Insulated Copper Wire 40%', category: 'Copper', unit: 'KG' },
  { code: 7, description: 'Insulated Copper Wire 75%', category: 'Copper', unit: 'KG' },
  { code: 8, description: 'Insulated Copper Wire 83%', category: 'Copper', unit: 'KG' },
  { code: 9, description: 'Gun Metal, Mix Brass', category: 'Brass', unit: 'KG' },
  { code: 10, description: 'Coast Brass', category: 'Brass', unit: 'KG' },
  { code: 11, description: 'Copper Brass Radiator', category: 'Radiator', unit: 'KG' },
  { code: 12, description: 'AL/CU Radiator', category: 'Radiator', unit: 'KG' },
  { code: 13, description: 'Aluminium Radiator', category: 'Radiator', unit: 'KG' },
  { code: 14, description: 'Aluminium Rims', category: 'Aluminium', unit: 'KG' },
  { code: 15, description: 'Extruded Aluminium', category: 'Aluminium', unit: 'KG' },
  { code: 16, description: 'Aluminium Domestic', category: 'Aluminium', unit: 'KG' },
  { code: 17, description: 'Cast Aluminium', category: 'Aluminium', unit: 'KG' },
  { code: 18, description: 'Irony Aluminium', category: 'Aluminium', unit: 'KG' },
  { code: 19, description: 'AC Units', category: 'Appliance', unit: 'UNIT' },
  { code: 20, description: 'Stainless Steel 304', category: 'Steel', unit: 'KG' },
  { code: 21, description: 'Stainless Steel 316', category: 'Steel', unit: 'KG' },
  { code: 22, description: 'Batteries', category: 'Battery', unit: 'KG' },
  { code: 23, description: 'Soft Lead', category: 'Lead', unit: 'KG' },
  { code: 24, description: 'Electric Motors', category: 'Motor', unit: 'KG' },
  { code: 25, description: 'LGEM', category: 'Motor', unit: 'KG' },
  { code: 26, description: 'HMS Insize', category: 'Steel', unit: 'KG' },
  { code: 27, description: 'Light Gage Steel', category: 'Steel', unit: 'KG' },
  { code: 28, description: 'Compressor', category: 'Motor', unit: 'UNIT' },
  { code: 29, description: 'Starter & Alternator', category: 'Motor', unit: 'UNIT' },
  { code: 30, description: 'B Engine', category: 'Vehicle', unit: 'UNIT' },
  { code: 31, description: 'White Engine', category: 'Vehicle', unit: 'UNIT' },
  { code: 32, description: 'Car Wire', category: 'Copper', unit: 'KG' },
  { code: 33, description: 'Cars & Trucks', category: 'Vehicle', unit: 'UNIT' },
];

async function main() {
  console.log('Seeding materials...');
  for (const m of materials) {
    await prisma.material.upsert({
      where: { code: m.code },
      update: {},
      create: { ...m, currentPrice: 0 },
    });
  }

  console.log('Creating initial admin user...');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: 'admin@shinemotor.com.au' },
    update: {},
    create: {
      name: 'Admin',
      email: 'admin@shinemotor.com.au',
      passwordHash,
      role: 'ADMIN',
    },
  });

  console.log('Seeding company settings row...');
  // Branding (logoUrl/stampUrl) is deliberately only set on first create: re-running
  // the seed must not wipe an image the admin has since uploaded via Settings.
  const companyDetails = {
    companyName: 'Shine Motor Corporation Pty Ltd',
    abn: '96 167 579 179',
    acn: '167 579 179',
    address: '8 Noonan Rd, Ingleburn NSW 2565, Australia',
    phone: '+61 2 8712 6999',
    mobile: '+61 4 351 350 80',
    fax: '+61 2 8712 9548',
    email: 'info@shinemotor.com.au',
    website: 'www.shinemotor.com.au',
    bankName: 'WESTPAC',
    bankSwift: 'WPACAU2S',
    bankAccountNo: '576624',
    bankBsb: '034-702',
    bankAddress: 'Level 30, Tower 8, Parramatta Square, 10 Darcy Street, Parramatta NSW 2150',
    beneficiary: 'SHINE MOTOR CORPORATION PTY LTD',
  };

  await prisma.companySettings.upsert({
    where: { id: 'singleton' },
    update: companyDetails,
    create: {
      id: 'singleton',
      ...companyDetails,
      logoUrl: '/branding/logo.png',
      // No stamp image ships with the repo — upload one via Settings. Pointing at a
      // file that doesn't exist just renders a broken image on every printed invoice.
      stampUrl: null,
    },
  });

  console.log('Done. Admin login: admin@shinemotor.com.au / (see SEED_ADMIN_PASSWORD env or default)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
