import { NextRequest, NextResponse } from 'next/server';
import { decideApproval, decisionMessage } from '@/lib/workflow/approvals';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';

/** Most approvals one bulk request decides. */
const MAX_BULK_APPROVALS = 50;

/**
 * POST { instanceIds: string[], comments?: string } — approves each of the
 * caller's selected approvals, one by one, exactly as approving it from the
 * Approvals Inbox would (decideApproval: the level waiting on it, only by
 * its approver or a tenant administrator). Bulk is for approving: a
 * rejection needs its own reason. One failing (decided meanwhile, not the
 * caller's) does not stop the others; each gets its own result.
 */
async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const body = await req.json().catch(() => ({})) as { instanceIds?: unknown; comments?: unknown; action?: unknown };
  if (body.action != null && body.action !== 'APPROVE') {
    return NextResponse.json({ error: 'Only approvals can be decided in bulk: reject each one with its reason' }, { status: 400 });
  }
  const ids = Array.isArray(body.instanceIds)
    ? [...new Set(body.instanceIds.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))]
    : [];
  if (!ids.length) return NextResponse.json({ error: 'Select at least one approval' }, { status: 400 });
  if (ids.length > MAX_BULK_APPROVALS) {
    return NextResponse.json({ error: `Approve at most ${MAX_BULK_APPROVALS} at a time` }, { status: 400 });
  }
  const comments = typeof body.comments === 'string' ? body.comments : '';

  const results: Array<{ instanceId: string; ok: boolean; status?: string; message?: string; error?: string }> = [];
  // One at a time: each decision may complete an approval and apply its outcome.
  for (const instanceId of ids) {
    try {
      const decision = await decideApproval({ headers: req.headers, tenantId, instanceId, action: 'APPROVE', comments });
      if (decision.ok) {
        results.push({ instanceId, ok: true, status: decision.result.status, message: decisionMessage(decision, 'APPROVE') });
      } else {
        // Not signed in: nothing else will succeed either.
        if (decision.status === 401) return NextResponse.json({ error: decision.error }, { status: 401 });
        results.push({ instanceId, ok: false, error: decision.error });
      }
    } catch (e) {
      console.error('[Approvals] Bulk approve failed for', instanceId, e instanceof Error ? e.message : e);
      results.push({ instanceId, ok: false, error: 'Could not approve this one' });
    }
  }
  const approved = results.filter((r) => r.ok).length;
  return NextResponse.json({ approved, failed: results.length - approved, results });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
