/**
 * GET /api/leasing-portal/contracts
 * Lists the authenticated lessee's own contracts. Scoped entirely by the
 * session's lesseeId — there is no way to pass a different lesseeId in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  const contracts = await prisma.leaseContract2.findMany({
    where: { tenantId: ctx.tenantId, lesseeId: ctx.lesseeId, deletedAt: null },
    include: { vehicles: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(contracts);
}
