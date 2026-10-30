import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

loadDotEnv();

const prisma = new PrismaClient();
try {
  const tenants = await prisma.tenant.findMany({
    where: {
      AND: [
        { name: { not: { startsWith: 'Test ' } } },
        { name: { not: { startsWith: 'Phase0 ' } } },
        { name: { not: { startsWith: 'Dunning ' } } },
        { name: { not: { startsWith: 'Lease ' } } },
      ]
    },
    select: {
      id: true,
      name: true,
      code: true,
      plan: true,
      isActive: true,
      modules: {
        select: { module: true, isEnabled: true }
      },
      userTenants: {
        select: {
          user: {
            select: { id: true, username: true, email: true }
          },
          role: {
            select: { id: true, name: true, code: true }
          }
        }
      }
    }
  });
  console.log('REAL TENANTS (' + tenants.length + '):', JSON.stringify(tenants, null, 2));
} catch (e) {
  console.error(e);
} finally {
  await prisma.$disconnect();
}

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
