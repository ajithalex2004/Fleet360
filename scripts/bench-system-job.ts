/**
 * Measure withSystemJob sweep duration across every active tenant.
 *
 * The callback does nothing. That is deliberate: what is being measured is the
 * per-tenant TRANSACTION OVERHEAD — BEGIN, set_config with its read-back, and
 * COMMIT — which is what dominates a sweep whose real work is a small indexed
 * query per tenant. Adding fake work would only obscure the fixed cost.
 *
 * Read-only. Opens transactions and commits nothing.
 *
 * Run:
 *   TS_NODE_PROJECT=scripts/tsconfig.prove.json npx ts-node --transpile-only \
 *     -r tsconfig-paths/register -r dotenv/config scripts/bench-system-job.ts
 */

import { PrismaClient } from '@prisma/client';
import { withSystemJob } from '../src/lib/rls';

const prisma = new PrismaClient();

async function main() {
  for (let i = 0; i < 8; i++) {
    try { await prisma.$queryRawUnsafe('SELECT 1'); break; }
    catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  const [{ n }] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM public.tenants WHERE is_active IS NOT false`);
  console.log(`active tenants: ${n}`);

  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? '0') || undefined;
  console.log(`concurrency: ${concurrency ?? '(default)'}`);

  const started = Date.now();
  let visited = 0;
  await withSystemJob(
    prisma,
    async () => { visited++; return true; },
    concurrency ? ({ concurrency } as never) : {},
  );
  const ms = Date.now() - started;

  console.log(`\nvisited      : ${visited}`);
  console.log(`total        : ${(ms / 1000).toFixed(1)}s`);
  console.log(`per tenant   : ${(ms / Math.max(visited, 1)).toFixed(0)}ms`);
  console.log(`\nA sweep whose callback does real work adds to this, so this is`);
  console.log(`the floor, not the expected duration.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e instanceof Error ? e.message.split('\n')[0] : e);
  await prisma.$disconnect();
  process.exit(1);
});
