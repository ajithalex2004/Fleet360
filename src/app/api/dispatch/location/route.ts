/**
 * POST /api/dispatch/location — vehicle GPS heartbeat
 * Called by driver app every 10–30 seconds.
 *
 * Body: { vehicleId, lat, lng, heading?, speedKmh?, accuracyM? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';

export async function POST(req: NextRequest) {
  try {
    await ensureDispatchSchema();

    const { vehicleId, lat, lng, heading, speedKmh, accuracyM } = await req.json();
    if (!vehicleId || lat == null || lng == null) {
      return NextResponse.json({ error: 'vehicleId, lat, lng are required' }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(`
      INSERT INTO vehicle_locations (vehicle_id, lat, lng, heading, speed_kmh, accuracy_m, recorded_at, source)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'GPS')
      ON CONFLICT (vehicle_id) DO UPDATE SET
        lat         = EXCLUDED.lat,
        lng         = EXCLUDED.lng,
        heading     = EXCLUDED.heading,
        speed_kmh   = EXCLUDED.speed_kmh,
        accuracy_m  = EXCLUDED.accuracy_m,
        recorded_at = NOW(),
        source      = 'GPS'
    `,
      String(vehicleId),
      Number(lat),
      Number(lng),
      heading  != null ? Number(heading)  : null,
      speedKmh != null ? Number(speedKmh) : null,
      accuracyM != null ? Number(accuracyM) : null,
    );

    // Also update driver_availability last_ping
    await prisma.$executeRawUnsafe(`
      UPDATE driver_availability
      SET last_ping = NOW()
      WHERE driver_id IN (
        SELECT driver_id::text FROM vehicles WHERE id::text = $1 LIMIT 1
      )
    `, String(vehicleId)).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[dispatch/location POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /api/dispatch/location?vehicleId=X — get last known position */
export async function GET(req: NextRequest) {
  try {
    await ensureDispatchSchema();
    const vehicleId = new URL(req.url).searchParams.get('vehicleId');
    if (!vehicleId) return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });

    const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      SELECT * FROM vehicle_locations WHERE vehicle_id = $1
    `, vehicleId);

    if (!row) return NextResponse.json({ error: 'No location found' }, { status: 404 });

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = v instanceof Date ? v.toISOString() : v;
    }
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
