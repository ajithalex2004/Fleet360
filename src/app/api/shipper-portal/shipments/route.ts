/**
 * /api/shipper-portal/shipments
 *
 *   GET   — list the logged-in shipper's shipments (customer-scoped).
 *           Lightweight projection: id, shipmentNo, status, origin/destination
 *           summary, submittedAt. Detail page calls /[id] for the rest.
 *   POST  — submit a new shipment request. Tenant + customer are taken from
 *           the session, NEVER from the body. status='PENDING' so the
 *           operator sees it in dispatch immediately, sourceChannel
 *           tag lets them filter "from portal" vs "internal".
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';
import {
  createShipmentOrder,
  type LogisticsShipmentCreateInput,
} from '@/lib/logistics/domain';
import { applyContractQuoteToInput } from '@/lib/logistics/rate-engine';

export const runtime = 'nodejs';

// ── GET — list ─────────────────────────────────────────────────────────

interface ListRow {
  id: string;
  shipment_no: string | null;
  status: string;
  origin_name: string | null;
  destination_name: string | null;
  pickup_window_from: string | null;
  delivery_window_from: string | null;
  created_at: string;
  customer_rate_amount: string | null;
  currency: string | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireShipperPortal(req);
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const limit = Math.min(parseInt(sp.get('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(sp.get('offset') ?? '0', 10) || 0;

  const where = ['tenant_id = $1', 'cargo_owner_customer_id = $2', 'deleted_at IS NULL'];
  const args: unknown[] = [auth.tenantId, auth.customerId];
  if (status) { args.push(status); where.push(`status = $${args.length}`); }

  try {
    const rows = await prisma.$queryRawUnsafe<ListRow[]>(
      `SELECT id::text, shipment_no, status,
              origin_name, destination_name,
              pickup_window_from::text, delivery_window_from::text,
              created_at::text, customer_rate_amount::text, currency
         FROM logistics_shipment_orders
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      ...args,
    );

    const shipments = rows.map(r => ({
      id: r.id,
      shipmentNo: r.shipment_no,
      status: r.status,
      origin: { name: r.origin_name, city: null },
      destination: { name: r.destination_name, city: null },
      pickupWindowFrom: r.pickup_window_from,
      deliveryWindowFrom: r.delivery_window_from,
      submittedAt: r.created_at,
      customerRateAmount: r.customer_rate_amount != null ? Number(r.customer_rate_amount) : null,
      currency: r.currency,
    }));

    return NextResponse.json(
      { shipments, limit, offset },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
    );
  } catch (e) {
    console.error('[shipper-portal/shipments] GET', e);
    return NextResponse.json({ shipments: [], limit, offset }, { status: 200 });
  }
}

// ── POST — create ──────────────────────────────────────────────────────

interface IncomingBody {
  // Pickup
  pickup?: {
    name?: string | null; address?: string | null;
    city?: string | null; country?: string | null;
    contactName?: string | null; contactPhone?: string | null;
    windowFrom?: string | null; windowTo?: string | null;
    instructions?: string | null;
  };
  // Delivery
  delivery?: {
    name?: string | null; address?: string | null;
    city?: string | null; country?: string | null;
    contactName?: string | null; contactPhone?: string | null;
    windowFrom?: string | null; windowTo?: string | null;
    instructions?: string | null;
  };
  // Cargo
  cargoLines?: Array<{
    description: string;
    quantity?: number | null;
    packageType?: string | null;
    weightKg?: number | null;
    volumeCbm?: number | null;
    isHazmat?: boolean;
    tempMinC?: number | null;
    tempMaxC?: number | null;
  }>;
  // Other
  shipmentType?: string | null;
  requestedVehicleType?: string | null;
  priority?: 'Low' | 'Medium' | 'High';
  specialInstructions?: string | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireShipperPortal(req);
  if (auth instanceof NextResponse) return auth;

  let body: IncomingBody;
  try { body = (await req.json()) as IncomingBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Required-field validation — return specific errors so the form UX is helpful.
  if (!body.pickup?.address && !body.pickup?.name) {
    return NextResponse.json({ error: 'Pickup location is required' }, { status: 400 });
  }
  if (!body.delivery?.address && !body.delivery?.name) {
    return NextResponse.json({ error: 'Delivery location is required' }, { status: 400 });
  }
  if (!body.cargoLines?.length || !body.cargoLines[0].description) {
    return NextResponse.json({ error: 'At least one cargo line is required' }, { status: 400 });
  }

  // Hydrate cargo-owner details from the customer record so the operator
  // sees them in dispatch without needing to look up the customer separately.
  const customerRows = await prisma.$queryRawUnsafe<Array<{ name_en: string; email: string | null; mobile_number: string | null }>>(
    `SELECT name_en, email, mobile_number
       FROM customers
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    auth.customerId, auth.tenantId,
  ).catch(() => []);
  const customer = customerRows[0];

  // Aggregates so operators see totals immediately.
  const totalWeightKg = body.cargoLines.reduce(
    (sum, c) => sum + ((c.quantity ?? 1) * (c.weightKg ?? 0)), 0,
  );
  const totalVolumeCbm = body.cargoLines.reduce(
    (sum, c) => sum + ((c.quantity ?? 1) * (c.volumeCbm ?? 0)), 0,
  );

  // Build the input the existing engine expects.
  const input: LogisticsShipmentCreateInput = {
    tenantId: auth.tenantId,
    cargoOwnerCustomerId: auth.customerId,
    cargoOwnerName: customer?.name_en ?? null,
    cargoOwnerEmail: auth.user.email ?? customer?.email ?? null,
    cargoOwnerPhone: customer?.mobile_number ?? null,
    bookingMode: 'CONTRACT',                    // operator decides spot/RFQ later
    marketplaceStatus: 'PRIVATE',               // never auto-publish from portal
    status: 'PENDING',                          // skip DRAFT — shipper has signed off
    priority: body.priority ?? 'Medium',
    shipmentType: body.shipmentType ?? null,
    requestedVehicleType: body.requestedVehicleType ?? null,
    originName: body.pickup?.name ?? null,
    originAddress: body.pickup?.address ?? null,
    originCity: body.pickup?.city ?? null,
    originCountry: body.pickup?.country ?? null,
    destinationName: body.delivery?.name ?? null,
    destinationAddress: body.delivery?.address ?? null,
    destinationCity: body.delivery?.city ?? null,
    destinationCountry: body.delivery?.country ?? null,
    pickupWindowFrom:   body.pickup?.windowFrom ?? null,
    pickupWindowTo:     body.pickup?.windowTo ?? null,
    deliveryWindowFrom: body.delivery?.windowFrom ?? null,
    deliveryWindowTo:   body.delivery?.windowTo ?? null,
    totalWeightKg: totalWeightKg > 0 ? totalWeightKg : null,
    totalVolumeCbm: totalVolumeCbm > 0 ? totalVolumeCbm : null,
    stops: [
      {
        stopType: 'PICKUP',
        sequenceNo: 1,
        locationName: body.pickup?.name ?? null,
        address: body.pickup?.address ?? null,
        contactName: body.pickup?.contactName ?? null,
        contactPhone: body.pickup?.contactPhone ?? null,
        plannedArrivalAt: body.pickup?.windowFrom ?? null,
        plannedDepartAt: body.pickup?.windowTo ?? null,
        instructions: body.pickup?.instructions ?? null,
      },
      {
        stopType: 'DELIVERY',
        sequenceNo: 2,
        locationName: body.delivery?.name ?? null,
        address: body.delivery?.address ?? null,
        contactName: body.delivery?.contactName ?? null,
        contactPhone: body.delivery?.contactPhone ?? null,
        plannedArrivalAt: body.delivery?.windowFrom ?? null,
        plannedDepartAt: body.delivery?.windowTo ?? null,
        instructions: body.delivery?.instructions ?? null,
      },
    ],
    cargoLines: body.cargoLines.map(c => ({
      description: c.description,
      quantity: c.quantity ?? null,
      packageType: c.packageType ?? null,
      weightKg: c.weightKg ?? null,
      volumeCbm: c.volumeCbm ?? null,
      isHazmat: !!c.isHazmat,
      tempMinC: c.tempMinC ?? null,
      tempMaxC: c.tempMaxC ?? null,
    })),
    metadata: {
      sourceChannel: 'SHIPPER_PORTAL',
      submittedByPortalUserId: auth.userId,
      submittedAt: new Date().toISOString(),
      specialInstructions: body.specialInstructions ?? null,
    },
    createdBy: auth.userId,
  } as LogisticsShipmentCreateInput;

  try {
    // Look up the contracted rate for this customer × lane × vehicle and
    // populate customerRateAmount + audit metadata. Shippers never quote
    // themselves — if no contract matches, the order still goes through
    // with customerRateAmount=null and a `rateQuote.reason=no-lane-match`
    // record so dispatch knows to set a price manually.
    const { input: quotedInput, quote } = await applyContractQuoteToInput(input);

    const created = await createShipmentOrder(quotedInput);
    if (!created) {
      return NextResponse.json({ error: 'Shipment creation failed' }, { status: 500 });
    }

    // Persist the winning contract id in the dedicated column so dispatch
    // can query "shipments under contract RC-X" without parsing JSONB.
    // Best-effort: column may not exist on very old tenants that haven't
    // run ensureLogisticsDomainTables yet — non-fatal in that case.
    if (quote?.matched && quote.contractId) {
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_shipment_orders
            SET quoted_contract_id = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        quote.contractId, (created as { id: string }).id, auth.tenantId,
      ).catch(() => { /* non-fatal */ });
    }

    // Tag the row with sourceChannel column too (in addition to metadata)
    // so operator-side dispatch filters can use plain SQL.
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_shipment_orders
          SET source_channel = 'SHIPPER_PORTAL', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      (created as { id: string }).id, auth.tenantId,
    ).catch(() => { /* column may not exist on very old tenants — non-fatal */ });

    return NextResponse.json({
      shipment: {
        id: (created as { id: string }).id,
        shipmentNo: (created as { shipmentNo?: string | null }).shipmentNo ?? null,
        status: (created as { status: string }).status,
      },
    }, { status: 201 });
  } catch (e) {
    console.error('[shipper-portal/shipments] POST', e);
    const msg = e instanceof Error ? e.message : 'Failed to create shipment';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
