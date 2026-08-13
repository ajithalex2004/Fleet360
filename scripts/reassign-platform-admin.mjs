// Re-assign Platform Admin to the system-wide SUPER_ADMIN role and delete
// the per-tenant duplicate. After this, the strict session code
// (role.code === 'SUPER_ADMIN' && role.tenantId === null) keeps Platform Admin
// working with wildcard access, and the per-tenant role no longer exists.

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Find both roles
const allSuperAdmin = await prisma.role.findMany({
  where: { code: 'SUPER_ADMIN' },
  select: { id: true, name: true, tenantId: true },
});
const systemRole = allSuperAdmin.find((r) => r.tenantId === null);
const perTenantRole = allSuperAdmin.find((r) => r.tenantId !== null);

if (!systemRole) {
  console.error('No system-wide SUPER_ADMIN role found. Aborting — run the seed first.');
  await prisma.$disconnect();
  process.exit(1);
}
if (!perTenantRole) {
  console.log('No per-tenant SUPER_ADMIN role found. Nothing to clean up.');
  await prisma.$disconnect();
  process.exit(0);
}
console.log(`System role:     ${systemRole.id}  (${systemRole.name}, tenantId=null)`);
console.log(`Per-tenant role: ${perTenantRole.id}  (${perTenantRole.name}, tenantId=${perTenantRole.tenantId})`);

// Find userTenants on the per-tenant role
const affected = await prisma.userTenant.findMany({
  where: { roleId: perTenantRole.id },
  include: { user: { select: { email: true } }, tenant: { select: { name: true } } },
});
console.log(`\nUserTenants on per-tenant role: ${affected.length}`);
for (const a of affected) console.log(`  - ${a.user.email} at ${a.tenant.name}  (membershipId=${a.id})`);

// Re-assign
console.log('\nRe-assigning...');
const result = await prisma.$transaction(async (tx) => {
  const reassigned = await tx.userTenant.updateMany({
    where: { roleId: perTenantRole.id },
    data: { roleId: systemRole.id },
  });
  // Delete the per-tenant role
  await tx.role.delete({ where: { id: perTenantRole.id } });
  return reassigned.count;
});
console.log(`  Re-assigned ${result} UserTenant(s) to the system role.`);
console.log(`  Deleted per-tenant role ${perTenantRole.id}.`);

// Verify
const stillExists = await prisma.role.count({ where: { id: perTenantRole.id } });
const superAdminAfter = await prisma.role.findMany({
  where: { code: 'SUPER_ADMIN' },
  select: { id: true, tenantId: true, _count: { select: { userTenants: true } } },
});
console.log(`\nPost-fix SUPER_ADMIN roles:`);
for (const r of superAdminAfter) {
  console.log(`  ${r.id}  tenantId=${r.tenantId ?? 'null'}  userTenants=${r._count.userTenants}`);
}
console.log(`Per-tenant role still in DB: ${stillExists > 0}  (expected false)`);

await prisma.$disconnect();
