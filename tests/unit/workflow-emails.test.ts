/**
 * tests/unit/workflow-emails.test.ts
 *
 * Approval emails go out through the platform email sender (src/lib/email.ts),
 * worded by the "workflow.approval_request" template (src/lib/email-templates;
 * the built-in wording here, as the mocked database has no saved template).
 * They used to be read from an "IntegrationConfig" row with columns that
 * table does not have, so the lookup always failed and no approver was ever
 * emailed.
 *
 * Covered:
 *  - starting a workflow emails the first step's approver
 *  - approving a step emails the next step's approver
 *  - tenant-supplied text is HTML-escaped in the email
 *  - a failed or unconfigured send never fails the approval
 *  - role steps email every active holder of the role; multi-user steps
 *    every listed address; each approver gets a personal copy
 *  - {placeholders} in the step's subject and body are filled in, and the
 *    workflow's default wording is used when the step has none
 *
 * The database is an in-memory model keyed on the SQL each call issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  sent: [] as Array<{ to: string | string[]; subject: string; html?: string; text?: string }>,
  sendResult: { sent: true } as { sent: boolean; reason?: string },
  sendThrows: false,
  steps: [] as Array<Record<string, unknown>>,
  definition: {} as Record<string, unknown>,
  roleHolders: [] as Array<{ user: { email: string; firstName: string | null; lastName: string | null } }>,
  roleQueries: [] as unknown[],
}));

vi.mock('@/lib/email', () => ({
  sendEmail: async (msg: { to: string; subject: string; html?: string; text?: string }) => {
    if (state.sendThrows) throw new Error('smtp down');
    state.sent.push(msg);
    return state.sendResult;
  },
}));

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const baseDefinition = { id: 'wf1', name: 'Quote approval', module: 'LEASING', procedure: 'quote', tenantId: TENANT, isActive: true, defaultEmailSubject: null, defaultEmailBody: null };
const baseSteps = () => [
  { id: 's1', workflowId: 'wf1', stepOrder: 1, stepName: 'Manager <review>', stepType: 'APPROVAL', assigneeType: 'SPECIFIC_USER', assigneeEmail: 'manager@a.test', assigneeRoleCode: null, multiApproverEmails: null, emailSubject: null, emailBody: null, slaHours: 24 },
  { id: 's2', workflowId: 'wf1', stepOrder: 2, stepName: 'Finance', stepType: 'APPROVAL', assigneeType: 'SPECIFIC_USER', assigneeEmail: 'finance@a.test', assigneeRoleCode: null, multiApproverEmails: null, emailSubject: null, emailBody: null, slaHours: 24 },
];

vi.mock('@/lib/branding', () => ({ getBranding: async () => null }));
vi.mock('@/lib/rls-scope', () => ({ runOutsideRlsScope: <T>(fn: () => Promise<T>) => fn() }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    userTenant: { findMany: async (args: unknown) => { state.roleQueries.push(args); return state.roleHolders; } },
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('FROM "WorkflowDefinition"')) return [state.definition];
      if (sql.includes('SELECT id FROM "WorkflowInstance"')) return [];
      if (sql.includes('SELECT * FROM "WorkflowStep"')) return state.steps;
      if (sql.includes('JOIN "WorkflowStep" ws')) return [state.steps[1]];
      if (sql.includes('SELECT * FROM "WorkflowInstance"')) {
        return [{ id: 'i1', workflowId: 'wf1', referenceNumber: 'Q-<1>', referenceType: 'LEASE_QUOTATION', initiatedByName: 'Sam Sales', initiatedByEmail: 'sales@a.test' }];
      }
      return [];
    },
    $executeRawUnsafe: async () => 1,
  },
}));

import { triggerWorkflow, advanceWorkflow, parseEmailList } from '@/lib/workflow-db';

const trigger = () => triggerWorkflow({
  tenantId: TENANT, module: 'LEASING', procedure: 'quote',
  referenceType: 'LEASE_QUOTATION', referenceId: 'q1', referenceNumber: 'Q-<1>',
  initiatedByEmail: 'sales@a.test', initiatedByName: 'Sam Sales',
});

beforeEach(() => {
  state.sent = [];
  state.sendResult = { sent: true };
  state.sendThrows = false;
  state.steps = baseSteps();
  state.definition = { ...baseDefinition };
  state.roleHolders = [];
  state.roleQueries = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('workflow approval emails', () => {
  it('emails the first approver when a workflow starts', async () => {
    const res = await trigger();
    expect(res).toMatchObject({ workflowName: 'Quote approval' });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toBe('manager@a.test');
    expect(state.sent[0].subject).toContain('Q-<1>');
    expect(state.sent[0].text).toContain('/approvals');
  });

  it('emails the next approver when a step is approved', async () => {
    const res = await advanceWorkflow(TENANT, 'i1', 1, 'APPROVE', 'ok', 'manager@a.test');
    expect(res).toMatchObject({ status: 'IN_PROGRESS', nextStep: 'Finance' });
    expect(state.sent.map((m) => m.to)).toEqual(['finance@a.test']);
  });

  it('escapes tenant-supplied text in the email', async () => {
    await trigger();
    const html = state.sent[0].html ?? '';
    expect(html).toContain('Manager &lt;review&gt;');
    expect(html).toContain('Q-&lt;1&gt;');
    expect(html).not.toContain('<review>');
    expect(state.sent[0].text).toContain('Manager <review>');
  });

  it('never fails the approval when email is not set up or the send throws', async () => {
    state.sendResult = { sent: false, reason: 'smtp_not_configured' };
    await expect(trigger()).resolves.toMatchObject({ workflowName: 'Quote approval' });
    state.sendThrows = true;
    await expect(advanceWorkflow(TENANT, 'i1', 1, 'APPROVE', '', 'manager@a.test'))
      .resolves.toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('emails every active holder of a role step, each with their own name', async () => {
    Object.assign(state.steps[0], { assigneeType: 'ROLE', assigneeEmail: null, assigneeRoleCode: 'FINANCE_MANAGER' });
    state.roleHolders = [
      { user: { email: 'Fin1@a.test', firstName: 'Fatima', lastName: 'Ali' } },
      { user: { email: 'fin2@a.test', firstName: null, lastName: null } },
    ];
    await trigger();
    expect(state.sent.map((m) => m.to)).toEqual(['fin1@a.test', 'fin2@a.test']);
    expect(state.sent[0].text).toContain('Dear Fatima Ali');
    expect(state.sent[1].text).toContain('Dear Approver');
    expect(state.roleQueries[0]).toMatchObject({
      where: { tenantId: TENANT, role: { code: { equals: 'FINANCE_MANAGER', mode: 'insensitive' } } },
    });
  });

  it('emails every address of a multi-user step once', async () => {
    Object.assign(state.steps[0], { assigneeType: 'MULTI_USER', assigneeEmail: null, multiApproverEmails: 'a@a.test, B@a.test;a@a.test not-an-email' });
    await trigger();
    expect(state.sent.map((m) => m.to)).toEqual(['a@a.test', 'b@a.test']);
  });

  it('fills placeholders in the step wording, falling back to the workflow default', async () => {
    Object.assign(state.steps[0], {
      emailSubject: 'Approve {referenceNumber}\r\nBcc: x@evil.test',
      emailBody: 'Hi {approverName}, {{submittedBy}} sent {referenceNumber} for {moduleLabel}. {unknown}',
    });
    await trigger();
    expect(state.sent[0].subject).toBe('Approve Q-<1> Bcc: x@evil.test');
    expect(state.sent[0].text).toContain('Hi Approver, Sam Sales sent Q-<1> for Leasing. {unknown}');

    state.sent = [];
    state.definition = { ...baseDefinition, defaultEmailSubject: 'Default: {stepName}' };
    await advanceWorkflow(TENANT, 'i1', 1, 'APPROVE', '', 'manager@a.test');
    expect(state.sent[0].subject).toBe('Default: Finance');
  });
});

describe('address helpers', () => {
  it('parses address lists', () => {
    expect(parseEmailList(' X@a.test;y@a.test ,bad ')).toEqual(['x@a.test', 'y@a.test']);
  });
});
