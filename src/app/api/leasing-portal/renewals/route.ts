/**
 * GET /api/leasing-portal/renewals
 * Lists the authenticated lessee's own renewal proposals (any status),
 * newest first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  const renewals = await prisma.leaseRenewal.findMany({
    where: {
      tenantId: ctx.tenantId,
      originalContract: { lesseeId: ctx.lesseeId },
    },
    include: { originalContract: { select: { contractNumber: true, endDate: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(renewals);
}
