/**
 * /api/leasing/traffic-fines/[id] — single fine detail / PATCH / DELETE.
 *
 * Tenant scoping: requires x-tenant-id. Refuses to touch fines from another
 * tenant.
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
    const fine = await tx.leaseTrafficFine.findFirst({
        where: { id: params.id, tenantId },
        include: { contract: true },
      });
      return fine
        ? NextResponse.json(fine)
        : NextResponse.json({ error: 'Not found' }, { status: 404 });
  });
}


export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const existing = await prisma.leaseTrafficFine.findFirst({
      where: { id: params.id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);
    const { contract, ...data } = body;
    if (data.billingStatus === 'PAID' && !data.paidDate) data.paidDate = new Date();
    const fine = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseTrafficFine.update({
      where: { id: params.id },
      data: { ...data, updatedAt: new Date() },
    }),
    );
    return NextResponse.json(fine);
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
  const existing = await prisma.leaseTrafficFine.findFirst({
    where: { id: params.id, tenantId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await withTenantRls(prisma, tenantId, async (tx) =>
    tx.leaseTrafficFine.delete({ where: { id: params.id } }),
  );
  return NextResponse.json({ success: true });
}
