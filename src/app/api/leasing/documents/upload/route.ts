export const dynamic = 'force-dynamic';

/**
 * POST /api/leasing/documents/upload
 *
 * Multipart form-data:
 *   file:        the file to upload
 *   entityType:  CONTRACT | LESSEE | QUOTATION | VEHICLE | RENTAL_BOOKING | RENTAL_AGREEMENT | RENTAL_CUSTOMER
 *   entityId:    UUID of the entity this document belongs to
 *   docType:     TRADE_LICENSE | EMIRATES_ID | PASSPORT | MOA | SIGNED_AGREEMENT | INSURANCE | VEHICLE_PHOTO | OTHER
 *   docName:     human-readable name
 *   issueDate:   ISO date (optional)
 *   expiryDate:  ISO date (optional — required for compliance docs)
 *   notes:       optional
 *
 * Returns: the created LeaseDocument row + storage metadata.
 *
 * Tenant scoping: requires authorized tenant session (`withTenantRls`). Every
 * referenced parent entity (`CONTRACT`, `LESSEE`, `QUOTATION`, `VEHICLE`, and
 * `RENTAL_*`) is verified to belong to the caller's tenant under RLS BEFORE any
 * file bytes are persisted to object storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { loadModuleAccess } from '@/lib/authz/module-access';
import { getStorage } from '@/lib/storage';
import { fileContentProblem } from '@/lib/storage/file-type';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'text/plain',
];

const ENTITY_TYPES = [
  'CONTRACT',
  'LESSEE',
  'QUOTATION',
  'VEHICLE',
  'RENTAL_BOOKING',
  'RENTAL_AGREEMENT',
  'RENTAL_CUSTOMER',
] as const;

type UploadEntityType = (typeof ENTITY_TYPES)[number];

const metadataSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
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
  docName: z.string().trim().min(1, 'docName is required').max(255),
  issueDate: z.string().optional().or(z.literal('')),
  expiryDate: z.string().optional().or(z.literal('')),
  notes: z.string().optional(),
});

/**
 * Verifies inside `withTenantRls` that `entityId` belongs to `tenantId` (and is not soft-deleted)
 * for EVERY supported `entityType`.
 */
async function verifyParentEntityOwnership(
  tx: TxClient,
  tenantId: string,
  entityType: UploadEntityType,
  entityId: string,
  docType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (entityType) {
    case 'CONTRACT': {
      const contract = await tx.leaseContract2.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (contract) return { ok: true };

      // RAC Counter (`src/app/(app)/rental/counter/page.tsx`) reuses CONTRACT + VEHICLE_PHOTO
      // with the active tenant's own `rentalBooking.id` or `rentalAgreement.id`.
      if (docType === 'VEHICLE_PHOTO') {
        const anyTx = tx as Record<string, unknown>;
        if (typeof (anyTx.rentalBooking as { findFirst?: unknown })?.findFirst === 'function') {
          const bk = await tx.rentalBooking.findFirst({
            where: { id: entityId, tenantId, deletedAt: null },
            select: { id: true },
          });
          if (bk) return { ok: true };
        }
        if (typeof (anyTx.rentalAgreement as { findFirst?: unknown })?.findFirst === 'function') {
          const agr = await tx.rentalAgreement.findFirst({
            where: { id: entityId, tenantId },
            select: { id: true },
          });
          if (agr) return { ok: true };
        }
      }
      return { ok: false, error: 'Contract not found' };
    }
    case 'LESSEE': {
      const lessee = await tx.lessee.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
        select: { id: true },
      });
      return lessee ? { ok: true } : { ok: false, error: 'Lessee not found' };
    }
    case 'QUOTATION': {
      const quotation = await tx.leaseQuotation.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
        select: { id: true },
      });
      return quotation ? { ok: true } : { ok: false, error: 'Quotation not found' };
    }
    case 'VEHICLE': {
      const vehicle = await tx.vehicle.findFirst({
        where: { id: entityId, tenantId, deletedAt: null },
        select: { id: true },
      });
      return vehicle ? { ok: true } : { ok: false, error: 'Vehicle not found' };
    }
    case 'RENTAL_BOOKING': {
      await assertRentalForeignKeysInTenant(tx, tenantId, { bookingId: entityId });
      return { ok: true };
    }
    case 'RENTAL_AGREEMENT': {
      await assertRentalForeignKeysInTenant(tx, tenantId, { agreementId: entityId });
      return { ok: true };
    }
    case 'RENTAL_CUSTOMER': {
      await assertRentalForeignKeysInTenant(tx, tenantId, { customerId: entityId });
      return { ok: true };
    }
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // Shared by the leasing documents page and the RAC counter (see the
  // 'leasing/documents/upload' area in policy-matrix.ts).
  const denied = (await loadModuleAccess(req.headers, tenantId))(
    ['leasing', 'rental'],
    'create',
    '/api/leasing/documents/upload',
  );
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file uploaded. Send multipart form-data with a "file" field.' },
        { status: 400 },
      );
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: 'Uploaded file is empty.' }, { status: 400 });
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

    const expiry = parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null;
    if (expiry && Number.isNaN(expiry.getTime())) {
      return NextResponse.json({ error: 'Invalid expiryDate' }, { status: 400 });
    }
    const issue = parsed.data.issueDate ? new Date(parsed.data.issueDate) : null;
    if (issue && Number.isNaN(issue.getTime())) {
      return NextResponse.json({ error: 'Invalid issueDate' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // The browser-reported type is the uploader's claim; check magic bytes & extension match first.
    const contentProblem = fileContentProblem(file.name, buffer, [
      'pdf',
      'png',
      'jpeg',
      'gif',
      'webp',
      'ooxml',
      'ole',
      'text',
    ]);
    if (contentProblem) {
      return NextResponse.json({ error: contentProblem }, { status: 415 });
    }

    // Verify ownership of the parent entity inside `withTenantRls` BEFORE persisting bytes to storage.
    const ownership = await withTenantRls(prisma, tenantId, (tx) =>
      verifyParentEntityOwnership(
        tx,
        tenantId,
        parsed.data.entityType,
        parsed.data.entityId,
        parsed.data.docType,
      ),
    );
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: 404 });
    }

    const storage = getStorage();
    const stored = await storage.upload({
      buffer,
      originalName: file.name,
      mimeType,
      prefix: `leasing/${parsed.data.entityType.toLowerCase()}/${parsed.data.entityId}`,
    });

    let status = 'ACTIVE';
    if (expiry) {
      const days = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
      if (days < 0) status = 'EXPIRED';
      else if (days <= 30) status = 'EXPIRING_SOON';
    }

    let doc;
    try {
      doc = await withTenantRls(prisma, tenantId, async (tx) =>
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
    } catch (createErr) {
      await storage.delete(stored.key).catch(() => {});
      throw createErr;
    }

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
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    captureException(err, { context: 'leasing.documents.upload' });
    console.error('[documents upload] error:', err);
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}
