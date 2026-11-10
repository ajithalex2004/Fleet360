export const dynamic = 'force-dynamic';

/**
 * POST /api/dispatch/location — vehicle GPS heartbeat
 * Called by driver app every 10–30 seconds.
 *
 * Body: { vehicleId, lat, lng, heading?, speedKmh?, accuracyM? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

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
      const { vehicleId, lat, lng, heading, speedKmh, accuracyM } = body;
      if (!vehicleId || lat == null || lng == null) {
        return NextResponse.json({ error: 'vehicleId, lat, lng are required' }, { status: 400 });
      }

      // Verify vehicle belongs to this tenant
      const [veh] = await tx.$queryRawUnsafe<{ id: string; assigned_driver_id: string | null }[]>(
        `SELECT id::text AS id, assigned_driver_id::text AS assigned_driver_id
         FROM vehicles
         WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
         LIMIT 1`,
        String(vehicleId),
        tenantId,
      );
      if (!veh) {
        return NextResponse.json({ error: 'Vehicle not found in this tenant' }, { status: 404 });
      }

      await tx.$executeRawUnsafe(`
        INSERT INTO vehicle_locations (vehicle_id, tenant_id, lat, lng, heading, speed_kmh, accuracy_m, recorded_at, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'GPS')
        ON CONFLICT (vehicle_id) DO UPDATE SET
          tenant_id   = EXCLUDED.tenant_id,
          lat         = EXCLUDED.lat,
          lng         = EXCLUDED.lng,
          heading     = EXCLUDED.heading,
          speed_kmh   = EXCLUDED.speed_kmh,
          accuracy_m  = EXCLUDED.accuracy_m,
          recorded_at = NOW(),
          source      = 'GPS'
      `,
        String(vehicleId),
        tenantId,
        Number(lat),
        Number(lng),
        heading   != null ? Number(heading)   : null,
        speedKmh  != null ? Number(speedKmh)  : null,
        accuracyM != null ? Number(accuracyM) : null,
      );

      // Also update driver_availability last_ping via assigned_driver_id or vehicle_id
      await tx.$executeRawUnsafe(`
        UPDATE driver_availability
        SET last_ping = NOW(), updated_at = NOW()
        WHERE vehicle_id = $1
           OR ($2::text IS NOT NULL AND driver_id = $2::text)
      `, String(vehicleId), veh.assigned_driver_id ?? null).catch(() => {});

      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error('[dispatch/location POST]', err);
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}

/** GET /api/dispatch/location?vehicleId=X — get last known position (scoped to tenant) */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await ensureDispatchSchema();
      const vehicleId = new URL(req.url).searchParams.get('vehicleId');
      if (!vehicleId) return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });

      const [row] = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`
        SELECT vl.*
        FROM vehicle_locations vl
        LEFT JOIN vehicles v ON v.id::text = vl.vehicle_id
        WHERE vl.vehicle_id = $1
          AND (vl.tenant_id = $2 OR v.tenant_id::text = $2)
        LIMIT 1
      `, vehicleId, tenantId);

      if (!row) return NextResponse.json({ error: 'No location found' }, { status: 404 });

      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v instanceof Date ? v.toISOString() : v;
      }
      return NextResponse.json(out);
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  });
}
