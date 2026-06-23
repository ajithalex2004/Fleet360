/**
 * /api/fleet/vehicles/dropdown
 *
 * Slim endpoint for the maintenance ticket creation form (and any other
 * dropdown-style UI). Returns only the fields the form needs — no
 * pagination — and supports tenant + branch + scope filtering.
 *
 * Why a dedicated endpoint when /api/fleet/vehicles already exists?
 *   • That endpoint is paginated; dropdowns want every accessible vehicle.
 *   • That endpoint returns the full row; dropdowns want a slim payload.
 *   • Scope filtering (Phase 2E) is a tree walk that's awkward to overlay
 *     on the existing endpoint without changing its behaviour.
 *
 * Filtering precedence (most specific wins):
 *   ?vehicleId=…   single vehicle (used to re-resolve after pick)
 *   ?branchId=…    single branch
 *   ?scopeId=…     scope tree — walks service_scopes children to collect
 *                  every branch/region underneath, then matches vehicles by
 *                  branch_id. Falls back to "all branches" if scope can't
 *                  be resolved.
 *   (none)         all non-deleted vehicles for the tenant
 *
 * Response shape is shared with the form — keep it stable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';

interface Row {
  id: string;
  vehicle_code: string | null;
  license_plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicle_type_id: string | null;
  vehicle_type_name: string | null;
  vehicle_class: string | null;
  vehicle_group: string | null;
  vehicle_usage: string | null;
  branch_id: string | null;
  branch_name: string | null;
  status: string | null;
  current_mileage: number | null;
  odometer_reading: number | null;
}

export interface VehicleDropdownItem {
  id: string;
  vehicleCode: string | null;
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  /** "Toyota Camry 2022" — pre-rendered display label */
  makeModelYear: string;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  vehicleClass: string | null;
  vehicleGroup: string | null;
  vehicleUsage: string | null;
  branchId: string | null;
  branchName: string | null;
  status: string | null;
  /** Last known odometer reading — auto-fills the form's "current odometer"
   *  field as a starting suggestion, the user enters the reading they
   *  observed. */
  lastOdometer: number | null;
}

function rowToItem(r: Row): VehicleDropdownItem {
  const parts = [r.make, r.model, r.year ? String(r.year) : null].filter(Boolean);
  return {
    id: r.id,
    vehicleCode:    r.vehicle_code,
    licensePlate:   r.license_plate,
    make:           r.make,
    model:          r.model,
    year:           r.year,
    makeModelYear:  parts.join(' ') || '—',
    vehicleTypeId:   r.vehicle_type_id,
    vehicleTypeName: r.vehicle_type_name,
    vehicleClass:    r.vehicle_class,
    vehicleGroup:    r.vehicle_group,
    vehicleUsage:    r.vehicle_usage,
    branchId:        r.branch_id,
    branchName:      r.branch_name,
    status:          r.status,
    // Prefer odometer_reading (newer field) over current_mileage when both
    // are present; older Fleet rows may only have one populated.
    lastOdometer: r.odometer_reading != null ? Number(r.odometer_reading)
                 : r.current_mileage  != null ? Number(r.current_mileage)
                 : null,
  };
}

export async function GET(req: NextRequest) {
  await ensureFleetSchema();
  try {
    const tenantId = req.headers.get('x-tenant-id') ?? '';
    const sp = req.nextUrl.searchParams;
    const vehicleId = sp.get('vehicleId');
    const branchId  = sp.get('branchId');
    const scopeId   = sp.get('scopeId');
    const status = (sp.get('status') ?? '').trim().toUpperCase();
    const availableOnly = ['1', 'true', 'yes'].includes((sp.get('availableOnly') ?? '').toLowerCase());
    const excludeLeaseAssigned = ['1', 'true', 'yes'].includes((sp.get('excludeLeaseAssigned') ?? '').toLowerCase());

    const conditions: string[] = ['v.deleted_at IS NULL'];
    const args: unknown[] = [];

    // Tenant scoping. The vehicles table doesn't carry tenant_id directly
    // (legacy schema), but the middleware sets x-tenant-id and downstream
    // queries rely on branch_id / hierarchy_id to scope. We surface tenant
    // via header for parity; when no tenantId is present we still let the
    // query through (Super Admin / platform context).
    if (tenantId) {
      // Best-effort tenant scoping via tenants → branches → vehicles. If the
      // tenant_branches table isn't populated yet we fall through to the
      // un-scoped query rather than hiding everything.
      try {
        const branchRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text FROM tenant_branches WHERE tenant_id = $1`,
          tenantId,
        );
        if (branchRows.length > 0) {
          args.push(branchRows.map(b => b.id));
          conditions.push(`v.branch_id = ANY($${args.length}::text[])`);
        }
      } catch {
        // tenant_branches not present — skip the scoping
      }
    }

    if (vehicleId) {
      args.push(vehicleId);
      conditions.push(`v.id::text = $${args.length}`);
    } else if (branchId) {
      args.push(branchId);
      conditions.push(`v.branch_id = $${args.length}`);
    } else if (scopeId && tenantId) {
      // Scope subtree: collect every descendant scope, then match vehicles
      // whose branch_id matches one of those scope keys (we treat
      // service_scopes.key as the branch identifier — admins set them up
      // to mirror branch codes).
      try {
        const scopeRows = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
          `WITH RECURSIVE subtree AS (
             SELECT id, key FROM service_scopes
              WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
             UNION ALL
             SELECT s.id, s.key FROM service_scopes s
               JOIN subtree st ON s.parent_scope_id = st.id
              WHERE s.tenant_id = $2 AND s.deleted_at IS NULL
           )
           SELECT key FROM subtree`,
          scopeId, tenantId,
        );
        const keys = scopeRows.map(s => s.key).filter(k => !!k);
        if (keys.length > 0) {
          args.push(keys);
          conditions.push(`v.branch_id = ANY($${args.length}::text[])`);
        }
      } catch {
        // Service scopes table not initialised — fall through
      }
    }

    const statusFilter = status || (availableOnly ? 'AVAILABLE' : '');
    if (!vehicleId && statusFilter) {
      args.push(statusFilter);
      conditions.push(`UPPER(COALESCE(v.status, 'AVAILABLE')) = $${args.length}`);
    }

    if (!vehicleId && excludeLeaseAssigned) {
      conditions.push(`
        NOT EXISTS (
          SELECT 1
            FROM lease_contract_vehicles lcv
            JOIN lease_contracts_v2 lc ON lc.id::text = lcv.contract_id::text
           WHERE lcv.vehicle_id::text = v.id::text
             AND COALESCE(lcv.status, 'ACTIVE') = 'ACTIVE'
             AND COALESCE(lc.status, 'DRAFT') NOT IN ('CLOSED', 'TERMINATED', 'CANCELLED', 'EXPIRED')
             AND lc.deleted_at IS NULL
        )
      `);
    }

    const where = conditions.join(' AND ');
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT v.id::text                AS id,
              v.vehicle_code            AS vehicle_code,
              v.license_plate           AS license_plate,
              v.make                    AS make,
              v.model                   AS model,
              v.year::int               AS year,
              v.vehicle_type_id         AS vehicle_type_id,
              vt.name                   AS vehicle_type_name,
              v.vehicle_class           AS vehicle_class,
              v.vehicle_group           AS vehicle_group,
              v.vehicle_usage           AS vehicle_usage,
              v.branch_id               AS branch_id,
              v.branch_name             AS branch_name,
              v.status                  AS status,
              v.current_mileage::bigint AS current_mileage,
              v.odometer_reading::bigint AS odometer_reading
         FROM vehicles v
         LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
        WHERE ${where}
        ORDER BY v.license_plate NULLS LAST, v.make NULLS LAST, v.model NULLS LAST
        LIMIT 1000`,
      ...args,
    );

    return NextResponse.json(
      { vehicles: rows.map(rowToItem) },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
    );
  } catch (e) {
    console.error('[vehicles/dropdown] GET error:', e);
    return NextResponse.json({ error: 'Failed to load vehicles' }, { status: 500 });
  }
}
