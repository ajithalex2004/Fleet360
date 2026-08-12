import { NextRequest, NextResponse } from 'next/server';
import {
  fetchShipmentById,
  recordLogisticsFieldOpsEvent,
  resolveCarrierAppDevice,
} from '@/lib/logistics/domain';

export const runtime = 'nodejs';

interface CarrierPodBody {
  recipientName?: string | null;
  recipientSignature?: string | null;
  photos?: string[] | null;
  documents?: string[] | null;
  gpsLat?: number | string | null;
  gpsLng?: number | string | null;
  gpsAccuracy?: number | string | null;
  deliveryNote?: string | null;
  submittedBy?: string | null;
}

async function requireDevice(req: NextRequest) {
  const token = req.headers.get('x-carrier-app-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  return resolveCarrierAppDevice(token);
}

async function requireAssignedShipment(req: NextRequest, shipmentOrderId: string) {
  const device = await requireDevice(req);
  if (!device) return { error: NextResponse.json({ error: 'Invalid carrier app token' }, { status: 401 }) };

  const shipment = await fetchShipmentById(shipmentOrderId, device.tenantId);
  if (!shipment) return { error: NextResponse.json({ error: 'Load not found' }, { status: 404 }) };
  if (shipment.assigned_carrier_id !== device.carrierId) {
    return { error: NextResponse.json({ error: 'Load is not assigned to this carrier' }, { status: 403 }) };
  }
  return { device, shipment };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAssignedShipment(req, params.id);
  if ('error' in auth) return auth.error;

  let body: CarrierPodBody;
  try { body = (await req.json()) as CarrierPodBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.recipientName?.trim()) {
    return NextResponse.json({ error: 'recipientName is required' }, { status: 400 });
  }
  if (!body.recipientSignature?.trim()) {
    return NextResponse.json({ error: 'recipientSignature is required' }, { status: 400 });
  }

  try {
    const result = await recordLogisticsFieldOpsEvent({
      tenantId: auth.device.tenantId,
      shipmentOrderId: params.id,
      eventType: 'DELIVERY_CONFIRMED',
      occurredAt: new Date().toISOString(),
      latitude: numberOrNull(body.gpsLat),
      longitude: numberOrNull(body.gpsLng),
      recipientName: body.recipientName.trim(),
      signatureUrl: body.recipientSignature,
      photoUrls: body.photos ?? [],
      documentUrls: body.documents ?? [],
      remarks: body.deliveryNote ?? null,
      actorUserId: `carrier:${auth.device.carrierId}`,
      metadata: {
        deliveryNote: body.deliveryNote ?? '',
        gpsAccuracy: numberOrNull(body.gpsAccuracy),
        submittedBy: body.submittedBy ?? 'Carrier driver',
        source: 'carrier-app-epod',
        carrierId: auth.device.carrierId,
        deviceId: auth.device.deviceId,
      },
    });

    return NextResponse.json({
      success: true,
      pod: result?.pods?.[0] ?? null,
      shipment: result?.shipment ?? null,
    }, { status: 201 });
  } catch (e) {
    console.error('[carrier-portal/app/loads/:id/pod POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to submit carrier POD' },
      { status: 400 },
    );
  }
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
