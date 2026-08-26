/**
 * GET /api/logistics/rfqs
 *
 * Lists the tenant's freight RFQs (the load board) with their bid counts, then
 * enriches each with its shipment's lane / customer / vehicle so the marketplace
 * page can show what each load actually is. Thin wrapper over domain.listFreightRfqs
 * plus a single batched shipment lookup — no N+1.
 *
 * The marketplace write path (award) stays in Next.js/Prisma because it posts to
 * the shared Finance tables; this read surface lives alongside it.
 *
 * Auth: tenant operator session; tenantId comes from the middleware-set
 * x-tenant-id header, never the query.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { listFreightRfqs, createFreightRfq } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface ShipmentLaneRow {
  id: string;
  origin_name: string | null;
  destination_name: string | null;
  cargo_owner_name: string | null;
  requested_vehicle_type: string | null;
  // Shipper-declared cargo classification bag (haulage / customs / hazmat).
  // Small jsonb; sent so the marketplace detail panel can render classification
  // chips without a second round-trip.
  metadata: Record<string, unknown> | null;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const search = sp.get('search');
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 1), 500);

  try {
    const rfqs = await listFreightRfqs({ tenantId, status, search, limit });

    // Batch-load the lane/customer/vehicle for the referenced shipments so the
    // board shows what each load is — one query, not one per RFQ.
    const shipmentIds = [...new Set(rfqs.map(r => r.shipmentOrderId).filter(Boolean))];
    const laneById = new Map<string, { origin: string | null; destination: string | null; customerName: string | null; vehicleType: string | null; metadata: Record<string, unknown> | null }>();
    if (shipmentIds.length > 0) {
      const ph = shipmentIds.map((_, i) => `$${i + 2}`).join(',');
      // Only this query is wrapped, not the listFreightRfqs call above it:
      // that helper starts with ensureLogisticsDomainTables(), and running DDL
      // inside a tenant transaction is not something to do casually.
      //
      // The .catch stays outside the wrapper on purpose. A rejection now rolls
      // the transaction back first and the fallback is applied after, which is
      // the same observable behaviour as before without leaving an aborted
      // transaction open.
      const rows = await withTenantRls(prisma, tenantId, async (tx) =>
        tx.$queryRawUnsafe<ShipmentLaneRow[]>(
          `SELECT id, origin_name, destination_name, cargo_owner_name, requested_vehicle_type, metadata
             FROM logistics_shipment_orders
            WHERE tenant_id = $1 AND deleted_at IS NULL AND id IN (${ph})`,
          tenantId, ...shipmentIds,
        ),
      ).catch(() => [] as ShipmentLaneRow[]);
      for (const r of rows) {
        laneById.set(r.id, {
          origin: r.origin_name,
          destination: r.destination_name,
          customerName: r.cargo_owner_name,
          vehicleType: r.requested_vehicle_type,
          metadata: r.metadata,
        });
      }
    }

    const data = rfqs.map(r => ({ ...r, shipment: laneById.get(r.shipmentOrderId) ?? null }));
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, max-age=15' } });
    } catch (e) {
    console.error('[logistics/rfqs GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list RFQs' },
      { status: 500 },
    );
  }
}

// ── POST — post a load to the marketplace (create an RFQ) ─────────────────────

interface PostLoadBody {
  shipmentOrderId?: string;
  inviteScope?: string | null;        // SELECTED_CARRIERS | ALL_ACTIVE_CARRIERS
  invitedCarrierIds?: string[];
  bidDeadlineAt?: string | null;
  rfqNo?: string | null;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: PostLoadBody;
  try { body = (await req.json()) as PostLoadBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.shipmentOrderId) {
    return NextResponse.json({ error: 'shipmentOrderId is required' }, { status: 400 });
  }
  const inviteScope = body.inviteScope === 'ALL_ACTIVE_CARRIERS' ? 'ALL_ACTIVE_CARRIERS' : 'SELECTED_CARRIERS';
  const invitedCarrierIds = Array.isArray(body.invitedCarrierIds)
    ? body.invitedCarrierIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (inviteScope === 'SELECTED_CARRIERS' && invitedCarrierIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one carrier to invite (or choose all active carriers)' }, { status: 400 });
  }

  try {
    // createFreightRfq creates the RFQ AND flips the shipment to OPEN.
    const rfq = await createFreightRfq({
      tenantId,
      shipmentOrderId: body.shipmentOrderId,
      rfqNo: body.rfqNo?.trim() || null,
      inviteScope,
      invitedCarrierIds,
      bidDeadlineAt: body.bidDeadlineAt || null,
      status: 'OPEN',
    });
    return NextResponse.json(rfq, { status: 201 });
    } catch (e) {
    console.error('[logistics/rfqs POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to post the load' },
      { status: 500 },
    );
  }
}
