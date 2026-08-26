/**
 * finance_payments resolution test.
 *
 * Proves the shadow is gone and that the handler's own SQL now reaches the
 * tenant-isolated table. Runs the handler's actual statements rather than
 * inspecting the catalog, because the whole defect was that catalog state and
 * runtime resolution disagreed.
 *
 * Writes one payment row inside a transaction and ROLLS BACK, so nothing is
 * left behind.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

let failures = 0;
function check(name, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
  if (!pass) failures++;
}

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  // 1. Only one finance_payments, and unqualified names reach it.
  const all = await q(`
    SELECT n.nspname AS schema FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'finance_payments' AND c.relkind = 'r' ORDER BY 1`);
  check('exactly one finance_payments table exists', all.length === 1,
    `found in schema(s): ${all.map(x => x.schema).join(', ')}`);

  const [res] = await q(`SELECT n.nspname || '.' || c.relname AS r FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass('finance_payments')`);
  check('unqualified name resolves to the protected table', res.r === 'finance.finance_payments',
    `finance_payments -> ${res.r}`);

  // 2. It is actually protected, and the escape is gone.
  const [p] = await q(`
    SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policy pol WHERE pol.polrelid = c.oid) AS pols,
           (SELECT col.is_nullable FROM information_schema.columns col
             WHERE col.table_schema='finance' AND col.table_name='finance_payments'
               AND col.column_name='tenant_id') AS tenant_nullable,
           (SELECT bool_or(pg_get_expr(pol.polqual, pol.polrelid) LIKE '%tenant_id IS NULL%')
              FROM pg_policy pol WHERE pol.polrelid = c.oid) AS has_escape
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='finance' AND c.relname='finance_payments'`);
  check('enabled + forced with a policy', p.rls && p.forced && p.pols > 0,
    `rls=${p.rls} forced=${p.forced} policies=${p.pols}`);
  check('tenant_id NOT NULL and no IS NULL escape', p.tenant_nullable === 'NO' && !p.has_escape,
    `nullable=${p.tenant_nullable} escape_in_using=${p.has_escape}`);

  // 3. The handler's cross-schema join still executes.
  let joinOk = true, joinErr = '';
  try {
    await q(`SELECT count(*) FROM finance_payments p
             LEFT JOIN finance_invoices i ON i.id = p.invoice_id
             WHERE i.tenant_id = '__none__'`);
  } catch (e) { joinOk = false; joinErr = String(e.message).split('\n').find(l => /exist|error/i.test(l)) ?? e.message; }
  check("the handler's payments-to-invoices join still runs", joinOk,
    joinOk ? 'resolves across public/finance without 42P01' : joinErr);

  // 4. The handler's INSERT, with a tenant, against the real table. Rolled back.
  const [t] = await q(`SELECT id FROM public.tenants ORDER BY id LIMIT 1`);
  let insertOk = true, insertDetail = '';
  try {
    await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRawUnsafe(
        `INSERT INTO finance_payments (tenant_id, invoice_id, amount, payment_date, payment_method, reference, notes)
         VALUES ($7, $1, $2, $3::date, $4, $5, $6) RETURNING id, tenant_id`,
        null, 10.5, '2026-08-26', 'BANK_TRANSFER', 'resolution-test', null, t.id);
      const [landed] = await tx.$queryRawUnsafe(
        `SELECT tenant_id FROM finance.finance_payments WHERE id = $1::uuid`, row.id);
      insertDetail = `row written with tenant_id=${String(row.tenant_id).slice(0, 8)}...; `
        + `visible in finance.finance_payments: ${landed ? 'yes' : 'NO'}`;
      insertOk = !!landed && landed.tenant_id === t.id;
      throw new Error('__rollback__');
    });
  } catch (e) {
    if (String(e.message) !== '__rollback__' && !String(e.message).includes('__rollback__')) {
      insertOk = false;
      insertDetail = String(e.message).split('\n').filter(l => l.trim()).slice(0, 3).join(' | ');
    }
  }
  check('handler INSERT lands in the tenant-isolated table', insertOk, insertDetail);

  // 5. And an INSERT with no tenant is now rejected rather than silently orphaned.
  let rejected = false, rejDetail = '';
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `INSERT INTO finance_payments (invoice_id, amount, payment_date, payment_method)
         VALUES (NULL, 1, '2026-08-26'::date, 'CASH') RETURNING id`);
      throw new Error('__rollback__');
    });
  } catch (e) {
    const m = String(e.message);
    rejected = /23502|null value|not-null/i.test(m);
    rejDetail = rejected ? 'rejected with a not-null violation (23502)'
      : `NOT rejected — ${m.split('\n')[0].slice(0, 90)}`;
  }
  check('untenanted INSERT is rejected', rejected, rejDetail);

  const [leftover] = await q(`SELECT count(*)::int n FROM finance.finance_payments WHERE reference = 'resolution-test'`);
  check('test rows rolled back', leftover.n === 0, `leftover rows: ${leftover.n}`);

  console.log(`\n${failures === 0 ? 'RESOLUTION TEST PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n').slice(0, 3).join(' | '));
  await prisma.$disconnect();
  process.exit(1);
});
