import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowInstanceWithHistory } from '@/lib/workflow-db';
import { decideApproval, decisionMessage } from '@/lib/workflow/approvals';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Approve or reject the level waiting on one of the caller's tenant's
 * approvals (src/lib/workflow/approvals.ts, decideApproval): only the
 * level's approvers or a tenant administrator may decide, recorded under
 * the signed-in user. A level requiring all approvers waits for each of
 * them; when the last level passes, or one is rejected, the record's module
 * applies the outcome.
 */
async function handlePOST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json().catch(() => ({}));
    const { action, comments } = body as { action?: string; comments?: string };

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: 'action must be APPROVE or REJECT' }, { status: 400 });
    }
    const decision = await decideApproval({
      headers: req.headers, tenantId, instanceId: params.id, action,
      comments: typeof comments === 'string' ? comments : '',
    });
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
    return NextResponse.json({ ...decision.result, message: decisionMessage(decision, action) });
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
