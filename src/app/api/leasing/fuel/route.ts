export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

/**
 * Fuel logs list (GET) + record (POST).
 *
 * Multi-tenant: every operation is scoped by x-tenant-id from the
 * middleware. Layer 2.5 fix that closes TENANT-001 for the fuel-log
 * surface.
 */
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const contractId = searchParams.get('contractId');
        const billingStatus = searchParams.get('billingStatus');
        const logs = await tx.leaseFuelLog.findMany({
          where: {
            tenantId,
            ...(contractId ? { contractId } : {}),
            ...(billingStatus ? { billingStatus } : {}),
          },
          include: { contract: { select: { contractNumber: true } } },
          orderBy: { fuelDate: 'desc' },
        });
        return NextResponse.json(logs);
      } catch (e) {
        console.error('GET /api/leasing/fuel error:', e);
        return NextResponse.json({ error: 'Failed' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    if (body.contractId) {
      const contract = await prisma.leaseContract2.findFirst({
        where: { id: body.contractId, tenantId },
        select: { id: true },
      });
      if (!contract) {
        return NextResponse.json({ error: 'Contract not found in this tenant' }, { status: 404 });
      }
    }
    const totalCost = body.totalCost ?? (parseFloat(body.liters) * parseFloat(body.costPerLiter || '0'));
    const log = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseFuelLog.create({
      data: { ...body, tenantId, totalCost },
    }),
    );
    return NextResponse.json(log, { status: 201 });
    } catch (e) {
    console.error('POST /api/leasing/fuel error:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
