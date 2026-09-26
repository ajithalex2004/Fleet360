/**
 * /api/agents/ecosystem loads everything in ONE statement (4 round trips with
 * BEGIN / set_config / COMMIT instead of 11), scoped to the caller's tenant,
 * and logs a failure instead of silently zeroing the numbers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ row: null as unknown, fail: null as Error | null, calls: [] as unknown[][], tenants: [] as string[] }));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/agents/schema', () => ({ ensureAgentSchema: vi.fn(async () => undefined) }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: vi.fn(async (_p: unknown, tenantId: string, fn: (tx: unknown) => unknown) => {
    db.tenants.push(tenantId);
    return fn({
      $queryRawUnsafe: vi.fn(async (...args: unknown[]) => {
        db.calls.push(args);
        if (db.fail) throw db.fail;
        return [db.row];
      }),
    });
  }),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/agents/ecosystem/route';

const req = () => new NextRequest('http://localhost/api/agents/ecosystem', {
  headers: { 'x-tenant-id': 'tenant-a', 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN' },
});

const row = {
  pending_routes: [{ id: 'r1', route_name: 'Route 1', route_number: 'RT-1', distance_saved_km: 4.5, distance_saved_pct: 2, matched_stop_count: 8, created_at: '2026-09-26 06:00:00+00' }],
  coach_pending: 2,
  feed: [{ agent_id: 'finance-anomaly', event_type: 'manual.trigger', status: 'COMPLETED', items_processed: 10, actions_created: 8, created_at: '2026-09-26 06:12:55+00', duration_ms: 15671 }],
  actions_today: 8,
  route_km: 12.345,
  anomalies: 8,
  last_runs: [{ agent_id: 'finance-anomaly', status: 'COMPLETED', created_at: '2026-09-26 06:12:55+00', duration_ms: 15671, items_processed: 10, actions_created: 8 }],
  stats: [
    { agent_id: 'finance-anomaly', runs: 3, items_processed: 30, actions_created: 24, avg_ms: 20000 },
    { agent_id: 'whatsapp-agent', runs: 4, items_processed: 4, actions_created: 3, avg_ms: 900 },
    { agent_id: 'ops-assistant', runs: 2, items_processed: 7, actions_created: 5, avg_ms: 1200 },
  ],
};

beforeEach(() => { db.row = row; db.fail = null; db.calls = []; db.tenants = []; });

describe('GET /api/agents/ecosystem', () => {
  it('runs one statement in the caller\'s tenant and maps it to the hub response', async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(db.tenants).toEqual(['tenant-a']);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0][1]).toBe('tenant-a');
    expect(db.calls[0][3]).toEqual(expect.arrayContaining(['whatsapp-agent', 'ops-assistant', 'finance-anomaly']));

    expect(body.commandStrip).toEqual({ activeAgents: 8, actionsToday: 8, routeKmSaved7d: 12.3, anomaliesFlagged7d: 8, pendingApprovals: 3 });
    const fa = body.batchAgents.find((a: { id: string }) => a.id === 'finance-anomaly');
    expect(fa.lastRun).toEqual({ status: 'COMPLETED', created_at: '2026-09-26 06:12:55+00', duration_ms: 15671, items_processed: 10, actions_created: 8 });
    expect(fa.stats7d).toEqual({ runs: 3, items_processed: 30, actions_created: 24 });
    const ro = body.batchAgents.find((a: { id: string }) => a.id === 'route-optimiser');
    expect(ro).toMatchObject({ lastRun: null, stats7d: { runs: 0, items_processed: 0, actions_created: 0 }, pendingCount: 1 });
    expect(body.convAgents[0].stats7d).toEqual({ sessions: 4, resolved: 3, resolvedRate: 75, avgResponseMs: 900 });
    expect(body.convAgents[1].stats7d).toEqual({ sessions: 2, total_queries: 7, tools_invoked: 5, avg_ms: 1200 });
    expect(body.activityFeed).toEqual(row.feed);
  });

  it('logs a failed statement and returns the empty structure', async () => {
    db.fail = new Error('permission denied for table driver_coaching_plans');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.commandStrip.actionsToday).toBe(0);
    expect(body.batchAgents).toHaveLength(8);
    expect(spy).toHaveBeenCalledWith('[agents/ecosystem] failed to load ecosystem stats:', db.fail);
    spy.mockRestore();
  });
});
