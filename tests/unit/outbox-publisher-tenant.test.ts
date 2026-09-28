import { describe, it, expect, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { tick } from '@/lib/outbox/publisher';
import { register, _resetForTests } from '@/lib/outbox/registry';
import type { OutboxEvent } from '@/lib/outbox/types';

// A queue client that serves `rows` to the batch SELECT and records every
// statement, including the set_config that puts the batch in platform context.
function fakeQueue(rows: Partial<OutboxEvent>[]) {
  const statements: string[] = [];
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push(strings.join('?') + ' ' + JSON.stringify(values));
      return 1;
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM event_outbox')) return rows;
      return [{ exists: false }];
    },
  };
  const client = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { client, statements };
}

const event = (tenantId: string | null): Partial<OutboxEvent> => ({
  id: '00000000-0000-4000-8000-000000000001',
  eventId: '00000000-0000-4000-8000-0000000000e1',
  eventType: 'test.event',
  tenantId: tenantId as string,
  payload: {},
});

describe('outbox tick: consumers run in their event tenant', () => {
  beforeEach(() => _resetForTests());

  it('runs the consumer inside runForTenant with the event tenant and the consumer client', async () => {
    const consumerClient = { tag: 'app-client' } as unknown as PrismaClient;
    const seen: Array<{ tenant: string | undefined; client: unknown }> = [];
    let currentTenant: string | undefined;
    register('test.event', {
      consumerName: 'test-consumer',
      async handle(_e, db) { seen.push({ tenant: currentTenant, client: db }); },
    });
    const { client, statements } = fakeQueue([event('tenant-a')]);

    const result = await tick(client, {
      consumer: {
        client: consumerClient,
        runForTenant: async (tenantId, fn) => {
          currentTenant = tenantId;
          try { return await fn(); } finally { currentTenant = undefined; }
        },
      },
    });

    expect(result).toMatchObject({ total: 1, dispatched: 1, failed: 0 });
    expect(seen).toEqual([{ tenant: 'tenant-a', client: consumerClient }]);
    expect(statements[0]).toContain("set_config('app.tenant_id', '*', true)");
  });

  it('fails, rather than running unscoped, an event without a tenant', async () => {
    let ran = false;
    register('test.event', { consumerName: 'test-consumer', async handle() { ran = true; } });
    const { client, statements } = fakeQueue([event(null)]);

    const result = await tick(client, {
      consumer: { client: {} as PrismaClient, runForTenant: async (_t, fn) => fn() },
    });

    expect(ran).toBe(false);
    expect(result).toMatchObject({ total: 1, dispatched: 0, failed: 1 });
    expect(statements.some((s) => s.includes('retry_count = retry_count + 1') && s.includes('has no tenant'))).toBe(true);
  });

  it('without the consumer option, keeps handing consumers the queue client', async () => {
    let got: unknown;
    register('test.event', { consumerName: 'test-consumer', async handle(_e, db) { got = db; } });
    const { client } = fakeQueue([event('tenant-a')]);

    await tick(client);

    expect(got).toBe(client);
  });
});
