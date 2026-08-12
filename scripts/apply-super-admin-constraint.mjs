// Apply the SUPER_ADMIN system-wide CHECK constraint to the live database
// and mark the migration as applied in _prisma_migrations so future
// `npx prisma migrate deploy` runs are a no-op for this migration.
//
// Run with: node scripts/apply-super-admin-constraint.mjs
//
// What it does:
//   1. Verifies the data invariant holds (no per-tenant SUPER_ADMIN).
//      If any exist, aborts with a clear message.
//   2. Applies the constraint (idempotent — skip if already present).
//   3. Records the migration in _prisma_migrations as applied.
//   4. Runs scripts/check-no-per-tenant-super-admin.mjs as a final smoke test.

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const MIGRATION_NAME = '20260803181100_enforce_super_admin_system_wide';

function log(...args) { console.log('[apply-super-admin-constraint]', ...args); }

// Step 1: pre-check
const offenders = await prisma.role.findMany({
  where: { code: 'SUPER_ADMIN', tenantId: { not: null } },
  select: { id: true, name: true, tenantId: true },
});
if (offenders.length > 0) {
  log(`ABORT: ${offenders.length} per-tenant SUPER_ADMIN role(s) exist.`);
  for (const o of offenders) log(`  - ${o.id}  ${o.name}  tenantId=${o.tenantId}`);
  log('Fix them with scripts/reassign-platform-admin.mjs (or its pattern) before re-running.');
  await prisma.$disconnect();
  process.exit(1);
}
log('Pre-check OK: no per-tenant SUPER_ADMIN.');

// Step 2: check if the constraint already exists
const existing = await prisma.$queryRawUnsafe(
  `SELECT conname FROM pg_constraint
   WHERE conname = 'chk_super_admin_tenant' AND conrelid = 'roles'::regclass`,
);
if (existing.length > 0) {
  log('Constraint chk_super_admin_tenant already exists — skipping ADD.');
} else {
  // Run the pre-check DO block + ALTER TABLE from the migration
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE offender_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO offender_count
        FROM roles
       WHERE code = 'SUPER_ADMIN' AND tenant_id IS NOT NULL;
      IF offender_count > 0 THEN
        RAISE EXCEPTION 'Pre-check failed inside DB: % per-tenant SUPER_ADMIN role(s) exist.', offender_count;
      END IF;
    END
    $$;
  `);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE roles ADD CONSTRAINT chk_super_admin_tenant
       CHECK (code <> 'SUPER_ADMIN' OR tenant_id IS NULL)`,
  );
  log('Added constraint chk_super_admin_tenant.');
}

// Step 3: mark the migration as applied in _prisma_migrations
// Compute the checksum the same way Prisma does (sha256 of the migration SQL, base64).
const fs = await import('node:fs');
const path = await import('node:path');
const migrationSqlPath = path.join(
  'prisma', 'migrations', MIGRATION_NAME, 'migration.sql',
);
const sql = fs.readFileSync(migrationSqlPath, 'utf-8');
// Prisma's checksum is sha256 of the SQL, base64 encoded (no newline normalization we need to mimic).
const checksum = crypto.createHash('sha256').update(sql, 'utf-8').digest('base64');

const alreadyApplied = await prisma.$queryRawUnsafe(
  `SELECT id FROM _prisma_migrations WHERE migration_name = $1`,
  MIGRATION_NAME,
);
if (alreadyApplied.length > 0) {
  log('Migration already recorded in _prisma_migrations — skipping insert.');
} else {
  await prisma.$executeRawUnsafe(
    `INSERT INTO _prisma_migrations
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (gen_random_uuid()::text, $1, NOW(), $2, NULL, NULL, NOW(), 1)`,
    checksum,
    MIGRATION_NAME,
  );
  log('Recorded migration in _prisma_migrations.');
}

// Step 4: verification
const constraint = await prisma.$queryRawUnsafe(
  `SELECT conname, pg_get_constraintdef(oid) AS def
   FROM pg_constraint
   WHERE conname = 'chk_super_admin_tenant' AND conrelid = 'roles'::regclass`,
);
if (constraint.length > 0) {
  log(`Verified constraint in pg_constraint:`);
  log(`  ${constraint[0].conname}: ${constraint[0].def}`);
} else {
  log('ERROR: constraint not found in pg_constraint after applying.');
  await prisma.$disconnect();
  process.exit(1);
}

log('Done. Run scripts/check-no-per-tenant-super-admin.mjs as a final smoke test.');
await prisma.$disconnect();
