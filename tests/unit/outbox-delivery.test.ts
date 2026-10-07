/**
 * tests/unit/outbox-delivery.test.ts
 *
 * Architecture audit A2/A3: the outbox had two publishers that acknowledged
 * each other's events, rows were not claimed, an event type without a
 * consumer was marked published, and a consumer's inbox "claim" overwrote
 * another worker's and ran the handler anyway.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory event_consumer_inbox with the SQL's conflict semantics ────────
const inbox = vi.hoisted(() => new Map<string, { status: string; at: number }>());
const sql = vi.hoisted(() => ({ statements: [] as string[], outboxRows: [] as unknown[] }));

vi.mock('@/lib/prisma', () => {
  const key = (args: unknown[]) => `${args[0]}|${args[1]}`;
  return {
    prisma: {
      $queryRawUnsafe: async (q: string, ...args: unknown[]) => {
        sql.statements.push(q);
        if (q.includes('INSERT INTO event_consumer_inbox')) {
          const k = key(args);
          const row = inbox.get(k);
          // Ownership is decided synchronously here, like one SQL statement.
          if (!row) { inbox.set(k, { status: 'PROCESSING', at: Date.now() }); return [{ status: 'PROCESSING' }]; }
          if (row.status === 'FAILED') { row.status = 'PROCESSING'; row.at = Date.now(); return [{ status: 'PROCESSING' }]; }
          return [];
        }
        if (q.includes('SELECT status FROM event_consumer_inbox')) {
          const row = inbox.get(key(args));
          return row ? [{ status: row.status }] : [];
        }
        if (q.includes('UPDATE event_outbox') && q.includes('FOR UPDATE SKIP LOCKED')) return sql.outboxRows;
        return [];
      },
      $executeRawUnsafe: async (q: string, ...args: unknown[]) => {
        const row = inbox.get(key(args));
        if (row && q.includes("'PROCESSED'")) row.status = 'PROCESSED';
        if (row && q.includes("'FAILED'")) row.status = 'FAILED';
        return 1;
      },
    },
  };
});
vi.mock('@/lib/rls-scope', () => ({ runWithTenantContext: (_t: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (tx: unknown) => unknown) => fn({
    $queryRaw: async () => [{ parked: 0, lag_ms: null }],
    $queryRawUnsafe: async (q: string) => {
      sql.statements.push(q);
      return q.includes('FOR UPDATE SKIP LOCKED') ? sql.outboxRows : [];
    },
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.statements.push(strings.join('?') + ' -- ' + JSON.stringify(values));
      return 1;
    },
  }),
}));

import { BaseEventConsumer } from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { initEventConsumers, runOutboxPublisher } from '@/lib/jobs/outbox-publisher';
import { getEventBus } from '@/events/event-bus';
import { EVENTS_WITHOUT_CONSUMERS, FLEET360_EVENTS } from '@/events/registry';

beforeEach(() => { inbox.clear(); sql.statements = []; sql.outboxRows = []; });

const envelope = (eventType = 'test.event'): DomainEventEnvelope<unknown> => ({
  eventId: '11111111-1111-4111-8111-111111111111', eventType, eventVersion: '1',
  occurredAt: new Date().toISOString(), tenantId: 'tenant-a', aggregateType: 'X', aggregateId: 'x',
  sourceModule: 'test', correlationId: null, causationId: null, actor: 'system', data: {},
});

class SlowConsumer extends BaseEventConsumer {
  readonly consumerName = 'test-consumer';
  readonly eventType = 'test.event';
  calls = 0;
  fail = false;
  protected async handle(): Promise<void> {
    this.calls++;
    await new Promise((r) => setTimeout(r, 20));
    if (this.fail) throw new Error('boom');
  }
}

describe('consumer inbox claim', () => {
  it('runs the handler once for two simultaneous deliveries of one event', async () => {
    const c = new SlowConsumer();
    const [a, b] = await Promise.all([c.process(envelope()), c.process(envelope())]);
    expect(c.calls).toBe(1);
    // The loser reports "not delivered yet", not success.
    expect([a, b].sort()).toEqual([false, true]);
    expect(await c.process(envelope())).toBe(true); // PROCESSED: skipped
    expect(c.calls).toBe(1);
  });

  it('retries a FAILED delivery', async () => {
    const c = new SlowConsumer();
    c.fail = true;
    expect(await c.process(envelope())).toBe(false);
    c.fail = false;
    expect(await c.process(envelope())).toBe(true);
    expect(c.calls).toBe(2);
  });
});

describe('event registry completeness', () => {
  it('gives every registered event type a consumer, or lists it as needing none', async () => {
    await initEventConsumers();
    const bus = getEventBus();
    for (const e of FLEET360_EVENTS) {
      const consumed = bus.getHandlers(e.type).length > 0;
      const exempt = EVENTS_WITHOUT_CONSUMERS.has(e.type);
      expect(consumed !== exempt, `${e.type}: consumed=${consumed}, listed without consumers=${exempt}`).toBe(true);
    }
    const known = new Set(FLEET360_EVENTS.map((e) => e.type));
    for (const t of EVENTS_WITHOUT_CONSUMERS) expect(known.has(t), t).toBe(true);
  }, 60_000);
});

describe('outbox publisher', () => {
  const row = (event_type: string) => ({
    id: '22222222-2222-4222-8222-222222222222', event_id: '33333333-3333-4333-8333-333333333333',
    event_type, event_version: '1', aggregate_type: 'X', aggregate_id: 'x', source_module: 'test',
    tenant_id: 'tenant-a', correlation_id: null, causation_id: null, actor: 'system', payload: {},
    occurred_at: new Date(), created_at: new Date(), retry_count: 0,
  });
  const run = () => runOutboxPublisher({ tenantId: null, userId: 'system:cron', searchParams: new URLSearchParams(), request: {} as never });
  const outboxUpdates = () => sql.statements.filter((s) => s.includes('UPDATE event_outbox') && !s.includes('FOR UPDATE SKIP LOCKED'));

  it('claims its batch exclusively with a lease', async () => {
    await run();
    const claim = sql.statements.find((s) => s.includes('FOR UPDATE SKIP LOCKED'))!;
    expect(claim).toMatch(/SET claimed_by = \$1, claim_expires_at/);
    expect(claim).toMatch(/claim_expires_at IS NULL OR claim_expires_at < NOW\(\)/);
  }, 60_000);

  it('parks an event type nothing consumes instead of acknowledging it', async () => {
    sql.outboxRows = [row('nobody.listens')];
    const result = await run();
    const [update] = outboxUpdates();
    expect(update).toContain('failure_reason');
    expect(update).not.toContain('published_at');
    expect(update).toContain('AND claimed_by = ');
    expect(result.data).toMatchObject({ unrouted: 1 });
  }, 60_000);

  it('acknowledges a recorded fact listed as needing no consumer', async () => {
    sql.outboxRows = [row('trip.en_route')];
    await run();
    const [update] = outboxUpdates();
    expect(update).toContain('published_at = NOW()');
    expect(update).toContain('AND claimed_by = ');
  }, 60_000);
});
