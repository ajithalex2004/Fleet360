export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { notProvisionedAware } from '@/lib/exchange/partner-auth';

export const runtime = 'nodejs';

/**
 * GET /api/admin/exchange/partners/:id/compliance
 *
 * A transport partner's compliance documents for review on
 * /admin/exchange-partners, pending ones first. Platform administrators only
 * (ADMIN_ROUTE_POLICY). Decisions go to .../compliance/:docId.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: partnerId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  if (!isSuperAdmin(req.headers)) return NextResponse.json({ error: 'Platform administrators only' }, { status: 403 });

  const run = await notProvisionedAware(() => withPlatformAdmin(prisma, (tx) =>
    tx.partnerComplianceDoc.findMany({
      where: { partnerId },
      select: {
        id: true,
        docType: true,
        docNumber: true,
        fileUrl: true,
        expiryDate: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ));
  if ('response' in run) return run.response;

  // Pending first, then newest first.
  const documents = [...run.value].sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'));
  return NextResponse.json({ documents });
}
