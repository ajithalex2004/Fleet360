/**
 * Does withTenantRls() survive Neon's transaction pooler?
 *
 * src/lib/rls.ts throws an error whose text tells the reader to check that
 * DATABASE_URL is direct, "no -pooler". But .env sets DATABASE_URL to the
 * pooled endpoint and DIRECT_URL to the direct one — the standard Prisma/Neon
 * split. One of those two is wrong, and guessing which is not good enough to
 * start an RLS activation pass on.
 *
 * set_config('app.tenant_id', ..., true) is transaction-LOCAL. It is safe under
 * a transaction-mode pooler if and only if the pooler pins a transaction to one
 * backend for its whole duration, and the setting reverts at COMMIT so it
 * cannot leak to whoever gets that backend next.
 *
 * This proves both, against the real withTenantRls, over the pooled URL:
 *
 *   A  set / read-back / query / commit          — the basic path works
 *   B  read app.tenant_id after commit           — must NOT still be set
 *   C  concurrent transactions, distinct tenants — none may observe another's
 *   D  interleaved reads inside one transaction  — value must be stable across
 *                                                  multiple round-trips, which
 *                                                  is what proves the pin
 *
 * Read-only. Sets no data, changes no schema, switches no role.
 *
 * Run:
 *   TS_NODE_PROJECT=scripts/tsconfig.prove.json npx ts-node --transpile-only \
 *     -r tsconfig-paths/register -r dotenv/config scripts/prove-pooled-rls.ts
 *
 * The dedicated tsconfig exists to map @/* and to stub `server-only`, which
 * rls-scope imports and which throws outside a Next server context.
 *
 * RESULT, 2026-08-26, against ep-calm-heart-a15voo2a-pooler: all four pass.
 * The pooled DATABASE_URL is correct and the old "no -pooler" instruction in
 * rls.ts was wrong. Re-run this if the connection layer ever changes —
 * Accelerate or a statement-mode pooler WOULD break it.
 */

import { PrismaClient } from '@prisma/client';
import { withTenantRls } from '../src/lib/rls';

const prisma = new PrismaClient();

function host(url: string | undefined): string {
  if (!url) return '(unset)';
  const m = url.match(/@([^/?]+)/);
  return m ? m[1] : '(unparseable)';
}

const results: Array<{ test: string; pass: boolean; detail: string }> = [];
function record(test: string, pass: boolean, detail: string) {
  results.push({ test, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${test}\n      ${detail}`);
}

async function warm() {
  for (let i = 0; i < 6; i++) {
    try { await prisma.$queryRawUnsafe('SELECT 1'); return; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }
  throw new Error('database did not become reachable');
}

async function main() {
  await warm();

  const dbUrl = process.env.DATABASE_URL;
  const pooled = /-pooler\./.test(dbUrl ?? '');
  console.log(`\nDATABASE_URL host : ${host(dbUrl)}`);
  console.log(`DIRECT_URL host   : ${host(process.env.DIRECT_URL)}`);
  console.log(`pooled            : ${pooled}\n`);

  if (!pooled) {
    console.log('DATABASE_URL is NOT the pooled endpoint — this run does not prove');
    console.log('anything about pooler behaviour. Point it at -pooler and re-run.\n');
  }

  // Pick two real tenant ids so the queries are representative.
  const tenants = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM public.tenants ORDER BY id LIMIT 2`,
  );
  if (tenants.length < 2) throw new Error('need at least 2 tenants to test isolation');
  const [tenantA, tenantB] = tenants.map(t => t.id);
  console.log(`tenantA = ${tenantA}\ntenantB = ${tenantB}\n`);

  // ── A. The basic path: set, read back, query, commit.
  const a = await withTenantRls(prisma, tenantA, async (tx) => {
    const [{ v }] = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
      `SELECT current_setting('app.tenant_id', true) AS v`,
    );
    const [{ n }] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM public.bus_routes WHERE tenant_id = $1`, tenantA,
    );
    return { v, n };
  });
  record('A  set_config visible inside the transaction', a.v === tenantA,
    `current_setting returned ${JSON.stringify(a.v)} (expected ${tenantA}); tenant-owned query returned ${a.n} rows`);

  // ── B. After COMMIT the setting must be gone. If it survives, a pooled
  //       backend could hand a stale tenant context to the next client.
  const [{ after }] = await prisma.$queryRawUnsafe<Array<{ after: string | null }>>(
    `SELECT current_setting('app.tenant_id', true) AS after`,
  );
  record('B  app.tenant_id does NOT persist after commit',
    after !== tenantA && (after === null || after === ''),
    `outside any transaction current_setting returned ${JSON.stringify(after)}`);

  // ── D. Stability across round-trips inside ONE transaction. If the pooler
  //       moved us to a different backend mid-transaction, one of these reads
  //       would come back empty. Ten reads with real gaps between them.
  const reads = await withTenantRls(prisma, tenantB, async (tx) => {
    const seen: Array<string | null> = [];
    for (let i = 0; i < 10; i++) {
      const [{ v }] = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
        `SELECT current_setting('app.tenant_id', true) AS v`,
      );
      seen.push(v);
      await new Promise(r => setTimeout(r, 40));
    }
    return seen;
  });
  const stable = reads.every(v => v === tenantB);
  record('D  value stable across 10 round-trips in one tx', stable,
    stable ? `all 10 reads returned ${tenantB}` : `drifted: ${JSON.stringify(reads)}`);

  // ── C. The one that actually matters. Concurrent transactions with distinct
  //       tenants, each re-reading its own value. Under a pooler that failed to
  //       pin, these would bleed into each other.
  const ids = [tenantA, tenantB, tenantA, tenantB, tenantA, tenantB, tenantA, tenantB];
  const concurrent = await Promise.all(
    ids.map((id, i) =>
      withTenantRls(prisma, id, async (tx) => {
        await new Promise(r => setTimeout(r, (i % 4) * 30));
        const [{ v }] = await tx.$queryRawUnsafe<Array<{ v: string | null }>>(
          `SELECT current_setting('app.tenant_id', true) AS v`,
        );
        await new Promise(r => setTimeout(r, 50));
        const [{ v2 }] = await tx.$queryRawUnsafe<Array<{ v2: string | null }>>(
          `SELECT current_setting('app.tenant_id', true) AS v2`,
        );
        return { expected: id, first: v, second: v2 };
      }),
    ),
  );
  const bled = concurrent.filter(r => r.first !== r.expected || r.second !== r.expected);
  record('C  8 concurrent txs never observe another tenant', bled.length === 0,
    bled.length === 0
      ? 'every transaction read back only its own tenant id, twice'
      : `${bled.length} transaction(s) saw the wrong value: ${JSON.stringify(bled)}`);

  // ── Report.
  const failed = results.filter(r => !r.pass);
  console.log('\n' + '─'.repeat(64));
  if (failed.length === 0 && pooled) {
    console.log('VERDICT: withTenantRls works correctly over the pooled endpoint.');
    console.log('The "no -pooler" instruction in src/lib/rls.ts is wrong and should');
    console.log('be corrected — it will send whoever debugs the first set_config');
    console.log('failure down a false trail.');
  } else if (failed.length === 0) {
    console.log('VERDICT: passed, but not against a pooled URL — inconclusive.');
  } else {
    console.log(`VERDICT: ${failed.length} check(s) FAILED — the warning in rls.ts is`);
    console.log('justified and DATABASE_URL must be moved to the direct endpoint.');
    failed.forEach(f => console.log(`  - ${f.test}`));
  }
  console.log('─'.repeat(64) + '\n');

  await prisma.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nERROR:', e instanceof Error ? e.message.split('\n').slice(0, 5).join('\n') : e);
  await prisma.$disconnect();
  process.exit(1);
});
