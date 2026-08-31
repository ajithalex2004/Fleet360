export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/transport-enrollments/[id] — single-row GET / PATCH / DELETE.
 * DELETE is soft (sets deletedAt).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
async function loadOwned(id: string, tenantId: string) {
  return prisma.transportEnrollment.findFirst({ where: { id, tenantId, deletedAt: null } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const { id } = await ctx.params;
  const row = await loadOwned(id, tenantId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const { id } = await ctx.params;
      const existing = await loadOwned(id, tenantId);
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const patch: any = {};
        if ('defaultRouteId'  in body) patch.defaultRouteId  = body.defaultRouteId  || null;
        if ('defaultStopId'   in body) patch.defaultStopId   = body.defaultStopId   || null;
        if ('defaultStopName' in body) patch.defaultStopName = body.defaultStopName || null;
        if ('shiftType'       in body) patch.shiftType       = body.shiftType       || null;
        if ('transportType'   in body) patch.transportType   = body.transportType   || 'BUS';
        if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;
        const row = await tx.transportEnrollment.update({ where: { id }, data: patch });
        return NextResponse.json(row);
      } catch (e) {
        console.error('[transport-enrollments.PATCH]', e);
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const { id } = await ctx.params;
      const existing = await loadOwned(id, tenantId);
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      try {
        await tx.transportEnrollment.update({ where: { id }, data: { deletedAt: new Date() } });
        return NextResponse.json({ ok: true });
        } catch (e) {
        console.error('[transport-enrollments.DELETE]', e);
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
      }
  });
}

