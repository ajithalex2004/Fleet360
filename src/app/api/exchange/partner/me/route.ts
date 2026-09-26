export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { partnerMembershipsForUser } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/partner/me
 *
 * The transport partners the signed-in user is a member of, with their role
 * in each. The partner portal uses it to show who the user acts for and, for
 * users in several partners, which x-partner-id to send.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const userId = req.headers.get('x-user-id') as string;

  const partners = await partnerMembershipsForUser(userId);
  return NextResponse.json({ userId, partners });
}
