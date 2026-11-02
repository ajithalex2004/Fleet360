import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

loadDotEnv();

const prisma = new PrismaClient();

async function main() {
  const targetCode = process.argv[2] || 'EXL-360-001';
  console.log(`Configuring target tenant with code: ${targetCode}`);

  let tenant = await prisma.tenant.findUnique({
    where: { code: targetCode },
    include: {
      modules: true,
      userTenants: {
        include: {
          user: true,
          role: true,
        }
      }
    }
  });

  if (!tenant) {
    console.log(`Tenant with code '${targetCode}' not found. Creating dedicated tenant 'Port Drayage & Fleet Operations' (PDF-LOGISTICS)...`);
    tenant = await prisma.tenant.create({
      data: {
        name: 'Port Drayage & Fleet Logistics L.L.C',
        code: targetCode,
        plan: 'ENTERPRISE',
        isActive: true,
        industry: 'PORT_LOGISTICS',
      },
      include: {
        modules: true,
        userTenants: {
          include: {
            user: true,
            role: true,
          }
        }
      }
    });
  }

  console.log(`Found tenant: ${tenant.name} (${tenant.id})`);

  // Target modules: ONLY 'drayage' and 'fleet'
  const targetModules = ['drayage', 'fleet'];

  // Delete all existing modules for this tenant
  await prisma.tenantModule.deleteMany({
    where: { tenantId: tenant.id }
  });

  // Insert ONLY drayage and fleet
  await prisma.tenantModule.createMany({
    data: targetModules.map(module => ({
      tenantId: tenant.id,
      module,
      isEnabled: true,
    }))
  });

  // Ensure role permissions include logistics and fleet for users of this tenant
  const updatedTenant = await prisma.tenant.findUnique({
    where: { id: tenant.id },
    include: {
      modules: {
        select: { module: true, isEnabled: true }
      },
      userTenants: {
        select: {
          user: { select: { id: true, username: true, email: true } },
          role: { select: { id: true, name: true, code: true } }
        }
      }
    }
  });

  console.log('Successfully seeded tenant module profile!');
  console.log('----------------------------------------------------');
  console.log(`Tenant Name   : ${updatedTenant.name}`);
  console.log(`Tenant Code   : ${updatedTenant.code}`);
  console.log(`Tenant ID     : ${updatedTenant.id}`);
  console.log(`Active Modules:`, updatedTenant.modules.map(m => m.module));
  console.log(`Users Assigned:`, updatedTenant.userTenants.map(u => `${u.user.username} (${u.role.name})`));
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (key === 'DATABASE_URL' && process.env[key]?.startsWith('postgresql+psycopg://')) {
      process.env[key] = raw.replace(/^["']|["']$/g, '');
      continue;
    }
    if (!process.env[key]) {
      process.env[key] = raw.replace(/^["']|["']$/g, '');
    }
  }
}
