import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchShipmentById } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

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
}

export async function GET(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  await ensureTable();
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM logistics_shipment_documents
      WHERE tenant_id = $1 AND shipment_order_id = $2 AND id = $3
      LIMIT 1`,
    tenantId,
    params.id,
    params.docId,
  );

  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const doc = rows[0];
  return NextResponse.json({
    ...doc,
    file_size: doc.file_size != null ? Number(doc.file_size as bigint | number) : null,
    uploaded_at: doc.created_at instanceof Date ? doc.created_at.toISOString() : doc.created_at,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const shipment = await fetchShipmentById(params.id, tenantId);
  if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });

  await ensureTable();
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_shipment_documents
      WHERE tenant_id = $1 AND shipment_order_id = $2 AND id = $3`,
    tenantId,
    params.id,
    params.docId,
  );
  return NextResponse.json({ success: true });
}
