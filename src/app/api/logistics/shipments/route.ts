/**
 * GET /api/logistics/shipments
 *
 * Lists the tenant's shipment orders for the marketplace "post a load" picker.
 * Thin wrapper over domain.listShipmentOrders. With ?postable=1 it returns only
 * shipments that can still be opened to the marketplace — marketplace_status
 * PRIVATE/DRAFT and a non-terminal lifecycle status — so an operator doesn't
 * re-post a load that's already out for bids, awarded, or delivered.
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { createShipmentOrder, listShipmentOrders } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

const POSTABLE_MARKETPLACE = new Set(['PRIVATE', 'DRAFT', '']);
const TERMINAL_STATUS = new Set(['DELIVERED', 'POD_SUBMITTED', 'COMPLETED', 'CLOSED', 'CANCELLED']);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const search = sp.get('search');
  const postable = sp.get('postable') === '1';
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 1), 500);

  try {
    let data = await listShipmentOrders({ tenantId, search, limit });
    if (postable) {
      data = data.filter((s: { marketplaceStatus?: string | null; status?: string | null }) =>
        POSTABLE_MARKETPLACE.has((s.marketplaceStatus ?? '').toUpperCase()) &&
        !TERMINAL_STATUS.has((s.status ?? '').toUpperCase()),
      );
    }
    return NextResponse.json({ data });
    } catch (e) {
    console.error('[logistics/shipments GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list shipments' },
      { status: 500 },
    );
  }
}

interface ShipmentBody {
  cargoOwnerCustomerId?: string | null;
  cargoOwnerName?: string | null;
  cargoOwnerEmail?: string | null;
  cargoOwnerPhone?: string | null;
  shipmentType?: string | null;
  bookingMode?: string | null;
  marketplaceStatus?: string | null;
  status?: string | null;
  priority?: string | null;
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
  customerRateAmount?: number | string | null;
  notes?: string | null;
  cargoLines?: Array<{ description: string; quantity?: number | null; weightKg?: number | null; volumeCbm?: number | null }>;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: ShipmentBody;
  try { body = (await req.json()) as ShipmentBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.originName && !body.originAddress) {
    return NextResponse.json({ error: 'Pickup location is required' }, { status: 400 });
  }
  if (!body.destinationName && !body.destinationAddress) {
    return NextResponse.json({ error: 'Delivery location is required' }, { status: 400 });
  }

  try {
    const shipment = await createShipmentOrder({
      tenantId,
      cargoOwnerCustomerId: body.cargoOwnerCustomerId ?? null,
      cargoOwnerName: body.cargoOwnerName ?? null,
      cargoOwnerEmail: body.cargoOwnerEmail ?? null,
      cargoOwnerPhone: body.cargoOwnerPhone ?? null,
      shipmentType: body.shipmentType ?? null,
      bookingMode: body.bookingMode ?? 'SPOT',
      marketplaceStatus: body.marketplaceStatus ?? 'PRIVATE',
      status: body.status ?? 'PENDING',
      priority: body.priority ?? 'NORMAL',
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
      currency: body.currency ?? 'AED',
      customerRateAmount: num(body.customerRateAmount),
      sourceChannel: 'OPERATOR_PORTAL',
      notes: body.notes ?? null,
      cargoLines: body.cargoLines,
      createdBy: req.headers.get('x-user-id') ?? null,
    });
    return NextResponse.json({ data: shipment }, { status: 201 });
    } catch (e) {
    console.error('[logistics/shipments POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to create shipment' },
      { status: 500 },
    );
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
