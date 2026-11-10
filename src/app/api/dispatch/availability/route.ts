export const dynamic = 'force-dynamic';

/**
 * Driver Availability API
 *
 * GET   /api/dispatch/availability            — list driver availability (with filters)
 * POST  /api/dispatch/availability            — driver checks in (start shift)
 * PATCH /api/dispatch/availability            — update status / shift info
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function serialize(rows: Row[]): Row[] {
  return rows.map(r => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
      if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
      out[k] = v;
    }
    return out;
  });
}

/* ─────────────────────────────────────────────
   GET — List available drivers with vehicle &
   last-known location for dispatch dashboard
───────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();

      const sp          = new URL(req.url).searchParams;
      const status      = sp.get('status')      ?? '';
      const serviceType = sp.get('serviceType') ?? '';
      const zoneId      = sp.get('zoneId')      ?? '';
      const page        = Math.max(1, parseInt(sp.get('page')  ?? '1'));
      const limit       = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset      = (page - 1) * limit;

      const conditions: string[] = [];
      const values: unknown[]    = [];

      const add = (cond: string, val: unknown) => {
        values.push(val);
        conditions.push(`${cond} = $${values.length}`);
      };

      add('d.tenant_id::text', tenantId);
      if (status) add('da.status', status);
      if (zoneId) add('da.zone_id', zoneId);
      if (serviceType) {
        values.push(`%${serviceType}%`);
        conditions.push(`da.service_types::text ILIKE $${values.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const [rows, countRows] = await Promise.all([
        tx.$queryRawUnsafe<Row[]>(`
          SELECT
            da.*,
            COALESCE(NULLIF(TRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')), ''), d.name) AS driver_name,
            d.contact_number                                              AS driver_phone,
            COALESCE(d.rating, 4.5)                                       AS driver_rating,
            COALESCE(v.registration_no, v.license_plate, v.plate_number)  AS vehicle_reg,
            v.type                                                        AS vehicle_type,
            COALESCE(v.seating_capacity, v.capacity, 4)                   AS vehicle_capacity,
            v.make                                                        AS vehicle_make,
            v.model                                                       AS vehicle_model,
            vl.lat                                                        AS last_lat,
            vl.lng                                                        AS last_lng,
            vl.heading                                                    AS last_heading,
            vl.speed_kmh                                                  AS last_speed_kmh,
            vl.recorded_at                                                AS location_updated_at
          FROM driver_availability da
          JOIN drivers d  ON d.id::text = da.driver_id AND d.deleted_at IS NULL
          LEFT JOIN vehicles v  ON v.id::text = COALESCE(da.vehicle_id, d.assigned_vehicle_id::text) AND v.deleted_at IS NULL
          LEFT JOIN vehicle_locations vl ON vl.vehicle_id = COALESCE(da.vehicle_id, v.id::text)
          ${where}
          ORDER BY da.status ASC, da.last_ping DESC NULLS LAST
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}
        `, ...values, limit, offset),

        tx.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT COUNT(*) AS count
           FROM driver_availability da
           JOIN drivers d ON d.id::text = da.driver_id AND d.deleted_at IS NULL
           ${where}`,
          ...values
        ),
      ]);

      const total = Number(countRows[0]?.count ?? 0);

      return NextResponse.json({
        data:  serialize(rows),
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      });
    } catch (err) {
      console.error('[dispatch/availability GET]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}

/* ─────────────────────────────────────────────
   POST — Driver checks in / starts shift
───────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const {
        driverId,
        vehicleId,
        zoneId,
        serviceTypes = ['PASSENGER'],
        shiftStartsAt,
      } = body as {
        driverId?: string;
        vehicleId?: string;
        zoneId?: string;
        serviceTypes?: string[];
        shiftStartsAt?: string;
      };

      if (!driverId) {
        return NextResponse.json({ error: 'driverId is required' }, { status: 400 });
      }

      // Verify driver belongs to this tenant
      const [driver] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM drivers WHERE id = $1::uuid AND tenant_id::text = $2 AND deleted_at IS NULL`,
        driverId,
        tenantId,
      );
      if (!driver) {
        return NextResponse.json({ error: 'Driver not found in this tenant' }, { status: 404 });
      }

      // If vehicleId is supplied, verify it belongs to this tenant
      if (vehicleId) {
        const [vehicle] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM vehicles WHERE id = $1::uuid AND tenant_id::text = $2 AND deleted_at IS NULL`,
          vehicleId,
          tenantId,
        );
        if (!vehicle) {
          return NextResponse.json({ error: 'Vehicle not found in this tenant' }, { status: 404 });
        }
      }

      const shiftStart = shiftStartsAt ? new Date(shiftStartsAt) : new Date();

      await tx.$executeRawUnsafe(`
        INSERT INTO driver_availability
          (driver_id, tenant_id, vehicle_id, status, zone_id, service_types, shift_start, shift_starts_at, last_ping, updated_at)
        VALUES
          ($1, $2, $3, 'AVAILABLE', $4, $5::jsonb, $6, $6, NOW(), NOW())
        ON CONFLICT (driver_id) DO UPDATE SET
          tenant_id       = EXCLUDED.tenant_id,
          vehicle_id      = EXCLUDED.vehicle_id,
          status          = 'AVAILABLE',
          zone_id         = EXCLUDED.zone_id,
          service_types   = EXCLUDED.service_types,
          shift_start     = EXCLUDED.shift_start,
          shift_starts_at = EXCLUDED.shift_starts_at,
          last_ping       = NOW(),
          updated_at      = NOW()
      `,
        driverId,
        tenantId,
        vehicleId ?? null,
        zoneId ?? null,
        JSON.stringify(serviceTypes),
        shiftStart,
      );

      // Update vehicle status to AVAILABLE scoped to tenant
      if (vehicleId) {
        await tx.$executeRawUnsafe(`
          UPDATE vehicles SET status = 'AVAILABLE', updated_at = NOW()
          WHERE id = $1::uuid AND tenant_id::text = $2 AND deleted_at IS NULL
        `, vehicleId, tenantId).catch(() => {});
      }

      return NextResponse.json({ ok: true, driverId, status: 'AVAILABLE' }, { status: 201 });
    } catch (err) {
      console.error('[dispatch/availability POST]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}

/* ─────────────────────────────────────────────
   PATCH — Update driver status / shift end
───────────────────────────────────────────── */
export async function PATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { driverId, status, vehicleId, zoneId, shiftEndsAt } = body as {
        driverId?: string;
        status?: string;
        vehicleId?: string;
        zoneId?: string;
        shiftEndsAt?: string;
      };

      if (!driverId) {
        return NextResponse.json({ error: 'driverId is required' }, { status: 400 });
      }

      const VALID_STATUSES = ['AVAILABLE', 'BUSY', 'BREAK', 'OFF_DUTY', 'OFFLINE'];
      if (status && !VALID_STATUSES.includes(status)) {
        return NextResponse.json({
          error: `status must be one of: ${VALID_STATUSES.join(', ')}`,
        }, { status: 400 });
      }

      // Verify driver belongs to this tenant
      const [driver] = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM drivers WHERE id = $1::uuid AND tenant_id::text = $2 AND deleted_at IS NULL`,
        driverId,
        tenantId,
      );
      if (!driver) {
        return NextResponse.json({ error: 'Driver not found in this tenant' }, { status: 404 });
      }

      const setClauses: string[] = ['last_ping = NOW()', 'updated_at = NOW()'];
      const values: unknown[]    = [driverId, tenantId];

      if (status)      { values.push(status);      setClauses.push(`status = $${values.length}`); }
      if (vehicleId)   { values.push(vehicleId);   setClauses.push(`vehicle_id = $${values.length}`); }
      if (zoneId)      { values.push(zoneId);      setClauses.push(`zone_id = $${values.length}`); }
      if (shiftEndsAt) {
        values.push(new Date(shiftEndsAt));
        setClauses.push(`shift_ends_at = $${values.length}`, `shift_end = $${values.length}`);
      }
      if (status === 'OFF_DUTY' || status === 'OFFLINE') {
        setClauses.push(`hours_worked_today = COALESCE(EXTRACT(EPOCH FROM (NOW() - COALESCE(shift_starts_at, shift_start))) / 3600.0, hours_worked_today, 0)`);
      }

      const [updated] = await tx.$queryRawUnsafe<{ driver_id: string }[]>(`
        UPDATE driver_availability
        SET ${setClauses.join(', ')}
        WHERE driver_id = $1 AND (tenant_id IS NULL OR tenant_id = $2)
        RETURNING driver_id
      `, ...values);

      if (!updated) {
        return NextResponse.json(
          { error: 'Driver availability record not found — driver must check in first' },
          { status: 404 }
        );
      }

      if (vehicleId && (status === 'OFF_DUTY' || status === 'BREAK' || status === 'OFFLINE')) {
        await tx.$executeRawUnsafe(`
          UPDATE vehicles SET status = 'AVAILABLE', updated_at = NOW()
          WHERE id = $1::uuid AND tenant_id::text = $2 AND deleted_at IS NULL
        `, vehicleId, tenantId).catch(() => {});
      }

      return NextResponse.json({ ok: true, driverId: updated.driver_id, status });
    } catch (err) {
      console.error('[dispatch/availability PATCH]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
