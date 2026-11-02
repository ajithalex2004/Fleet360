export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const driverId = sp.get('driverId');
      const status = sp.get('status');
      const { take, skip, page, limit } = paginate(sp);

      // Query operational shifts from the shifts table (populated by Driver App)
      const rawShifts = await tx.$queryRaw<Array<{
        id: string;
        tenant_id: string;
        driver_id: string;
        vehicle_id: string | null;
        started_at: Date;
        ended_at: Date | null;
        status: string;
        checklist: unknown;
        checklist_signed_at: Date | null;
        checklist_signature_svg: string | null;
        notes: string | null;
        start_odometer: number | string | null;
        end_odometer: number | string | null;
        driver_first_name: string | null;
        driver_last_name: string | null;
        driver_code: string | null;
        license_plate: string | null;
        vehicle_code: string | null;
      }>>`
        SELECT 
          s.id,
          s.tenant_id,
          s.driver_id,
          s.vehicle_id,
          s.started_at,
          s.ended_at,
          s.status,
          s.checklist,
          s.checklist_signed_at,
          s.checklist_signature_svg,
          s.notes,
          s.start_odometer,
          s.end_odometer,
          d.first_name AS driver_first_name,
          d.last_name AS driver_last_name,
          d.driver_code AS driver_code,
          v.license_plate,
          v.vehicle_code
        FROM shifts s
        LEFT JOIN drivers d ON d.id::text = s.driver_id::text
        LEFT JOIN vehicles v ON v.id::text = s.vehicle_id::text
        WHERE s.tenant_id = ${tenantId}::uuid
          ${driverId ? Prisma.sql`AND s.driver_id::text = ${driverId}` : Prisma.empty}
          ${status ? Prisma.sql`AND s.status = ${status}` : Prisma.empty}
        ORDER BY s.started_at DESC
        LIMIT ${take} OFFSET ${skip}
      `;

      const countResult = await tx.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT count(*)::int AS count
        FROM shifts s
        WHERE s.tenant_id = ${tenantId}::uuid
          ${driverId ? Prisma.sql`AND s.driver_id::text = ${driverId}` : Prisma.empty}
          ${status ? Prisma.sql`AND s.status = ${status}` : Prisma.empty}
      `;
      const rawCount = Number(countResult[0]?.count ?? 0);

      if (rawCount > 0) {
        const mapped = rawShifts.map((r) => {
          const totalHours = r.ended_at && r.started_at
            ? Number(((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 3600000).toFixed(1))
            : null;

          return {
            id: r.id,
            driverId: r.driver_id,
            vehicleId: r.vehicle_id,
            shiftDate: r.started_at ? new Date(r.started_at).toISOString() : new Date().toISOString(),
            startTime: r.started_at ? new Date(r.started_at).toISOString() : new Date().toISOString(),
            endTime: r.ended_at ? new Date(r.ended_at).toISOString() : null,
            totalHours,
            status: r.status,
            checklist: r.checklist,
            checklistSignedAt: r.checklist_signed_at ? new Date(r.checklist_signed_at).toISOString() : null,
            checklistSignatureSvg: r.checklist_signature_svg,
            startOdometer: r.start_odometer != null ? Number(r.start_odometer) : null,
            endOdometer: r.end_odometer != null ? Number(r.end_odometer) : null,
            notes: r.notes,
            driverName: r.driver_first_name ? `${r.driver_first_name} ${r.driver_last_name || ''}`.trim() : null,
            driverCode: r.driver_code,
            vehiclePlate: r.license_plate,
            vehicleCode: r.vehicle_code,
          };
        });

        return NextResponse.json(paginatedResponse(mapped, rawCount, page, limit));
      }

      // Fallback to driverShift Prisma model if shifts table has no records
      const where = { tenantId, ...(driverId ? { driverId } : {}), ...(status ? { status } : {}) };
      const [data, total] = await Promise.all([
        tx.driverShift.findMany({
          where,
          orderBy: { shiftDate: 'desc' },
          take,
          skip,
        }),
        tx.driverShift.count({ where }),
      ]);
      return NextResponse.json(paginatedResponse(data, total, page, limit));
    } catch (e) {
      console.error('Error fetching shifts:', e);
      return NextResponse.json({ error: 'Failed to fetch shifts' }, { status: 500 });
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
      const shift = await tx.driverShift.create({ data: { ...body, tenantId } as Prisma.DriverShiftUncheckedCreateInput });
      return NextResponse.json(shift, { status: 201 });
    } catch (e) {
      console.error('Error creating shift:', e);
      return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 });
    }
  });
}
