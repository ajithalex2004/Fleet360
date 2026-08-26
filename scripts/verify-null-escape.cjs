/**
 * Independent verification of 20260910000000 and 20260910000001.
 *
 * Deliberately NOT the assertions embedded in those migrations: a migration
 * verifying itself proves the migration ran, not that the state is right. This
 * re-derives the whole picture from the catalog.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

const KNOWN_EXCEPTIONS = ['roles', 'auth_login_attempts', 'bookings', 'customer_hierarchy'];

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  const live = await q(`
    SELECT c.relname AS name, col.is_nullable AS nullable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col ON col.table_schema='public'
        AND col.table_name=c.relname AND col.column_name='tenant_id'
     WHERE n.nspname='public' AND c.relkind='r'
       AND EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid=c.oid
                    AND pg_get_expr(pol.polqual,pol.polrelid) LIKE '%tenant_id IS NULL%')
     ORDER BY 1`);

  const liveEscape = live.filter(r => r.nullable === 'YES').map(r => r.name);
  const deadEscape = live.filter(r => r.nullable === 'NO').map(r => r.name);

  console.log(`Policies still carrying the IS NULL branch: ${live.length}`);
  console.log(`   unreachable (tenant_id NOT NULL): ${deadEscape.length}`);
  console.log(`   LIVE (tenant_id nullable):        ${liveEscape.length}`);
  console.log(`      ${liveEscape.join(', ') || '(none)'}`);

  const unexpected = liveEscape.filter(t => !KNOWN_EXCEPTIONS.includes(t));
  console.log(`   unexpected live escapes: ${unexpected.length ? unexpected.join(', ') : 'NONE'}`);

  console.log('\nBackfilled tables:');
  for (const t of ['route_stops', 'trip_logs']) {
    const c = await q(`SELECT count(*)::int total, count(*) FILTER (WHERE tenant_id IS NULL)::int nulls FROM public."${t}"`);
    const nn = await q(`SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`, t);
    const d = await q(`SELECT count(DISTINCT tenant_id)::int n FROM public."${t}"`);
    console.log(`   ${t}: rows=${c[0].total} nulls=${c[0].nulls} nullable=${nn[0].is_nullable} distinct_tenants=${d[0].n}`);
  }

  // Did the backfill assign the RIGHT tenant, not merely a tenant?
  const rs = await q(`SELECT count(*)::int wrong FROM public.route_stops rs
     JOIN public.bus_routes br ON br.id = rs.route_id
    WHERE rs.tenant_id IS DISTINCT FROM br.tenant_id`);
  const tl = await q(`SELECT count(*)::int wrong FROM public.trip_logs tl
     JOIN public.trip_schedules ts ON ts.id = tl.schedule_id
    WHERE tl.tenant_id IS DISTINCT FROM ts.tenant_id::text`);
  console.log(`\nBackfill correctness (child tenant must equal parent tenant):`);
  console.log(`   route_stops mismatched against bus_routes:    ${rs[0].wrong}`);
  console.log(`   trip_logs   mismatched against trip_schedules: ${tl[0].wrong}`);

  // FORCE on the four that lacked it.
  const f = await q(`SELECT c.relname, c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY($1::text[]) ORDER BY 1`,
    ['customer_interactions', 'dvir_defects', 'trip_stop_visits', 'vehicle_issue_reports']);
  console.log('\nFORCE ROW LEVEL SECURITY on the four that lacked it:');
  f.forEach(x => console.log(`   ${x.relname}: forced=${x.forced}`));

  // Nothing should have been emptied or duplicated.
  const counts = await q(`SELECT
      (SELECT count(*) FROM public.route_stops)::int rs,
      (SELECT count(*) FROM public.trip_logs)::int tl,
      (SELECT count(*) FROM public.bus_routes)::int br`);
  console.log(`\nRow counts: route_stops=${counts[0].rs} (was 96)  trip_logs=${counts[0].tl} (was 4)  bus_routes=${counts[0].br}`);

  await prisma.$disconnect();
  process.exit(unexpected.length === 0 && rs[0].wrong === 0 && tl[0].wrong === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n')[0]);
  await prisma.$disconnect();
  process.exit(1);
});
