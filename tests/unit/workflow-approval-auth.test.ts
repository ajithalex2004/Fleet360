/**
 * tests/unit/workflow-approval-auth.test.ts
 *
 * Who may see and act on workflow approvals.
 *
 *   GET  /api/my-approvals                   the signed-in user's own approvals
 *   POST /api/workflow/instances/[id]/action  approve / reject the current step
 *
 * Covered:
 *  - the inbox ignores an `email` query parameter and uses the session user,
 *    in the caller's tenant
 *  - only the step's assignee (by email or role) or a tenant admin may act;
 *    the action is recorded under the session user, never a body email
 *  - an instance the caller's tenant cannot see is a 404
 *  - the step acted on is the instance's current one, not a body stepOrder
 *  - a step actioned concurrently answers 409
 *
 * The engine (workflow-db) and the user lookup are replaced by mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  me: { email: 'approver@a.test', name: 'Ann' } as { email: string; name?: string } | null,
  instance: null as null | Record<string, unknown>,
  historyCalls: [] as unknown[][],
  advanceCalls: [] as unknown[][],
  pendingCalls: [] as unknown[][],
  advanceResult: { status: 'IN_PROGRESS' } as { status: string },
  roleCodes: [] as string[],
}));

vi.mock('@/lib/session-user', () => ({ sessionUser: async () => state.me }));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: <T>(h: T) => h }));
vi.mock('@/lib/workflow-db', () => ({
  getMyPendingApprovals: async (...args: unknown[]) => { state.pendingCalls.push(args); return [{ stepInstanceId: 'si1' }]; },
  getEscalatedToMe: async () => [],
  getWorkflowInstanceWithHistory: async (...args: unknown[]) => { state.historyCalls.push(args); return state.instance; },
  advanceWorkflow: async (...args: unknown[]) => { state.advanceCalls.push(args); return state.advanceResult; },
  getUserRoleCodes: async () => state.roleCodes,
  parseEmailList: (v: string | null) => (v ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
}));

import { GET as myApprovals } from '@/app/api/my-approvals/route';
import { POST as act } from '@/app/api/workflow/instances/[id]/action/route';
import { NextRequest } from 'next/server';

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const headers = (role = 'LEASING_OPERATOR') => ({
  'x-user-id': 'u1', 'x-tenant-id': TENANT_A, 'x-user-role': role,
});
const ctx = { params: Promise.resolve({ id: 'inst-1' }) };
const post = (body: Record<string, unknown>, role?: string) =>
  act(new NextRequest('http://x/api/workflow/instances/inst-1/action', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers(role) }, body: JSON.stringify(body),
  }), ctx);

beforeEach(() => {
  state.me = { email: 'approver@a.test', name: 'Ann' };
  state.instance = {
    id: 'inst-1', status: 'IN_PROGRESS', currentStepOrder: 2,
    steps: [
      { stepOrder: 1, status: 'APPROVED', assignedToEmail: 'first@a.test', assigneeRoleCode: null },
      { stepOrder: 2, status: 'PENDING', assignedToEmail: 'Approver@A.test', assigneeType: 'ROLE', assigneeRoleCode: 'FINANCE_MANAGER', multiApproverEmails: null },
    ],
  };
  state.historyCalls = []; state.advanceCalls = []; state.pendingCalls = [];
  state.advanceResult = { status: 'IN_PROGRESS' };
  state.roleCodes = [];
});

describe('my approvals', () => {
  it('uses the session user and tenant, ignoring an email parameter', async () => {
    const res = await myApprovals(new NextRequest('http://x/api/my-approvals?email=victim@b.test', { headers: headers() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ email: 'approver@a.test', approvals: [{ stepInstanceId: 'si1' }], escalated: [] });
    expect(body.approvals).toHaveLength(1);
    expect(state.pendingCalls).toEqual([[TENANT_A, 'approver@a.test', ['LEASING_OPERATOR']]]);
  });
});

describe('approve / reject', () => {
  it('lets the assignee act on the current step, recorded under the session user', async () => {
    const res = await post({ action: 'APPROVE', comments: 'ok', actionedByEmail: 'someone@else', currentStepOrder: 1 });
    expect(res.status).toBe(200);
    expect(state.historyCalls[0]).toEqual(['inst-1', TENANT_A]);
    expect(state.advanceCalls).toEqual([[TENANT_A, 'inst-1', 2, 'APPROVE', 'ok', 'approver@a.test', { override: false }]]);
  });

  it('lets a holder of the step role act, by session role or tenant membership', async () => {
    state.me = { email: 'fm@a.test' };
    expect((await post({ action: 'REJECT' }, 'FINANCE_MANAGER')).status).toBe(200);
    state.roleCodes = ['finance_manager'];
    expect((await post({ action: 'REJECT' })).status).toBe(200);
  });

  it('lets any address listed on a multi-user step act', async () => {
    const steps = (state.instance as { steps: Array<Record<string, unknown>> }).steps;
    Object.assign(steps[1], { assigneeType: 'MULTI_USER', assignedToEmail: null, assigneeRoleCode: null, multiApproverEmails: 'x@a.test; Listed@a.test' });
    state.me = { email: 'listed@a.test' };
    expect((await post({ action: 'APPROVE' })).status).toBe(200);
    state.me = { email: 'notlisted@a.test' };
    expect((await post({ action: 'APPROVE' })).status).toBe(403);
  });

  it('refuses anyone else, but lets a tenant admin act', async () => {
    state.me = { email: 'other@a.test' };
    const res = await post({ action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(state.advanceCalls).toHaveLength(0);
    expect((await post({ action: 'APPROVE' }, 'TENANT_ADMIN')).status).toBe(200);
    expect(state.advanceCalls[0][5]).toBe('other@a.test');
    // An administrator who is not the level's approver decides it for them.
    expect(state.advanceCalls[0][6]).toEqual({ override: true });
  });

  it('on an all-approvers level, counts only the approvers it was sent to', async () => {
    const steps = (state.instance as { steps: Array<Record<string, unknown>> }).steps;
    Object.assign(steps[1], { requireAllApprovers: true, approverEmails: ['fm1@a.test', 'fm2@a.test'], assignedToEmail: 'fm1@a.test' });
    state.me = { email: 'fm3@a.test' };
    expect((await post({ action: 'APPROVE' }, 'FINANCE_MANAGER')).status).toBe(403);
    state.me = { email: 'FM2@a.test' };
    expect((await post({ action: 'APPROVE' })).status).toBe(200);
    expect(state.advanceCalls[0][6]).toEqual({ override: false });
  });

  it('answers 409 when the approver already decided a level still waiting for others', async () => {
    state.advanceResult = { status: 'ALREADY_DECIDED' };
    expect((await post({ action: 'APPROVE' })).status).toBe(409);
  });

  it('answers 404 for an instance the tenant cannot see', async () => {
    state.instance = null;
    expect((await post({ action: 'APPROVE' })).status).toBe(404);
  });

  it('answers 409 when the step was actioned meanwhile', async () => {
    state.advanceResult = { status: 'NOT_PENDING' };
    expect((await post({ action: 'APPROVE' })).status).toBe(409);
  });

  it('answers 401 without a known user and 400 for an unknown action', async () => {
    expect((await post({ action: 'MAYBE' })).status).toBe(400);
    state.me = null;
    expect((await post({ action: 'APPROVE' })).status).toBe(401);
  });
});
