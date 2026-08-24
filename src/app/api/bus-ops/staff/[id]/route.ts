import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const member = await tx.staffMember.findFirst({
          where: { id: params.id, tenantId, deletedAt: null },
          include: { transportRequests: { orderBy: { createdAt: 'desc' }, take: 5 } },
        });
        if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(member);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const existing = await tx.staffMember.findFirst({ where: { id: params.id, tenantId, deletedAt: null }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { transportRequests, ...data } = body;
        const member = await tx.staffMember.update({
          where: { id: params.id },
          data: { ...data, updatedAt: new Date() },
        });
        return NextResponse.json(member);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const existing = await tx.staffMember.findFirst({ where: { id: params.id, tenantId, deletedAt: null }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        await tx.staffMember.update({
          where: { id: params.id },
          data: { deletedAt: new Date(), isActive: false },
        });
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

