/**
 * tests/unit/maintenance-approval-rules.test.ts
 *
 * Maintenance estimate approval rules:
 *  - rule input checks; the rule for a cost (narrowest band wins); who may
 *    approve; auto-approve
 *  - only tenant admins change rules; rules are saved for the session tenant
 *  - the estimate decision: approving needs a role the rule names, records
 *    the chosen quotation's amount and garage, rejects the other
 *    quotations; rejecting sends the request back to Under Estimation
 *  - the request update route applies the same rules, so they can't be
 *    bypassed, and auto-approves on submission
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = 'tenant-a';

const rec = vi.hoisted(() => ({
  rules: [] as Array<object>,
  roleCodes: [] as string[],
  mr: null as null | Record<string, unknown>,
  quotations: [] as Array<Record<string, unknown>>,
  creates: [] as Array<{ model: string; data: Record<string, unknown> }>,
  updates: [] as Array<{ model: string; where: Record<string, unknown>; data: Record<string, unknown> }>,
  published: [] as unknown[],
}));

const tx = vi.hoisted(() => {
  const updateMany = (model: string) => async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    rec.updates.push({ model, where, data });
    return { count: 1 };
  };
  const create = (model: string) => async ({ data }: { data: Record<string, unknown> }) => {
    rec.creates.push({ model, data });
    return { id: `${model}-1`, ...data };
  };
  return {
    // The estimate decision's atomic status change (claimPending).
    $executeRawUnsafe: async (_sql: string, id: string, tenantId: string, status: string) => {
      rec.updates.push({ model: 'request', where: { id, tenantId }, data: { status } });
      return 1;
    },
    maintenanceApprovalRule: {
      findMany: async () => rec.rules,
      findFirst: async ({ where }: { where: { id: string } }) => (rec.rules as Array<{ id: string }>).find((r) => r.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        rec.creates.push({ model: 'rule', data });
        return { id: 'rule-new', minCost: 0, maxCost: null, requiredRoles: [], autoApprove: false, isActive: true, ...data };
      },
      updateMany: updateMany('rule'),
    },
    userTenant: { findMany: async () => rec.roleCodes.map((code) => ({ role: { code } })) },
    maintenanceRequest: {
      findFirst: async () => rec.mr,
      updateMany: updateMany('request'),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        rec.updates.push({ model: 'request', where: {}, data });
        return { id: 'mr1', ...rec.mr, ...data };
      },
    },
    quotation: { findMany: async () => rec.quotations, updateMany: updateMany('quotation') },
    garage: { findFirst: async () => ({ name: 'Autopro' }) },
    statusHistory: { create: create('history') },
    attachment: { findMany: async () => [] },
  };
});
vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({ withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx) }));
vi.mock('@/lib/rls-scope', () => ({ runAsTenant: async <T>(_t: string, fn: () => Promise<T>) => fn() }));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: <T>(h: T) => h }));

// No approval workflow configured: the module decides approvals itself (the
// workflow path is covered by tests/unit/workflow-*.test.ts).
vi.mock('@/lib/workflow/approvals', () => ({
  approvalGate: async () => null,
  approvalInProgress: async () => null,
  withApprovalStart: async (res: unknown) => res,
  withdrawApproval: async () => {},
}));
vi.mock('@/lib/workflow-db', async (orig) => ({ ...(await orig<Record<string, unknown>>()), hasTenantWorkflow: async () => false }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));
vi.mock('@/lib/maintenance/publish-event', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const stub = async (...args: unknown[]) => { rec.published.push(args); };
  return Object.fromEntries(Object.keys(actual).map((k) => [k, stub]));
});

import { NextRequest } from 'next/server';
import { autoApproveRule, checkApprover, parseApprovalRuleInput, ruleForCost, type ApprovalRuleRow } from '@/lib/maintenance/approval-rules';
import * as rulesApi from '@/app/api/maintenance/approval-rules/route';
import * as ruleApi from '@/app/api/maintenance/approval-rules/[id]/route';
import * as decision from '@/app/api/maintenance-requests/[id]/estimate-decision/route';
import * as request from '@/app/api/maintenance-requests/[id]/route';

const rule = (o: Partial<ApprovalRuleRow>): ApprovalRuleRow => ({
  id: 'r', name: 'Rule', minCost: 0, maxCost: null, requiredRoles: [], autoApprove: false, isActive: true, ...o,
});
const RULES = [
  rule({ id: 'low', name: 'Small repairs', minCost: 0, maxCost: 1000, autoApprove: true }),
  rule({ id: 'mid', name: 'Medium repairs', minCost: 1000.01, maxCost: 5000, requiredRoles: ['FLEET_MANAGER'] }),
  rule({ id: 'high', name: 'Large repairs', minCost: 5000.01, requiredRoles: ['FINANCE_MANAGER', 'TENANT_ADMIN'] }),
];

const call = (role: string, path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/${path}`, {
    method,
    headers: { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': role, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  rec.rules = []; rec.roleCodes = []; rec.creates = []; rec.updates = []; rec.published = [];
  rec.mr = { id: 'mr1', status: 'Pending Estimation Approval', vehicleId: 'v1', estimatedCost: null };
  rec.quotations = [
    { id: 'q1', grandTotal: 3200, totalCost: 3000, garageId: 'g1' },
    { id: 'q2', grandTotal: 4100, totalCost: 4000, garageId: 'g2' },
  ];
});

describe('approval rule logic', () => {
  it('finds the rule for a cost, narrowest band first', () => {
    expect(ruleForCost(RULES, 800)?.id).toBe('low');
    expect(ruleForCost(RULES, 3200)?.id).toBe('mid');
    expect(ruleForCost(RULES, 90_000)?.id).toBe('high');
    expect(ruleForCost([...RULES, rule({ id: 'narrow', minCost: 3000, maxCost: 3500 })], 3200)?.id).toBe('narrow');
    expect(ruleForCost(RULES.map((r) => ({ ...r, isActive: false })), 3200)).toBeNull();
  });

  it('allows an approver holding one of the named roles, and anyone when no rule applies', () => {
    expect(checkApprover(RULES, 3200, ['FLEET_MANAGER']).ok).toBe(true);
    expect(checkApprover(RULES, 90_000, ['TENANT_ADMIN']).ok).toBe(true);
    const denied = checkApprover(RULES, 3200, ['DRIVER']);
    expect(denied).toMatchObject({ ok: false, error: 'Estimates in "Medium repairs" must be approved by: FLEET_MANAGER' });
    expect(checkApprover([], 3200, []).ok).toBe(true);
    expect(autoApproveRule(RULES, 800)?.id).toBe('low');
    expect(autoApproveRule(RULES, 3200)).toBeNull();
  });

  it('checks rule input', () => {
    expect(parseApprovalRuleInput({ name: ' Mid ', minCost: '1000', maxCost: '', requiredRoles: ['FLEET_MANAGER'] }, false))
      .toEqual({ ok: true, data: { name: 'Mid', minCost: 1000, maxCost: null, requiredRoles: ['FLEET_MANAGER'], autoApprove: false, isActive: true } });
    expect(parseApprovalRuleInput({ name: 'x', minCost: 500, maxCost: 100 }, false).ok).toBe(false);
    expect(parseApprovalRuleInput({ name: 'x', requiredRoles: ['drop table'] }, false).ok).toBe(false);
    expect(parseApprovalRuleInput({ name: 'x', autoApprove: true, requiredRoles: ['FLEET_MANAGER'] }, false).ok).toBe(false);
    expect(parseApprovalRuleInput({ tenantId: 'other', isActive: false }, true)).toEqual({ ok: true, data: { isActive: false } });
  });
});

describe('rules API', () => {
  it('lets only tenant admins change rules', async () => {
    const res = await rulesApi.POST(call('FLEET_MANAGER', 'maintenance/approval-rules', 'POST', { name: 'x' }));
    expect(res.status).toBe(403);
    const del = await ruleApi.DELETE(call('DRIVER', 'x', 'DELETE'), params('r'));
    expect(del.status).toBe(403);
    expect(rec.creates).toHaveLength(0);
  });

  it('saves a rule for the session tenant', async () => {
    const res = await rulesApi.POST(call('TENANT_ADMIN', 'maintenance/approval-rules', 'POST', { name: 'Mid', minCost: 1000, maxCost: 5000, requiredRoles: ['FLEET_MANAGER'], tenantId: 'other' }));
    expect(res.status).toBe(201);
    expect(rec.creates[0].data).toMatchObject({ tenantId: TENANT, name: 'Mid', requiredRoles: ['FLEET_MANAGER'], createdBy: 'u1' });
  });

  it('rechecks the merged band on update', async () => {
    rec.rules = [{ ...RULES[1], minCost: 1000, maxCost: 5000 }];
    const res = await ruleApi.PATCH(call('TENANT_ADMIN', 'x', 'PATCH', { maxCost: 500 }), params('mid'));
    expect(res.status).toBe(400);
  });
});

describe('estimate decision', () => {
  it('approves with the chosen quotation when the approver holds a named role', async () => {
    rec.rules = RULES;
    rec.roleCodes = ['FLEET_MANAGER'];
    const res = await decision.POST(call('FLEET_MANAGER', 'x', 'POST', { action: 'approve', quotationId: 'q1', comments: 'Go ahead' }), params('mr1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'Estimation Approved', amount: 3200, rule: 'Medium repairs' });
    // The status moves first, atomically (only from Pending Estimation Approval).
    expect(rec.updates[0]).toMatchObject({ model: 'request', data: { status: 'Estimation Approved' } });
    const mrUpdate = rec.updates.find((u) => u.model === 'request' && u.data.estimatedCost !== undefined)!;
    expect(mrUpdate.data).toMatchObject({ estimatedCost: 3200, garageId: 'g1' });
    expect(rec.updates.find((u) => u.model === 'request' && u.data.workOrderNo)?.data.workOrderNo).toMatch(/^WO-\d{2}-\d{4}-MR1$/);
    expect(JSON.parse(mrUpdate.data.estimateApproval as string)).toMatchObject({ quotationId: 'q1', approvedBy: 'u1', rule: { name: 'Medium repairs' } });
    expect(rec.updates.filter((u) => u.model === 'quotation').map((u) => u.data.status)).toEqual(['REJECTED', 'APPROVED']);
    expect(rec.creates.find((c) => c.model === 'history')?.data.note).toContain('under rule "Medium repairs"');
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.published).toHaveLength(1);
  });

  it('refuses an approver without a named role, changing nothing', async () => {
    rec.rules = RULES;
    rec.roleCodes = ['DRIVER'];
    const res = await decision.POST(call('DRIVER', 'x', 'POST', { action: 'approve', quotationId: 'q2' }), params('mr1'));
    expect(res.status).toBe(403);
    expect(rec.updates).toHaveLength(0);
  });

  it('only decides requests pending approval, on their own quotations', async () => {
    const other = await decision.POST(call('TENANT_ADMIN', 'x', 'POST', { action: 'approve', quotationId: 'q-other' }), params('mr1'));
    expect(other.status).toBe(400);
    rec.mr = { ...rec.mr, status: 'Under Maintenance' };
    const late = await decision.POST(call('TENANT_ADMIN', 'x', 'POST', { action: 'approve', quotationId: 'q1' }), params('mr1'));
    expect(late.status).toBe(409);
  });

  it('rejects all quotations and sends the request back with the reason', async () => {
    const res = await decision.POST(call('FLEET_MANAGER', 'x', 'POST', { action: 'reject', reason: 'Too expensive' }), params('mr1'));
    expect(res.status).toBe(200);
    expect(rec.updates.map((u) => [u.model, u.data.status])).toEqual([['request', 'Under Estimation'], ['quotation', 'REJECTED']]);
    expect(rec.creates.find((c) => c.model === 'history')?.data.note).toBe('Estimates rejected: Too expensive');
  });
});

describe('request update route applies the same rules', () => {
  it('refuses setting Estimation Approved without a named role', async () => {
    rec.rules = RULES;
    rec.mr = { status: 'Pending Estimation Approval', estimatedCost: 3200 };
    const res = await request.PATCH(call('DRIVER', 'x', 'PATCH', { status: 'Estimation Approved' }), params('mr1'));
    expect(res.status).toBe(403);
    expect(rec.updates).toHaveLength(0);
  });

  it('auto-approves an estimate submitted inside an auto-approve band', async () => {
    rec.rules = RULES;
    rec.mr = { status: 'Under Estimation', estimatedCost: null };
    rec.quotations = []; // an estimate typed in, no garage quotations
    const res = await request.PATCH(call('FLEET_MANAGER', 'x', 'PATCH', { status: 'Pending Estimation Approval', estimatedCost: 800 }), params('mr1'));
    expect(res.status).toBe(200);
    expect(rec.updates[0].data.status).toBe('Estimation Approved');
    expect(rec.creates.find((c) => c.model === 'history')?.data).toMatchObject({ status: 'Estimation Approved', note: 'Auto-approved under rule "Small repairs"' });
  });

  it('leaves approval unchanged when the tenant has no rules', async () => {
    rec.mr = { status: 'Pending Estimation Approval', estimatedCost: 90_000 };
    const res = await request.PATCH(call('DRIVER', 'x', 'PATCH', { status: 'Estimation Approved' }), params('mr1'));
    expect(res.status).toBe(200);
  });
});

describe('creates use the signed-in tenant', () => {
  // `tenantId: ''` was left in several create routes (quotations, drivers,
  // alerts, service requests, alert rules): row level security refuses it,
  // so every create failed. Demo seeders under admin/seed are excluded.
  it('no API route writes a blank tenant', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (!p.includes(join('admin', 'seed'))) walk(p); continue; }
        if (name === 'route.ts' && /tenantId:\s*''/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk(join(process.cwd(), 'src/app/api'));
    expect(offenders).toEqual([]);
  });
});

describe('before the rules table exists', () => {
  it('treats a missing table as no rules, so approvals keep working', async () => {
    const { loadApprovalRules } = await import('@/lib/maintenance/approval-rules-db');
    const missing = { maintenanceApprovalRule: { findMany: async () => { throw Object.assign(new Error('The table `public.maintenance_approval_rules` does not exist in the current database.'), { code: 'P2021' }); } } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(loadApprovalRules(missing as never, 'tenant-a')).resolves.toEqual([]);
    warn.mockRestore();
  });
});

describe('what counts as approving an estimate', () => {
  it('is any move from before approval to approved or later', async () => {
    const { approvesEstimate } = await import('@/lib/maintenance/approval-rules');
    expect(approvesEstimate('Pending Estimation Approval', 'Estimation Approved')).toBe(true);
    // The request page's approve goes straight to Under Maintenance.
    expect(approvesEstimate('Pending Estimation Approval', 'UNDER_MAINTENANCE')).toBe(true);
    expect(approvesEstimate('Under Estimation', 'Closed')).toBe(true);
    expect(approvesEstimate('Pending Estimation Approval', 'Under Estimation')).toBe(false);
    expect(approvesEstimate('Pending Estimation Approval', 'Rejected')).toBe(false);
    expect(approvesEstimate('Under Maintenance', 'Repair Completed')).toBe(false);
  });

  it('uses the stored amount, not the request body, and records a work order', () => {
    const route = readFileSync('src/app/api/maintenance-requests/[id]/route.ts', 'utf8');
    expect(route).toContain('const stored = await approvalAmount(tx, tenantId, params.id, body.selectedQuotationId);');
    expect(route).toContain('Math.max(sent, stored ?? sent)');
    const decision = readFileSync('src/lib/maintenance/estimate-decision.ts', 'utf8');
    expect(decision).toContain('await claimPending(tx, tenantId, requestId, ESTIMATION_APPROVED);');
    expect(decision).toContain('workOrderNo: workOrderNumber(requestId, now)');
  });
});

describe('the request update route cannot skip or shrink the approval', () => {
  it('checks the rule when the approve goes straight to Under Maintenance', async () => {
    const { RULES_FOR_SKIP } = { RULES_FOR_SKIP: [{ id: 'r', name: 'Big', minCost: 1000, maxCost: null, requiredRoles: ['FLEET_DIRECTOR'], autoApprove: false, isActive: true }] };
    rec.rules = RULES_FOR_SKIP;
    rec.mr = { status: 'Pending Estimation Approval', estimatedCost: null };
    const { PATCH } = await import('@/app/api/maintenance-requests/[id]/route');
    const res = await PATCH(new NextRequest('http://x/api/maintenance-requests/mr1', {
      method: 'PATCH', headers: { 'x-tenant-id': TENANT, 'x-user-id': 'u1', 'x-user-role': 'DRIVER', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'Under Maintenance', estimatedCost: 1, actualCost: 1 }),
    }), { params: Promise.resolve({ id: 'mr1' }) });
    // The quotations (3,200 and 4,100) set the amount, not the body's 1.
    expect(res.status).toBe(403);
    expect(rec.updates).toHaveLength(0);
  });
});
