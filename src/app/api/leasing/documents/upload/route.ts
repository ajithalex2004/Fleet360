/**
 * POST /api/leasing/documents/upload
 *
 * Multipart form-data:
 *   file:        the file to upload
 *   entityType:  CONTRACT | LESSEE | QUOTATION | VEHICLE
 *   entityId:    UUID of the entity this document belongs to
 *   docType:     TRADE_LICENSE | EMIRATES_ID | PASSPORT | MOA | SIGNED_AGREEMENT | INSURANCE | VEHICLE_PHOTO | OTHER
 *   docName:     human-readable name
 *   issueDate:   ISO date (optional)
 *   expiryDate:  ISO date (optional — required for compliance docs)
 *   notes:       optional
 *
 * Returns: the created LeaseDocument row + storage metadata.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB cap per file

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'text/plain',
];

const metadataSchema = z.object({
  entityType: z.enum(['CONTRACT', 'LESSEE', 'QUOTATION', 'VEHICLE']),
  entityId: z.string().uuid('entityId must be a UUID'),
  docType: z.enum([
    'TRADE_LICENSE',
    'EMIRATES_ID',
    'PASSPORT',
    'MOA',
    'SIGNED_AGREEMENT',
    'INSURANCE',
    'VEHICLE_PHOTO',
    'OTHER',
  ]),
  docName: z.string().min(1, 'docName is required'),
  issueDate: z.string().optional().or(z.literal('')),
  expiryDate: z.string().optional().or(z.literal('')),
  notes: z.string().optional(),
  replaceDocumentId: z.string().uuid().optional().or(z.literal('')),
});

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file uploaded. Send multipart form-data with a "file" field.' },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Max ${MAX_FILE_BYTES} bytes.` },
        { status: 413 },
      );
    }

    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p) || mimeType === p)) {
      return NextResponse.json(
        { error: `Unsupported MIME type: ${mimeType}.` },
        { status: 415 },
      );
    }

    const meta = {
      entityType: String(form.get('entityType') ?? ''),
      entityId: String(form.get('entityId') ?? ''),
      docType: String(form.get('docType') ?? ''),
      docName: String(form.get('docName') ?? file.name),
      issueDate: String(form.get('issueDate') ?? ''),
      expiryDate: String(form.get('expiryDate') ?? ''),
      notes: form.get('notes') ? String(form.get('notes')) : undefined,
      replaceDocumentId: String(form.get('replaceDocumentId') ?? ''),
    };

    const parsed = metadataSchema.safeParse(meta);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storage = getStorage();
    const stored = await storage.upload({
      buffer,
      originalName: file.name,
      mimeType,
      prefix: `leasing/${parsed.data.entityType.toLowerCase()}/${parsed.data.entityId}`,
    });

    const expiry = parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null;
    const issue = parsed.data.issueDate ? new Date(parsed.data.issueDate) : null;

    // Determine status: EXPIRED if past, EXPIRING_SOON if within 30 days, else ACTIVE.
    let status = 'ACTIVE';
    if (expiry) {
      const days = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
      if (days < 0) status = 'EXPIRED';
      else if (days <= 30) status = 'EXPIRING_SOON';
    }

    const existingId = parsed.data.replaceDocumentId || undefined;

    if (existingId) {
      const existing = await prisma.leaseDocument.findUnique({
        where: { id: existingId },
        select: { id: true, docName: true, fileUrl: true },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Document to replace was not found' }, { status: 404 });
      }

      const doc = await prisma.leaseDocument.update({
        where: { id: existingId },
        data: {
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
          docType: parsed.data.docType,
          docName: parsed.data.docName,
          fileName: stored.originalName,
          fileUrl: stored.url,
          fileSize: stored.size,
          mimeType: stored.mimeType,
          issueDate: issue,
          expiryDate: expiry,
          status,
          uploadedBy: req.headers.get('x-user-id') ?? null,
          notes: parsed.data.notes ?? null,
          updatedAt: new Date(),
        },
      });

      if (existing.fileUrl?.startsWith('/uploads/')) {
        await storage.delete(existing.fileUrl.replace('/uploads/', ''));
      }

      void logAudit({
        tenantId: req.headers.get('x-tenant-id') ?? undefined,
        userId: req.headers.get('x-user-id') ?? undefined,
        userRole: req.headers.get('x-user-role') ?? undefined,
        entityType: 'LeaseDocument',
        entityId: doc.id,
        entityName: doc.docName,
        action: 'UPDATE',
        details: `Replaced ${parsed.data.docType} with ${stored.originalName} for ${parsed.data.entityType} ${parsed.data.entityId}${expiry ? ` (expires ${expiry.toISOString().slice(0, 10)})` : ''}`,
      });

      return NextResponse.json({ document: doc, storage: stored, replaced: true }, { status: 200 });
    }

    const doc = await prisma.leaseDocument.create({
      data: {
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        docType: parsed.data.docType,
        docName: parsed.data.docName,
        fileName: stored.originalName,
        fileUrl: stored.url,
        fileSize: stored.size,
        mimeType: stored.mimeType,
        issueDate: issue,
        expiryDate: expiry,
        status,
        uploadedBy: req.headers.get('x-user-id') ?? null,
        notes: parsed.data.notes ?? null,
      },
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'LeaseDocument',
      entityId: doc.id,
      entityName: doc.docName,
      action: 'CREATE',
      details: `Uploaded ${parsed.data.docType} (${stored.originalName}, ${(stored.size / 1024).toFixed(1)} KB) for ${parsed.data.entityType} ${parsed.data.entityId}${expiry ? ` (expires ${expiry.toISOString().slice(0, 10)})` : ''}`,
    });

    return NextResponse.json({ document: doc, storage: stored }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'leasing.documents.upload' });
    console.error('[documents upload] error:', err);
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}
