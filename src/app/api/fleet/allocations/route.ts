export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { recordLifecycleEvent } from '@/lib/fleet/lifecycle-events';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  await ensureFleetSchema();
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const status = sp.get('status');
      const vehicleId = sp.get('vehicleId');
      const search = sp.get('search');
      const { take, skip, page, limit } = paginate(sp);

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (status) {
        params.push(status);
        conditions.push(`fa.status = $${params.length}`);
      }
      if (vehicleId) {
        params.push(vehicleId);
        conditions.push(`fa.vehicle_id::text = $${params.length}`);
      }
      if (search && search.trim()) {
        const s = `%${search.trim().toLowerCase()}%`;
        params.push(s);
        const idx = params.length;
        conditions.push(`(
          LOWER(COALESCE(fa.allocated_to_name, '')) LIKE $${idx} OR
          LOWER(COALESCE(fa.region_name, '')) LIKE $${idx} OR
          LOWER(COALESCE(fa.department_name, '')) LIKE $${idx} OR
          LOWER(COALESCE(fa.unit_name, '')) LIKE $${idx} OR
          LOWER(COALESCE(fa.purpose, '')) LIKE $${idx} OR
          LOWER(COALESCE(v.vehicle_code, '')) LIKE $${idx} OR
          LOWER(COALESCE(v.license_plate, '')) LIKE $${idx} OR
          LOWER(COALESCE(v.plate_number, '')) LIKE $${idx} OR
          LOWER(COALESCE(v.make, '')) LIKE $${idx} OR
          LOWER(COALESCE(v.model, '')) LIKE $${idx}
        )`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countParams = [...params];
      const dataParams = [...params];
      dataParams.push(take, skip);

      const [countResult, rows, availableCountResult] = await Promise.all([
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count
           FROM fleet_allocations fa
           LEFT JOIN vehicles v ON v.id = fa.vehicle_id::text
           ${where}`,
          ...countParams,
        ),
        tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT fa.*, 
                  v.vehicle_code, 
                  v.make, 
                  v.model, 
                  v.license_plate, 
                  v.plate_number,
                  v.status AS current_vehicle_status
           FROM fleet_allocations fa
           LEFT JOIN vehicles v ON v.id = fa.vehicle_id::text
           ${where}
           ORDER BY fa.created_at DESC
           LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          ...dataParams,
        ),
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count FROM vehicles WHERE status = 'AVAILABLE' AND deleted_at IS NULL`
        ).catch(() => [{ count: BigInt(0) }]),
      ]);

      const total = Number(countResult[0]?.count ?? 0);
      const availableVehicles = Number(availableCountResult[0]?.count ?? 0);
      const data = rows.map(rowToCamel);

      return NextResponse.json({
        ...paginatedResponse(data, total, page, limit),
        availableVehicles,
      });
    } catch (e) {
      console.error('Error fetching allocations:', e);
      return NextResponse.json({ error: 'Failed to fetch allocations' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
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

      if (!body.vehicleId) {
        return NextResponse.json({ error: 'Vehicle is required' }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      // Format clean composite hierarchy name: Region > Department > Unit
      const hierarchySegments = [
        body.regionName,
        body.departmentName,
        body.unitName,
      ].filter(Boolean);

      const allocatedToName =
        body.allocatedToName ||
        (hierarchySegments.length > 0 ? hierarchySegments.join(' > ') : 'General Fleet Allocation');

      const record = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `INSERT INTO fleet_allocations (
          id, vehicle_id, allocated_to_type, allocated_to_id, allocated_to_name,
          region_id, region_name, department_id, department_name, unit_id, unit_name,
          allocation_date, expected_return_date, purpose, authorized_by,
          mileage_at_allocation, notes, status, created_at, updated_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12::timestamptz, $13::timestamptz, $14, $15,
          $16::int, $17, $18, $19::timestamptz, $20::timestamptz
        ) RETURNING *`,
        id,
        String(body.vehicleId),
        body.allocatedToType ?? 'HIERARCHY',
        body.allocatedToId ?? null,
        allocatedToName,
        body.regionId ?? null,
        body.regionName ?? null,
        body.departmentId ?? null,
        body.departmentName ?? null,
        body.unitId ?? null,
        body.unitName ?? null,
        body.allocationDate ? new Date(body.allocationDate).toISOString() : now,
        body.expectedReturnDate ? new Date(body.expectedReturnDate).toISOString() : null,
        body.purpose ?? null,
        body.authorizedBy ?? null,
        body.mileageAtAllocation != null && body.mileageAtAllocation !== '' ? Number(body.mileageAtAllocation) : null,
        body.notes ?? null,
        body.status ?? 'ACTIVE',
        now,
        now,
      );

      // Update vehicle lifecycle stage and operational status, and record hierarchy
      if (body.vehicleId) {
        await tx.$executeRawUnsafe(
          `UPDATE vehicles 
           SET lifecycle_stage = 'ALLOCATED', 
               status = 'RENTED',
               region_id = COALESCE($1, region_id),
               region_name = COALESCE($2, region_name),
               department_id = COALESCE($3, department_id),
               department_name = COALESCE($4, department_name),
               unit_id = COALESCE($5, unit_id),
               unit_name = COALESCE($6, unit_name),
               hierarchy_name = COALESCE($7, hierarchy_name),
               updated_at = $8::timestamptz 
           WHERE id = $9`,
          body.regionId ?? null,
          body.regionName ?? null,
          body.departmentId ?? null,
          body.departmentName ?? null,
          body.unitId ?? null,
          body.unitName ?? null,
          allocatedToName,
          now,
          String(body.vehicleId),
        );

        // Auto-capture lifecycle event
        await recordLifecycleEvent(tx, {
          vehicleId: String(body.vehicleId),
          eventType: 'DRIVER_ALLOCATION',
          description: `Vehicle allocated to: ${allocatedToName}${body.purpose ? ` (Purpose: ${body.purpose})` : ''}`,
          toStage: 'ALLOCATED',
          performedBy: body.authorizedBy || 'Fleet Operations',
          metadata: {
            allocationId: id,
            regionId: body.regionId,
            regionName: body.regionName,
            departmentId: body.departmentId,
            departmentName: body.departmentName,
            unitId: body.unitId,
            unitName: body.unitName,
            mileageAtAllocation: body.mileageAtAllocation,
            expectedReturnDate: body.expectedReturnDate,
          },
        }).catch(() => {});
      }

      return NextResponse.json(rowToCamel(record[0]), { status: 201 });
    } catch (e) {
      console.error('Error creating allocation:', e);
      return NextResponse.json({ error: 'Failed to create allocation' }, { status: 500 });
    }
  });
}
