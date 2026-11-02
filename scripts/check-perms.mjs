import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

loadDotEnv();

const prisma = new PrismaClient();
try {
  const perms = await prisma.permission.findMany({
    where: { module: 'logistics' },
    select: { id: true, module: true, action: true, resource: true }
  });
  console.log('LOGISTICS PERMISSIONS (' + perms.length + '):', perms);
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
