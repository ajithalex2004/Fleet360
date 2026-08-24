/**
 * /api/leasing/insurance/[id]/claims — list and create claims for a policy.
 *
 * Tenant scoping: requires x-tenant-id. The policy must belong to the
 * caller's tenant; the claim number is scoped per tenant (not global) so
 * two tenants don't collide on "CLM-00001"; every created claim row is
 * stamped with the same tenantId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const policy = await tx.leaseInsurancePolicy.findFirst({
        where: { id: params.id, tenantId },
        select: { id: true },
      });
      if (!policy) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const claims = await tx.leaseInsuranceClaim.findMany({
        where: { tenantId, policyId: params.id },
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json(claims);
  });
}


export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const policy = await prisma.leaseInsurancePolicy.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!policy) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const count = await prisma.leaseInsuranceClaim.count({ where: { tenantId } });
    const claimNo = `CLM-${String(count + 1).padStart(5, '0')}`;
    const claim = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseInsuranceClaim.create({
      data: { ...body, policyId: params.id, claimNo, tenantId },
    }),
    );
    return NextResponse.json(claim, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
