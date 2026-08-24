import { NextRequest, NextResponse } from 'next/server';
import { getMyPendingApprovals } from '@/lib/workflow-db';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');
    if (!email) return NextResponse.json({ error: 'email query param required' }, { status: 400 });
    const approvals = await getMyPendingApprovals(email);
    return NextResponse.json(approvals);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
