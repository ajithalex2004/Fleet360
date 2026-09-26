export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/jobs/awards
 *
 * Jobs awarded to the signed-in partner user's partner. (The partner used to
 * come from ?partnerId=, and without it every partner's awards were listed.)
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req);
  if (!auth.ok) return partnerAuthFailure(auth);

  // Awards belong to the buyers' tenants: platform context, limited to the
  // verified partner's own awards.
  const awards = await withPlatformAdmin(prisma, (tx) =>
    tx.outsourceAward.findMany({
      where: { partnerId: auth.ctx.partnerId },
      include: {
        request: true,
        quote: true,
        assignment: {
          include: { pod: true },
        },
        invoice: true,
      },
      orderBy: { awardedAt: 'desc' },
    }),
  );

  return NextResponse.json({ awards });
}
