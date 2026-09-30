import { NextRequest, NextResponse } from 'next/server';
import { advanceWorkflow, getUserRoleCodes, getWorkflowInstanceWithHistory, parseEmailList } from '@/lib/workflow-db';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { isSuperAdmin } from '@/lib/admin-access';
import { sessionUser } from '@/lib/session-user';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

const isTenantAdmin = (headers: Headers) =>
  headers.get('x-user-role') === 'TENANT_ADMIN' || isSuperAdmin(headers);

/**
 * Approve or reject the current step of one of the caller's tenant's
 * approvals. Only the step's approver (its assigned email, an address on a
 * multi-user step, or a holder of a role step's role in this tenant) or a
 * tenant administrator may act, and the action is
 * recorded under the signed-in user. The approver used to come from the
 * request body, and any instance id from any tenant was accepted.
 */
async function handlePOST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json();
    const { action, comments } = body;

    if (!action || !['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: 'action must be APPROVE or REJECT' }, { status: 400 });
    }
    const me = await sessionUser(req.headers);
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const instance = await getWorkflowInstanceWithHistory(params.id, tenantId);
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    if (instance.status !== 'IN_PROGRESS') {
      return NextResponse.json({ error: `Workflow is already ${instance.status}` }, { status: 422 });
    }

    // Always the instance's current step: a step order from the body could
    // act on a step that is not yet (or no longer) awaiting approval.
    const step = instance.steps.find((s) => s.stepOrder === instance.currentStepOrder && s.status === 'PENDING');
    if (!step) return NextResponse.json({ error: 'No step is awaiting approval' }, { status: 422 });
    const role = req.headers.get('x-user-role') ?? '';
    const myEmail = me.email.toLowerCase();
    const roleCode = step.assigneeType === 'ROLE' ? step.assigneeRoleCode?.trim().toUpperCase() : undefined;
    const isApprover =
      (step.assignedToEmail != null && step.assignedToEmail.toLowerCase() === myEmail)
      || (step.assigneeType === 'MULTI_USER' && parseEmailList(step.multiApproverEmails).includes(myEmail))
      || (!!roleCode && (role.toUpperCase() === roleCode
        || (await getUserRoleCodes(tenantId, me.email)).some((c) => c.toUpperCase() === roleCode)));
    if (!isApprover && !isTenantAdmin(req.headers)) {
      return NextResponse.json({ error: 'You are not the approver for this step' }, { status: 403 });
    }

    const result = await advanceWorkflow(tenantId, params.id, step.stepOrder, action, comments ?? '', me.email);
    if (result.status === 'NOT_PENDING') {
      // Actioned by someone else between the read above and this update.
      return NextResponse.json({ error: 'This step has already been actioned' }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error('POST /api/workflow/instances/[id]/action error:', errorMessage(e, 'Failed'));
    return NextResponse.json({ error: errorMessage(e, 'Failed') }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const instance = await getWorkflowInstanceWithHistory(params.id, tenantId);
    if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(instance);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, 'Failed to fetch workflow instance') }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
