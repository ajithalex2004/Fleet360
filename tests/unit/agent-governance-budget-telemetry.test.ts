import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/agents/registry', () => ({
  getAgent: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { PolicyService, policyService, type TenantPolicy } from '@/lib/agents/governance';
import { runGoverned } from '@/lib/agents/orchestrator';
import { updateDailyRoiMetrics } from '@/lib/agents/telemetry';

const basePolicy: TenantPolicy = {
  tenantId: 't1',
  maxAutonomyLevel: 'L3',
  dailyBudgetAed: 100,
  monthlyBudgetAed: 1000,
  requireHumanApprovalThresholdAed: 500,
  disabledAgents: [],
  circuitBreakerTriggered: false,
};

const executed = () => vi.mocked(prisma.$executeRawUnsafe).mock.calls.map((c) => String(c[0]));

describe('checkBudgetQuota (spend-based, nothing persisted)', () => {
  let service: PolicyService;
  beforeEach(() => {
    vi.clearAllMocks();
    service = new PolicyService();
  });

  it('refuses over the daily cap without writing a breaker flag', async () => {
    vi.spyOn(service, 'getTenantPolicy').mockResolvedValueOnce(basePolicy);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ todayCostAed: 105, monthCostAed: 300 }]);

    const quota = await service.checkBudgetQuota('t1', 1);

    expect(quota.allowed).toBe(false);
    expect(quota.reason).toContain('Daily budget exceeded');
    expect(executed().some((q) => q.includes('tenant_ai_policies'))).toBe(false);
  });

  it('refuses over the monthly cap even when today is under', async () => {
    vi.spyOn(service, 'getTenantPolicy').mockResolvedValueOnce(basePolicy);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ todayCostAed: 10, monthCostAed: 999.99 }]);

    const quota = await service.checkBudgetQuota('t1', 1);

    expect(quota.allowed).toBe(false);
    expect(quota.reason).toContain('Monthly budget exceeded');
  });

  it('allows a run under both caps', async () => {
    vi.spyOn(service, 'getTenantPolicy').mockResolvedValueOnce(basePolicy);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ todayCostAed: 10, monthCostAed: 300 }]);

    expect(await service.checkBudgetQuota('t1', 1)).toEqual({ allowed: true });
  });

  it('refuses when spend cannot be read', async () => {
    vi.spyOn(service, 'getTenantPolicy').mockResolvedValueOnce(basePolicy);
    vi.mocked(prisma.$queryRawUnsafe).mockRejectedValueOnce(new Error('connection reset'));

    const quota = await service.checkBudgetQuota('t1', 1);

    expect(quota.allowed).toBe(false);
    expect(quota.reason).toContain('could not be checked');
  });

  it('refuses while the manual circuit breaker is on, before reading spend', async () => {
    vi.spyOn(service, 'getTenantPolicy').mockResolvedValueOnce({ ...basePolicy, circuitBreakerTriggered: true });

    const quota = await service.checkBudgetQuota('t1', 1);

    expect(quota.allowed).toBe(false);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('createApprovalItem dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts against the one-pending-item index', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValueOnce([{ id: 'appr-1' }]);

    const item = await new PolicyService().createApprovalItem('t1', {
      agentId: 'preventive-maintenance',
      entityType: 'VEHICLE',
      entityId: 'veh-1',
      actionType: 'SCHEDULE_PM_SLOT',
      title: 'Schedule PM',
      description: 'Due soon',
    });

    expect(item.id).toBe('appr-1');
    const sql = String(vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0]);
    expect(sql).toContain("ON CONFLICT (tenant_id, agent_id, action_type, entity_id) WHERE status = 'PENDING'");
    expect(sql).toContain('DO UPDATE SET');
  });
});

describe('updateDailyRoiMetrics acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps an accepted count and recomputes the rate on every run', async () => {
    await updateDailyRoiMetrics({ tenantId: 't1', agentId: 'incident-triage', wasAccepted: false });

    const [sql, ...params] = vi.mocked(prisma.$executeRawUnsafe).mock.calls[0];
    expect(String(sql)).toContain('accepted_executions = agent_roi_metrics.accepted_executions + EXCLUDED.accepted_executions');
    expect(String(sql)).toContain('acceptance_rate_pct = ROUND(');
    expect(params[5]).toBe(0);
  });
});

describe('runGoverned (co-pilot / direct calls)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  const event = { tenant_id: 't1', agent_id: 'quotation-copilot', event_type: 'leasing.quotation_copilot_requested' } as const;

  it('does not run the call when governance refuses', async () => {
    vi.spyOn(policyService, 'checkBudgetQuota').mockResolvedValueOnce({ allowed: false, reason: 'Daily budget exceeded' });
    const call = vi.fn();

    const outcome = await runGoverned(event, call, () => { throw new Error('unused'); });

    expect(outcome).toEqual({ ok: false, reason: 'Daily budget exceeded' });
    expect(call).not.toHaveBeenCalled();
  });

  it('does not run a disabled agent', async () => {
    vi.spyOn(policyService, 'checkBudgetQuota').mockResolvedValueOnce({ allowed: true });
    vi.spyOn(policyService, 'getTenantPolicy').mockResolvedValueOnce({ ...basePolicy, disabledAgents: ['quotation-copilot'] });
    const call = vi.fn();

    const outcome = await runGoverned(event, call, () => { throw new Error('unused'); });

    expect(outcome.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it('runs an allowed call and records it with its tokens, not counting it as accepted', async () => {
    vi.spyOn(policyService, 'checkBudgetQuota').mockResolvedValueOnce({ allowed: true });
    vi.spyOn(policyService, 'getTenantPolicy').mockResolvedValueOnce(basePolicy);

    const outcome = await runGoverned(
      { ...event, payload: { brief: 'x'.repeat(5000) } },
      async () => 'suggestion',
      (value, durationMs) => ({
        agentId: 'quotation-copilot', tenantId: 't1', eventType: event.event_type,
        status: 'COMPLETED', durationMs, itemsProcessed: 1, actionsCreated: 0, output: { value },
        telemetry: { modelAlias: 'STANDARD_REASONING', modelProvider: 'openai', inputTokens: 1000, outputTokens: 200 },
      }),
    );

    expect(outcome).toEqual({ ok: true, value: 'suggestion' });
    const runInsert = vi.mocked(prisma.$executeRawUnsafe).mock.calls.find((c) => String(c[0]).includes('INSERT INTO agent_runs'));
    expect(runInsert).toBeDefined();
    // $5 = input (long strings summarised), $14/$15 = input/output tokens
    expect(runInsert![5]).toContain('[omitted: 5000 chars]');
    expect(runInsert![14]).toBe(1000);
    expect(runInsert![15]).toBe(200);

    const roi = vi.mocked(prisma.$executeRawUnsafe).mock.calls.find((c) => String(c[0]).includes('INSERT INTO agent_roi_metrics'));
    expect(roi![6]).toBe(0); // COMPLETED without human feedback is not "accepted"
  });
});
