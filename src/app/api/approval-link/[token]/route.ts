export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { runAsTenant } from '@/lib/rls-scope';
import { getMembershipStatus, getWorkflowInstanceWithHistory } from '@/lib/workflow-db';
import { decideAs, decisionMessage } from '@/lib/workflow/approvals';
import { verifyDecisionLink } from '@/lib/workflow/decision-link';
import { contextHighlights } from '@/lib/workflow/inbox';
import { slaStatus } from '@/lib/workflow/sla';
import { logAudit } from '@/lib/audit';

/**
 * The email decision link (src/lib/workflow/decision-link.ts). Public: the
 * signed token in the path is the only credential, and it names the tenant,
 * approval, level and approver. GET shows what is being approved (and
 * changes nothing); POST { action: APPROVE | REJECT, comments } decides
 * that level as that approver (decideAs re-checks they are still one of
 * its approvers and that it is still the level waiting).
 */
type Params = { params: Promise<{ token: string }> };

const LINK_ERRORS = {
  invalid: 'This approval link is not valid. Open the Approvals Inbox to decide it.',
  expired: 'This approval link has expired. Open the Approvals Inbox to decide it.',
};

async function resolve(token: string) {
  const check = verifyDecisionLink(token);
  if (!check.ok) return { error: NextResponse.json({ error: LINK_ERRORS[check.reason], reason: check.reason }, { status: check.reason === 'expired' ? 410 : 404 }) };
  const { link } = check;
  const member = await getMembershipStatus(link.tenantId, link.email);
  if (member === 'INACTIVE') {
    return { error: NextResponse.json({ error: 'Your account no longer has access to this company.', reason: 'inactive' }, { status: 403 }) };
  }
  const instance = await runAsTenant(link.tenantId, () => getWorkflowInstanceWithHistory(link.instanceId, link.tenantId));
  if (!instance) return { error: NextResponse.json({ error: LINK_ERRORS.invalid, reason: 'invalid' }, { status: 404 }) };
  const level = instance.steps.find((s) => s.id === link.stepInstanceId);
  if (!level) return { error: NextResponse.json({ error: LINK_ERRORS.invalid, reason: 'invalid' }, { status: 404 }) };
  return { link, instance, level };
}

export async function GET(_req: NextRequest, props: Params) {
  const { token } = await props.params;
  try {
    const r = await resolve(token);
    if ('error' in r) return r.error;
    const { link, instance, level } = r;
    const mine = Array.isArray(level.approvals)
      ? (level.approvals as Array<{ email?: string; action?: string }>).find((d) => d.email?.toLowerCase() === link.email)
      : undefined;
    const waiting = instance.status === 'IN_PROGRESS' && level.status === 'PENDING' && level.stepOrder === instance.currentStepOrder;
    return NextResponse.json({
      approverEmail: link.email,
      expiresAt: new Date(link.expiresAt).toISOString(),
      referenceNumber: instance.referenceNumber,
      referenceType: instance.referenceType,
      workflowName: instance.workflowName,
      module: instance.module,
      procedure: instance.procedure,
      submittedBy: instance.initiatedByName || instance.initiatedByEmail,
      submittedAt: instance.initiatedAt,
      levelName: level.stepName,
      levelStatus: level.status,
      approvalStatus: instance.status,
      // Waiting for this approver's decision; else why not.
      canDecide: waiting && !mine,
      yourDecision: mine?.action ?? (level.actionedByEmail?.toLowerCase() === link.email ? level.status : null),
      decidedBy: level.actionedByEmail,
      decidedAt: level.actionedAt,
      sla: waiting ? slaStatus({ dueAt: level.dueAt, openedAt: level.activatedAt ?? level.createdAt, escalatedAt: level.escalatedAt }) : null,
      highlights: contextHighlights(instance.contextJson),
      levels: instance.steps.map((s) => ({ order: s.stepOrder, name: s.stepName, status: s.status })),
    });
  } catch (e) {
    console.error('GET /api/approval-link error:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not load this approval' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, props: Params) {
  const { token } = await props.params;
  try {
    const r = await resolve(token);
    if ('error' in r) return r.error;
    const { link, instance } = r;
    const body = await req.json().catch(() => ({})) as { action?: unknown; comments?: unknown };
    const action = body.action;
    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: 'action must be APPROVE or REJECT' }, { status: 400 });
    }
    const comments = typeof body.comments === 'string' ? body.comments.trim() : '';
    if (action === 'REJECT' && comments.length < 3) {
      return NextResponse.json({ error: 'Give a reason for the rejection' }, { status: 400 });
    }
    const decision = await decideAs({
      tenantId: link.tenantId, instanceId: link.instanceId, stepInstanceId: link.stepInstanceId,
      actor: { email: link.email, role: null, admin: false },
      action, comments,
    });
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
    void logAudit({
      tenantId: link.tenantId, entityType: 'WorkflowInstance', entityId: link.instanceId,
      entityName: instance.referenceNumber ?? undefined, userEmail: link.email,
      action: action === 'APPROVE' ? 'APPROVE' : 'REJECT',
      details: `${action === 'APPROVE' ? 'Approved' : 'Rejected'} "${decision.stepName}" of ${instance.workflowName} from the email decision link`,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
    return NextResponse.json({ ok: true, status: decision.result.status, message: decisionMessage(decision, action) });
  } catch (e) {
    console.error('POST /api/approval-link error:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not record your decision' }, { status: 500 });
  }
}
