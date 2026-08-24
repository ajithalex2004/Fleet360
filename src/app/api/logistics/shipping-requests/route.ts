/**
 * /api/logistics/shipping-requests
 *
 *   GET   list shipping requests (the demand intake inbox). Filter by status,
 *         shipper, or free-text search.
 *   POST  file a new shipping request on behalf of an onboarded shipper.
 *
 * Auth: tenant operator session; tenantId / actor from x-tenant-id / x-user-id.
 * (The shipper-portal self-service path lands in Phase 3 under /api/shipper-portal.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { listShippingRequests, createShippingRequest, LogisticsValidationError } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const shipperId = sp.get('shipperId');
  const search = sp.get('search');
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 1), 500);

  try {
    const data = await listShippingRequests({ tenantId, status, shipperId, search, limit });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[logistics/shipping-requests GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list shipping requests' },
      { status: 500 },
    );
  }
}

interface CreateRequestBody {
  shipperId?: string;
  shipmentType?: string | null;
  originName?: string | null;
  originAddress?: string | null;
  destinationName?: string | null;
  destinationAddress?: string | null;
  pickupWindowFrom?: string | null;
  pickupWindowTo?: string | null;
  deliveryWindowFrom?: string | null;
  deliveryWindowTo?: string | null;
  requestedVehicleType?: string | null;
  totalWeightKg?: number | string | null;
  totalVolumeCbm?: number | string | null;
  cargoValueAmount?: number | string | null;
  currency?: string | null;
  goodsDescription?: string | null;
  specialInstructions?: string | null;
  referenceNo?: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });
  const createdBy = req.headers.get('x-user-id');

  let body: CreateRequestBody;
  try { body = (await req.json()) as CreateRequestBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.shipperId) {
    return NextResponse.json({ error: 'A shipper is required' }, { status: 400 });
  }

  try {
    const request = await createShippingRequest({
      tenantId,
      shipperId: body.shipperId,
      shipmentType: body.shipmentType ?? null,
      originName: body.originName ?? null,
      originAddress: body.originAddress ?? null,
      destinationName: body.destinationName ?? null,
      destinationAddress: body.destinationAddress ?? null,
      pickupWindowFrom: body.pickupWindowFrom ?? null,
      pickupWindowTo: body.pickupWindowTo ?? null,
      deliveryWindowFrom: body.deliveryWindowFrom ?? null,
      deliveryWindowTo: body.deliveryWindowTo ?? null,
      requestedVehicleType: body.requestedVehicleType ?? null,
      totalWeightKg: num(body.totalWeightKg),
      totalVolumeCbm: num(body.totalVolumeCbm),
      cargoValueAmount: num(body.cargoValueAmount),
      currency: body.currency ?? null,
      goodsDescription: body.goodsDescription ?? null,
      specialInstructions: body.specialInstructions ?? null,
      referenceNo: body.referenceNo ?? null,
      source: 'OPERATOR',
      createdBy,
    });
    return NextResponse.json({ data: request }, { status: 201 });
  } catch (e) {
    if (e instanceof LogisticsValidationError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    console.error('[logistics/shipping-requests POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to create shipping request' },
      { status: 500 },
    );
  }
}
