// Creates a disposable test user + tenant membership + a small amount of
// seed data, for one-off end-to-end verification (e.g. testing an API fix
// through the real login → session cookie → authenticated request flow).
//
// Run locally against whichever DATABASE_URL your .env/.env.local points at.
// Prints the login credentials ONCE at the end — copy them immediately.
//
// Usage:
//   node scripts/create-disposable-test-account.mjs [tenantId]
//
// If tenantId is omitted, the script picks an active tenant that already
// has at least one vehicle, so vehicle/fleet-derived stats endpoints have
// non-zero data to return.
//
// Cleanup: node scripts/cleanup-disposable-test-account.mjs <userId>
// (the userId is printed below when this script finishes)

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function pickTenant() {
  const withVehicles = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT tenant_id FROM vehicles WHERE deleted_at IS NULL LIMIT 20`,
  );
  for (const row of withVehicles) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: row.tenant_id },
      select: { id: true, name: true, isActive: true },
    });
    if (tenant?.isActive) return tenant;
  }
  throw new Error('No active tenant with vehicle data found — pass a tenantId explicitly.');
}

async function main() {
  const explicitTenantId = process.argv[2];
  const tenant = explicitTenantId
    ? await prisma.tenant.findUnique({ where: { id: explicitTenantId }, select: { id: true, name: true, isActive: true } })
    : await pickTenant();

  if (!tenant) throw new Error(`Tenant ${explicitTenantId} not found.`);
  if (tenant.isActive === false) throw new Error(`Tenant ${tenant.id} is inactive — pick a different one.`);

  const role = await prisma.role.findFirst({ where: { code: 'TENANT_ADMIN', tenantId: null } });
  if (!role) throw new Error('TENANT_ADMIN role not found.');

  const suffix = crypto.randomBytes(4).toString('hex');
  const userId = `disposable-test-${suffix}`;
  const email = `disposable-test-${suffix}@fleet360.invalid`;
  const password = crypto.randomBytes(18).toString('base64url');

  // Same PBKDF2-SHA512 / 100k iters / 64-byte scheme the app's own
  // /api/auth/login route verifies against.
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  const storedHash = `${salt}:${hash}`;
  const now = new Date();

  await prisma.user.create({
    data: {
      id: userId,
      username: userId,
      email,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
    storedHash, userId,
  );
  await prisma.userTenant.create({
    data: { userId, tenantId: tenant.id, roleId: role.id, isActive: true },
  });

  // Minimal seed data so stats/list endpoints that were empty before the
  // RLS fix have something real to return.
  const asset = await prisma.$queryRawUnsafe(
    `INSERT INTO asset_registry (tenant_id, asset_no, name, domain, asset_type)
     VALUES ($1, $2, 'Disposable test asset', 'GENERAL', 'CONSUMABLE')
     RETURNING id`,
    tenant.id, `DISPOSABLE-TEST-${suffix}`,
  );
  const customer = await prisma.$queryRawUnsafe(
    `INSERT INTO rental_customers (id, full_name, tenant_id)
     VALUES (gen_random_uuid(), $1, $2)
     RETURNING id`,
    `Disposable test customer ${suffix}`, tenant.id,
  );

  console.log('\n=== Disposable test account created ===');
  console.log(`  EMAIL:     ${email}`);
  console.log(`  PASSWORD:  ${password}`);
  console.log(`  TENANT_ID: ${tenant.id} (${tenant.name})`);
  console.log(`  USER_ID:   ${userId}`);
  console.log(`  seeded asset_registry id:   ${asset[0].id}`);
  console.log(`  seeded rental_customers id: ${customer[0].id}`);
  console.log('\nLog in via POST /api/auth/login with EMAIL + PASSWORD above.');
  console.log(`When done, clean up with:\n  node scripts/cleanup-disposable-test-account.mjs ${userId}`);
  console.log('========================================\n');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
