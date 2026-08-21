import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';

/**
 * Mileage overages list (GET).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the overages
 * surface.
 *
 * Note: overage rows are normally created by `/api/leasing/mileage-readings`
 * (auto-invoiced when a RETURN/MONTHLY reading blows past the cap).
 * There is no manual POST here by design — the read API surfaces them
 * for the receivables dashboard.
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const { searchParams } = new URL(req.url);
    const contractId = searchParams.get('contractId');
    const status     = searchParams.get('status');
    const overages = await prisma.leaseMileageOverage.findMany({
      where: {
        tenantId,
        ...(contractId ? { contractId } : {}),
        ...(status ? { status } : {}),
      },
      include: { contract: { select: { contractNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(overages);
  } catch (e) {
    console.error('GET /api/leasing/mileage-overages error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
