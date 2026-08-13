// Final hard-delete pass with explicit dependency order.
//
// Strategy: collect every table that still has rows for the 72 target tenants,
// then delete them in the right FK order. We use a simple multi-pass approach:
// each pass deletes from every table that is currently deletable; if FK chains
// exist, the lower tables fail this pass but succeed in the next one because
// their referencing rows are now gone. Up to MAX_PASSES passes; in practice 2-3
// are enough.
//
// After the per-table passes, we delete the tenant rows themselves and verify.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MAX_PASSES = 8;
const TX_TIMEOUT_MS = 30_000;

const KEEP = ['EXL Solutions LLC', 'XL AI Smart Mobility — Platform'];
const PATTERNS = [/^E2E\b/i, /^Test Tenant\b/i, /^Phase0 Smoke Test\b/i, /^Debug /i];

function log(...args) { console.log('[hard-delete-v3]', ...args); }

// Step 1: find the 72 targets
const candidates = await prisma.tenant.findMany({
  where: { isActive: false, name: { notIn: KEEP } },
  select: { id: true, name: true },
});
const targets = candidates.filter((t) => PATTERNS.some((p) => p.test(t.name)));
const targetIds = targets.map((t) => t.id);
log(`Targets: ${targetIds.length}`);
if (targetIds.length !== 72) {
  log(`Expected 72, got ${targetIds.length}. Aborting.`);
  await prisma.$disconnect();
  process.exit(1);
}

// Step 2: discover every table with a tenant_id column
const tables = await prisma.$queryRawUnsafe(
  `SELECT table_name
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
    ORDER BY table_name`,
);
const allTables = tables.map((t) => t.table_name).filter((n) => n !== 'tenants');
log(`Tables with tenant_id: ${allTables.length}`);

// Step 3: multi-pass delete. Each pass tries to delete from every table;
// FK-blocked tables fail this pass and are retried in the next one.
let remaining = [...allTables];
const summary = {};
let totalRows = 0;
let pass = 0;

while (remaining.length > 0 && pass < MAX_PASSES) {
  pass++;
  log(`\nPass ${pass}/${MAX_PASSES} — ${remaining.length} tables remaining`);
  const stillBlocked = [];
  for (const table of remaining) {
    try {
      const r = await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "tenant_id"::text = ANY($1::text[])`,
        targetIds,
      );
      const n = Number(r);
      summary[table] = (summary[table] ?? 0) + n;
      if (n > 0) log(`  ${table.padEnd(40)}  ${n} row(s) deleted`);
    } catch (e) {
      const code = e.code ?? '?';
      const msg = (e.message ?? '').split('\n')[0].slice(0, 80);
      if (!summary[table]) summary[table] = `BLOCKED: ${code} ${msg}`;
      stillBlocked.push(table);
    }
  }
  if (stillBlocked.length === remaining.length) {
    log(`  No progress this pass (${stillBlocked.length} still blocked). Aborting to avoid infinite loop.`);
    break;
  }
  remaining = stillBlocked;
  log(`  After pass ${pass}: ${remaining.length} table(s) still blocked.`);
}

if (remaining.length > 0) {
  log(`\nERROR: ${remaining.length} table(s) still blocked after ${MAX_PASSES} passes:`);
  remaining.forEach((t) => log(`  - ${t}  ${summary[t]}`));
  log('\nThe remaining tenants cannot be deleted until these are resolved.');
  log('Likely cause: foreign key from a non-tenant_id column to one of the target tables.');
  log('These blockers would also prevent a CASCADE delete of the tenants.');
  await prisma.$disconnect();
  process.exit(1);
}

// Step 4: delete the tenant rows
log(`\nAll ${allTables.length} dependent tables cleared. Deleting tenant rows...`);
try {
  const r = await prisma.$executeRawUnsafe(
    `DELETE FROM tenants WHERE "id"::text = ANY($1::text[])`,
    targetIds,
  );
  log(`  Deleted ${Number(r)} tenant row(s).`);
  summary['tenants'] = Number(r);
  totalRows += Number(r);
} catch (e) {
  log(`  Tenant delete FAILED: ${(e.message ?? '').split('\n')[0]}`);
  log('  This is unexpected — a CASCADE-less FK must still exist.');
  log('  Investigate before retrying.');
  await prisma.$disconnect();
  process.exit(1);
}

// Final summary
log('\n=== Summary ===');
const sortedByCount = Object.entries(summary).sort((a, b) => {
  if (typeof a[1] === 'string') return 1;
  if (typeof b[1] === 'string') return -1;
  return b[1] - a[1];
});
let totalNonError = 0;
for (const [table, count] of sortedByCount) {
  if (typeof count === 'string') log(`  ${table.padEnd(40)}  ${count}`);
  else if (count > 0) {
    log(`  ${table.padEnd(40)}  ${count} row(s)`);
    totalNonError += count;
  }
}
log(`  ${'TOTAL'.padEnd(40)}  ${totalNonError}`);

// Verification
const stillExist = await prisma.tenant.count({ where: { id: { in: targetIds } } });
const remainingActive = await prisma.tenant.count({ where: { isActive: true } });
const remainingInactive = await prisma.tenant.count({ where: { isActive: false } });
log(`\nPost-delete verification:`);
log(`  Target tenants still in DB:    ${stillExist} (expected 0)`);
log(`  Active tenants remaining:      ${remainingActive} (expected 2 — the real ones)`);
log(`  Inactive tenants remaining:    ${remainingInactive} (expected 0)`);

await prisma.$disconnect();
