export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { rejectForeignIdentifiers, requireDriverActor } from '@/lib/driver-app-actor';
import { requireDriverSessionForTenant } from '@/lib/driver-session';
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
 * Receives periodic high-accuracy GPS telemetry pings from the driver app
 * and updates vehicle position for live dispatch visibility.
 *
 * Only an active driver of the session's tenant may send pings, and only
 * for the vehicle of their own IN_PROGRESS trip (src/lib/driver-app-actor.ts).
 * With no active trip the ping is acknowledged but not stored. A body
 * driverId/vehicleId naming anyone or anything else is rejected with 403.
 *
 * (Restored: a drayage change had replaced this with a handler that took
 * anonymous pings, resolving the tenant from a body vehicle id or a
 * hard-coded tenant, and writing to a hard-coded fallback vehicle.)
 */
export async function POST(req: NextRequest) {
  const origin = corsOrigin(req);
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return withCorsHeaders(NextResponse.json({ error: authz.error }, { status: authz.status }), origin);
  }
  const { tenantId } = authz;
  // Verify the credential before opening a transaction, so requests without
  // a valid driver session never touch the database.
  const session = await requireDriverSessionForTenant(req, tenantId);
  if (session instanceof NextResponse) return withCorsHeaders(session, origin);

  return withTenantRls(prisma, tenantId, async (tx) => {
    const actor = await requireDriverActor(tx, session);
    if (actor instanceof NextResponse) return withCorsHeaders(actor, origin);

    try {
      const rawBody = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(rawBody);

      const {
        lat,
        lng,
        speedKmh = 0,
        heading = 0,
        accuracy = 0,
      } = body;

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return withCorsHeaders(
          NextResponse.json({ error: 'Valid lat and lng numbers are required' }, { status: 400 }),
          origin,
        );
      }

      const vehicle = actor.activeTrip?.vehicle ?? null;
      const foreign = rejectForeignIdentifiers(actor, body, vehicle);
      if (foreign) return withCorsHeaders(foreign, origin);

      // Live position is tracked in BusGpsPing, the table the telematics
      // gateway and geofence evaluator read. The vehicle is the one on the
      // driver's own IN_PROGRESS trip; the client does not choose it.
      if (!vehicle) {
        return withCorsHeaders(
          NextResponse.json({
            ok: true,
            recorded: false,
            reason: 'No trip in progress for this driver; location not recorded.',
            timestamp: new Date().toISOString(),
          }),
          origin,
        );
      }

      await tx.busGpsPing.create({
        data: {
          tenantId,
          vehicleId: vehicle.id,
          latitude: lat,
          longitude: lng,
          speedKmh,
          headingDeg: heading,
          accuracyM: accuracy,
          occurredAt: new Date(),
          source: 'DRIVER_APP',
        },
      });

      return withCorsHeaders(
        NextResponse.json({
          ok: true,
          recorded: true,
          vehicleId: vehicle.id,
          lat,
          lng,
          timestamp: new Date().toISOString(),
        }),
        origin,
      );
    } catch (err) {
      console.error('[api/driver-app/telematics/live-location POST]', err);
      return withCorsHeaders(
        NextResponse.json({ error: 'Failed to process location ping' }, { status: 500 }),
        origin,
      );
    }
  });
}
