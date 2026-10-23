/**
 * Live-data agent actions go through the governance gate.
 *
 * predictive-maintenance, incident-triage and dispatch-optimiser used to
 * create work orders, raise incident severity and offer dispatch jobs
 * directly, bypassing the tenant AI policy. They now submit proposals: queued
 * for approval under the default ceiling (L3), executed only when the tenant
 * allows L4, blocked when the agent is disabled. Approving runs the action;
 * an action that no longer applies is marked EXPIRED and changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  sql: [] as string[],
  policy: { maxAutonomyLevel: 'L3', disabledAgents: [] as string[], circuitBreakerTriggered: false, requireHumanApprovalThresholdAed: 500 },
  pending: [] as Array<{ id: string }>,
  incidentSeverity: 'MEDIUM' as string | null,
  jobDispatchable: true,
  openWo: false,
  approvalRow: null as null | Record<string, unknown>,
  approvalUpdateCount: 1,
}));

vi.mock('@/lib/agents/schema', () => ({ ensureAgentSchema: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      st.sql.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('UPDATE agent_approvals') && sql.includes("status = 'PENDING'")) return st.approvalUpdateCount;
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      st.sql.push(q);
      if (q.includes('FROM tenant_ai_policies')) {
        return [{ tenantId: 't1', dailyBudgetAed: 200, monthlyBudgetAed: 5000, ...st.policy }];
      }
      if (q.includes('FROM agent_approvals') && q.includes("status = 'PENDING' LIMIT 1")) return st.pending;
      if (q.includes('gen_random_uuid()::text AS id')) return [{ id: 'appr-1' }];
      if (q.includes('FROM agent_approvals WHERE id')) return st.approvalRow ? [st.approvalRow] : [];
      if (q.includes('FROM operations.incidents')) return st.incidentSeverity === null ? [] : [{ severity: st.incidentSeverity }];
      if (q.startsWith('UPDATE dispatch_jobs')) return st.jobDispatchable ? [{ current_attempt: 2 }] : [];
      if (q.includes("requested_by = 'Predictive Maintenance Agent'")) return st.openWo ? [{ id: 'wo-old' }] : [];
      if (q.includes('COUNT(*) AS count FROM fleet_work_orders')) return [{ count: 41n }];
      if (q.startsWith('INSERT INTO fleet_work_orders')) return [{ id: 'wo-new' }];
      return [];
    }),
  },
}));

import { submitGatedAction } from '@/lib/agents/governance/gated-actions';
import { PolicyService, ApprovalNotPendingError } from '@/lib/agents/governance';

const escalation = {
  agentId: 'incident-triage',
  entityType: 'INCIDENT',
  entityId: 'inc-1',
  actionType: 'ESCALATE_INCIDENT_SEVERITY' as const,
  title: 'Escalate',
  description: 'd',
  payload: { incidentId: 'inc-1', fromSeverity: 'MEDIUM', toSeverity: 'CRITICAL' },
};

const wrote = (needle: string) => st.sql.some((s) => s.includes(needle));

beforeEach(() => {
  st.sql.length = 0;
  st.policy = { maxAutonomyLevel: 'L3', disabledAgents: [], circuitBreakerTriggered: false, requireHumanApprovalThresholdAed: 500 };
  st.pending = [];
  st.incidentSeverity = 'MEDIUM';
  st.jobDispatchable = true;
  st.openWo = false;
  st.approvalRow = null;
  st.approvalUpdateCount = 1;
});

describe('submitGatedAction', () => {
  it('queues the action for approval under the default L3 ceiling and changes nothing', async () => {
    const r = await submitGatedAction('t1', escalation);
    expect(r).toEqual({ outcome: 'QUEUED', approvalId: 'appr-1' });
    expect(wrote('INSERT INTO agent_approvals')).toBe(true);
    expect(wrote('UPDATE operations.incidents')).toBe(false);
  });

  it('does not queue a second proposal for the same entity', async () => {
    st.pending = [{ id: 'appr-0' }];
    expect(await submitGatedAction('t1', escalation)).toEqual({ outcome: 'ALREADY_QUEUED', approvalId: 'appr-0' });
    expect(wrote('INSERT INTO agent_approvals')).toBe(false);
  });

  it('blocks a disabled agent: no queue item, no change', async () => {
    st.policy.disabledAgents = ['incident-triage'];
    const r = await submitGatedAction('t1', escalation);
    expect(r.outcome).toBe('BLOCKED');
    expect(wrote('INSERT INTO agent_approvals')).toBe(false);
    expect(wrote('UPDATE operations.incidents')).toBe(false);
  });

  it('executes immediately only when the tenant allows L4', async () => {
    st.policy.maxAutonomyLevel = 'L4';
    const r = await submitGatedAction('t1', escalation);
    expect(r.outcome).toBe('EXECUTED');
    expect(wrote('UPDATE operations.incidents SET severity')).toBe(true);
    expect(wrote('INSERT INTO agent_approvals')).toBe(false);
  });
});

describe('executors re-check that the action still applies', () => {
  beforeEach(() => { st.policy.maxAutonomyLevel = 'L4'; });

  it('does not lower or repeat an incident escalation', async () => {
    st.incidentSeverity = 'CRITICAL';
    const r = await submitGatedAction('t1', escalation);
    expect(r).toMatchObject({ outcome: 'EXECUTED', result: { ok: false, stale: true } });
    expect(wrote('UPDATE operations.incidents SET severity')).toBe(false);
  });

  it('offers a dispatch job only while it still waits for a driver', async () => {
    st.jobDispatchable = false;
    const r = await submitGatedAction('t1', {
      agentId: 'dispatch-optimiser', entityType: 'DISPATCH_JOB', entityId: 'job-1',
      actionType: 'OFFER_DISPATCH_JOB', title: 't', description: 'd',
      payload: { jobId: 'job-1', driverId: 'd1', vehicleId: 'v1', score: 0.9 },
    });
    expect(r).toMatchObject({ result: { ok: false, stale: true } });
    expect(wrote('INSERT INTO dispatch_attempts')).toBe(false);
  });

  it('creates a numbered work order under a per-tenant lock, once per vehicle', async () => {
    const proposal = {
      agentId: 'predictive-maintenance', entityType: 'VEHICLE', entityId: 'veh-1',
      actionType: 'CREATE_PREDICTIVE_WORK_ORDER' as const, title: 't', description: 'd',
      payload: { vehicleId: 'veh-1', description: 'd', priority: 'CRITICAL' },
    };
    const r = await submitGatedAction('t1', proposal);
    expect(r).toMatchObject({ result: { ok: true, detail: { workOrderId: 'wo-new', woNumber: 'FWO-000042' } } });
    expect(wrote('pg_advisory_xact_lock')).toBe(true);

    st.sql.length = 0;
    st.openWo = true;
    expect(await submitGatedAction('t1', proposal)).toMatchObject({ result: { ok: false, stale: true } });
    expect(wrote('INSERT INTO fleet_work_orders')).toBe(false);
  });
});

describe('reviewApprovalItem', () => {
  const row = (status: string) => ({
    id: 'appr-1', tenantId: 't1', agentId: 'incident-triage', entityType: 'INCIDENT', entityId: 'inc-1',
    actionType: 'ESCALATE_INCIDENT_SEVERITY', title: 't', description: 'd', financialImpactAed: 0,
    proposedPayload: escalation.payload, status, requestedAutonomy: 'L3', createdAt: '',
  });

  it('runs the approved action', async () => {
    st.approvalRow = row('APPROVED');
    const item = await new PolicyService().reviewApprovalItem('appr-1', 'u1', 'APPROVED', undefined, 't1');
    expect(item.execution).toMatchObject({ executed: true, to: 'CRITICAL' });
    expect(wrote('UPDATE operations.incidents SET severity')).toBe(true);
  });

  it('does not run a rejected action', async () => {
    st.approvalRow = row('REJECTED');
    await new PolicyService().reviewApprovalItem('appr-1', 'u1', 'REJECTED', undefined, 't1');
    expect(wrote('UPDATE operations.incidents')).toBe(false);
  });

  it('marks a stale approval EXPIRED instead of applying it', async () => {
    st.approvalRow = row('APPROVED');
    st.incidentSeverity = 'CRITICAL';
    const item = await new PolicyService().reviewApprovalItem('appr-1', 'u1', 'APPROVED', undefined, 't1');
    expect(item.execution).toMatchObject({ executed: false });
    expect(wrote("SET status = 'EXPIRED'")).toBe(true);
  });

  it('refuses to re-decide an item that is not pending (or of another tenant)', async () => {
    st.approvalUpdateCount = 0;
    await expect(new PolicyService().reviewApprovalItem('appr-1', 'u1', 'APPROVED', undefined, 't2'))
      .rejects.toBeInstanceOf(ApprovalNotPendingError);
    expect(wrote('UPDATE operations.incidents')).toBe(false);
  });
});
