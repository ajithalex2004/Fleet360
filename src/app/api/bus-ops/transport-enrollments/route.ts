export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/transport-enrollments
 *
 * Per-employee transport-module preferences. Split out of StaffMember
 * by Task 3 so non-transport modules don't drag around bus-ops columns.
 * GET   — list, filter by employeeId / routeId / active
 * POST  — create (one active enrollment per employee enforced by DB
 *         partial unique on employee_id WHERE deleted_at IS NULL)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp = req.nextUrl.searchParams;
      try {
        const rows = await tx.transportEnrollment.findMany({
          where: {
            tenantId, deletedAt: null,
            ...(sp.get('employeeId') ? { employeeId: sp.get('employeeId')! } : {}),
            ...(sp.get('routeId')    ? { defaultRouteId: sp.get('routeId')! } : {}),
            ...(sp.get('active') === '1' ? { isActive: true } : sp.get('active') === '0' ? { isActive: false } : {}),
          },
          include: { employee: { select: { id: true, employeeId: true, name: true, department: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(rows);
      } catch (e) {
        console.error('[transport-enrollments.GET]', e);
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        if (!body?.employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 });
        const row = await tx.transportEnrollment.create({
          data: {
            tenantId,
            employeeId:      body.employeeId,
            defaultRouteId:  body.defaultRouteId  || null,
            defaultStopId:   body.defaultStopId   || null,
            defaultStopName: body.defaultStopName || null,
            shiftType:       body.shiftType       || null,
            transportType:   body.transportType   || 'BUS',
            isActive:        body.isActive ?? true,
          },
        });
        return NextResponse.json(row, { status: 201 });
        } catch (e) {
        const code = (e as { code?: string } | null)?.code;
        if (code === 'P2002') {
          return NextResponse.json({
            error: 'This employee already has an active transport enrollment. Update the existing one or archive it first.',
          }, { status: 409 });
        }
        console.error('[transport-enrollments.POST]', e);
        return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
      }
  });
}

