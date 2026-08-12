// Apply the platform_audit_log migration directly + register in _prisma_migrations
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const migrationPath = 'prisma/migrations/20260803210000_create_platform_audit_log/migration.sql';
const migrationName = '20260803210000_create_platform_audit_log';

const rawSql = readFileSync(migrationPath, 'utf8');
console.log(`Applying ${migrationName} (${rawSql.length} bytes)...`);

// Strip `--` line comments but leave `$$` lines alone.
const sql = rawSql
  .split('\n')
  .map(line => {
    if (line.includes('$$')) return line;
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');

// Split on `;` but respect `$$ ... $$` blocks.
function splitSql(input) {
  const out = [];
  let buf = '';
  let inDollar = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '$' && input[i + 1] === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 2;
      continue;
    }
    if (c === ';' && !inDollar) {
      buf += ';';
      out.push(buf.trim());
      buf = '';
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim().length) out.push(buf.trim());
  return out.filter(s => {
    const code = s.split('\n').filter(l => l.trim() && !l.trim().startsWith('--')).join('\n').trim();
    return code.length > 0;
  });
}

const stmts = splitSql(sql);
console.log(`  Found ${stmts.length} statements.`);
for (let i = 0; i < stmts.length; i++) {
  const s = stmts[i];
  const firstNonComment = s.split('\n').find(l => l.trim() && !l.trim().startsWith('--')) ?? s;
  const summary = firstNonComment.replace(/\s+/g, ' ').slice(0, 70);
  try {
    await prisma.$executeRawUnsafe(s);
    console.log(`  [${i + 1}/${stmts.length}] ✓ ${summary}`);
  } catch (e) {
    console.log(`  [${i + 1}/${stmts.length}] ✗ ${summary}`);
    console.log(`    ERROR: ${e.message.split('\n').slice(0, 3).join(' | ')}`);
    throw e;
  }
}
console.log('  ✓ All statements applied.');

// Verify
const cols = await prisma.$queryRawUnsafe(
  `SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='platform_audit_log' ORDER BY ordinal_position`,
);
console.log(`\nplatform_audit_log columns (${cols.length}):`);
for (const c of cols) console.log(`  ${c.column_name} (${c.data_type})`);

// Register in _prisma_migrations
const checksum = crypto.createHash('sha256').update(rawSql).digest('hex');
const already = await prisma.$queryRawUnsafe(
  `SELECT id FROM _prisma_migrations WHERE migration_name = $1`, migrationName,
);
if (already.length === 0) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, started_at, applied_steps_count, logs)
     VALUES (gen_random_uuid()::text, $1, $2, NOW(), NOW(), 1, NULL)`,
    checksum, migrationName,
  );
  console.log('\n  ✓ Registered in _prisma_migrations.');
} else {
  console.log('\n  Already in _prisma_migrations — no change.');
}

await prisma.$disconnect();
