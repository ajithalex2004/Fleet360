/**
 * /api/shipper-portal/shipments
 *
 *   GET   — list the logged-in shipper's shipments (customer-scoped). These are
 *           job orders the operator has already created (converted) from the
 *           shipper's requests; lightweight projection for the list page.
 *   POST  — submit a new SHIPPING REQUEST (model A + route-through-review). The
 *           submission no longer creates a shipment order directly; it lands in
 *           the operator's review inbox as a logistics_shipping_request
 *           (source=SHIPPER_PORTAL). The operator reviews → converts it into a
 *           job order, at which point it appears in the GET list above.
 *
 * Tenant + customer are taken from the session, NEVER from the body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireShipperPortal } from '@/lib/shipper-portal/auth';
import { createShipmentOrder, createShippingRequest, LogisticsValidationError } from '@/lib/logistics/domain';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

// ── GET — list converted job orders ────────────────────────────────────────

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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

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
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<ListRow[]>(
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

      // Pending shipping requests (not yet converted into a job order) so the
      // shipper sees their submission immediately, with a review status.
      const requestRows = await tx.$queryRawUnsafe<Array<{
        id: string; request_no: string; status: string;
        origin_name: string | null; destination_name: string | null;
        pickup_window_from: string | null; created_at: string;
      }>>(
        `SELECT id::text, request_no, status,
                origin_name, destination_name,
                pickup_window_from::text, created_at::text
           FROM logistics_shipping_requests
          WHERE tenant_id = $1 AND shipper_id = $2 AND deleted_at IS NULL
            AND status IN ('SUBMITTED','UNDER_REVIEW','ACCEPTED')
          ORDER BY created_at DESC
          LIMIT 50`,
        auth.tenantId, auth.customerId,
      ).catch(() => []);

      const requests = requestRows.map(r => ({
        id: r.id,
        requestNo: r.request_no,
        status: r.status,
        origin: { name: r.origin_name },
        destination: { name: r.destination_name },
        pickupWindowFrom: r.pickup_window_from,
        submittedAt: r.created_at,
      }));

      return NextResponse.json(
        { shipments, requests, limit, offset },
        { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
      );
    });
    } catch (e) {
    console.error('[shipper-portal/shipments] GET', e);
    return NextResponse.json({ shipments: [], requests: [], limit, offset }, { status: 200 });
  }
}

// ── POST — submit a shipping request (review inbox) ─────────────────────────

interface IncomingBody {
  pickup?: {
    name?: string | null; address?: string | null;
    city?: string | null; country?: string | null;
    contactName?: string | null; contactPhone?: string | null;
    windowFrom?: string | null; windowTo?: string | null;
    instructions?: string | null;
  };
  delivery?: {
    name?: string | null; address?: string | null;
    city?: string | null; country?: string | null;
    contactName?: string | null; contactPhone?: string | null;
    windowFrom?: string | null; windowTo?: string | null;
    instructions?: string | null;
  };
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
  shipmentType?: string | null;
  requestedVehicleType?: string | null;
  priority?: 'Low' | 'Medium' | 'High';
  specialInstructions?: string | null;
  bookingMode?: 'review' | 'book';
  acceptedQuoteAmount?: number | string | null;
  /** INLAND (no customs) | CROSS_BORDER (customs clearance section applies). */
  haulage?: 'INLAND' | 'CROSS_BORDER' | null;
  /** Customs section — only present when haulage = CROSS_BORDER. */
  customs?: {
    cargoType?: string | null;
    hsCode?: string | null;
    netWeightKg?: number | null;
    grossWeightKg?: number | null;
    customsValue?: number | null;
    customsCurrency?: string | null;
    incoterms?: string | null;
    originCountry?: string | null;
  } | null;
  /** Dangerous-goods / regulated-cargo declaration — independent of haulage. */
  hazmat?: {
    unNumber?: string | null;
    unClass?: string | null;
    packingGroup?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  } | null;
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

  if (!body.pickup?.address && !body.pickup?.name) {
    return NextResponse.json({ error: 'Pickup location is required' }, { status: 400 });
  }
  if (!body.delivery?.address && !body.delivery?.name) {
    return NextResponse.json({ error: 'Delivery location is required' }, { status: 400 });
  }
  if (!body.cargoLines?.length || !body.cargoLines[0].description) {
    return NextResponse.json({ error: 'At least one cargo line is required' }, { status: 400 });
  }

  const totalWeightKg = body.cargoLines.reduce(
    (sum, c) => sum + ((c.quantity ?? 1) * (c.weightKg ?? 0)), 0,
  );
  const totalVolumeCbm = body.cargoLines.reduce(
    (sum, c) => sum + ((c.quantity ?? 1) * (c.volumeCbm ?? 0)), 0,
  );
  const goodsDescription = body.cargoLines
    .map(c => c.description)
    .filter(Boolean)
    .join('; ')
    .slice(0, 500) || null;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      if (body.bookingMode === 'book') {
        const shipment = await createShipmentOrder({
          tenantId: auth.tenantId,
          cargoOwnerCustomerId: auth.customerId,
          cargoOwnerName: auth.user.fullName ?? null,
          shipmentType: body.shipmentType ?? null,
          bookingMode: 'SPOT',
          marketplaceStatus: 'PRIVATE',
          status: 'PENDING',
          priority: body.priority ?? 'Medium',
          originName: body.pickup?.name || body.pickup?.address || null,
          originAddress: body.pickup?.address ?? null,
          destinationName: body.delivery?.name || body.delivery?.address || null,
          destinationAddress: body.delivery?.address ?? null,
          pickupWindowFrom: body.pickup?.windowFrom ?? null,
          pickupWindowTo: body.pickup?.windowTo ?? null,
          deliveryWindowFrom: body.delivery?.windowFrom ?? null,
          deliveryWindowTo: body.delivery?.windowTo ?? null,
          requestedVehicleType: body.requestedVehicleType ?? null,
          totalWeightKg: totalWeightKg > 0 ? totalWeightKg : null,
          totalVolumeCbm: totalVolumeCbm > 0 ? totalVolumeCbm : null,
          customerRateAmount: num(body.acceptedQuoteAmount),
          currency: 'AED',
          sourceChannel: 'SHIPPER_PORTAL_BOOK_NOW',
          notes: body.specialInstructions ?? null,
          metadata: {
            priority: body.priority ?? 'Medium',
            pickup: body.pickup ?? null,
            delivery: body.delivery ?? null,
            cargoLines: body.cargoLines ?? [],
            submittedByPortalUserId: auth.userId,
            shipperAcceptedQuote: body.acceptedQuoteAmount != null,
            // Shipper-declared cargo classification — preserved on the order so
            // the operator + downstream carrier see HS/INCOTERMS/DG class.
            haulage: body.haulage ?? 'INLAND',
            customs: body.customs ?? null,
            hazmat: body.hazmat ?? null,
          },
          cargoLines: body.cargoLines?.map(line => ({
            description: line.description,
            quantity: line.quantity ?? null,
            packageType: line.packageType ?? null,
            weightKg: line.weightKg ?? null,
            volumeCbm: line.volumeCbm ?? null,
            isHazmat: Boolean(line.isHazmat),
            tempMinC: line.tempMinC ?? null,
            tempMaxC: line.tempMaxC ?? null,
          })),
          stops: [
            {
              stopType: 'PICKUP',
              sequenceNo: 1,
              locationName: body.pickup?.name || body.pickup?.address || null,
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
              locationName: body.delivery?.name || body.delivery?.address || null,
              address: body.delivery?.address ?? null,
              contactName: body.delivery?.contactName ?? null,
              contactPhone: body.delivery?.contactPhone ?? null,
              plannedArrivalAt: body.delivery?.windowFrom ?? null,
              plannedDepartAt: body.delivery?.windowTo ?? null,
              instructions: body.delivery?.instructions ?? null,
            },
          ],
          createdBy: auth.userId,
        });

        return NextResponse.json({
          shipment: shipment ? { id: shipment.id, shipmentNo: shipment.shipment_no, status: shipment.status } : null,
          message: 'Your shipment was booked and is now available for tracking.',
        }, { status: 201 });
      }

      // The full pickup/delivery/cargo payload is stashed in metadata so the
      // operator can rebuild stops + cargo lines when they convert the request.
      const request = await createShippingRequest({
        tenantId: auth.tenantId,
        shipperId: auth.customerId,
        source: 'SHIPPER_PORTAL',
        createdBy: auth.userId,
        shipmentType: body.shipmentType ?? null,
        requestedVehicleType: body.requestedVehicleType ?? null,
        originName: body.pickup?.name || body.pickup?.address || null,
        originAddress: body.pickup?.address ?? null,
        destinationName: body.delivery?.name || body.delivery?.address || null,
        destinationAddress: body.delivery?.address ?? null,
        pickupWindowFrom: body.pickup?.windowFrom ?? null,
        pickupWindowTo: body.pickup?.windowTo ?? null,
        deliveryWindowFrom: body.delivery?.windowFrom ?? null,
        deliveryWindowTo: body.delivery?.windowTo ?? null,
        totalWeightKg: totalWeightKg > 0 ? totalWeightKg : null,
        totalVolumeCbm: totalVolumeCbm > 0 ? totalVolumeCbm : null,
        goodsDescription,
        specialInstructions: body.specialInstructions ?? null,
        metadata: {
          priority: body.priority ?? 'Medium',
          pickup: body.pickup ?? null,
          delivery: body.delivery ?? null,
          cargoLines: body.cargoLines ?? [],
          submittedByPortalUserId: auth.userId,
          // Carried through into the operator's review inbox; the convert step
          // mirrors these onto the shipment order's metadata.
          haulage: body.haulage ?? 'INLAND',
          customs: body.customs ?? null,
          hazmat: body.hazmat ?? null,
        },
      });

      return NextResponse.json({
        request: request ? { id: request.id, requestNo: request.requestNo, status: request.status } : null,
        message: 'Your shipping request was submitted and is awaiting review by our team.',
      }, { status: 201 });
    });
    } catch (e) {
    if (e instanceof LogisticsValidationError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    console.error('[shipper-portal/shipments] POST', e);
    const msg = e instanceof Error ? e.message : 'Failed to submit shipping request';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
