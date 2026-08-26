/**
 * Provenance analysis for the 17 NULL-tenant rows in finance.finance_invoices.
 *
 * Read-only. Decides nothing and changes nothing — the point is to find an
 * attribution path, or to establish that there isn't one, rather than to infer
 * ownership from appearance.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  // ── 1. Which columns are actually populated on the NULL-tenant rows?
  const cols = await q(`SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='finance' AND table_name='finance_invoices' ORDER BY ordinal_position`);
  console.log(`finance.finance_invoices has ${cols.length} columns\n`);

  const parts = cols.map(c => `count("${c.column_name}")::int AS "${c.column_name}"`).join(', ');
  const [pop] = await q(`SELECT ${parts} FROM finance.finance_invoices WHERE tenant_id IS NULL`);
  const populated = Object.entries(pop).filter(([, v]) => v > 0);
  const empty = Object.entries(pop).filter(([, v]) => v === 0).map(([k]) => k);
  console.log(`POPULATED on all/some of the 17 (${populated.length}):`);
  populated.forEach(([k, v]) => console.log(`   ${k.padEnd(26)} ${v}/17`));
  console.log(`\nENTIRELY EMPTY on the 17 (${empty.length}): ${empty.join(', ')}`);

  // ── 2. Identity / attribution fields.
  const idish = cols.map(c => c.column_name).filter(n =>
    /(_id$|_by$|^source|origin|reference|invoice_number|client|customer|account|contract|booking)/i.test(n));
  console.log(`\nATTRIBUTION-CANDIDATE COLUMNS: ${idish.join(', ')}`);
  const sel = idish.map(n => `"${n}"::text AS "${n}"`).join(', ');
  const rows = await q(`SELECT ${sel}, created_at FROM finance.finance_invoices
     WHERE tenant_id IS NULL ORDER BY created_at, invoice_number`);
  console.log(`\nTHE 17 ROWS:`);
  rows.forEach((r, i) => {
    const filled = Object.entries(r).filter(([k, v]) => v !== null && k !== 'created_at')
      .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`);
    console.log(`   ${String(i + 1).padStart(2)}. ${filled.join('  ') || '(all attribution fields null)'}`);
  });

  // ── 3. created_at clustering — one bulk load, or organic over time?
  const clust = await q(`SELECT created_at, count(*)::int n FROM finance.finance_invoices
     WHERE tenant_id IS NULL GROUP BY 1 ORDER BY 1`);
  console.log(`\nCREATED_AT CLUSTERING (${clust.length} distinct timestamps for 17 rows):`);
  clust.forEach(c => console.log(`   ${new Date(c.created_at).toISOString()}  x${c.n}`));

  // ── 4. Does anything reference these invoices?
  const fks = await q(`
    SELECT tc.table_schema AS sch, tc.table_name AS child, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_schema='finance'
       AND ccu.table_name='finance_invoices'`);
  console.log(`\nINBOUND FOREIGN KEYS: ${fks.length ? fks.map(f => `${f.sch}.${f.child}.${f.col}`).join(', ') : 'none declared'}`);

  // Even without FKs, do payments / journal entries / credit notes point at them?
  for (const [sch, tbl, col] of [
    ['finance', 'finance_payments', 'invoice_id'],
    ['finance', 'finance_credit_notes', 'invoice_id'],
    ['finance', 'finance_journal_entries', 'invoice_id'],
    ['finance', 'finance_collection_cases', 'invoice_id'],
  ]) {
    const has = await q(`SELECT 1 FROM information_schema.columns
       WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`, sch, tbl, col);
    if (!has.length) { console.log(`   ${sch}.${tbl}.${col}: column does not exist`); continue; }
    const n = await q(`SELECT count(*)::int n FROM ${sch}.${tbl} c
       WHERE c.${col} IN (SELECT id FROM finance.finance_invoices WHERE tenant_id IS NULL)`);
    console.log(`   ${sch}.${tbl} rows pointing at a NULL-tenant invoice: ${n[0].n}`);
  }

  // ── 5. Can the client be matched to a tenant-owned customer anywhere?
  const clientCol = cols.map(c => c.column_name).find(n => /client_name|customer_name/.test(n));
  if (clientCol) {
    const names = await q(`SELECT DISTINCT "${clientCol}" AS n FROM finance.finance_invoices
       WHERE tenant_id IS NULL AND "${clientCol}" IS NOT NULL`);
    console.log(`\nDISTINCT ${clientCol} on the 17: ${names.length}`);
    names.forEach(x => console.log(`   "${x.n}"`));
    // Look for a same-named customer that DOES have a tenant.
    const custTables = await q(`
      SELECT table_schema s, table_name t, column_name c FROM information_schema.columns
       WHERE column_name IN ('name','client_name','customer_name','company_name')
         AND table_schema IN ('public','finance')
         AND table_name ~ '(customer|client|account)'`);
    let matched = 0;
    for (const ct of custTables) {
      const hasT = await q(`SELECT 1 FROM information_schema.columns
         WHERE table_schema=$1 AND table_name=$2 AND column_name='tenant_id'`, ct.s, ct.t);
      if (!hasT.length) continue;
      const m = await q(`SELECT count(*)::int n FROM ${ct.s}."${ct.t}" x
         WHERE x.tenant_id IS NOT NULL AND x."${ct.c}" IN (
           SELECT "${clientCol}" FROM finance.finance_invoices WHERE tenant_id IS NULL)`);
      if (m[0].n > 0) { console.log(`   MATCH: ${ct.s}.${ct.t}.${ct.c} has ${m[0].n} tenant-owned row(s) with the same name`); matched += m[0].n; }
    }
    if (matched === 0) console.log('   no tenant-owned customer/client row matches any of those names');
  }

  // ── 6. The one tenanted invoice, for shape comparison.
  const [one] = await q(`SELECT ${sel}, created_at, tenant_id FROM finance.finance_invoices
     WHERE tenant_id IS NOT NULL LIMIT 1`);
  console.log(`\nTHE ONE TENANTED INVOICE (for shape comparison), tenant=${one.tenant_id}:`);
  console.log('   ' + Object.entries(one).filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join('  '));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n').slice(0, 4).join(' | '));
  await prisma.$disconnect();
  process.exit(1);
});
