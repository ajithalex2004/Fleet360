import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { fetchShipmentById, listShipmentExecutionTimeline, recordLogisticsFieldOpsEvent } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface PodBody {
  recipientName?: string;
  recipientSignature?: string;
  photos?: string[];
  documents?: string[];
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracy?: number;
  deliveryNote?: string;
  submittedBy?: string;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const timeline = await listShipmentExecutionTimeline({ tenantId, shipmentOrderId: params.id });
  if (!timeline) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  return NextResponse.json({
    shipment: timeline.shipment,
    pod: timeline.pods[0] ?? null,
    pods: timeline.pods,
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let body: PodBody;
  try { body = (await req.json()) as PodBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.recipientName?.trim()) {
    return NextResponse.json({ error: 'recipientName is required' }, { status: 400 });
  }
  if (!body.recipientSignature?.trim()) {
    return NextResponse.json({ error: 'recipientSignature is required' }, { status: 400 });
  }

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  try {
    const result = await recordLogisticsFieldOpsEvent({
      tenantId,
      shipmentOrderId: params.id,
      eventType: 'DELIVERY_CONFIRMED',
      occurredAt: new Date().toISOString(),
      latitude: body.gpsLat ?? null,
      longitude: body.gpsLng ?? null,
      recipientName: body.recipientName.trim(),
      signatureUrl: body.recipientSignature,
      photoUrls: body.photos ?? [],
      documentUrls: body.documents ?? [],
      remarks: body.deliveryNote ?? null,
      actorUserId: req.headers.get('x-user-id') ?? body.submittedBy ?? null,
      metadata: {
        deliveryNote: body.deliveryNote ?? '',
        gpsAccuracy: body.gpsAccuracy ?? null,
        submittedBy: body.submittedBy ?? 'Driver',
        source: 'shipment-epod',
      },
    });

    return NextResponse.json({
      success: true,
      pod: result?.pods?.[0] ?? null,
      shipment: result?.shipment ?? null,
    }, { status: 201 });
    } catch (e) {
    console.error('[logistics/shipments/:id/pod POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save POD' },
      { status: 500 },
    );
  }
}
