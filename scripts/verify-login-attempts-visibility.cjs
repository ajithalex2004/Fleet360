/**
 * Behavioural check that NULL-tenant login attempts are platform-only.
 *
 * Catalog inspection would only show the policy TEXT changed. This runs actual
 * SELECTs under a tenant context and under platform-admin and compares what
 * comes back.
 *
 * IMPORTANT CAVEAT, stated up front so the result is not over-read: the runtime
 * role is still neondb_owner, which holds rolbypassrls. RLS therefore does NOT
 * filter anything during this run, and both contexts will see every row. So
 * this script does two things:
 *
 *   1. Reports the raw counts, which prove nothing about RLS while BYPASSRLS
 *      is in effect, and says so.
 *   2. Evaluates the policy expressions DIRECTLY against each row for each
 *      context, which is what the planner would do once the role changes. That
 *      is the part that actually answers the question today.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { withTenantRls, withPlatformAdmin } = require('../src/lib/rls');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  const role = await q(`SELECT current_user AS u,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`);
  console.log(`connected as ${role[0].u}  bypassrls=${role[0].bypass}`);
  if (role[0].bypass) {
    console.log('-> RLS is NOT enforced for this role. Raw counts below prove nothing;');
    console.log('   the policy evaluation further down is the meaningful part.\n');
  }

  const [t] = await q(`SELECT id FROM public.tenants ORDER BY id LIMIT 1`);

  // 1. Raw counts under each context.
  const asTenant = await withTenantRls(prisma, t.id, (tx) =>
    tx.$queryRawUnsafe(`SELECT count(*)::int total,
        count(*) FILTER (WHERE tenant_id IS NULL)::int nulls
      FROM public.auth_login_attempts`));
  const asAdmin = await withPlatformAdmin(prisma, (tx) =>
    tx.$queryRawUnsafe(`SELECT count(*)::int total,
        count(*) FILTER (WHERE tenant_id IS NULL)::int nulls
      FROM public.auth_login_attempts`));
  console.log(`raw rows visible as tenant ${String(t.id).slice(0, 8)}: total=${asTenant[0].total} null-tenant=${asTenant[0].nulls}`);
  console.log(`raw rows visible as platform admin:        total=${asAdmin[0].total} null-tenant=${asAdmin[0].nulls}`);

  // 2. Evaluate the live USING expression per row, per context. This is what
  //    the planner will apply once the role no longer bypasses RLS.
  const [pol] = await q(`
    SELECT pg_get_expr(polqual, polrelid) AS u
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relname='auth_login_attempts' LIMIT 1`);
  console.log(`\nlive USING expression:\n   ${pol.u}`);

  for (const [label, ctx] of [[`tenant ${String(t.id).slice(0, 8)}`, t.id], ['platform admin', '*']]) {
    const r = await q(
      `SELECT count(*) FILTER (WHERE ${pol.u})::int visible,
              count(*) FILTER (WHERE tenant_id IS NULL AND (${pol.u}))::int visible_nulls,
              count(*)::int total
         FROM public.auth_login_attempts,
              LATERAL (SELECT set_config('app.tenant_id', $1, true)) s`, ctx);
    console.log(`   as ${label.padEnd(20)} -> ${r[0].visible}/${r[0].total} rows pass USING, of which NULL-tenant: ${r[0].visible_nulls}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n').slice(0, 4).join(' | '));
  await prisma.$disconnect();
  process.exit(1);
});
