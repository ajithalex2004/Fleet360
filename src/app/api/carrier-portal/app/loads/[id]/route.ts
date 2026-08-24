import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import {
  fetchShipmentById,
  listShipmentExecutionTimeline,
  recordLogisticsFieldOpsEvent,
  resolveCarrierAppDevice,
} from '@/lib/logistics/domain';

export const runtime = 'nodejs';

interface EventBody {
  eventType?: string;
  occurredAt?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  etaAt?: string | null;
  recipientName?: string | null;
  signatureUrl?: string | null;
  photoUrls?: string[] | null;
  documentUrls?: string[] | null;
  remarks?: string | null;
  exceptionSeverity?: string | null;
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

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const auth = await requireAssignedShipment(req, params.id);
  if ('error' in auth) return auth.error;

  try {
    const [timeline, stops, cargoLines, documents, settlement] = await Promise.all([
      listShipmentExecutionTimeline({ tenantId: auth.device.tenantId, shipmentOrderId: params.id }),
      listStops(auth.device.tenantId, params.id),
      listCargoLines(auth.device.tenantId, params.id),
      listDocuments(auth.device.tenantId, params.id),
      getCarrierSettlement(auth.device.tenantId, params.id, auth.device.carrierId),
    ]);

    return NextResponse.json({
      carrierId: auth.device.carrierId,
      shipment: mapShipment(auth.shipment),
      stops,
      cargoLines,
      documents,
      timeline,
      settlement,
    }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
    console.error('[carrier-portal/app/loads/:id GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load carrier load detail' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const auth = await requireAssignedShipment(req, params.id);
  if ('error' in auth) return auth.error;

  let body: EventBody;
  try { body = (await req.json()) as EventBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const eventType = String(body.eventType ?? '').trim().toUpperCase();
  if (!eventType) return NextResponse.json({ error: 'eventType is required' }, { status: 400 });
  if (!ALLOWED_EVENTS.has(eventType)) {
    return NextResponse.json({ error: 'Unsupported carrier execution event' }, { status: 400 });
  }
  if (eventType === 'DELIVERY_CONFIRMED' && !body.recipientName?.trim()) {
    return NextResponse.json({ error: 'recipientName is required for delivery confirmation' }, { status: 400 });
  }
  if (eventType === 'ETA_UPDATED' && !body.etaAt) {
    return NextResponse.json({ error: 'etaAt is required for ETA updates' }, { status: 400 });
  }

  try {
    const result = await recordLogisticsFieldOpsEvent({
      tenantId: auth.device.tenantId,
      shipmentOrderId: params.id,
      eventType,
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      latitude: numberOrNull(body.latitude),
      longitude: numberOrNull(body.longitude),
      etaAt: body.etaAt ?? null,
      recipientName: body.recipientName ?? null,
      signatureUrl: body.signatureUrl ?? null,
      photoUrls: body.photoUrls ?? [],
      documentUrls: body.documentUrls ?? [],
      remarks: body.remarks ?? null,
      exceptionSeverity: body.exceptionSeverity ?? null,
      actorUserId: `carrier:${auth.device.carrierId}`,
      metadata: {
        source: 'carrier-app',
        carrierId: auth.device.carrierId,
        deviceId: auth.device.deviceId,
      },
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
    } catch (e) {
    console.error('[carrier-portal/app/loads/:id POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to record carrier execution update' },
      { status: 400 },
    );
  }
}

const ALLOWED_EVENTS = new Set([
  'PICKUP_CONFIRMED',
  'DELIVERY_CONFIRMED',
  'ETA_UPDATED',
  'EXCEPTION_REPORTED',
  'PHOTO_ATTACHED',
  'OPERATIONAL_REMARK',
]);

async function listStops(tenantId: string, shipmentOrderId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    sequence_no: number;
    stop_type: string;
    location_name: string | null;
    address: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    planned_arrival_at: Date | null;
    actual_arrival_at: Date | null;
    status: string;
    instructions: string | null;
  }>>(
    `SELECT id, sequence_no, stop_type, location_name, address, contact_name,
            contact_phone, planned_arrival_at, actual_arrival_at, status, instructions
       FROM logistics_shipment_stops
      WHERE tenant_id = $1 AND shipment_order_id = $2
      ORDER BY sequence_no ASC`,
    tenantId,
    shipmentOrderId,
  ).catch(() => []);

  return rows.map(row => ({
    id: row.id,
    sequenceNo: row.sequence_no,
    stopType: row.stop_type,
    locationName: row.location_name,
    address: row.address,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    plannedArrivalAt: row.planned_arrival_at?.toISOString() ?? null,
    actualArrivalAt: row.actual_arrival_at?.toISOString() ?? null,
    status: row.status,
    instructions: row.instructions,
  }));
}

async function listCargoLines(tenantId: string, shipmentOrderId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    description: string;
    quantity: string | number | null;
    package_type: string | null;
    weight_kg: string | number | null;
    is_hazmat: boolean;
  }>>(
    `SELECT id, description, quantity, package_type, weight_kg, is_hazmat
       FROM logistics_cargo_lines
      WHERE tenant_id = $1 AND shipment_order_id = $2
      ORDER BY created_at ASC`,
    tenantId,
    shipmentOrderId,
  ).catch(() => []);

  return rows.map(row => ({
    id: row.id,
    description: row.description,
    quantity: row.quantity == null ? null : Number(row.quantity),
    packageType: row.package_type,
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    isHazmat: row.is_hazmat,
  }));
}

async function listDocuments(tenantId: string, shipmentOrderId: string) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS logistics_shipment_documents (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id TEXT NOT NULL,
      shipment_order_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      doc_name TEXT NOT NULL,
      file_url TEXT,
      file_data TEXT,
      mime_type TEXT,
      file_size BIGINT,
      uploaded_by TEXT,
      notes TEXT,
      metadata JSONB
    )
  `).catch(() => {});

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    doc_type: string;
    doc_name: string;
    file_url: string | null;
    mime_type: string | null;
    created_at: Date;
  }>>(
    `SELECT id, doc_type, doc_name, file_url, mime_type, created_at
       FROM logistics_shipment_documents
      WHERE tenant_id = $1 AND shipment_order_id = $2
      ORDER BY created_at DESC`,
    tenantId,
    shipmentOrderId,
  ).catch(() => []);

  return rows.map(row => ({
    id: row.id,
    docType: row.doc_type,
    docName: row.doc_name,
    fileUrl: row.file_url,
    mimeType: row.mime_type,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  }));
}

async function getCarrierSettlement(tenantId: string, shipmentOrderId: string, carrierId: string) {
  const [summary, charges, postings, payouts] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{
      carrier_payable: string | number | null;
      settlement_id: string | null;
      settlement_no: string | null;
      settlement_status: string | null;
      settlement_net_amount: string | number | null;
      settlement_gross_amount: string | number | null;
      deductions_amount: string | number | null;
      commission_amount: string | number | null;
      payment_id: string | null;
      currency: string | null;
    }>>(
      `SELECT
          COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_side = 'CARRIER'), 0) AS carrier_payable,
          MAX(fc.settlement_id) AS settlement_id,
          MAX(s.settlement_no) AS settlement_no,
          MAX(s.status) AS settlement_status,
          MAX(s.net_payable_amount) AS settlement_net_amount,
          MAX(s.gross_amount) AS settlement_gross_amount,
          MAX(s.deductions_amount) AS deductions_amount,
          MAX(s.commission_amount) AS commission_amount,
          MAX(s.payment_id) AS payment_id,
          MAX(COALESCE(s.currency, fc.currency)) AS currency
         FROM logistics_freight_charges fc
         LEFT JOIN logistics_carrier_settlements s
           ON s.tenant_id = fc.tenant_id
          AND s.id = fc.settlement_id
          AND s.carrier_id = $3
        WHERE fc.tenant_id = $1
          AND fc.shipment_order_id = $2`,
      tenantId,
      shipmentOrderId,
      carrierId,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{
      id: string;
      charge_type: string;
      description: string | null;
      total_amount: string | number;
      currency: string;
      billing_status: string;
      settlement_id: string | null;
    }>>(
      `SELECT id, charge_type, description, total_amount, currency, billing_status, settlement_id
         FROM logistics_freight_charges
        WHERE tenant_id = $1
          AND shipment_order_id = $2
          AND charge_side = 'CARRIER'
        ORDER BY created_at DESC`,
      tenantId,
      shipmentOrderId,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{
      id: string;
      posting_type: string;
      source_record_id: string;
      finance_invoice_id: string | null;
      finance_journal_entry_id: string | null;
      amount: string | number;
      currency: string;
      status: string;
      created_at: Date;
    }>>(
      `SELECT id, posting_type, source_record_id, finance_invoice_id,
              finance_journal_entry_id, amount, currency, status, created_at
         FROM logistics_finance_postings
        WHERE tenant_id = $1
          AND shipment_order_id = $2
          AND posting_type IN ('CARRIER_PAYABLE','CARRIER_SETTLEMENT')
        ORDER BY created_at DESC`,
      tenantId,
      shipmentOrderId,
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{
      id: string;
      payout_no: string;
      net_payable_amount: string | number;
      currency: string;
      status: string;
      payment_id: string | null;
    }>>(
      `SELECT dp.id, dp.payout_no, dp.net_payable_amount, dp.currency, dp.status, dp.payment_id
         FROM logistics_driver_payouts dp
        WHERE dp.tenant_id = $1
          AND dp.shipment_order_id = $2
        ORDER BY dp.created_at DESC`,
      tenantId,
      shipmentOrderId,
    ).catch(() => []),
  ]);

  const row = summary[0];
  return row ? {
    carrierPayable: row.carrier_payable == null ? 0 : Number(row.carrier_payable),
    settlementId: row.settlement_id,
    settlementNo: row.settlement_no,
    settlementStatus: row.settlement_status,
    settlementNetAmount: row.settlement_net_amount == null ? null : Number(row.settlement_net_amount),
    settlementGrossAmount: row.settlement_gross_amount == null ? null : Number(row.settlement_gross_amount),
    deductionsAmount: row.deductions_amount == null ? null : Number(row.deductions_amount),
    commissionAmount: row.commission_amount == null ? null : Number(row.commission_amount),
    paymentId: row.payment_id,
    currency: row.currency,
    payableStatus: charges.length === 0 ? 'NOT_PREPARED' : charges.every(charge => charge.billing_status === 'POSTED') ? 'POSTED' : 'PREPARED',
    charges: charges.map(charge => ({
      id: charge.id,
      type: charge.charge_type,
      description: charge.description,
      totalAmount: Number(charge.total_amount),
      currency: charge.currency,
      status: charge.billing_status,
      settlementId: charge.settlement_id,
    })),
    postings: postings.map(posting => ({
      id: posting.id,
      type: posting.posting_type,
      sourceRecordId: posting.source_record_id,
      financeInvoiceId: posting.finance_invoice_id,
      financeJournalEntryId: posting.finance_journal_entry_id,
      amount: Number(posting.amount),
      currency: posting.currency,
      status: posting.status,
      createdAt: posting.created_at?.toISOString?.() ?? posting.created_at,
    })),
    payouts: payouts.map(payout => ({
      id: payout.id,
      payoutNo: payout.payout_no,
      netPayableAmount: Number(payout.net_payable_amount),
      currency: payout.currency,
      status: payout.status,
      paymentId: payout.payment_id,
    })),
  } : null;
}

function mapShipment(row: Awaited<ReturnType<typeof fetchShipmentById>>) {
  if (!row) return null;
  return {
    id: row.id,
    shipmentNo: row.shipment_no,
    status: row.status,
    marketplaceStatus: row.marketplace_status,
    cargoOwnerName: row.cargo_owner_name,
    shipmentType: row.shipment_type,
    priority: row.priority,
    originName: row.origin_name,
    originAddress: row.origin_address,
    destinationName: row.destination_name,
    destinationAddress: row.destination_address,
    pickupWindowFrom: row.pickup_window_from?.toISOString() ?? null,
    pickupWindowTo: row.pickup_window_to?.toISOString() ?? null,
    deliveryWindowFrom: row.delivery_window_from?.toISOString() ?? null,
    deliveryWindowTo: row.delivery_window_to?.toISOString() ?? null,
    requestedVehicleType: row.requested_vehicle_type,
    totalWeightKg: row.total_weight_kg == null ? null : Number(row.total_weight_kg),
    carrierCostAmount: row.carrier_cost_amount == null ? null : Number(row.carrier_cost_amount),
    currency: row.currency,
  };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
