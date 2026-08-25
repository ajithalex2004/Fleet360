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
 *   node -r dotenv/config scripts/check-rls-enforcement.mjs dotenv_config_path=.env
 *
 * Exit 0 if RLS is enforced, 1 if it is bypassed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FAKE_TENANT = '00000000-0000-0000-0000-000000000000';

async function countAs(tenant, table) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant);
    const [r] = await tx.$queryRawUnsafe(`SELECT count(*)::text n FROM ${table}`);
    return r.n;
  });
}

try {
  const [who] = await prisma.$queryRawUnsafe(
    `SELECT current_user AS role,
            (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls`);
  console.log(`connected as : ${who.role}`);
  console.log(`BYPASSRLS    : ${who.bypassrls}`);

  // Pick a populated, RLS-enabled, tenant-scoped table to probe with.
  const [probe] = await prisma.$queryRawUnsafe(
    `SELECT n.nspname||'.'||c.relname AS t
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND c.relrowsecurity
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                     WHERE col.table_schema = n.nspname AND col.table_name = c.relname
                       AND col.column_name = 'tenant_id')
        AND c.reltuples > 0
      ORDER BY c.reltuples DESC
      LIMIT 1`);

  if (!probe) {
    console.log('\nno populated RLS table to probe with — cannot assess enforcement');
    process.exit(1);
  }

  const all = await countAs('*', probe.t);
  const other = await countAs(FAKE_TENANT, probe.t);

  console.log(`\nprobe table  : ${probe.t}`);
  console.log(`  as platform '*'     : ${all}`);
  console.log(`  as unrelated tenant : ${other}`);

  const enforced = other === '0' && all !== '0';
  console.log(
    enforced
      ? '\n✅ RLS IS ENFORCED — an unrelated tenant sees nothing.'
      : `\n❌ RLS IS NOT ENFORCED — an unrelated tenant sees ${other} row(s).`
        + (who.bypassrls ? `\n   Cause: ${who.role} has BYPASSRLS, which overrides FORCE ROW LEVEL SECURITY.` : '')
        + '\n   Tenant isolation currently depends entirely on application-level filtering.');

  process.exit(enforced ? 0 : 1);
} finally {
  await prisma.$disconnect();
}
