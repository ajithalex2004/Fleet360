/**
 * Evidence for the last four pre-activation blockers. Read-only.
 *
 *   WorkOrder, bulk_import_jobs, route_consolidation_scoring_policies  — RLS off
 *   public.finance_payments                                            — shadow table
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

const RLS_OFF = ['WorkOrder', 'bulk_import_jobs', 'route_consolidation_scoring_policies'];

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  console.log('=== The three RLS-off tables');
  for (const t of RLS_OFF) {
    const col = await q(`SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`, t);
    const cnt = await q(`SELECT count(*)::int total, count(*) FILTER (WHERE tenant_id IS NULL)::int nulls
       FROM public."${t}"`);
    const rls = await q(`SELECT relrowsecurity rs, relforcerowsecurity fs FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`, t);
    const pol = await q(`SELECT polname FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`, t);
    const fk = await q(`SELECT count(*)::int n FROM information_schema.table_constraints
       WHERE table_schema='public' AND table_name=$1 AND constraint_type='FOREIGN KEY'`, t);
    console.log(`\n   ${t}`);
    console.log(`      tenant_id: ${col[0] ? `${col[0].data_type} nullable=${col[0].is_nullable}` : 'ABSENT'}`);
    console.log(`      rows=${cnt[0].total} null-tenant=${cnt[0].nulls}`);
    console.log(`      rls=${rls[0]?.rs} force=${rls[0]?.fs} policies=${pol.length} fks=${fk[0].n}`);
    if (cnt[0].total > 0 && cnt[0].total <= 5) {
      const d = await q(`SELECT DISTINCT tenant_id FROM public."${t}"`);
      console.log(`      distinct tenants: ${d.map(x => String(x.tenant_id ?? 'NULL').slice(0, 8)).join(', ')}`);
    }
  }

  console.log('\n=== finance_payments: the two tables side by side');
  for (const s of ['public', 'finance']) {
    const cols = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema=$1 AND table_name='finance_payments' ORDER BY ordinal_position`, s);
    const n = await q(`SELECT count(*)::int n FROM ${s}.finance_payments`);
    const rls = await q(`SELECT c.relrowsecurity rs, c.relforcerowsecurity fs FROM pg_class c
       JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname=$1 AND c.relname='finance_payments'`, s);
    console.log(`\n   ${s}.finance_payments  rows=${n[0].n} rls=${rls[0]?.rs} force=${rls[0]?.fs}`);
    cols.forEach(c => console.log(`      ${c.column_name.padEnd(18)} ${c.data_type.padEnd(28)} null=${c.is_nullable}`));
  }

  // Anything depending on public.finance_payments?
  console.log('\n   dependencies on public.finance_payments:');
  const fks = await q(`
    SELECT tc.table_name AS child, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_schema='public'
       AND ccu.table_name='finance_payments'`);
  console.log(`      inbound FKs: ${fks.length ? fks.map(f => `${f.child}.${f.col}`).join(', ') : 'none'}`);
  const views = await q(`
    SELECT DISTINCT dependent.relname AS view_name
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class dependent ON dependent.oid = r.ev_class
      JOIN pg_class src ON src.oid = d.refobjid
      JOIN pg_namespace n ON n.oid = src.relnamespace
     WHERE n.nspname='public' AND src.relname='finance_payments' AND dependent.relkind IN ('v','m')`);
  console.log(`      views/matviews: ${views.length ? views.map(v => v.view_name).join(', ') : 'none'}`);

  // Which schema wins today, and is the finance one otherwise reachable?
  const res = await q(`SELECT n.nspname||'.'||c.relname AS r FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid = to_regclass('finance_payments')`);
  console.log(`      unqualified 'finance_payments' resolves to: ${res[0].r}`);
  console.log(`      search_path: ${(await q('SHOW search_path'))[0].search_path}`);

  // Still only one shadowed name?
  const dup = await q(`SELECT a.table_name FROM information_schema.tables a
     JOIN information_schema.tables b ON b.table_name=a.table_name AND b.table_schema='finance'
    WHERE a.table_schema='public' ORDER BY 1`);
  console.log(`      names present in BOTH public and finance: ${dup.map(x => x.table_name).join(', ') || 'none'}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n').slice(0, 3).join(' | '));
  await prisma.$disconnect();
  process.exit(1);
});
