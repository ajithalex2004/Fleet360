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
 *   3. Mint a Bearer JWT from the tenant + customer identity and forward
 *      the request to the Go rate engine.
 *   4. Relay Go's response back to the browser unchanged.
 *
 * The same engine is used as for operator quotes — contract-aware, with the
 * spot-market fallback. Returns the same QuoteResult the operator UI gets;
 * the shipper form uses it for a live estimate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';
import { signJwtForBackend } from '@/lib/auth/jwt';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? 'http://localhost:8080';

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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

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

  let token: string;
  try {
    // Mint a JWT scoped to the shipper's tenant. The role is TENANT_ADMIN
    // because the rate engine is a read-only operation gated by tenant_id;
    // a finer-grained "SHIPPER" role isn't a thing Go validates on this path.
    token = await signJwtForBackend({
      userId: auth.userId,
      tenantId: auth.tenantId,
      role: 'TENANT_ADMIN',
    });
  } catch (err) {
    console.warn('[shipper-portal/rates/quote] backend JWT sign failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Rate engine is not available right now.' }, { status: 503 });
  }

  try {
    const res = await fetch(`${GO_BACKEND_URL}/api/v1/logistics/rates/quote`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: body.origin.trim(),
        destination: body.destination.trim(),
        vehicleType: body.vehicleType ?? null,
        serviceLevel: body.serviceLevel ?? null,
        // Customer id is ALWAYS the session's — never the body. This is what
        // lets the engine match customer-scoped contracts; trusting the body
        // would let one shipper preview another shipper's rates.
        customerId: auth.customerId,
        shipmentDate: body.shipmentDate ?? null,
        distanceKm: body.distanceKm ?? null,
        totalWeightKg: body.totalWeightKg ?? null,
      }),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    console.error('[shipper-portal/rates/quote] upstream call failed', err);
    return NextResponse.json({ error: 'Rate engine is unreachable.' }, { status: 502 });
  }
}
