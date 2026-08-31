/**
 * Measure how many concurrent interactive transactions RUNTIME_DIRECT_DATABASE_URL
 * actually sustains, so SWEEP_CONCURRENCY_CAP is a number someone observed
 * rather than a number someone reasoned about.
 *
 *   node --env-file=.env scripts/measure-sweep-concurrency.mjs [maxLevel]
 *
 * Ramps 1..maxLevel. At each level it opens that many transactions that all
 * overlap — a barrier holds every one open until the last has started, because
 * transactions that merely run back-to-back prove nothing about pool pressure.
 * Each does the same work a real sweep tenant does: set_config('app.tenant_id')
 * plus a trivial scoped read.
 *
 * Reports the highest level that passed. That is the ceiling; the cap should sit
 * at or below it.
 *
 * Exit codes: 0 measured cleanly, 1 could not measure (no URL, level 1 failed).
 */
import { PrismaClient } from '@prisma/client';

const MAX = Number(process.argv[2] ?? 8);
const url = process.env.RUNTIME_DIRECT_DATABASE_URL;

function mask(u) {
  return String(u).replace(/:\/\/[^@]*@/, '://***:***@');
}

if (!url) {
  console.error('RUNTIME_DIRECT_DATABASE_URL is not set. Run with: node --env-file=.env');
  process.exit(1);
}
if (/-pooler\./.test(url)) {
  console.error(`RUNTIME_DIRECT_DATABASE_URL is a -pooler endpoint (${mask(url)}).`);
  console.error('Sweeps refuse pooled endpoints, so measuring one tells us nothing.');
  process.exit(1);
}

const declared = /[?&]connection_limit=(\d+)/.exec(url);
console.log(`url            : ${mask(url)}`);
console.log(`connection_limit: ${declared ? declared[1] : '(unset - Prisma sizes from core count)'}`);
console.log(`ramping        : 1..${MAX} concurrent overlapping transactions\n`);

/** Resolves once `n` participants have arrived. */
function barrier(n) {
  let arrived = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  return () => {
    if (++arrived === n) release();
    return gate;
  };
}

async function attempt(client, level) {
  const arrive = barrier(level);

  const units = Array.from({ length: level }, (_, i) =>
    client.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT set_config('app.tenant_id', 'measure-${i}', true) AS v`);
        // Hold the transaction open until every sibling has one too.
        await arrive();
        await tx.$queryRawUnsafe('SELECT 1 AS ok');
        return i;
      },
      { timeout: 15_000, maxWait: 5_000 },
    ),
  );

  await Promise.all(units);
}

const client = new PrismaClient({ datasourceUrl: url, log: [] });
let ceiling = 0;
let firstFailure = null;

try {
  const who = await client.$queryRawUnsafe(
    'SELECT current_user, rolbypassrls, rolconnlimit FROM pg_roles WHERE rolname = current_user',
  );
  const role = who[0] ?? {};
  console.log(
    `role           : ${role.current_user} (bypassrls=${role.rolbypassrls}, rolconnlimit=${role.rolconnlimit})\n`,
  );

  for (let level = 1; level <= MAX; level++) {
    const started = Date.now();
    try {
      await attempt(client, level);
      ceiling = level;
      console.log(`  ${String(level).padStart(2)} concurrent  OK    ${Date.now() - started}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.log(`  ${String(level).padStart(2)} concurrent  FAIL  ${msg}`);
      firstFailure = { level, msg };
      break;
    }
  }
} finally {
  await client.$disconnect();
}

console.log('');
if (ceiling === 0) {
  console.log('Could not sustain even one transaction — this is a connectivity problem, not a pool one.');
  process.exit(1);
}
console.log(`highest sustained : ${ceiling}`);
if (firstFailure) {
  console.log(`first failure at  : ${firstFailure.level}`);
} else {
  console.log(`no failure up to  : ${MAX} (the real ceiling may be higher — re-run with a larger max)`);
}
console.log(`\nSWEEP_CONCURRENCY_CAP in src/lib/prisma-sweep.ts should be <= ${ceiling}.`);
