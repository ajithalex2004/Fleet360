// List the 2 users of XL AI Smart Mobility — Platform and their roles.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const tenant = await prisma.tenant.findFirst({
  where: { name: 'XL AI Smart Mobility — Platform' },
  select: { id: true, name: true, code: true, plan: true, isActive: true },
});
if (!tenant) {
  console.log('Tenant not found.');
  await prisma.$disconnect();
  process.exit(0);
}
console.log('Tenant:');
console.log(' ', JSON.stringify(tenant, null, 2));
console.log('');

const memberships = await prisma.userTenant.findMany({
  where: { tenantId: tenant.id },
  include: {
    user: { select: { id: true, username: true, email: true, firstName: true, lastName: true, isActive: true } },
    role: { select: { id: true, code: true, name: true, tenantId: true, isSystem: true } },
  },
  orderBy: { id: 'asc' },
});

console.log(`Members: ${memberships.length}`);
for (const m of memberships) {
  console.log('');
  console.log(`  User:    ${m.user.firstName ?? ''} ${m.user.lastName ?? ''} (${m.user.username})`);
  console.log(`           id=${m.user.id}  email=${m.user.email}  isActive=${m.user.isActive}`);
  console.log(`  Role:    ${m.role.name}  (code=${m.role.code})  isSystem=${m.role.isSystem}`);
  console.log(`           id=${m.role.id}  roleTenantId=${m.role.tenantId ?? 'null (system-wide)'}`);
  console.log(`  Membership:  id=${m.id}  isActive=${m.isActive}`);
}

await prisma.$disconnect();
