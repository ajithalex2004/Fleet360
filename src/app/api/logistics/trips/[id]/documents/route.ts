import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  assertGovernedShipmentWrite,
  ensureShipmentForLegacyBooking,
  LogisticsValidationError,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

/**
 * Trip Documents API
 * GET  /api/logistics/trips/[id]/documents  — list documents
 * POST /api/logistics/trips/[id]/documents  — upload/attach document
 *
 * Documents are stored in trip_documents table (auto-created).
 * File content stored as base64 data URL for files <5 MB;
 * larger files should use fileUrl pointing to cloud storage.
 */

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS trip_documents (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      booking_id   TEXT NOT NULL,
      doc_type     TEXT NOT NULL,
      doc_name     TEXT NOT NULL,
      file_url     TEXT,
      file_data    TEXT,
      mime_type    TEXT,
      file_size    BIGINT,
      uploaded_by  TEXT,
      notes        TEXT,
      uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_trip_docs_booking ON trip_documents(booking_id)`
  ).catch(() => {});
}

async function assertTripDocumentWriteAllowed(
  req: NextRequest,
  bookingId: string,
  bodyTenantId?: string | null,
) {
  const tenantId = req.headers.get('x-tenant-id') ?? bodyTenantId ?? req.nextUrl.searchParams.get('tenantId');
  if (!tenantId) return;
  const shipment = await ensureShipmentForLegacyBooking({
    tenantId,
    bookingId,
    actorUserId: req.headers.get('x-user-id') ?? null,
  });
  if (!shipment) return;
  await assertGovernedShipmentWrite({
    tenantId,
    shipmentOrderId: shipment.id,
    action: 'Trip document mutation',
  });
}

type TripDocumentPayload = {
  docType: string;
  docName: string;
  fileUrl?: string;
  fileData?: string;
  mimeType?: string;
  fileSize?: number;
  uploadedBy?: string;
  notes?: string;
  tenantId?: string;
  issueDate?: string;
  expiryDate?: string;
  validFrom?: string;
  validTo?: string;
};

type TripRouteContext = { params: Promise<{ id: string }> };

function parseOptionalDate(value: string | undefined, label: string, issues: string[]) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    issues.push(`${label} must be a valid date.`);
    return null;
  }
  return date;
}

function assertTripDocumentPayload(body: Partial<TripDocumentPayload>) {
  const issues: string[] = [];
  if (!String(body.docType ?? '').trim()) issues.push('Document type is required.');
  if (!String(body.docName ?? '').trim()) issues.push('Document name is required.');
  if (body.fileSize != null && (!Number.isFinite(Number(body.fileSize)) || Number(body.fileSize) < 0)) {
    issues.push('Document file size cannot be negative.');
  }
  if (body.fileData && body.fileSize && body.fileSize > 5 * 1024 * 1024) {
    issues.push('File too large for inline storage (max 5 MB). Use fileUrl instead.');
  }
  if (!body.fileUrl && !body.fileData) {
    issues.push('Attach a file or provide a file URL.');
  }

  const issueDate = parseOptionalDate(body.issueDate, 'Document issue date', issues);
  const expiryDate = parseOptionalDate(body.expiryDate, 'Document expiry date', issues);
  const validFrom = parseOptionalDate(body.validFrom, 'Document valid-from date', issues);
  const validTo = parseOptionalDate(body.validTo, 'Document valid-to date', issues);
  if (issueDate && expiryDate && expiryDate < issueDate) {
    issues.push('Document expiry date cannot be before issue date.');
  }
  if (validFrom && validTo && validTo < validFrom) {
    issues.push('Document valid-to date cannot be before valid-from date.');
  }
  if (String(body.notes ?? '').length > 2000) {
    issues.push('Document notes cannot exceed 2000 characters.');
  }

  if (issues.length > 0) throw new LogisticsValidationError(issues);
}

export async function GET(
  _req: NextRequest,
  { params }: TripRouteContext
) {
  try {
    const { id } = await params;
    await ensureTable();
    const docs = await prisma.$queryRawUnsafe<Array<{
      id: string; booking_id: string; doc_type: string; doc_name: string;
      file_url: string | null; mime_type: string | null; file_size: bigint | null;
      uploaded_by: string | null; notes: string | null; uploaded_at: Date;
    }>>(
      `SELECT id, booking_id, doc_type, doc_name, file_url, mime_type,
              file_size, uploaded_by, notes, uploaded_at
       FROM trip_documents WHERE booking_id = $1 ORDER BY uploaded_at DESC`,
      id
    ).catch(() => [] as Array<{ id: string; booking_id: string; doc_type: string; doc_name: string; file_url: string | null; mime_type: string | null; file_size: bigint | null; uploaded_by: string | null; notes: string | null; uploaded_at: Date }>);

    return NextResponse.json(docs.map(d => ({
      ...d,
      file_size:   d.file_size != null ? Number(d.file_size) : null,
      uploaded_at: d.uploaded_at instanceof Date ? d.uploaded_at.toISOString() : d.uploaded_at,
    })));
  } catch (err) {
    console.error('[trip-docs GET]', err);
    return NextResponse.json([]);
  }
}

export async function POST(
  req: NextRequest,
  { params }: TripRouteContext
) {
  try {
    const { id } = await params;
    const body = await req.json() as TripDocumentPayload;
    assertTripDocumentPayload(body);
    await ensureTable();
    await assertTripDocumentWriteAllowed(req, id, body.tenantId ?? null);

    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_documents (booking_id, doc_type, doc_name, file_url, file_data, mime_type, file_size, uploaded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      id,
      body.docType,
      body.docName,
      body.fileUrl ?? null,
      body.fileData ?? null,
      body.mimeType ?? null,
      body.fileSize ?? null,
      body.uploadedBy ?? 'Operations',
      body.notes ?? null
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('[trip-docs POST]', err);
    return logisticsErrorResponse(err, 'Failed to save document');
  }
}
