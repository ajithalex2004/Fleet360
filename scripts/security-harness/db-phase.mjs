/**
 * Security harness, database phase: tenant isolation proved in the
 * database itself, connected as the runtime role the application uses
 * (never the owner), across every table with a tenant_id column.
 *
 *   identity   the connection is not a superuser, cannot bypass RLS, and
 *              owns no tenant table without FORCE ROW LEVEL SECURITY
 *   coverage   every tenant table has RLS enabled (and forced when the
 *              runtime role owns it)
 *   read       in tenant A's context no row of another tenant is visible,
 *              and without a tenant context no tenant's rows are visible
 *   write      in tenant A's context: tenant B's rows cannot be updated,
 *              a row cannot be inserted for tenant B, and one of A's rows
 *              cannot be moved to tenant B
 *
 * Everything runs in transactions that are always rolled back; the write
 * probes each run inside a savepoint. Uses Prisma (already installed).
 */
import { PrismaClient } from '@prisma/client';

const ROLLBACK = Symbol('rollback');
const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

export async function runDbPhase({ url, tenantA, tenantB, results, log = console.log }) {
  const phase = 'database';
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [who] = await prisma.$queryRawUnsafe(`
      SELECT current_user AS "user", r.rolsuper AS super, r.rolbypassrls AS bypass, current_database() AS db
        FROM pg_roles r WHERE r.rolname = current_user`);
    results.add(phase, `connected as ${who.user} on ${who.db}`, 'pass');
    results.add(phase, 'runtime role is not a superuser', who.super ? 'fail' : 'pass', who.super ? `${who.user} is a superuser: RLS does not apply` : '');
    results.add(phase, 'runtime role cannot bypass RLS', who.bypass ? 'fail' : 'pass', who.bypass ? `${who.user} has BYPASSRLS` : '');

    const tables = await prisma.$queryRawUnsafe(`
      SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             pg_get_userbyid(c.relowner) AS owner, format_type(a.atttypid, a.atttypmod) AS type,
             has_table_privilege(c.oid, 'SELECT') AS can_select,
             has_table_privilege(c.oid, 'INSERT') AS can_insert,
             has_table_privilege(c.oid, 'UPDATE') AS can_update
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY 1, 2`);
    log(`  database: ${tables.length} tables with tenant_id`);
    results.add(phase, `tenant tables found: ${tables.length}`, tables.length ? 'pass' : 'fail');

    for (const t of tables) {
      const name = `${t.schema}.${t.name}`;
      const rel = `${q(t.schema)}.${q(t.name)}`;
      if (!t.rls) {
        results.add(phase, `${name}: RLS enabled`, 'fail', 'row level security is not enabled');
        continue;
      }
      if (t.owner === who.user && !t.forced) {
        results.add(phase, `${name}: RLS applies to the runtime role`, 'fail', `${who.user} owns the table and RLS is not forced`);
        continue;
      }
      if (!t.can_select) {
        results.add(phase, `${name}: isolation`, 'skip', 'runtime role has no SELECT privilege');
        continue;
      }
      const findings = await probeTable(prisma, { rel, type: t.type, tenantA, tenantB, canInsert: t.can_insert, canUpdate: t.can_update });
      for (const f of findings) results.add(phase, `${name}: ${f.check}`, f.status, f.detail ?? '');
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function probeTable(prisma, { rel, type, tenantA, tenantB, canInsert, canUpdate }) {
  const findings = [];
  const other = (ctx) => (ctx === tenantA ? tenantB : tenantA);
  const savepoint = async (tx, fn) => {
    await tx.$executeRawUnsafe('SAVEPOINT harness_probe');
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      return { ok: false, code: err?.meta?.code ?? /\b(\d{5}|[0-9A-Z]{5})\b/.exec(String(err?.message))?.[1] ?? '', message: String(err?.message ?? err).split('\n').pop() };
    } finally {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT harness_probe');
    }
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Read: as each test tenant, nothing of another tenant.
      for (const ctx of [tenantA, tenantB]) {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, ctx);
        const rows = await tx.$queryRawUnsafe(
          `SELECT tenant_id::text AS tenant FROM ${rel} WHERE tenant_id IS NOT NULL AND tenant_id::text <> $1 LIMIT 1`, ctx);
        findings.push(rows.length
          ? { check: `read isolation as tenant ${short(ctx)}`, status: 'fail', detail: `sees a row of tenant ${rows[0].tenant}` }
          : { check: `read isolation as tenant ${short(ctx)}`, status: 'pass' });
      }
      // Without any tenant context: no tenant's rows.
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '', true)`);
      const open = await tx.$queryRawUnsafe(`SELECT 1 FROM ${rel} WHERE tenant_id IS NOT NULL LIMIT 1`);
      findings.push({ check: 'no rows without a tenant context', status: open.length ? 'fail' : 'pass', detail: open.length ? 'tenant rows visible with no app.tenant_id' : '' });

      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantA);
      if (canUpdate) {
        const upd = await savepoint(tx, () => tx.$executeRawUnsafe(
          `UPDATE ${rel} SET tenant_id = tenant_id WHERE tenant_id::text = $1`, tenantB));
        findings.push(!upd.ok
          ? { check: "cannot update tenant B's rows", status: 'pass', detail: `refused (${upd.code})` }
          : { check: "cannot update tenant B's rows", status: upd.value === 0 ? 'pass' : 'fail', detail: upd.value ? `${upd.value} rows updated` : '' });

        const move = await savepoint(tx, () => tx.$executeRawUnsafe(
          `UPDATE ${rel} SET tenant_id = $1::${type} WHERE ctid = (SELECT ctid FROM ${rel} WHERE tenant_id::text = $2 LIMIT 1)`,
          other(tenantA), tenantA));
        if (move.ok && move.value === 0) findings.push({ check: 'cannot move a row to tenant B', status: 'skip', detail: 'tenant A has no row here' });
        else if (move.ok) findings.push({ check: 'cannot move a row to tenant B', status: 'fail', detail: 'row moved to another tenant' });
        else findings.push({ check: 'cannot move a row to tenant B', status: move.code === '42501' ? 'pass' : 'skip', detail: move.code === '42501' ? 'refused by policy' : `inconclusive: ${move.message}` });
      }
      if (canInsert) {
        const ins = await savepoint(tx, () => tx.$executeRawUnsafe(
          `INSERT INTO ${rel} (tenant_id) VALUES ($1::${type})`, tenantB));
        if (ins.ok) findings.push({ check: 'cannot insert for tenant B', status: 'fail', detail: 'row inserted for another tenant (rolled back)' });
        else findings.push({ check: 'cannot insert for tenant B', status: ins.code === '42501' ? 'pass' : 'skip', detail: ins.code === '42501' ? 'refused by policy' : `inconclusive: ${ins.message}` });
      }
      throw ROLLBACK;
    }, { timeout: 60_000, maxWait: 20_000 });
  } catch (err) {
    if (err !== ROLLBACK) findings.push({ check: 'probe', status: 'fail', detail: `error: ${String(err?.message ?? err).split('\n').pop()}` });
  }
  return findings;
}

const short = (id) => String(id).slice(0, 8);
