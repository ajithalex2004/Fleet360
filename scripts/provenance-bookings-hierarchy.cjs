/**
 * Provenance for the last two live nullable escapes:
 *   public.bookings            3 NULL-tenant rows
 *   public.customer_hierarchy  3 NULL-tenant rows
 *
 * Same evidence standard used for finance_invoices. Read-only, decides nothing.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

async function profile(schema, table) {
  console.log(`\n${'='.repeat(70)}\n=== ${schema}.${table}\n${'='.repeat(70)}`);

  const cols = await q(`SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, schema, table);

  // 1. Which columns are populated on the NULL-tenant rows?
  const counts = cols.map(c => `count("${c.column_name}")::int AS "${c.column_name}"`).join(', ');
  const [pop] = await q(`SELECT ${counts} FROM ${schema}."${table}" WHERE tenant_id IS NULL`);
  const filled = Object.entries(pop).filter(([, v]) => v > 0).map(([k, v]) => `${k}(${v})`);
  const empty = Object.entries(pop).filter(([, v]) => v === 0).map(([k]) => k);
  console.log(`\nPOPULATED (${filled.length}): ${filled.join(', ')}`);
  console.log(`EMPTY     (${empty.length}): ${empty.join(', ') || 'none'}`);

  // 2. Full row dump of the NULL-tenant rows, truncated per field.
  const rows = await q(`SELECT * FROM ${schema}."${table}" WHERE tenant_id IS NULL ORDER BY 1`);
  console.log(`\nTHE ${rows.length} ROWS (populated fields only):`);
  rows.forEach((r, i) => {
    const kv = Object.entries(r)
      .filter(([, v]) => v !== null && v !== '' && !(typeof v === 'object' && v && Object.keys(v).length === 0))
      .map(([k, v]) => `${k}=${String(v instanceof Date ? v.toISOString() : v).slice(0, 34)}`);
    console.log(`  ${i + 1}. ${kv.join('  ')}`);
  });

  // 3. created_at clustering.
  const tsCol = cols.map(c => c.column_name).find(n => /^created_?at$/i.test(n));
  if (tsCol) {
    const cl = await q(`SELECT "${tsCol}" AS t FROM ${schema}."${table}" WHERE tenant_id IS NULL ORDER BY 1`);
    const times = cl.map(r => new Date(r.t).getTime());
    const span = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 1000 : 0;
    console.log(`\nCREATED_AT: ${cl.map(r => new Date(r.t).toISOString()).join(', ')}`);
    console.log(`   span: ${span}s across ${cl.length} rows`);
  }

  // 4. Outbound FKs — can a parent supply the tenant?
  const out = await q(`
    SELECT kcu.column_name AS col, ccu.table_schema AS psch, ccu.table_name AS ptbl, ccu.column_name AS pcol
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2`, schema, table);
  console.log(`\nOUTBOUND FKs (${out.length}):`);
  for (const f of out) {
    if (f.col === 'tenant_id') { console.log(`   ${f.col} -> ${f.psch}.${f.ptbl} (the tenant FK itself)`); continue; }
    const hasT = await q(`SELECT 1 FROM information_schema.columns
       WHERE table_schema=$1 AND table_name=$2 AND column_name='tenant_id'`, f.psch, f.ptbl);
    if (!hasT.length) { console.log(`   ${f.col} -> ${f.psch}.${f.ptbl} (parent has no tenant_id)`); continue; }
    const rec = await q(`SELECT count(*)::int n FROM ${schema}."${table}" c
       JOIN ${f.psch}."${f.ptbl}" p ON p."${f.pcol}"::text = c."${f.col}"::text
      WHERE c.tenant_id IS NULL AND p.tenant_id IS NOT NULL`);
    console.log(`   ${f.col} -> ${f.psch}.${f.ptbl}.tenant_id : ${rec[0].n}/${rows.length} recoverable`);
  }

  // 5. Undeclared parent links — *_id columns without an FK.
  const idCols = cols.map(c => c.column_name).filter(n => /_id$/.test(n) && n !== 'tenant_id');
  const declared = new Set(out.map(f => f.col));
  const undeclared = idCols.filter(n => !declared.has(n));
  if (undeclared.length) {
    console.log(`\nUNDECLARED *_id COLUMNS: ${undeclared.join(', ')}`);
    for (const c of undeclared) {
      const nn = await q(`SELECT count(*)::int n FROM ${schema}."${table}" WHERE tenant_id IS NULL AND "${c}" IS NOT NULL`);
      console.log(`   ${c}: populated on ${nn[0].n}/${rows.length} NULL-tenant rows`);
    }
  }

  // 6. Inbound references.
  const inb = await q(`
    SELECT tc.table_schema AS sch, tc.table_name AS child, kcu.column_name AS col
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_schema=$1 AND ccu.table_name=$2
       AND tc.table_name <> $2`, schema, table);
  console.log(`\nINBOUND FKs (${inb.length}): ${inb.map(f => `${f.sch}.${f.child}.${f.col}`).join(', ') || 'none'}`);
  for (const f of inb) {
    const n = await q(`SELECT count(*)::int n FROM ${f.sch}."${f.child}" c
       WHERE c."${f.col}"::text IN (SELECT id::text FROM ${schema}."${table}" WHERE tenant_id IS NULL)`);
    console.log(`   ${f.sch}.${f.child}: ${n[0].n} row(s) point at a NULL-tenant row`);
  }

  // 7. Audit trail.
  for (const a of ['audit_logs', 'audit_events', 'admin_change_history']) {
    try {
      const n = await q(`SELECT count(*)::int n FROM public.${a}
         WHERE entity_id::text IN (SELECT id::text FROM ${schema}."${table}" WHERE tenant_id IS NULL)`);
      console.log(`   ${a}: ${n[0].n} entries`);
    } catch { console.log(`   ${a}: (no entity_id column or table missing)`); }
  }
}

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }
  await profile('public', 'bookings');
  await profile('public', 'customer_hierarchy');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n').slice(0, 4).join(' | '));
  await prisma.$disconnect();
  process.exit(1);
});
