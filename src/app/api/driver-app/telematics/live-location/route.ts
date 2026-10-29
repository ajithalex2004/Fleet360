export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * Origins allowed to call this route cross-origin with credentials: the
 * driver app's WebView (capacitor.config.ts server.hostname 'localhost2':
 * https on Android, capacitor:// on iOS) and the web app's own origin.
 * Reflecting any Origin with Allow-Credentials let any website send
 * credentialed requests here from a signed-in driver's browser.
 */
function allowedOrigins(): Set<string> {
  const origins = new Set(['https://localhost2', 'capacitor://localhost2', 'https://localhost', 'capacitor://localhost']);
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) origins.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
  } catch {
    // malformed URL: no extra origin
  }
  return origins;
}

function corsOrigin(req: NextRequest): string | null {
  const origin = req.headers.get('origin');
  return origin && allowedOrigins().has(origin) ? origin : null;
}

function withCorsHeaders(res: NextResponse, origin: string | null): NextResponse {
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.headers.set('Vary', 'Origin');
  }
  return res;
}

/**
 * OPTIONS /api/driver-app/telematics/live-location
 * CORS preflight from the driver app's WebView. Preflights carry no
 * credentials, so there is no session to check; it reads and writes
 * nothing, and only allowlisted origins get CORS headers.
 */
export async function OPTIONS(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  const origin = corsOrigin(req);
  if (origin) res.headers.set('Access-Control-Max-Age', '86400');
  return withCorsHeaders(res, origin);
}

/**
 * POST /api/driver-app/telematics/live-location
 *
 * Periodic GPS pings from the signed-in driver's app, for live dispatch and
 * telematics. The tenant is the session's. This used to accept anonymous
 * pings: the tenant was taken from whatever vehicle id the body named, else
 * a hard-coded tenant, and the vehicle fell back to a hard-coded one — so
 * anyone could plant positions on any vehicle.
 */
export async function POST(req: NextRequest) {
  const origin = corsOrigin(req);
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return withCorsHeaders(NextResponse.json({ error: authz.error }, { status: authz.status }), origin);
  }
  const { tenantId } = authz;

  const rawBody = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(rawBody as Record<string, unknown>);

  const vehicleRef = typeof body.vehicleId === 'string' && body.vehicleId.trim()
    ? body.vehicleId.trim()
    : req.cookies.get('xl-driver-vehicle-id')?.value ?? null;
  if (!vehicleRef) {
    return withCorsHeaders(NextResponse.json({ error: 'vehicleId is required' }, { status: 400 }), origin);
  }

  const { lat, lng, speedKmh = 0, heading = 0, accuracy = 0 } = body as Record<string, unknown>;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    Number.isNaN(lat) ||
    Number.isNaN(lng) ||
    (lat === 0 && lng === 0) ||
    (Math.abs(lat - 25.2048) < 0.0001 && Math.abs(lng - 55.2708) < 0.0001)
  ) {
    return withCorsHeaders(
      NextResponse.json({ error: 'Valid real device GPS coordinates required' }, { status: 400 }),
      origin,
    );
  }

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      // The vehicle must be the caller's tenant's: by id, else by plate/code.
      const vehicle =
        (await tx.vehicle.findFirst({
          where: { id: vehicleRef, tenantId, deletedAt: null },
          select: { id: true },
        })) ??
        (await tx.vehicle.findFirst({
          where: { tenantId, deletedAt: null, OR: [{ licensePlate: vehicleRef }, { vehicleCode: vehicleRef }] },
          select: { id: true },
        }));
      if (!vehicle) {
        return withCorsHeaders(NextResponse.json({ ok: false, error: 'Vehicle not found' }, { status: 404 }), origin);
      }

      const now = new Date();
      const speed = Math.max(0, Number(speedKmh) || 0);
      await tx.busGpsPing.create({
        data: {
          tenantId,
          vehicleId: vehicle.id,
          latitude: lat,
          longitude: lng,
          speedKmh: speed,
          headingDeg: Math.max(0, Number(heading) || 0),
          accuracyM: Math.max(0, Number(accuracy) || 0),
          occurredAt: now,
          source: 'DRIVER_APP',
        },
      });

      // Touch the vehicle so live fleet queries see the movement at once.
      await tx.vehicle.update({ where: { id: vehicle.id }, data: { updatedAt: now } });

      return withCorsHeaders(
        NextResponse.json({
          ok: true,
          recorded: true,
          vehicleId: vehicle.id,
          lat,
          lng,
          speedKmh: speed,
          source: 'DRIVER_APP',
          timestamp: now.toISOString(),
        }),
        origin,
      );
    });
  } catch (err) {
    console.error('[api/driver-app/telematics/live-location POST]', err);
    return withCorsHeaders(NextResponse.json({ error: 'Failed to process location ping' }, { status: 500 }), origin);
  }
}
