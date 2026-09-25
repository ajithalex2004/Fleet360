/**
 * tests/unit/rls-unprotected-tables-paths.test.ts
 *
 * RLS is being enabled on 22 tenant tables that had none
 * (prisma/migrations/20260925130000_rls_for_unprotected_tenant_tables).
 * Code that reaches them outside an authenticated request has no tenant for
 * the Prisma layer to scope with, so each such path now runs in an explicit,
 * verified context. Covered here:
 *
 *  - outbox event consumers run in the envelope's tenant
 *  - public partner-driver links run in the tenant of the token's award
 *  - the document lifecycle sweep: a signed-in user only sweeps their own
 *    tenant (a tenant in the query or body used to be honoured); only the
 *    scheduler may name a tenant or sweep all, in platform context
 *  - /api/agents/run ignores a tenant_id in the body
 *  - the WhatsApp webhook stores inbound messages and auto-replies under the
 *    tenant that last messaged the sender, or 'default' (platform-only)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const rec = vi.hoisted(() => ({
  contexts: [] as string[],          // 'tenant:<id>' | 'platform'
  sql: [] as Array<{ ctx: string; sql: string; params: unknown[] }>,
  tokenTenant: null as string | null,
  lastOutboundTenant: null as string | null,
  sweepCalls: [] as Array<{ arg: string | undefined; ctx: string | undefined }>,
  scanCalls: [] as string[],
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(async () => []),
    $executeRawUnsafe: vi.fn(async () => 1),
  },
}));
vi.mock('@/lib/rls', () => {
  const tx = (ctx: string) => ({
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      rec.sql.push({ ctx, sql, params });
      if (sql.includes('FROM partner_assignments')) return rec.tokenTenant ? [{ tenant_id: rec.tokenTenant }] : [];
      if (sql.includes("direction = 'OUTBOUND' AND to_number")) return rec.lastOutboundTenant ? [{ tenant_id: rec.lastOutboundTenant }] : [];
      return [];
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => { rec.sql.push({ ctx, sql, params }); return 1; },
  });
  return {
    withTenantRls: async (_p: unknown, tenantId: string, fn: (t: unknown) => unknown) => {
      rec.contexts.push(`tenant:${tenantId}`);
      const prev = currentCtx.value; currentCtx.value = `tenant:${tenantId}`;
      try { return await fn(tx(`tenant:${tenantId}`)); } finally { currentCtx.value = prev; }
    },
    withPlatformAdmin: async (_p: unknown, fn: (t: unknown) => unknown) => {
      rec.contexts.push('platform');
      const prev = currentCtx.value; currentCtx.value = 'platform';
      try { return await fn(tx('platform')); } finally { currentCtx.value = prev; }
    },
  };
});
const currentCtx = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('@/lib/agents/schema', () => ({ ensureAgentSchema: vi.fn(async () => undefined) }));
vi.mock('@/lib/agents/document-intelligence/pipeline/lifecycle-manager', () => ({
  sweepDocumentExpiries: vi.fn(async (tenantId?: string) => {
    rec.sweepCalls.push({ arg: tenantId, ctx: currentCtx.value });
    return { expiredCount: 0, expiringCount: 0 };
  }),
}));
vi.mock('@/lib/agents/orchestrator', () => ({
  triggerFullScan: vi.fn(async (_agent: string, tenantId: string) => { rec.scanCalls.push(tenantId); return { status: 'COMPLETED' }; }),
}));
vi.mock('@/lib/whatsapp/twilio-signature', () => ({
  verifyTwilioSignature: () => true,
  twilioWebhookUrl: () => 'http://localhost/api/webhooks/whatsapp',
}));
vi.mock('@/lib/whatsapp/twilio-client', () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ sid: 'SMreply', status: 'sent' })),
  WHATSAPP_FROM_NUMBER: '+971500000000',
}));
vi.mock('@/lib/agents/whatsapp-agent/agent', () => ({ logInteraction: vi.fn(async () => undefined) }));
vi.mock('@/lib/exchange/webhook-receipt-service', () => ({ WebhookReceiptService: {} }));

import { NextRequest } from 'next/server';
import { backgroundTenantId } from '@/lib/rls-scope';
import { BaseEventConsumer } from '@/events/consumer-base';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { withPartnerTokenTenant } from '@/lib/exchange/partner-token-tenant';
import { POST as lifecycleSweep } from '@/app/api/documents/intelligence/cron/lifecycle-sweep/route';
import { POST as agentsRun } from '@/app/api/agents/run/route';
import { POST as whatsappWebhook } from '@/app/api/webhooks/whatsapp/route';

beforeEach(() => {
  rec.contexts = []; rec.sql = []; rec.sweepCalls = []; rec.scanCalls = [];
  rec.tokenTenant = null; rec.lastOutboundTenant = null;
});

class ProbeConsumer extends BaseEventConsumer<unknown> {
  readonly consumerName = 'probe';
  readonly eventType = 'probe.event';
  seen: string | undefined = 'unset';
  protected async handle(): Promise<void> { this.seen = backgroundTenantId(); }
}
const envelope = (tenantId: string) =>
  ({ eventId: '33333333-3333-4333-8333-333333333333', eventType: 'probe.event', tenantId, payload: {} }) as unknown as DomainEventEnvelope<unknown>;

describe('event consumers', () => {
  it('handle the event in the envelope tenant', async () => {
    const c = new ProbeConsumer();
    expect(await c.process(envelope(TENANT_A))).toBe(true);
    expect(c.seen).toBe(TENANT_A);
    expect(backgroundTenantId()).toBeUndefined();
  });

  it('fall back to no context for a malformed tenant id instead of throwing', async () => {
    const c = new ProbeConsumer();
    expect(await c.process(envelope("x'; --"))).toBe(true);
    expect(c.seen).toBeUndefined();
  });
});

describe('partner-driver links', () => {
  it('run in the tenant of the token\'s award, resolved in platform context', async () => {
    rec.tokenTenant = TENANT_B;
    const seen = await withPartnerTokenTenant('x'.repeat(32), async () => backgroundTenantId());
    expect(seen).toBe(TENANT_B);
    expect(rec.contexts).toEqual(['platform']);
  });

  it('run unchanged when the token resolves to nothing', async () => {
    expect(await withPartnerTokenTenant('x'.repeat(32), async () => backgroundTenantId())).toBeUndefined();
    expect(await withPartnerTokenTenant('short', async () => backgroundTenantId())).toBeUndefined();
  });
});

describe('document lifecycle sweep', () => {
  const sessionHeaders = { 'x-tenant-id': TENANT_A, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN' };

  beforeEach(() => { process.env.CRON_SECRET = 'cron-secret-for-tests'; });

  it('sweeps only the signed-in user\'s tenant, ignoring a tenant in the body', async () => {
    const res = await lifecycleSweep(new NextRequest('http://localhost/api/documents/intelligence/cron/lifecycle-sweep', {
      method: 'POST', headers: sessionHeaders, body: JSON.stringify({ tenantId: TENANT_B }),
    }));
    expect(res.status).toBe(200);
    expect(rec.sweepCalls).toEqual([{ arg: TENANT_A, ctx: `tenant:${TENANT_A}` }]);
  });

  it('refuses a signed-in user who names another tenant in the query', async () => {
    const res = await lifecycleSweep(new NextRequest(`http://localhost/api/documents/intelligence/cron/lifecycle-sweep?tenantId=${TENANT_B}`, {
      method: 'POST', headers: sessionHeaders,
    }));
    expect(res.status).toBe(403);
    expect(rec.sweepCalls).toEqual([]);
  });

  it('refuses a caller with neither a session nor the cron secret', async () => {
    const res = await lifecycleSweep(new NextRequest('http://localhost/api/documents/intelligence/cron/lifecycle-sweep', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(rec.sweepCalls).toEqual([]);
  });

  it('lets the scheduler name a tenant, run in that tenant', async () => {
    await lifecycleSweep(new NextRequest(`http://localhost/api/documents/intelligence/cron/lifecycle-sweep?tenantId=${TENANT_B}`, {
      method: 'POST', headers: { authorization: 'Bearer cron-secret-for-tests' },
    }));
    expect(rec.sweepCalls).toEqual([{ arg: TENANT_B, ctx: `tenant:${TENANT_B}` }]);
  });

  it('runs the scheduler\'s all-tenant sweep in platform context', async () => {
    await lifecycleSweep(new NextRequest('http://localhost/api/documents/intelligence/cron/lifecycle-sweep', {
      method: 'POST', headers: { authorization: 'Bearer cron-secret-for-tests' },
    }));
    expect(rec.sweepCalls).toEqual([{ arg: undefined, ctx: 'platform' }]);
  });
});

describe('/api/agents/run', () => {
  it('ignores a tenant_id in the body and scans the session tenant', async () => {
    await agentsRun(new NextRequest('http://localhost/api/agents/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT_A, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN' },
      body: JSON.stringify({ agent_id: 'compliance', tenant_id: TENANT_B }),
    }));
    expect(rec.scanCalls).toEqual([TENANT_A]);
  });
});

describe('WhatsApp webhook', () => {
  const inbound = () => new NextRequest('http://localhost/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'sig' },
    body: new URLSearchParams({ MessageSid: 'SMin', From: 'whatsapp:+971501234567', To: 'whatsapp:+971500000000', Body: 'hello' }).toString(),
  });
  const inserts = () => rec.sql.filter((q) => q.sql.includes('INSERT INTO whatsapp_messages'));

  it('stores the conversation under the tenant that last messaged the sender', async () => {
    rec.lastOutboundTenant = TENANT_B;
    expect((await whatsappWebhook(inbound())).status).toBe(200);
    expect(inserts()).toHaveLength(2);
    for (const q of inserts()) {
      expect(q.ctx).toBe('platform');
      expect(q.sql).toContain('tenant_id');
      expect(q.params[q.params.length - 1]).toBe(TENANT_B);
    }
  });

  it('keeps an unattributed conversation platform-only', async () => {
    await whatsappWebhook(inbound());
    for (const q of inserts()) expect(q.params[q.params.length - 1]).toBe('default');
  });
});
