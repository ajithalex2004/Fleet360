import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

loadDotEnv();

const prisma = new PrismaClient();
try {
  const roleId = 'b7489f0c-4d48-44d7-a96f-ed6d2b3b512c'; // Transport Manager
  const logisticsPerms = await prisma.permission.findMany({
    where: { module: 'logistics' }
  });

  for (const perm of logisticsPerms) {
    const existing = await prisma.rolePermission.findFirst({
      where: { roleId, permissionId: perm.id }
    });
    if (!existing) {
      await prisma.rolePermission.create({
        data: { roleId, permissionId: perm.id }
      });
      console.log('Added permission:', perm.action, perm.resource, 'to Transport Manager');
    }
  }

  console.log('Transport Manager logistics permissions updated successfully!');
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
