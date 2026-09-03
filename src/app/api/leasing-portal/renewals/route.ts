/**
 * GET /api/leasing-portal/renewals
 * Lists the authenticated lessee's own renewal proposals (any status),
 * newest first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  // A bare prisma call here never sets app.tenant_id, so RLS on
  // lease_renewals silently returned zero rows regardless of whether the
  // lessee actually had renewals. Same bug found across every other
  // leasing-portal route that used a bare `prisma.X` call instead of
  // withTenantRls.
  const renewals = await withTenantRls(prisma, ctx.tenantId, (tx) =>
    tx.leaseRenewal.findMany({
      where: {
        tenantId: ctx.tenantId,
        originalContract: { lesseeId: ctx.lesseeId },
      },
      include: { originalContract: { select: { contractNumber: true, endDate: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );

  return NextResponse.json(renewals);
}
