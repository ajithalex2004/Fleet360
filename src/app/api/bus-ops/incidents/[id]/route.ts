export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const incident = await tx.tripIncident.findFirst({ where: { id: params.id, tenantId } });
        if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json(incident);
      } catch (e) {
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const existing = await tx.tripIncident.findFirst({ where: { id: params.id, tenantId }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        if (body.status === 'RESOLVED' && !body.resolvedAt) body.resolvedAt = new Date();
        const incident = await tx.tripIncident.update({ where: { id: params.id }, data: { ...body, updatedAt: new Date() } });
        return NextResponse.json(incident);
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
        const existing = await tx.tripIncident.findFirst({ where: { id: params.id, tenantId }, select: { id: true } });
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        await tx.tripIncident.delete({ where: { id: params.id } });
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

