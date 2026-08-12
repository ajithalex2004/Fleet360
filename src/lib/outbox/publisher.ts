/**
 * Outbox publisher.
 *
 * Drains event_outbox and dispatches each event to its registered
 * consumer. The contract:
 *
 *   1. Read up to `batchSize` unpublished events with FOR UPDATE
 *      SKIP LOCKED so multiple publisher instances don't double-
 *      dispatch. The row lock is held for the duration of the
 *      transaction.
 *   2. For each event, find the consumer by event_type.
 *      - No consumer registered? Mark the row published and skip
 *        (so we don't re-poll forever for an event no one cares
 *        about).
 *   3. Check event_consumer_inbox for the (consumerName, eventId)
 *      pair. If present, the consumer has already processed this
 *      event — mark the row published and move on.
 *   4. Otherwise, invoke consumer.handle(event). On success, insert
 *      the consumer-inbox row and mark the outbox row published.
 *      On throw, increment retry_count and set failed_at +
 *      failure_reason. The next tick will retry until
 *      retryCount >= maxRetries.
 *
 * Concurrency: SKIP LOCKED + per-row transaction means multiple
 * publishers can run side-by-side without double-dispatching. The
 * consumer-inbox UNIQUE constraint on (consumerName, eventId) is
 * the final guard — if two publishers somehow try to process the
 * same event for the same consumer, only one INSERT succeeds.
 *
 * Run pattern:
 *   - As a long-lived process: scripts/outbox-publisher-dev.ts
 *   - As a cron tick: POST /api/cron/outbox-publish
 */

import type { PrismaClient } from '@prisma/client';
import type { OutboxEvent, TickOptions, TickResult } from './types.ts';
import { get as getConsumer } from './registry.ts';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_RETRIES = 10;

export async function tick(
  prisma: PrismaClient,
  options: TickOptions = {},
): Promise<TickResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  // The whole batch is one transaction so FOR UPDATE SKIP LOCKED
  // actually holds the row locks until we commit. Otherwise the
  // locks would be released after the SELECT and two publishers
  // could pick up the same event.
  return prisma.$transaction(async (tx) => {
    // Alias snake_case columns to camelCase so the result matches
    // OutboxEvent's TypeScript shape. Without aliases, $queryRaw
    // returns the raw column names and the consumer lookup
    // (event.eventType) silently fails to find a registered handler.
    const events = await tx.$queryRaw<OutboxEvent[]>`
      SELECT id,
             event_id      AS "eventId",
             event_type    AS "eventType",
             event_version AS "eventVersion",
             aggregate_type AS "aggregateType",
             aggregate_id  AS "aggregateId",
             source_module AS "sourceModule",
             tenant_id     AS "tenantId",
             correlation_id AS "correlationId",
             causation_id  AS "causationId",
             actor,
             payload,
             occurred_at   AS "occurredAt",
             published_at  AS "publishedAt",
             failed_at     AS "failedAt",
             failure_reason AS "failureReason",
             retry_count   AS "retryCount",
             created_at    AS "createdAt"
        FROM event_outbox
       WHERE published_at IS NULL
         AND (failed_at IS NULL OR retry_count < ${maxRetries})
       ORDER BY created_at ASC
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    `;

    let dispatched = 0;
    let failed = 0;
    let skipped = 0;

    for (const event of events) {
      const consumer = getConsumer(event.eventType);
      if (!consumer) {
        // No consumer for this event_type. Mark published so we
        // don't re-poll. If a consumer is registered later, it
        // can pick up future events of this type.
        await tx.$executeRaw`
          UPDATE event_outbox
             SET published_at = NOW()
           WHERE id = ${event.id}::uuid
        `;
        skipped++;
        continue;
      }

      // Per-consumer idempotency check.
      const alreadyProcessed = await tx.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM event_consumer_inbox
           WHERE consumer_name = ${consumer.consumerName}
             AND event_id = ${event.eventId}::uuid
        ) AS exists
      `;
      if (alreadyProcessed[0]?.exists) {
        await tx.$executeRaw`
          UPDATE event_outbox
             SET published_at = NOW()
           WHERE id = ${event.id}::uuid
        `;
        dispatched++;
        continue;
      }

      try {
        await consumer.handle(event, prisma);

        await tx.$executeRaw`
          INSERT INTO event_consumer_inbox
            (consumer_name, event_id, event_type, tenant_id, status, processed_at)
          VALUES
            (${consumer.consumerName}, ${event.eventId}::uuid, ${event.eventType},
             ${event.tenantId}::uuid, 'PROCESSED', NOW())
        `;

        await tx.$executeRaw`
          UPDATE event_outbox
             SET published_at = NOW(),
                 failed_at = NULL,
                 failure_reason = NULL
           WHERE id = ${event.id}::uuid
        `;
        dispatched++;
      } catch (err) {
        const reason = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        await tx.$executeRaw`
          UPDATE event_outbox
             SET failed_at = NOW(),
                 failure_reason = ${reason},
                 retry_count = retry_count + 1
           WHERE id = ${event.id}::uuid
        `;
        failed++;
      }
    }

    return { total: events.length, dispatched, failed, skipped };
  });
}

/**
 * Long-running loop. Polls every `pollIntervalMs`. Returns on
 * SIGINT/SIGTERM. The publisher should be run with a process
 * manager (pm2, systemd, etc.) that restarts it on crash.
 */
export async function run(
  prisma: PrismaClient,
  options: TickOptions & { pollIntervalMs?: number } = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  let stopping = false;

  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(`[outbox] publisher started, polling every ${pollIntervalMs}ms`);

  while (!stopping) {
    try {
      const result = await tick(prisma, options);
      if (result.total > 0) {
        console.log(
          `[outbox] tick: ${result.dispatched} dispatched, ${result.failed} failed, ${result.skipped} skipped`,
        );
      }
    } catch (err) {
      // Tick-level failure (e.g. DB connection lost). Log and
      // back off; the next tick will retry.
      console.error(`[outbox] tick failed:`, err);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  console.log(`[outbox] publisher stopped`);
}
