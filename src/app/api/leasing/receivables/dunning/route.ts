export const dynamic = 'force-dynamic';

/**
 * /api/leasing/receivables/dunning — list + create dunning activity rows.
 *
 * Tenant scoping: requires x-tenant-id. Reads filter by tenant; creates
 * stamp the new row with the caller's tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

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
        const activities = await tx.leaseDunningActivity.findMany({
          where: {
            tenantId,
            ...(contractId
              ? { contract: { id: contractId, tenantId } }
              : {}),
          },
          include: { contract: { select: { contractNumber: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(activities);
      } catch (e) {
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
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: body.contractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found in this tenant' }, { status: 404 });
    }
    const activity = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseDunningActivity.create({
      data: { ...body, tenantId },
    }),
    );
    return NextResponse.json(activity, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
