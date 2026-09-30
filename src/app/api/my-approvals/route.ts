import { NextRequest, NextResponse } from 'next/server';
import { getMyPendingApprovals } from '@/lib/workflow-db';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { sessionUser } from '@/lib/session-user';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * The signed-in user's pending approvals in their current tenant. The
 * approver is the session's user: this used to take any `email` query
 * parameter, so anyone could read anyone's approvals, in any tenant.
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
    const approvals = await getMyPendingApprovals(tenantId, me.email);
    return NextResponse.json({ email: me.email, approvals });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, 'Failed to fetch approvals') }, { status: 500 });
  }
}
