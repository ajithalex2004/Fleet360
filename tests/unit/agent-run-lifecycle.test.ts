/**
 * Agent run lifecycle: one agent_runs row per run, and the async
 * POST /api/agents/run + GET ?run_id= polling pair.
 *
 * Before: the orchestrator inserted a row after every run, while
 * finance-anomaly / predictive-maintenance / staff-transport-planner also
 * inserted their own, so each of their runs was logged twice. And the UI
 * waited on the synchronous POST, which outlived the proxy's timeout for
 * finance-anomaly (~30 s) and surfaced as a 502 although the run completed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sql = vi.hoisted(() => ({ exec: [] as { q: string; args: unknown[] }[], rows: [] as unknown[] }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(async (q: string, ...args: unknown[]) => { sql.exec.push({ q, args }); return 1; }),
    $queryRawUnsafe: vi.fn(async () => sql.rows),
  },
}));
vi.mock('@/lib/agents/schema', () => ({ ensureAgentSchema: vi.fn(async () => undefined) }));
vi.mock('@/lib/agents/telemetry', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/telemetry')>()),
  updateDailyRoiMetrics: vi.fn(async () => undefined),
}));
const agentRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/agents/registry', () => ({ getAgent: vi.fn(async () => ({ run: agentRun })) }));
const afterFn = vi.hoisted(() => vi.fn());
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: afterFn }));

import { NextRequest } from 'next/server';
import { startRun } from '@/lib/agents/orchestrator';
import { policyService } from '@/lib/agents/governance';
import { GET as runStatus, POST as runPost } from '@/app/api/agents/run/route';
import type { AgentEvent } from '@/lib/agents/types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const headers = { 'content-type': 'application/json', 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN' };
const event: AgentEvent = { tenant_id: TENANT, agent_id: 'finance-anomaly', event_type: 'manual.trigger' };

beforeEach(() => {
  sql.exec = []; sql.rows = [];
  agentRun.mockReset();
  afterFn.mockReset();
  vi.spyOn(policyService, 'checkBudgetQuota').mockResolvedValue({ allowed: true } as never);
  vi.spyOn(policyService, 'getTenantPolicy').mockResolvedValue({ disabledAgents: [] } as never);
  agentRun.mockImplementation(async (e: AgentEvent) => ({
    agentId: e.agent_id, tenantId: e.tenant_id, eventType: e.event_type, status: 'COMPLETED',
    durationMs: 5, itemsProcessed: 10, actionsCreated: 8, output: { summary: {} },
  }));
});

const runInserts = () => sql.exec.filter((s) => s.q.includes('INSERT INTO agent_runs'));

describe('orchestrator startRun', () => {
  it('records RUNNING first and finalises the same row, giving the agent its run id', async () => {
    const run = await startRun(event);
    expect(run.kind).toBe('started');
    if (run.kind !== 'started') return;

    // RUNNING row exists before the agent finishes.
    expect(runInserts()).toHaveLength(1);
    expect(runInserts()[0].q).toContain("'RUNNING'");
    expect(runInserts()[0].args[0]).toBe(run.runId);

    await run.result;
    await run.settled;

    expect(agentRun).toHaveBeenCalledWith(expect.objectContaining({ run_id: run.runId }));
    const [, final] = runInserts();
    expect(runInserts()).toHaveLength(2);
    expect(final.q).toContain('ON CONFLICT (id) DO UPDATE');
    expect(final.args.at(-1)).toBe(run.runId);
    expect(final.args).toContain('COMPLETED');
  });

  it('records a failed agent run on the same row', async () => {
    agentRun.mockRejectedValue(new Error('boom'));
    const run = await startRun(event);
    if (run.kind !== 'started') throw new Error('expected started');
    expect((await run.result).status).toBe('FAILED');
    await run.settled;
    const final = runInserts()[1];
    expect(final.args.at(-1)).toBe(run.runId);
    expect(final.args).toContain('boom');
  });

  it('ignores a caller-supplied run_id so it cannot overwrite another run', async () => {
    const run = await startRun({ ...event, run_id: RUN_ID });
    if (run.kind !== 'started') throw new Error('expected started');
    await run.settled;
    expect(run.runId).not.toBe(RUN_ID);
    expect(runInserts().flatMap((s) => s.args)).not.toContain(RUN_ID);
  });

  it('records nothing when governance rejects the run', async () => {
    vi.spyOn(policyService, 'getTenantPolicy').mockResolvedValue({ disabledAgents: ['finance-anomaly'] } as never);
    const run = await startRun(event);
    expect(run.kind).toBe('rejected');
    expect(runInserts()).toHaveLength(0);
    expect(agentRun).not.toHaveBeenCalled();
  });
});

describe('POST /api/agents/run { async: true }', () => {
  it('answers 202 with the run id and keeps the run alive with after()', async () => {
    const res = await runPost(new NextRequest('http://localhost/api/agents/run', {
      method: 'POST', headers, body: JSON.stringify({ agent_id: 'finance-anomaly', async: true }),
    }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('RUNNING');
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(afterFn).toHaveBeenCalledTimes(1);
    await afterFn.mock.calls[0][0];
    expect(runInserts().every((s) => s.args.includes(body.runId))).toBe(true);
  });
});

describe('GET /api/agents/run?run_id=', () => {
  const get = (runId: string) => runStatus(new NextRequest(`http://localhost/api/agents/run?run_id=${runId}`, { headers }));

  it('rejects a run id that is not a UUID', async () => {
    expect((await get('nope')).status).toBe(400);
  });

  it('returns 404 for a run it cannot see', async () => {
    sql.rows = [];
    expect((await get(RUN_ID)).status).toBe(404);
  });

  it('returns the run in the synchronous response shape, scoped to the caller tenant', async () => {
    sql.rows = [{
      id: RUN_ID, agent_id: 'finance-anomaly', tenant_id: TENANT, event_type: 'manual.trigger', entity_id: null,
      status: 'COMPLETED', duration_ms: 27188, items_processed: 10, actions_created: 8,
      output: { summary: { totalAnomaliesFlagged: 8 } }, error_text: null,
    }];
    const res = await get(RUN_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      runId: RUN_ID, status: 'COMPLETED', itemsProcessed: 10, actionsCreated: 8,
      output: { summary: { totalAnomaliesFlagged: 8 } },
    });
    const { prisma } = await import('@/lib/prisma');
    expect(vi.mocked(prisma.$queryRawUnsafe).mock.calls.at(-1)?.slice(1)).toEqual([RUN_ID, TENANT]);
  });
});
