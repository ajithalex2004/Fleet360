/**
 * /api/leasing/insurance/[id] — single insurance policy detail.
 *
 * Tenant scoping: requires x-tenant-id. The policy must belong to the
 * caller's tenant.
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
  const p = await prisma.leaseInsurancePolicy.findFirst({
    where: { id: params.id, tenantId },
    include: { claims: { where: { tenantId } } },
  });
  return p
    ? NextResponse.json(p)
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseInsurancePolicy.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { claims, ...data } = await req.json();
    const p = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseInsurancePolicy.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(p);
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const existing = await prisma.leaseInsurancePolicy.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await withTenantRls(prisma, tenantId, async (tx) =>
    tx.leaseInsurancePolicy.update({
    where: { id: params.id },
    data: { deletedAt: new Date() },
  }),
  );
  return NextResponse.json({ success: true });
}
