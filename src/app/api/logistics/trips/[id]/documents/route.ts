import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await ensureTable();
    const docs = await prisma.$queryRawUnsafe<Array<{
      id: string; booking_id: string; doc_type: string; doc_name: string;
      file_url: string | null; mime_type: string | null; file_size: bigint | null;
      uploaded_by: string | null; notes: string | null; uploaded_at: Date;
    }>>(
      `SELECT id, booking_id, doc_type, doc_name, file_url, mime_type,
              file_size, uploaded_by, notes, uploaded_at
       FROM trip_documents WHERE booking_id = $1 ORDER BY uploaded_at DESC`,
      params.id
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
  { params }: { params: { id: string } }
) {
  try {
    await ensureTable();
    const body = await req.json() as {
      docType: string;
      docName: string;
      fileUrl?: string;
      fileData?: string;   // base64 data URL
      mimeType?: string;
      fileSize?: number;
      uploadedBy?: string;
      notes?: string;
    };

    if (!body.docType || !body.docName) {
      return NextResponse.json({ error: 'docType and docName are required' }, { status: 400 });
    }

    // Enforce 5 MB limit for inline storage
    if (body.fileData && body.fileSize && body.fileSize > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large for inline storage (max 5 MB). Use fileUrl instead.' }, { status: 413 });
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO trip_documents (booking_id, doc_type, doc_name, file_url, file_data, mime_type, file_size, uploaded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      params.id,
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
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }
}
