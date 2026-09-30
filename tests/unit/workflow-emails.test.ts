/**
 * tests/unit/workflow-emails.test.ts
 *
 * Approval emails go out through the platform email sender (src/lib/email.ts).
 * They used to be read from an "IntegrationConfig" row with columns that
 * table does not have, so the lookup always failed and no approver was ever
 * emailed.
 *
 * Covered:
 *  - starting a workflow emails the first step's approver
 *  - approving a step emails the next step's approver
 *  - tenant-supplied text is HTML-escaped in the email
 *  - a failed or unconfigured send never fails the approval
 *
 * The database is an in-memory model keyed on the SQL each call issues.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  sent: [] as Array<{ to: string | string[]; subject: string; html?: string; text?: string }>,
  sendResult: { sent: true } as { sent: boolean; reason?: string },
  sendThrows: false,
}));

vi.mock('@/lib/email', () => ({
  sendEmail: async (msg: { to: string; subject: string; html?: string; text?: string }) => {
    if (state.sendThrows) throw new Error('smtp down');
    state.sent.push(msg);
    return state.sendResult;
  },
}));

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const definition = { id: 'wf1', name: 'Quote approval', module: 'LEASING', procedure: 'quote', tenantId: TENANT, isActive: true };
const steps = [
  { id: 's1', workflowId: 'wf1', stepOrder: 1, stepName: 'Manager <review>', stepType: 'APPROVAL', assigneeEmail: 'manager@a.test', emailSubject: null, emailBody: null, slaHours: 24 },
  { id: 's2', workflowId: 'wf1', stepOrder: 2, stepName: 'Finance', stepType: 'APPROVAL', assigneeEmail: 'finance@a.test', emailSubject: null, emailBody: null, slaHours: 24 },
];

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('FROM "WorkflowDefinition"') && sql.includes('module=$1')) return [definition];
      if (sql.includes('SELECT id FROM "WorkflowInstance"')) return [];
      if (sql.includes('SELECT * FROM "WorkflowStep"')) return steps;
      if (sql.includes('JOIN "WorkflowStep" ws')) return [steps[1]];
      if (sql.includes('SELECT * FROM "WorkflowInstance"')) {
        return [{ id: 'i1', referenceNumber: 'Q-<1>', referenceType: 'LEASE_QUOTATION' }];
      }
      return [];
    },
    $executeRawUnsafe: async () => 1,
  },
}));

import { triggerWorkflow, advanceWorkflow, buildWorkflowEmailHtml } from '@/lib/workflow-db';

const trigger = () => triggerWorkflow({
  tenantId: TENANT, module: 'LEASING', procedure: 'quote',
  referenceType: 'LEASE_QUOTATION', referenceId: 'q1', referenceNumber: 'Q-<1>',
  initiatedByEmail: 'sales@a.test',
});

beforeEach(() => {
  state.sent = [];
  state.sendResult = { sent: true };
  state.sendThrows = false;
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
    expect(buildWorkflowEmailHtml({
      body: '<script>x</script>', referenceNumber: 'R', referenceType: 'T', stepName: 'S', approvalUrl: 'https://x/approvals',
    })).toContain('&lt;script&gt;');
  });

  it('never fails the approval when email is not set up or the send throws', async () => {
    state.sendResult = { sent: false, reason: 'smtp_not_configured' };
    await expect(trigger()).resolves.toMatchObject({ workflowName: 'Quote approval' });
    state.sendThrows = true;
    await expect(advanceWorkflow(TENANT, 'i1', 1, 'APPROVE', '', 'manager@a.test'))
      .resolves.toMatchObject({ status: 'IN_PROGRESS' });
  });
});
