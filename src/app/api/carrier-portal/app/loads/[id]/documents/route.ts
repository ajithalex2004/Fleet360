import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchShipmentById, resolveCarrierAppDevice } from '@/lib/logistics/domain';

export const runtime = 'nodejs';

interface DocumentBody {
  docType?: string;
  docName?: string;
  fileUrl?: string | null;
  fileData?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  notes?: string | null;
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

async function ensureTable() {
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
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_logistics_shipment_docs_shipment
      ON logistics_shipment_documents (tenant_id, shipment_order_id, created_at DESC)
  `);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAssignedShipment(req, params.id);
  if ('error' in auth) return auth.error;

  let body: DocumentBody;
  try { body = (await req.json()) as DocumentBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.docType || !body.docName) {
    return NextResponse.json({ error: 'docType and docName are required' }, { status: 400 });
  }
  if (!body.fileUrl && !body.fileData) {
    return NextResponse.json({ error: 'fileUrl or fileData is required' }, { status: 400 });
  }
  if (body.fileData && body.fileSize && body.fileSize > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large for inline upload (max 5 MB). Use a fileUrl instead.' }, { status: 413 });
  }

  try {
    await ensureTable();
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO logistics_shipment_documents
         (tenant_id, shipment_order_id, doc_type, doc_name, file_url, file_data, mime_type, file_size, uploaded_by, notes, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       RETURNING id`,
      auth.device.tenantId,
      params.id,
      body.docType,
      body.docName,
      body.fileUrl ?? null,
      body.fileData ?? null,
      body.mimeType ?? null,
      body.fileSize ?? null,
      `carrier:${auth.device.carrierId}`,
      body.notes ?? null,
      JSON.stringify({
        source: 'carrier-app',
        carrierId: auth.device.carrierId,
        deviceId: auth.device.deviceId,
      }),
    );

    return NextResponse.json({ success: true, id: rows[0]?.id ?? null }, { status: 201 });
  } catch (e) {
    console.error('[carrier-portal/app/loads/:id/documents POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to attach carrier document' },
      { status: 500 },
    );
  }
}
