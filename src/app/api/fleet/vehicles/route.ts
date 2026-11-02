export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireUnderQuota } from '@/lib/plan-limits';
import { revalidateCache } from '@/lib/server-cache';
import type { PlanCode } from '@/lib/billing';

import { recordLifecycleEvent } from '@/lib/fleet/lifecycle-events';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const FLEET_STATS_TAG = 'fleet:stats';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

let fleetSchemaEnsured = false;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  if (!fleetSchemaEnsured) {
    await ensureFleetSchema().catch(() => {});
    fleetSchemaEnsured = true;
  }
  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const search = sp.get('search');
      const status = sp.get('status');
      const vehicleUsage = sp.get('vehicleUsage');
      const branchId = sp.get('branchId');
      const lifecycleStage = sp.get('lifecycleStage');
      const vehicleTypeId = sp.get('vehicleTypeId');
      const zoneId = sp.get('zoneId');
      const { take, skip, page, limit } = paginate(sp);

      const conditions: string[] = ['v.deleted_at IS NULL'];
      const params: unknown[] = [];

      if (search && search.trim()) {
        const s = `%${search.trim().toLowerCase()}%`;
        params.push(s);
        conditions.push(`(
          LOWER(v.vehicle_code) LIKE $${params.length} OR
          LOWER(COALESCE(v.license_plate, '')) LIKE $${params.length} OR
          LOWER(COALESCE(v.make, '')) LIKE $${params.length} OR
          LOWER(COALESCE(v.model, '')) LIKE $${params.length} OR
          LOWER(COALESCE(v.vin, '')) LIKE $${params.length}
        )`);
      }
      if (status) {
        params.push(status);
        conditions.push(`v.status = $${params.length}`);
      }
      if (vehicleUsage) {
        params.push(vehicleUsage);
        conditions.push(`v.vehicle_usage = $${params.length}`);
      }
      if (branchId) {
        params.push(branchId);
        conditions.push(`v.branch_id = $${params.length}`);
      }
      if (lifecycleStage) {
        params.push(lifecycleStage);
        conditions.push(`v.lifecycle_stage = $${params.length}`);
      }
      if (vehicleTypeId) {
        params.push(vehicleTypeId);
        conditions.push(`v.vehicle_type_id = $${params.length}`);
      }
      if (zoneId) {
        params.push(zoneId);
        conditions.push(`v.zone_id = $${params.length}`);
      }

      const where = conditions.join(' AND ');
      const countParams = [...params];
      const dataParams = [...params];
      dataParams.push(take, skip);

      const [countResult, rows] = await Promise.all([
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count
           FROM vehicles v
           LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
           WHERE ${where}`,
          ...countParams,
        ),
        tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT v.*, vt.name AS vehicle_type_name, vt.vehicle_group, vt.vehicle_class,
                  z.name AS zone_name,
                  COALESCE(NULLIF(d.name, ''), TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, '')))) AS assigned_driver_name,
                  d.contact_number AS assigned_driver_phone
           FROM vehicles v
           LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
           LEFT JOIN spatial.places z ON z.id = v.zone_id
           LEFT JOIN drivers d ON d.id::text = v.assigned_driver_id::text
           WHERE ${where}
           ORDER BY v.created_at DESC
           LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
          ...dataParams,
        ),
      ]);

      const total = Number(countResult[0].count);
      const data = rows.map(rowToCamel);

      return NextResponse.json(paginatedResponse(data, total, page, limit));
    } catch (e) {
      console.error('Error fetching vehicles:', e);
      return NextResponse.json({ error: 'Failed to fetch vehicles' }, { status: 500 });
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
      const tenantPlan = (req.headers.get('x-tenant-plan') ?? 'TRIAL') as PlanCode;
      {
        const rows = await tx.$queryRawUnsafe<{ c: bigint }[]>(
          `SELECT COUNT(*)::bigint AS c FROM vehicles WHERE tenant_id::text = $1 AND deleted_at IS NULL`,
          tenantId,
        ).catch(() => []);
        const current = rows[0] ? Number(rows[0].c) : 0;
        const gate = requireUnderQuota({ plan: tenantPlan, resource: 'maxVehicles', current });
        if (gate) return gate;
      }

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      const id = crypto.randomUUID();
      const now = new Date();

      let vehicleCode = body.vehicleCode ?? body.vehicle_code ?? null;
      if (!vehicleCode) {
        const seqResult = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) as count FROM vehicles`,
        );
        const seq = Number(seqResult[0].count) + 1;
        vehicleCode = 'VEH-' + String(seq).padStart(6, '0');
      }

      const regExp = body.registrationExpiryDate || body.registrationExpiry ? new Date(body.registrationExpiryDate || body.registrationExpiry) : null;
      const insExp = body.insuranceExpiryDate || body.insuranceExpiry ? new Date(body.insuranceExpiryDate || body.insuranceExpiry) : null;

      const record = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `INSERT INTO vehicles (
          id, tenant_id, vehicle_code, make, model, type, year, vin, chassis_no, color,
          seating_capacity, zone_id,
          license_plate, registration_no, plate_number,
          plate_code, plate_category, emirate, vehicle_type_id, vehicle_usage,
          hierarchy_id, hierarchy_name, branch_id, branch_name, region_id, region_name, department_id, department_name, unit_id, unit_name, device_id,
          sim_card_no, lifecycle_stage, purchase_date,
          purchase_price, acquisition_type, odometer_reading, fuel_level,
          status, notes, category, registration_expiry, insurance_expiry, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12,
          $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
          $32, $33, $34::timestamptz,
          $35, $36, $37, $38,
          $39, $40, $41, $42::timestamptz, $43::timestamptz, $44::timestamptz, $45::timestamptz
        ) RETURNING *`,
        id,
        tenantId,
        vehicleCode,
        body.make ?? null,
        body.model ?? null,
        body.type ?? null,
        body.year ?? null,
        body.vin || null,
        body.chassisNo ?? null,
        body.color ?? null,
        body.seatingCapacity ?? body.seating_capacity ?? null,
        body.zoneId ?? body.zone_id ?? null,
        body.licensePlate || null,
        body.registrationNo ?? null,
        body.plateNumber ?? null,
        body.plateCode ?? null,
        body.plateCategory ?? null,
        body.emirate ?? null,
        body.vehicleTypeId ?? null,
        body.vehicleUsage ?? null,
        body.hierarchyId ?? null,
        body.hierarchyName ?? null,
        body.branchId ?? null,
        body.branchName ?? null,
        body.regionId ?? null,
        body.regionName ?? null,
        body.departmentId ?? null,
        body.departmentName ?? null,
        body.unitId ?? null,
        body.unitName ?? null,
        body.deviceId ?? null,
        body.simCardNo ?? null,
        body.lifecycleStage ?? 'ACTIVE',
        body.purchaseDate || null,
        body.purchasePrice ?? null,
        body.acquisitionType ?? null,
        body.odometerReading ?? null,
        body.fuelLevel ?? null,
        body.status ?? 'AVAILABLE',
        body.notes ?? null,
        body.category ?? null,
        regExp,
        insExp,
        now,
        now,
      );

      await recordLifecycleEvent(tx, {
        vehicleId: id,
        eventType: 'ACTIVATION',
        description: `Vehicle registered in Fleet Master (${body.make || ''} ${body.model || ''})`.trim(),
        referenceNo: vehicleCode,
        toStage: body.lifecycleStage ?? 'ACTIVE',
        performedBy: 'System / Vehicle Registration',
        eventDate: body.purchaseDate || now,
        notes: body.notes ?? null,
      }).catch(() => {});

      revalidateCache([FLEET_STATS_TAG]);
      return NextResponse.json(rowToCamel(record[0]), { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Error creating vehicle:', msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
