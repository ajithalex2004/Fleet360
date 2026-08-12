// Enforce: there must be no role with code = 'SUPER_ADMIN' and a non-null tenantId.
// Such a row is a misconfiguration under the role-code rule in the standard doc.
// Wire into CI as a pre-deploy step.
//
// Exits 0 if clean, 1 if any per-tenant SUPER_ADMIN is found.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const offenders = await prisma.role.findMany({
  where: {
    code: 'SUPER_ADMIN',
    tenantId: { not: null },
  },
  select: { id: true, name: true, code: true, tenantId: true, isSystem: true },
});

const allSuperAdmin = await prisma.role.findMany({
  where: { code: 'SUPER_ADMIN' },
  select: { id: true, name: true, tenantId: true, _count: { select: { userTenants: true } } },
});

if (offenders.length === 0) {
  console.log(`OK — ${allSuperAdmin.length} SUPER_ADMIN role(s), all system-wide (tenantId IS NULL).`);
  for (const r of allSuperAdmin) {
    console.log(`  ${r.id}  tenantId=${r.tenantId ?? 'null'}  userTenants=${r._count.userTenants}  (${r.name})`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

console.error(`FAIL — ${offenders.length} per-tenant SUPER_ADMIN role(s) found (rule violation):`);
for (const o of offenders) {
  console.error(`  ${o.id}  name='${o.name}'  tenantId=${o.tenantId}  isSystem=${o.isSystem}`);
}
console.error('');
console.error('Per the role-code rule in docs/TENANT_ISOLATION_STANDARD.md:');
console.error('  role.code = \'SUPER_ADMIN\' implies role.tenantId IS NULL.');
console.error('Use a per-tenant TENANT_ADMIN (or custom code) with explicit permissions instead.');
console.error('');
console.error('Remediation:');
console.error('  1. Re-assign any affected UserTenants to the system-wide SUPER_ADMIN role');
console.error('  2. Delete the per-tenant SUPER_ADMIN role(s)');
console.error('  3. Re-run this script');

await prisma.$disconnect();
process.exit(1);
