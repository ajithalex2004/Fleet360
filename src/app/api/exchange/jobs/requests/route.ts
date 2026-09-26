export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { partnerAuthFailure, requirePartnerContext } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/exchange/jobs/requests
 *
 * Open RFQs the signed-in partner user's partner was invited to. Marketplace
 * opportunities it was not invited to are discovered through
 * /api/exchange/marketplace, which shows their sanitized pre-award view only.
 *
 * This used to take partnerId from the query and also return every open
 * request nobody was invited to, with its full addresses and every invited
 * partner — to any signed-in user, as any partner.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = await requirePartnerContext(req);
  if (!auth.ok) return partnerAuthFailure(auth);
  const { partnerId } = auth.ctx;

  // Invitations come from other tenants (the buyers): platform context,
  // limited to requests this partner was invited to by a buyer that has not
  // blocked it.
  const requests = await withPlatformAdmin(prisma, async (tx) => {
    const blocked = await tx.tenantPartnerRelationship.findMany({
      where: { partnerId, status: 'BLOCKED' },
      select: { tenantId: true },
    });
    return tx.outsourceRequest.findMany({
      where: {
        // OutsourceRequest has no closesAt/deadline column — "still open" is
        // expressed via status (PUBLISHED/QUOTED); the deadline is on the opportunity.
        status: { in: ['PUBLISHED', 'QUOTED'] },
        invitedPartners: { some: { partnerId } },
        tenantId: { notIn: blocked.map((b) => b.tenantId) },
      },
      include: {
        // Only this partner's own invitation and quotes, not its competitors'.
        invitedPartners: { where: { partnerId } },
        quotes: { where: { partnerId } },
        opportunity: { select: { id: true, status: true, closesAt: true, visibility: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  return NextResponse.json({ requests });
}
