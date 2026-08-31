export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const existing = await tx.staffTransportRequest.findFirst({ where: { id: params.id, tenantId }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { staffMember, ...data } = body;
        if (data.status === 'APPROVED' && !data.approvedAt) data.approvedAt = new Date();
        const request = await tx.staffTransportRequest.update({
          where: { id: params.id },
          data: { ...data, updatedAt: new Date() },
          include: { staffMember: true },
        });
        return NextResponse.json(request);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const existing = await tx.staffTransportRequest.findFirst({ where: { id: params.id, tenantId }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        await tx.staffTransportRequest.delete({ where: { id: params.id } });
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

