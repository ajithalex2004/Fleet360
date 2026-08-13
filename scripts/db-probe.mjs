import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

loadDotEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const prisma = new PrismaClient({ log: ['error'] });
const startedAt = Date.now();

try {
  console.log(`Target: ${redactUrl(url)}`);
  await prisma.$connect();

  const ping = await prisma.$queryRawUnsafe('SELECT NOW()::text AS now, current_database() AS database');
  console.log('Read probe OK:', JSON.stringify(ping[0] ?? ping));

  await prisma.$transaction([
    prisma.$executeRawUnsafe('CREATE TEMP TABLE fleet360_db_probe (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW()) ON COMMIT DROP'),
    prisma.$executeRawUnsafe(`INSERT INTO fleet360_db_probe (id) VALUES ('probe-${Date.now()}')`),
    prisma.$executeRawUnsafe('INSERT INTO fleet360_db_probe (id) VALUES (gen_random_uuid()::text)'),
  ]);

  console.log(`Write probe OK in ${Date.now() - startedAt} ms`);
} catch (error) {
  console.error('DB probe failed:', error instanceof Error ? error.message : error);
  if (error?.cause) console.error('Cause:', error.cause);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
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
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return value.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  }
}
