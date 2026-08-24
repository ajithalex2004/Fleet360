import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchShipmentById } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

interface DocumentBody {
  docType?: string;
  docName?: string;
  fileUrl?: string | null;
  fileData?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  uploadedBy?: string | null;
  notes?: string | null;
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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  await ensureTable();
  const docs = await prisma.$queryRawUnsafe<Array<{
    id: string;
    doc_type: string;
    doc_name: string;
    file_url: string | null;
    mime_type: string | null;
    file_size: bigint | number | null;
    uploaded_by: string | null;
    notes: string | null;
    created_at: Date;
  }>>(
    `SELECT id, doc_type, doc_name, file_url, mime_type, file_size, uploaded_by, notes, created_at
       FROM logistics_shipment_documents
      WHERE tenant_id = $1 AND shipment_order_id = $2
      ORDER BY created_at DESC`,
    tenantId,
    params.id,
  );

  return NextResponse.json({
    shipment,
    data: docs.map(doc => ({
      id: doc.id,
      doc_type: doc.doc_type,
      doc_name: doc.doc_name,
      file_url: doc.file_url,
      mime_type: doc.mime_type,
      file_size: doc.file_size != null ? Number(doc.file_size) : null,
      uploaded_by: doc.uploaded_by,
      notes: doc.notes,
      uploaded_at: doc.created_at instanceof Date ? doc.created_at.toISOString() : doc.created_at,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  let body: DocumentBody;
  try { body = (await req.json()) as DocumentBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.docType || !body.docName) {
    return NextResponse.json({ error: 'docType and docName are required' }, { status: 400 });
  }
  if (body.fileData && body.fileSize && body.fileSize > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large for inline storage (max 5 MB). Use fileUrl instead.' }, { status: 413 });
  }

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  await ensureTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO logistics_shipment_documents
       (tenant_id, shipment_order_id, doc_type, doc_name, file_url, file_data, mime_type, file_size, uploaded_by, notes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     RETURNING id`,
    tenantId,
    params.id,
    body.docType,
    body.docName,
    body.fileUrl ?? null,
    body.fileData ?? null,
    body.mimeType ?? null,
    body.fileSize ?? null,
    body.uploadedBy ?? req.headers.get('x-user-id') ?? 'Operations',
    body.notes ?? null,
    JSON.stringify({ source: 'shipment-documents' }),
  );

  return NextResponse.json({ success: true, id: rows[0]?.id ?? null }, { status: 201 });
}
