import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { slaStatus } from '@/lib/workflow/sla';
import { byUrgency, contextHighlights, toInboxItem } from '@/lib/workflow/inbox';
import { signDecisionLink, verifyDecisionLink } from '@/lib/workflow/decision-link';
import { PUBLIC_PREFIXES } from '@/lib/auth-route-policies';

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 6, 12);
const at = (h: number) => new Date(NOW + h * H);

describe('approval SLA status', () => {
  it('is on track, due soon, overdue or escalated', () => {
    expect(slaStatus({ dueAt: at(20), openedAt: at(-4) }, NOW).state).toBe('ON_TRACK');
    expect(slaStatus({ dueAt: at(3), openedAt: at(-1) }, NOW).state).toBe('DUE_SOON');
    // A quarter of a 48-hour window left.
    expect(slaStatus({ dueAt: at(10), openedAt: at(-38) }, NOW).state).toBe('DUE_SOON');
    expect(slaStatus({ dueAt: at(-2), openedAt: at(-26) }, NOW)).toMatchObject({ state: 'OVERDUE', hoursLeft: -2 });
    expect(slaStatus({ dueAt: at(-2), escalatedAt: at(-1) }, NOW).state).toBe('ESCALATED');
    expect(slaStatus({ dueAt: null }, NOW).state).toBe('NO_SLA');
  });

  it('says when a level with an escalation contact will escalate', () => {
    expect(slaStatus({ dueAt: at(20), openedAt: at(-4), escalationHours: 48, escalates: true }, NOW).escalatesAt)
      .toBe(at(44).toISOString());
    expect(slaStatus({ dueAt: at(20), openedAt: at(-4), escalationHours: 48, escalates: false }, NOW).escalatesAt).toBeNull();
  });

  it('lists the most urgent first', () => {
    const row = (id: string, due: number | null, escalated = false) => toInboxItem({
      stepInstanceId: id, workflowInstanceId: id, dueAt: due == null ? null : at(due), receivedAt: at(-30),
      openedAt: at(-30), escalatedAt: escalated ? at(-1) : null,
    }, NOW);
    const sorted = [row('none', null), row('late', -3), row('ok', 30), row('soon', 2), row('esc', -1, true)].sort(byUrgency);
    expect(sorted.map((r) => r.stepInstanceId)).toEqual(['esc', 'late', 'soon', 'ok', 'none']);
  });

  it('highlights what is being approved', () => {
    expect(contextHighlights({ amount: 1250.5, requestType: 'BREAKDOWN', other: 'x', nested: { a: 1 } }))
      .toEqual([{ label: 'Amount', value: '1,250.50' }, { label: 'Request type', value: 'BREAKDOWN' }]);
    expect(contextHighlights(null)).toEqual([]);
  });
});

describe('email decision links', () => {
  beforeAll(() => { process.env.SESSION_SECRET = 'unit-test-secret-0123456789abcdef0123456789'; });
  const args = { tenantId: 't1', instanceId: 'i1', stepInstanceId: 's1', email: 'Fin@Example.com', now: NOW };

  it('round-trips, for one approver and level', () => {
    const check = verifyDecisionLink(signDecisionLink(args), NOW + H);
    expect(check).toMatchObject({ ok: true, link: { tenantId: 't1', instanceId: 'i1', stepInstanceId: 's1', email: 'fin@example.com' } });
  });

  it('refuses a changed, foreign or expired link', () => {
    const token = signDecisionLink(args);
    const [encoded, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(encoded, 'base64url').toString()), e: 'boss@example.com' })).toString('base64url');
    expect(verifyDecisionLink(`${forged}.${sig}`, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyDecisionLink('abc', NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyDecisionLink(token, NOW + 8 * 24 * H)).toEqual({ ok: false, reason: 'expired' });
  });

  it('is a public route whose GET changes nothing', () => {
    expect(PUBLIC_PREFIXES).toContain('/approval-link/');
    expect(PUBLIC_PREFIXES).toContain('/api/approval-link/');
    const route = readFileSync('src/app/api/approval-link/[token]/route.ts', 'utf8');
    const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
    expect(get).not.toContain('decideAs(');
    expect(route).toContain("actor: { email: link.email, role: null, admin: false }");
  });

  it('is in the approval request email', () => {
    const catalogue = readFileSync('src/lib/email-templates/catalogue.ts', 'utf8');
    expect(catalogue).toContain('[Approve or reject]({{decisionUrl}})');
    expect(readFileSync('src/lib/workflow-db.ts', 'utf8')).toContain('decisionUrl,');
  });
});

describe('bulk approve', () => {
  it('approves through the same decision as the inbox, approvals only', () => {
    const route = readFileSync('src/app/api/my-approvals/bulk/route.ts', 'utf8');
    expect(route).toContain("decideApproval({ headers: req.headers, tenantId, instanceId, action: 'APPROVE', comments })");
    expect(route).toContain('export const POST = withAuditedAction(handlePOST)');
  });
});
