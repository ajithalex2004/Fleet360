// Removes a disposable test account created by create-disposable-test-account.mjs
// — the user, its tenant membership, and the seed rows tagged with its suffix.
//
// Usage:
//   node scripts/cleanup-disposable-test-account.mjs <userId>
// (userId looks like "disposable-test-<hex>", printed by the create script)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userId = process.argv[2];
  if (!userId || !userId.startsWith('disposable-test-')) {
    throw new Error('Pass the userId printed by create-disposable-test-account.mjs, e.g. disposable-test-ab12cd34');
  }
  const suffix = userId.replace('disposable-test-', '');

  const asset = await prisma.$executeRawUnsafe(
    `DELETE FROM asset_registry WHERE asset_no = $1`,
    `DISPOSABLE-TEST-${suffix}`,
  );
  const customer = await prisma.$executeRawUnsafe(
    `DELETE FROM rental_customers WHERE full_name = $1`,
    `Disposable test customer ${suffix}`,
  );
  const membership = await prisma.userTenant.deleteMany({ where: { userId } });
  const user = await prisma.user.deleteMany({ where: { id: userId } });

  console.log(`Deleted: ${asset} asset_registry row(s), ${customer} rental_customers row(s), ${membership.count} user_tenants row(s), ${user.count} user row(s).`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
