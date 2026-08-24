/**
 * POST /api/driver-app/heartbeat
 *
 * The gig driver's (owner-operator carrier's) mobile app posts its GPS + status
 * here on an interval. The bearer token IS the credential — it resolves to a
 * carrier via domain.resolveCarrierAppDevice (no operator session; this path is
 * exempt from the session middleware). Upserts one presence row per carrier,
 * which feeds the "nearest idle drivers" pool for a load broadcast.
 *
 * Auth:  Authorization: Bearer <device-token>   (or { token } in the body)
 * Body:  { lat, lng, availability?, vehicleType?, accuracyM?, heading?, speedKph? }
 *
 * NOTE: the mobile-app onboarding/login that mints the device token is still
 * being designed; tokens are issued today by the operator via
 * POST /api/logistics/carriers/[id]/app-device. The auth seam here is final —
 * only how the token gets minted will change.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveCarrierAppDevice, upsertCarrierPresence } from '@/lib/logistics/domain';
import { applyDriverTelemetryLimit } from '@/lib/rate-limit-scope';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

function bearer(req: NextRequest, bodyToken?: string): string {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return (m ? m[1] : bodyToken ?? '').trim();
}

interface HeartbeatBody {
  token?: string;
  lat?: number | string;
  lng?: number | string;
  availability?: string | null;
  vehicleType?: string | null;
  accuracyM?: number | null;
  heading?: number | null;
  speedKph?: number | null;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let body: HeartbeatBody;
  try { body = (await req.json()) as HeartbeatBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const token = bearer(req, body.token);
  if (!token) {
    return NextResponse.json({ error: 'Missing device token' }, { status: 401 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'Valid lat/lng are required' }, { status: 400 });
  }

  try {
    const device = await resolveCarrierAppDevice(token);
    if (!device) {
      return NextResponse.json({ error: 'Invalid or inactive device token' }, { status: 401 });
    }

    // R2: per-driver telemetry rate limit. Runs AFTER token resolution so we
    // have (tenantId, carrierId) for the bucket key — one flooding device
    // can only block itself, not other drivers or the tenant's normal API
    // traffic. See src/lib/rate-limit-scope.ts for the design rationale.
    const rl = await applyDriverTelemetryLimit(
      req.nextUrl.pathname,
      { tenantId: device.tenantId, userId: device.carrierId },
    );
    if (rl) return rl;

    const availability = ['IDLE', 'ON_JOB', 'OFFLINE'].includes(String(body.availability ?? '').toUpperCase())
      ? String(body.availability).toUpperCase()
      : 'IDLE';

    await upsertCarrierPresence({
      tenantId: device.tenantId,
      carrierId: device.carrierId,
      latitude: lat,
      longitude: lng,
      availability,
      vehicleType: body.vehicleType ?? null,
      accuracyM: body.accuracyM ?? null,
      heading: body.heading ?? null,
      speedKph: body.speedKph ?? null,
    });
    return NextResponse.json({ ok: true, availability }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[driver-app/heartbeat]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'heartbeat failed' },
      { status: 500 },
    );
  }
}
