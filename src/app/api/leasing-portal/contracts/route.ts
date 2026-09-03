/**
 * GET /api/leasing-portal/contracts
 * Lists the authenticated lessee's own contracts. Scoped entirely by the
 * session's lesseeId — there is no way to pass a different lesseeId in.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  // Bare prisma calls here never set app.tenant_id, so RLS on
  // lease_contracts_v2 silently returned zero rows regardless of whether
  // the lessee actually had contracts -- found via E2E testing the portal
  // dashboard right after it was wired up.
  const contracts = await withTenantRls(prisma, ctx.tenantId, (tx) =>
    tx.leaseContract2.findMany({
      where: { tenantId: ctx.tenantId, lesseeId: ctx.lesseeId, deletedAt: null },
      include: { vehicles: true },
      orderBy: { createdAt: 'desc' },
    }),
  );

  return NextResponse.json(contracts);
}
