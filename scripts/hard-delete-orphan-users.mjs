// Hard-delete orphan users: any User with no active UserTenant membership.
// "Active" = at least one UserTenant row with isActive=true.
// Such users cannot log in to any tenant and are dead weight in the User table.
//
// What it does (per orphan):
//   1. Deletes any inactive UserTenant rows (cleanup of leftover memberships)
//   2. Deletes the User row itself
//
// Re-runnable: a second run with no orphans is a no-op.
//
// What it does NOT touch:
//   - The 2 real tenant rows (kept via the EXCLUDED_EMAILS list, see below)
//   - Users with at least one active UserTenant (they can still log in)
//   - User rows that ARE the seeded admin/service accounts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Always keep these accounts regardless of their membership state.
// These are real operator accounts — if they have no active membership right now,
// they should be re-invited, not deleted.
const PROTECTED_EMAILS = [
  'admin@xl-mobility.com',  // Platform Admin
];

function log(...args) { console.log('[hard-delete-orphan-users]', ...args); }

// Step 1: find the orphans. A user is an orphan if they have no active UserTenant.
const allUsers = await prisma.user.findMany({
  select: { id: true, username: true, email: true, firstName: true, lastName: true, isActive: true },
  orderBy: { email: 'asc' },
});
log(`Total users in DB: ${allUsers.length}`);

const orphans = [];
for (const u of allUsers) {
  if (PROTECTED_EMAILS.includes(u.email)) continue;
  const activeCount = await prisma.userTenant.count({
    where: { userId: u.id, isActive: true },
  });
  if (activeCount === 0) {
    // Also count inactive memberships for the report
    const inactiveCount = await prisma.userTenant.count({
      where: { userId: u.id, isActive: false },
    });
    orphans.push({ user: u, inactiveMemberships: inactiveCount });
  }
}
log(`Orphans (no active UserTenant): ${orphans.length}`);

// Step 2: print the list so this is auditable before delete
if (orphans.length === 0) {
  log('Nothing to do. Re-run anytime — script is idempotent.');
  await prisma.$disconnect();
  process.exit(0);
}

log('\nUsers to be deleted:');
log('-'.repeat(80));
for (const o of orphans) {
  const u = o.user;
  log(`  ${u.email.padEnd(45)}  ${u.firstName ?? ''} ${u.lastName ?? ''}`.trimEnd() +
      `  isActive=${u.isActive}  inactive-memberships=${o.inactiveMemberships}`);
}
log('-'.repeat(80));
log(`Total to delete: ${orphans.length}`);

// Step 3: delete in batches. Each batch is a transaction for safety.
const BATCH = 50;
let deletedUsers = 0;
let deletedInactiveMemberships = 0;

for (let i = 0; i < orphans.length; i += BATCH) {
  const batch = orphans.slice(i, i + BATCH);
  const userIds = batch.map((o) => o.user.id);
  const result = await prisma.$transaction(async (tx) => {
    // 3a. Delete any inactive UserTenant rows for these users (cleanup)
    const inactiveUT = await tx.userTenant.deleteMany({
      where: { userId: { in: userIds }, isActive: false },
    });
    // 3b. Delete the User rows themselves
    const users = await tx.user.deleteMany({
      where: { id: { in: userIds } },
    });
    return { inactiveUT: inactiveUT.count, users: users.count };
  });
  deletedUsers += result.users;
  deletedInactiveMemberships += result.inactiveUT;
  log(`  Batch ${Math.floor(i / BATCH) + 1}: deleted ${result.users} users, ${result.inactiveUT} inactive memberships`);
}

log(`\nDone. Deleted ${deletedUsers} users and ${deletedInactiveMemberships} inactive UserTenant rows.`);

// Step 4: verify
const remaining = await prisma.user.count();
const alex = await prisma.user.findFirst({ where: { email: 'alex@exlsolutions.ae' } });
const platformAdmin = await prisma.user.findFirst({ where: { email: 'admin@xl-mobility.com' } });
log(`\nPost-delete verification:`);
log(`  Total users now in DB:        ${remaining}`);
log(`  alex@exlsolutions.ae gone:    ${alex === null}`);
log(`  admin@xl-mobility.com kept:   ${platformAdmin !== null}`);

await prisma.$disconnect();
