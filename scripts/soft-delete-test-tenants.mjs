// Soft-delete test/E2E tenants and their UserTenant rows.
// Reversible: re-run with --revert to flip isActive back to true.
//
// Usage:
//   node scripts/soft-delete-test-tenants.mjs           # soft-delete
//   node scripts/soft-delete-test-tenants.mjs --revert  # restore

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const REVERT = process.argv.includes('--revert');

// Tenants to KEEP regardless of mode. Real customers + the platform tenant.
const KEEP = [
  'EXL Solutions LLC',
  'XL AI Smart Mobility — Platform',
];

function log(...args) { console.log('[tenant-cleanup]', ...args); }

const keepRows = await prisma.tenant.findMany({
  where: { name: { in: KEEP } },
  select: { id: true, name: true },
});
const keepIds = new Set(keepRows.map((t) => t.id));
log(`Keeping ${keepIds.size} tenants by name: ${[...keepIds].length > 0 ? [...keepRows.map((t) => t.name)].join(', ') : '(none found)'}`);

// Find the candidates. Match by name pattern: starts with "E2E ", "Test Tenant",
// "Phase0 Smoke Test", or "Debug ".
const PATTERNS = [
  /^E2E\b/i,
  /^Test Tenant\b/i,
  /^Phase0 Smoke Test\b/i,
  /^Debug /i,
];

const allTenants = await prisma.tenant.findMany({
  where: REVERT ? { isActive: false } : { isActive: true },
  select: { id: true, name: true, isActive: true },
});

const candidates = allTenants.filter((t) => {
  if (keepIds.has(t.id)) return false;
  return PATTERNS.some((p) => p.test(t.name));
});

log(`${REVERT ? 'Restoring' : 'Soft-deleting'} ${candidates.length} tenant(s):`);
for (const t of candidates) {
  log(`  - ${t.id}  ${t.name}  (currently isActive=${t.isActive})`);
}

if (candidates.length === 0) {
  log('Nothing to do.');
  await prisma.$disconnect();
  process.exit(0);
}

const ids = candidates.map((t) => t.id);

const t1 = await prisma.$transaction(async (tx) => {
  const tenantResult = await tx.tenant.updateMany({
    where: { id: { in: ids } },
    data: { isActive: REVERT }, // REVERT=true means restore to isActive=true; default mode soft-deletes to false
  });
  const userTenantResult = await tx.userTenant.updateMany({
    where: { tenantId: { in: ids } },
    data: { isActive: REVERT },
  });
  return { tenantResult, userTenantResult };
});

log(`Done. tenants updated: ${t1.tenantResult.count}, userTenants updated: ${t1.userTenantResult.count}`);

// Quick verification
const stillActive = await prisma.tenant.count({
  where: { id: { in: ids }, isActive: REVERT ? false : true },
});
log(`Verification: ${stillActive} of ${ids.length} target tenants are now isActive=${REVERT ? 'true' : 'false'} (expected ${ids.length - stillActive})`);

await prisma.$disconnect();
