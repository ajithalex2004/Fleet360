/**
 * Long-lived outbox publisher for local dev.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings scripts/outbox-publisher-dev.ts
 *
 * In production this is replaced by a containerised worker (or the
 * `/api/cron/outbox-publish` endpoint hit by an external scheduler).
 * This dev runner is for testing the wiring without bringing up the
 * full deploy story.
 *
 * It does:
 *   - import all consumer modules (side-effect: register handlers)
 *   - poll the outbox every POLL_INTERVAL_MS
 *   - log every tick's summary line
 *   - exit cleanly on SIGINT / SIGTERM
 *
 * Env vars (read by the underlying Prisma client):
 *   DATABASE_URL — Postgres connection string
 *   POLL_INTERVAL_MS — override the 2s default
 */

import { PrismaClient } from '@prisma/client';
import '../src/lib/finance/consumers/index.ts';
import { run } from '../src/lib/outbox/publisher.ts';

const prisma = new PrismaClient();

const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 2000);
if (Number.isNaN(pollIntervalMs) || pollIntervalMs < 100) {
  console.error(`Invalid POLL_INTERVAL_MS: ${process.env.POLL_INTERVAL_MS}`);
  process.exit(2);
}

console.log(`[outbox-dev] starting (poll every ${pollIntervalMs}ms)`);
console.log(`[outbox-dev] DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'MISSING'}`);

await run(prisma, { pollIntervalMs, batchSize: 50, maxRetries: 10 });

await prisma.$disconnect();
console.log(`[outbox-dev] exited`);
process.exit(0);
