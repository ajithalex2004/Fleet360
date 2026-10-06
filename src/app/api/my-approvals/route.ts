import { NextRequest, NextResponse } from 'next/server';
import { getEscalatedToMe, getMyPendingApprovals, getUserRoleCodes } from '@/lib/workflow-db';
import { byUrgency, slaSummary, toInboxItem } from '@/lib/workflow/inbox';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { sessionUser } from '@/lib/session-user';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * The signed-in user's Approvals Inbox in their current tenant, across every
 * module: the levels waiting for their decision, most urgent first, each
 * with where it stands against its SLA (sla.ts), plus the levels escalated
 * to them as an escalation contact (to follow up; deciding stays with the
 * approvers or a tenant administrator). The approver is the session's user:
 * this used to take any `email` query parameter, so anyone could read
 * anyone's approvals, in any tenant.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const me = await sessionUser(req.headers);
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Steps routed to a role reach every holder of that role in this tenant.
    const role = req.headers.get('x-user-role');
    const roleCodes = [...new Set([...(role ? [role] : []), ...await getUserRoleCodes(tenantId, me.email)])];
    const [mine, escalatedRows] = await Promise.all([
      getMyPendingApprovals(tenantId, me.email, roleCodes),
      getEscalatedToMe(tenantId, me.email),
    ]);
    const now = Date.now();
    const approvals = mine.map((r) => toInboxItem(r, now)).sort(byUrgency);
    const mineIds = new Set(approvals.map((a) => a.stepInstanceId));
    const escalated = escalatedRows
      .filter((r) => !mineIds.has(r.stepInstanceId))
      .map((r) => toInboxItem(r, now))
      .sort(byUrgency);
    return NextResponse.json({
      email: me.email,
      approvals,
      escalated,
      summary: { ...slaSummary(approvals), escalatedToMe: escalated.length },
    });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, 'Failed to fetch approvals') }, { status: 500 });
  }
}
