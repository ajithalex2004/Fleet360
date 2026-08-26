/**
 * Evidence-gathering for the four tables held back from 20260910000000.
 * Read-only. Decides nothing.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  // ── 1. roles: is FLEET_MANAGER a template or a tenant role? ───────────────
  console.log('=== roles: the is_system <-> tenant_id IS NULL invariant');
  const inv = await q(`
    SELECT (tenant_id IS NULL) AS null_tenant, is_system, count(*)::int n
      FROM public.roles GROUP BY 1,2 ORDER BY 1,2`);
  inv.forEach(r => console.log(`   tenant_id IS NULL=${r.null_tenant}  is_system=${r.is_system}  ->  ${r.n} rows`));

  const viol = await q(`
    SELECT code, name, is_system, tenant_id IS NULL AS null_tenant
      FROM public.roles
     WHERE (tenant_id IS NULL) <> is_system ORDER BY code`);
  console.log(`\n   invariant violations: ${viol.length}`);
  viol.forEach(r => console.log(`      ${r.code}  is_system=${r.is_system}  null_tenant=${r.null_tenant}  "${r.name}"`));

  // Is FLEET_MANAGER used, and does a tenant-scoped twin exist?
  const fm = await q(`SELECT id, code, tenant_id, is_system FROM public.roles WHERE code = 'FLEET_MANAGER' ORDER BY tenant_id NULLS FIRST`);
  console.log(`\n   FLEET_MANAGER rows: ${fm.length}`);
  for (const r of fm) {
    const users = await q(`SELECT count(*)::int n FROM public.user_tenants WHERE role_id = $1`, r.id).catch(() => [{ n: -1 }]);
    const perms = await q(`SELECT count(*)::int n FROM public.role_permissions WHERE role_id = $1`, r.id).catch(() => [{ n: -1 }]);
    console.log(`      tenant=${r.tenant_id ?? 'NULL'}  is_system=${r.is_system}  assigned_users=${users[0].n}  permissions=${perms[0].n}`);
  }
  // What do the other NULL-tenant templates look like for comparison?
  const tmpl = await q(`
    SELECT r.code, r.is_system,
           (SELECT count(*)::int FROM public.role_permissions rp WHERE rp.role_id = r.id) AS perms,
           (SELECT count(*)::int FROM public.user_tenants ut WHERE ut.role_id = r.id) AS users
      FROM public.roles r WHERE r.tenant_id IS NULL ORDER BY r.code`);
  console.log('\n   all NULL-tenant roles (perms / assigned users):');
  tmpl.forEach(r => console.log(`      ${r.code.padEnd(22)} is_system=${String(r.is_system).padEnd(5)} perms=${String(r.perms).padStart(3)} users=${r.users}`));

  // ── 2. auth_login_attempts: the write path and the 6 attributable rows ────
  console.log('\n=== auth_login_attempts');
  const six = await q(`
    SELECT la.id, la.user_id, la.success, la.tenant_id IS NULL AS null_tenant
      FROM public.auth_login_attempts la
     WHERE la.tenant_id IS NULL AND la.user_id IS NOT NULL`);
  console.log(`   NULL-tenant rows WITH a user_id: ${six.length}`);
  for (const r of six) {
    const ut = await q(`SELECT tenant_id FROM public.user_tenants WHERE user_id = $1`, r.user_id).catch(() => []);
    console.log(`      user_id=${String(r.user_id).slice(0, 12)}...  success=${r.success}  user_tenants rows=${ut.length}  tenants=${[...new Set(ut.map(x => x.tenant_id))].map(t => String(t).slice(0, 8)).join(',') || 'none'}`);
  }
  const amb = await q(`
    SELECT count(*)::int n FROM (
      SELECT la.user_id FROM public.auth_login_attempts la
       WHERE la.tenant_id IS NULL AND la.user_id IS NOT NULL
       GROUP BY la.user_id
      HAVING (SELECT count(DISTINCT ut.tenant_id) FROM public.user_tenants ut WHERE ut.user_id = la.user_id) <> 1
    ) x`);
  console.log(`   of those, users NOT belonging to exactly one tenant (unbackfillable): ${amb[0].n}`);

  // ── 3. bookings + customer_hierarchy provenance ───────────────────────────
  console.log('\n=== bookings / customer_hierarchy provenance');
  for (const t of ['bookings', 'customer_hierarchy']) {
    const cols = await q(`SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, t);
    const names = cols.map(c => c.column_name);
    const label = ['name', 'title', 'code', 'reference', 'booking_ref', 'status'].find(c => names.includes(c));
    const ts = ['created_at', 'createdat'].find(c => names.includes(c));
    const sel = ['id', label, ts].filter(Boolean).map(c => `"${c}"::text AS "${c}"`).join(', ');
    const rows = await q(`SELECT ${sel} FROM public."${t}" WHERE tenant_id IS NULL ORDER BY 1`);
    console.log(`\n   ${t}: ${rows.length} NULL-tenant rows (cols shown: id, ${label ?? '-'}, ${ts ?? '-'})`);
    rows.forEach(r => console.log(`      ${Object.values(r).map(v => String(v ?? '-').slice(0, 34)).join('  |  ')}`));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n').slice(0, 3).join(' | '));
  await prisma.$disconnect();
  process.exit(1);
});
