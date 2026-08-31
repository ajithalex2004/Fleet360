export const dynamic = 'force-dynamic';

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
 *
 * Tenant scoping: requires x-tenant-id. The created LeaseDocument row is
 * stamped with the same tenantId; if entityType=CONTRACT or entityType=LESSEE
 * the referenced row is verified to belong to the caller's tenant first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getStorage } from '@/lib/storage';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

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
});

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
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

    // Verify ownership of the parent entity for entity types that have
    // tenant-scoped backing rows.
    if (parsed.data.entityType === 'CONTRACT') {
      const owned = await prisma.leaseContract2.findFirst({
        where: { id: parsed.data.entityId, tenantId },
        select: { id: true },
      });
      if (!owned) {
        return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
      }
    } else if (parsed.data.entityType === 'LESSEE') {
      const owned = await prisma.lessee.findFirst({
        where: { id: parsed.data.entityId, tenantId },
        select: { id: true },
      });
      if (!owned) {
        return NextResponse.json({ error: 'Lessee not found' }, { status: 404 });
      }
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

    let status = 'ACTIVE';
    if (expiry) {
      const days = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
      if (days < 0) status = 'EXPIRED';
      else if (days <= 30) status = 'EXPIRING_SOON';
    }

    const doc = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leaseDocument.create({
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
        tenantId,
      },
    }),
    );

    void logAudit({
      tenantId,
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
