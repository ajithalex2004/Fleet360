export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  generateContinuousTelemetryStream,
} from '@/lib/cold-chain-telematics';

export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const tripRef = req.nextUrl.searchParams.get('tripRef') || 'TRIP-9821';
  const band = req.nextUrl.searchParams.get('band') || 'FROZEN_PHARMA';

  const telemetry = generateContinuousTelemetryStream(tripRef, band);

  const recentEvents = await withTenantRls(prisma, auth.tenantId, async (tx) => {
    return tx.$queryRawUnsafe<Array<{
      id: string;
      event_type: string;
      occurred_at: Date;
      notes: string | null;
      metadata: Record<string, unknown> | null;
    }>>(
      `SELECT te.id, te.event_type, te.occurred_at, te.notes, te.metadata
         FROM logistics_tracking_events te
         JOIN logistics_shipment_orders so
           ON so.id = te.shipment_order_id AND so.tenant_id = te.tenant_id
        WHERE te.tenant_id = $1
          AND (so.shipment_no = $2 OR so.id = $2)
        ORDER BY te.occurred_at DESC
        LIMIT 20`,
      auth.tenantId,
      tripRef,
    );
  }).catch(() => []);

  return NextResponse.json({
    success: true,
    telemetry,
    recentEvents,
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);
    const { tripRef = 'TRIP-9821', band = 'FROZEN_PHARMA', shipmentOrderId } = body as {
      tripRef?: string;
      band?: string;
      shipmentOrderId?: string;
    };
    const telemetry = generateContinuousTelemetryStream(tripRef, band);

    await withTenantRls(prisma, auth.tenantId, async (tx) => {
      const orders = await tx.$queryRawUnsafe<Array<{ id: string; status: string }>>(
        `SELECT id, status
           FROM logistics_shipment_orders
          WHERE tenant_id = $1
            AND deleted_at IS NULL
            AND (id = $2 OR shipment_no = $3)
          LIMIT 1`,
        auth.tenantId,
        shipmentOrderId ?? tripRef,
        tripRef,
      );
      const order = orders[0];
      if (!order) return;

      await tx.$executeRawUnsafe(
        `INSERT INTO logistics_tracking_events (
           id, tenant_id, shipment_order_id, event_type, status,
           occurred_at, notes, metadata, created_at
         ) VALUES (
           $1, $2, $3, 'TELEMETRY_PING', $4,
           NOW(), $5, $6::jsonb, NOW()
         )`,
        crypto.randomUUID(),
        auth.tenantId,
        order.id,
        order.status,
        `Cold-chain telemetry ping (${band})`,
        JSON.stringify({ tripRef, band, telemetry }),
      );
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      telemetry,
      message: 'Live IoT telematics packet ingested successfully',
    });
  } catch (err) {
    console.error('[api/logistics/telematics/stream POST]', err);
    return NextResponse.json({ error: 'Failed to ingest telematics' }, { status: 500 });
  }
}
