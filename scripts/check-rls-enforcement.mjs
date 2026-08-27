#!/usr/bin/env node
/**
 * Reports whether RLS is actually ENFORCED for the current connection, rather
 * than merely configured.
 *
 * Policies existing is not the same as policies applying. A role with
 * BYPASSRLS reads every row regardless of FORCE ROW LEVEL SECURITY, which is
 * the situation this database is in today: the app connects as neondb_owner
 * (rolbypassrls = true), so all 256 RLS-enabled tables are unprotected at the
 * database level.
 *
 * Run before and after switching DATABASE_URL to fleet360_app.
 *   node scripts/check-rls-enforcement.mjs
 *
 * Exit 0 if RLS is enforced, 1 if it is bypassed.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const url = process.env.PHASE0_DATABASE_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: { db: { url } },
});
const FAKE_TENANT = '00000000-0000-0000-0000-000000000000';

async function queryWithRetry(fn, retries = 5, delayMs = 2500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function countAs(tenant, table) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant);
    const [r] = await tx.$queryRawUnsafe(`SELECT count(*)::text n FROM ${table}`);
    return r.n;
  });
}

try {
  const [who] = await queryWithRetry(() =>
    prisma.$queryRawUnsafe(
      `SELECT current_user AS role,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`,
    ),
  );
  console.log(`connected as : ${who.role}`);
  console.log(`BYPASSRLS    : ${who.bypassrls}`);

  // Pick a populated, RLS-enabled, tenant-scoped table to probe with.
  const [probe] = await queryWithRetry(() =>
    prisma.$queryRawUnsafe(
      `SELECT n.nspname||'.'||c.relname AS t
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND c.relrowsecurity
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema = n.nspname AND col.table_name = c.relname
                         AND col.column_name = 'tenant_id')
          AND c.reltuples > 0
        ORDER BY c.reltuples DESC
        LIMIT 1`,
    ),
  );

  if (!probe) {
    console.log('\nno populated RLS table to probe with — cannot assess enforcement');
    process.exit(1);
  }

  const all = await countAs('*', probe.t);
  const other = await countAs(FAKE_TENANT, probe.t);

  console.log(`\nprobe table  : ${probe.t}`);
  console.log(`  as platform '*'     : ${all}`);
  console.log(`  as unrelated tenant : ${other}`);

  if (who.bypassrls) {
    console.log('\n❌ RLS IS BYPASSED — the role holds BYPASSRLS.');
    console.log('   All rows are visible regardless of RLS policies.');
    process.exit(1);
  }

  if (other === '0') {
    console.log('\n✅ RLS IS ENFORCED — unrelated tenant saw 0 rows.');
    process.exit(0);
  } else {
    console.log('\n❌ RLS FAILED — unrelated tenant saw rows under non-bypass role.');
    process.exit(1);
  }
} catch (err) {
  console.error('Connection failed:', err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
