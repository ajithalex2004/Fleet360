export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { recordLifecycleEvent } from '@/lib/fleet/lifecycle-events';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { sqlCast } from '@/lib/fleet/sql-cast';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT fa.*, v.vehicle_code, v.make, v.model, v.license_plate, v.plate_number
         FROM fleet_allocations fa
         LEFT JOIN vehicles v ON v.id = fa.vehicle_id::text
         WHERE fa.id::text = $1`,
        params.id,
      );
      if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(rows[0]);
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to fetch') }, { status: 500 });
    }
  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const now = new Date().toISOString();

      const fieldMap: Record<string, string> = {
        vehicleId: 'vehicle_id',
        allocatedToType: 'allocated_to_type',
        allocatedToId: 'allocated_to_id',
        allocatedToName: 'allocated_to_name',
        regionId: 'region_id',
        regionName: 'region_name',
        departmentId: 'department_id',
        departmentName: 'department_name',
        unitId: 'unit_id',
        unitName: 'unit_name',
        allocationDate: 'allocation_date',
        expectedReturnDate: 'expected_return_date',
        actualReturnDate: 'actual_return_date',
        status: 'status',
        purpose: 'purpose',
        authorizedBy: 'authorized_by',
        mileageAtAllocation: 'mileage_at_allocation',
        mileageAtReturn: 'mileage_at_return',
        notes: 'notes',
      };

      const sets: string[] = [`updated_at = $1::timestamptz`];
      const vals: any[] = [now];
      let idx = 2;
      for (const [key, col] of Object.entries(fieldMap)) {
        if (key in body) {
          sets.push(`${col} = $${idx++}${sqlCast('fleet_allocations', col)}`);
          vals.push(body[key]);
        }
      }
      vals.push(params.id);

      await tx.$executeRawUnsafe(
        `UPDATE fleet_allocations SET ${sets.join(', ')} WHERE id::text = $${idx}`,
        ...vals,
      );

      // Handle vehicle return automation
      if (body.status === 'RETURNED' || body.status === 'CANCELLED') {
        const allocRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT vehicle_id, allocated_to_name FROM fleet_allocations WHERE id::text = $1`,
          params.id,
        );
        if (allocRows.length > 0 && allocRows[0].vehicle_id) {
          const vId = String(allocRows[0].vehicle_id);
          const mileage = body.mileageAtReturn != null && body.mileageAtReturn !== '' ? Number(body.mileageAtReturn) : null;

          await tx.$executeRawUnsafe(
            `UPDATE vehicles 
             SET lifecycle_stage = 'OPERATIONAL', 
                 status = 'AVAILABLE',
                 odometer_reading = COALESCE($1, odometer_reading),
                 updated_at = $2::timestamptz 
             WHERE id = $3`,
            mileage,
            now,
            vId,
          );

          await recordLifecycleEvent(tx, {
            vehicleId: vId,
            eventType: 'STATUS_CHANGE',
            description: body.status === 'RETURNED'
              ? `Vehicle returned from allocation (${allocRows[0].allocatedToName || 'Department'}). Status set to AVAILABLE${mileage ? `, Odometer: ${mileage.toLocaleString()} km` : ''}`
              : `Allocation cancelled for ${allocRows[0].allocatedToName || 'Department'}. Status set to AVAILABLE`,
            toStage: 'OPERATIONAL',
            performedBy: body.authorizedBy || 'Fleet Operations',
            metadata: {
              allocationId: params.id,
              actualReturnDate: body.actualReturnDate,
              mileageAtReturn: mileage,
            },
          }).catch(() => {});
        }
      }

      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT * FROM fleet_allocations WHERE id::text = $1`,
        params.id,
      );
      return NextResponse.json(rows[0]);
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to update') }, { status: 500 });
    }
  });
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await tx.$executeRawUnsafe(
        "DELETE FROM fleet_allocations WHERE id::text = $1",
        params.id,
      );
      return NextResponse.json({ success: true });
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to delete') }, { status: 500 });
    }
  });
}
