const crypto = require('crypto');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const EMAIL = 'alex@exlsolutions.ae';

  const user = await p.user.findUnique({ where: { email: EMAIL } });
  if (!user) { console.error('User not found'); process.exit(1); }
  console.log('User found:', user.id);

  const tenants = await p.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  if (!tenants.length) { console.log('No tenants found. Go to /onboarding first.'); process.exit(1); }
  const tenant = tenants[0];
  console.log('Using tenant:', tenant.name);

  let role = await p.role.findFirst({ where: { code: 'SUPER_ADMIN', tenantId: tenant.id } })
          ?? await p.role.findFirst({ where: { code: 'SUPER_ADMIN', tenantId: null } });

  if (!role) {
    role = await p.role.create({
      data: { id: crypto.randomUUID(), name: 'Super Admin', code: 'SUPER_ADMIN', tenantId: tenant.id, isSystem: true }
    });
  }
  console.log('Role:', role.name);

  await p.$executeRawUnsafe(`
    INSERT INTO user_tenants (id, user_id, tenant_id, role_id, is_active, created_at)
    VALUES ($1, $2, $3, $4, true, NOW())
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET is_active = true, role_id = $4
  `, crypto.randomUUID(), user.id, tenant.id, role.id);

  console.log('\nDone! Linked to', tenant.name, 'as SUPER_ADMIN');
  console.log('Log in at: http://localhost:3000/login');
}

run().catch(e => console.error('Error:', e.message)).finally(() => p.$disconnect());