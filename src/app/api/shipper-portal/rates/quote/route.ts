/**
 * POST /api/shipper-portal/rates/quote
 *
 * Shipper-facing rate preview. The shipper portal can't hit the operator
 * endpoint /api/logistics/rates/quote (different auth cookie + the shim
 * mints an operator JWT). This route bridges the gap:
 *
 *   1. Authenticate via shipper-portal session cookie.
 *   2. Stamp customerId from the session (NEVER from the body — a shipper
 *      can only request a rate for their own contracts).
 *   3. Try the upstream Go rate engine if configured and reachable; otherwise
 *      fall back seamlessly to the local TypeScript rate engine (quoteShipment)
 *      under tenant RLS so rate previews always work even without the Go binary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';
import { signJwtForBackend } from '@/lib/auth/jwt';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { quoteShipment } from '@/lib/logistics/rate-engine';

/** Role of backend tokens minted for shipper-portal users (no staff rights). */
const SHIPPER_PORTAL_BACKEND_ROLE = 'SHIPPER_PORTAL';
export const runtime = 'nodejs';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? '';

interface IncomingBody {
  origin?: string | null;
  destination?: string | null;
  vehicleType?: string | null;
  serviceLevel?: string | null;
  shipmentDate?: string | null;
  distanceKm?: number | null;
  totalWeightKg?: number | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireShipperPortal(req);
  if (auth instanceof NextResponse) return auth;

  let body: IncomingBody;
  try { body = (await req.json()) as IncomingBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Origin + destination are the minimum the rate engine needs. Without them,
  // the engine can't even attempt a lane match — short-circuit instead of
  // making a useless upstream call.
  if (!body.origin?.trim() || !body.destination?.trim()) {
    return NextResponse.json({
      matched: false, reason: 'missing-lane',
      contractId: null, contractNo: null,
      currency: 'AED',
      baseRate: 0, fuelSurchargePct: 0, fuelSurchargeAmount: 0,
      minCharge: 0, minChargeApplied: false,
      subtotal: 0, total: 0,
      alternates: [],
    });
  }

  // If GO_BACKEND_URL is explicitly configured, try upstream first and fall back to local TS engine on error
  if (GO_BACKEND_URL) {
    try {
      const token = await signJwtForBackend({
        userId: auth.userId,
        tenantId: auth.tenantId,
        role: SHIPPER_PORTAL_BACKEND_ROLE,
      });

      const res = await fetch(`${GO_BACKEND_URL}/api/v1/logistics/rates/quote`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: body.origin.trim(),
          destination: body.destination.trim(),
          vehicleType: body.vehicleType ?? null,
          serviceLevel: body.serviceLevel ?? null,
          customerId: auth.customerId,
          shipmentDate: body.shipmentDate ?? null,
          distanceKm: body.distanceKm ?? null,
          totalWeightKg: body.totalWeightKg ?? null,
        }),
      });
      if (res.ok) {
        const text = await res.text();
        return new NextResponse(text, {
          status: res.status,
          headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
        });
      }
    } catch {
      // Fall through to local TS rate engine
    }
  }

  try {
    const quote = await withTenantRls(prisma, auth.tenantId, () =>
      quoteShipment({
        tenantId: auth.tenantId,
        origin: body.origin!.trim(),
        destination: body.destination!.trim(),
        vehicleType: body.vehicleType ?? null,
        serviceLevel: body.serviceLevel ?? null,
        customerId: auth.customerId,
        shipmentDate: body.shipmentDate ?? null,
        distanceKm: body.distanceKm ?? null,
        weightKg: body.totalWeightKg ?? null,
      }),
    );
    return NextResponse.json(quote);
  } catch (err) {
    console.error('[shipper-portal/rates/quote] local quoteShipment failed', err);
    return NextResponse.json({ error: 'Failed to calculate rate quote.' }, { status: 500 });
  }
}
