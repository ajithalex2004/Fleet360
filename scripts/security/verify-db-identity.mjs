#!/usr/bin/env node
/**
 * Database identity release gate (read-only).
 *
 * RLS protects nothing when the connection is a superuser, holds BYPASSRLS,
 * or owns the tables (owners skip RLS unless FORCE ROW LEVEL SECURITY is set).
 * It also can't help when the runtime role can create or alter tables. This
 * reports, for each connection a deployed process uses, who it really
 * connects as and whether any of that applies, and fails if it does.
 *
 * Usage — run inside each deployed service (Next.js web, workers, Go backend)
 * so it sees that service's own environment:
 *
 *   node scripts/security/verify-db-identity.mjs                 # DATABASE_URL, RUNTIME_DIRECT_DATABASE_URL
 *   node scripts/security/verify-db-identity.mjs runtime=DATABASE_URL migration=DIRECT_URL
 *
 * Each argument is label=ENV_VAR. A label starting with "migration" is the
 * schema-change identity: it is reported, not failed, and must differ from
 * every runtime identity. Only catalog SELECTs are run; nothing is changed.
 *
 * Exit code 0 = every runtime connection passes; 1 = gate failed.
 * See docs/security/DB_IDENTITY_RELEASE_GATE.md.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const EXPECTED_RUNTIME_ROLE = process.env.EXPECTED_RUNTIME_ROLE || 'fleet360_app';
const args = process.argv.slice(2);
const targets = args.length
  ? args.map((a) => {
      const [label, envName] = a.split('=');
      return { label, envName: envName || label };
    })
  : [
      { label: 'runtime', envName: 'DATABASE_URL' },
      { label: 'runtime-direct', envName: 'RUNTIME_DIRECT_DATABASE_URL' },
    ];

const redact = (url) => url.replace(/\/\/([^:@/]+)(:[^@/]*)?@/, '//$1:***@');

async function inspect(url) {
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
  const q = (sql, ...p) => prisma.$queryRawUnsafe(sql, ...p);
  try {
    const [who] = await q(`
      SELECT current_user::text AS current_user, session_user::text AS session_user,
             current_database()::text AS database, r.rolsuper, r.rolbypassrls,
             r.rolcreaterole, r.rolcreatedb
        FROM pg_roles r WHERE r.rolname = current_user`);

    // Every role this identity can act as (direct and inherited membership).
    const memberOf = await q(`
      WITH RECURSIVE m(roleid) AS (
        SELECT oid FROM pg_roles WHERE rolname = current_user
        UNION
        SELECT am.roleid FROM pg_auth_members am JOIN m ON am.member = m.roleid
      )
      SELECT r.rolname::text AS role, r.rolsuper, r.rolbypassrls
        FROM m JOIN pg_roles r ON r.oid = m.roleid
       WHERE r.rolname <> current_user
       ORDER BY 1`);

    // Schema-level DDL: CREATE on any non-system schema, or on the database.
    const createSchemas = await q(`
      SELECT nspname::text AS schema FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
         AND has_schema_privilege(current_user, oid, 'CREATE')
       ORDER BY 1`);
    const [db] = await q(`SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema`);

    // Tables this identity owns, directly or through a role it inherits.
    // Owners bypass RLS unless it is forced, and can ALTER/DROP the table.
    const owned = await q(`
      SELECT n.nspname::text AS schema, c.relname::text AS table,
             c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p')
         AND n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
         AND pg_has_role(current_user, c.relowner, 'USAGE')
       ORDER BY 1, 2`);

    // Tenant tables where RLS is not even enabled (visible to this identity).
    const [noRls] = await q(`
      SELECT count(*)::int AS n
        FROM information_schema.columns col
        JOIN pg_namespace n ON n.nspname = col.table_schema
        JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = col.table_name
       WHERE col.column_name = 'tenant_id' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`);

    return { who, memberOf, createSchemas, db, owned, noRls: noRls.n };
  } finally {
    await prisma.$disconnect();
  }
}

let failed = false;
const runtimeUsers = new Set();
const migrationUsers = [];

for (const t of targets) {
  const url = process.env[t.envName];
  const isMigration = t.label.startsWith('migration');
  console.log(`\n== ${t.label} (${t.envName})`);
  if (!url) {
    console.log('   not set');
    continue;
  }
  console.log(`   url: ${redact(url)}`);
  let r;
  try {
    r = await inspect(url);
  } catch (e) {
    console.log(`   ❌ could not connect: ${e.message.split('\n')[0]}`);
    if (!isMigration) failed = true;
    continue;
  }
  const { who } = r;
  if (isMigration) migrationUsers.push(who.current_user);
  else runtimeUsers.add(who.current_user);

  const checks = [
    [`connects as ${EXPECTED_RUNTIME_ROLE}`, who.current_user === EXPECTED_RUNTIME_ROLE, who.current_user],
    ['not superuser', !who.rolsuper, String(who.rolsuper)],
    ['no BYPASSRLS', !who.rolbypassrls, String(who.rolbypassrls)],
    ['no inherited superuser/BYPASSRLS role', !r.memberOf.some((m) => m.rolsuper || m.rolbypassrls),
      r.memberOf.filter((m) => m.rolsuper || m.rolbypassrls).map((m) => m.role).join(', ') || 'none'],
    ['cannot create roles or databases', !who.rolcreaterole && !who.rolcreatedb,
      `createrole=${who.rolcreaterole} createdb=${who.rolcreatedb}`],
    ['owns no tables (owners bypass unforced RLS and can ALTER/DROP)', r.owned.length === 0,
      `${r.owned.length} owned, ${r.owned.filter((o) => o.rls_enabled && !o.rls_forced).length} with RLS not forced`],
    ['no CREATE on any schema', r.createSchemas.length === 0, r.createSchemas.map((s) => s.schema).join(', ') || 'none'],
    ['cannot create schemas', !r.db.can_create_schema, String(r.db.can_create_schema)],
  ];

  console.log(`   session_user=${who.session_user} current_user=${who.current_user} database=${who.database}`);
  console.log(`   member of: ${r.memberOf.map((m) => m.role).join(', ') || 'none'}`);
  console.log(`   tenant tables without RLS enabled: ${r.noRls}`);
  for (const [name, ok, detail] of checks) {
    const mark = ok ? '✅' : isMigration ? 'ℹ️ ' : '❌';
    console.log(`   ${mark} ${name} — ${detail}`);
    if (!ok && !isMigration) failed = true;
  }
  if (!isMigration && r.owned.length) {
    for (const o of r.owned.slice(0, 15)) console.log(`      owns ${o.schema}.${o.table} (rls ${o.rls_enabled ? (o.rls_forced ? 'forced' : 'enabled, not forced') : 'off'})`);
  }
}

if ([...runtimeUsers].some((u) => migrationUsers.includes(u))) {
  console.log('\n❌ a migration connection uses the same identity as a runtime connection');
  failed = true;
}
console.log(failed ? '\n❌ DATABASE IDENTITY GATE FAILED' : '\n✅ database identity gate passed');
process.exit(failed ? 1 : 0);
