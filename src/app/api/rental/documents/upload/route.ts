export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/rental/documents/upload
 *
 * Native Rent-A-Car (RAC) multipart file upload endpoint for:
 *   - Counter & Inspection walkaround photos (`BOOKING`, `AGREEMENT`, `INSPECTION`)
 *   - KYC & Compliance Document Vault scans (`DOCUMENT`, `CUSTOMER`)
 *   - Damage claim evidence (`DAMAGE_CLAIM`)
 *   - Rental insurance policy PDFs (`INSURANCE`)
 *
 * Authorized via RAC RBAC (`rental:create:counter` | `documents` | `damage` |
 * `insurance` | `inspections`) so `RAC_OPERATOR` and `RAC_MANAGER` never hit
 * Leasing module `403`s, never pollute `lease_documents`, and store objects
 * under `rental/<subCategory>/<entityId>/...` matching `authorizeFileAccess`
 * in `src/lib/storage/file-access.ts`.
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { getStorage } from '@/lib/storage';
import { fileContentProblem } from '@/lib/storage/file-type';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { isRentalSecurityError } from '@/lib/rental/security-guards';
import { requireRentalPermission } from '@/lib/rental/rbac';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'text/plain',
];

const ENTITY_TYPES = [
  'BOOKING',
  'AGREEMENT',
  'CUSTOMER',
  'DAMAGE_CLAIM',
  'DOCUMENT',
  'INSURANCE',
  'INSPECTION',
] as const;

type RentalUploadEntityType = (typeof ENTITY_TYPES)[number];

const metadataSchema = z.object({
  entityType: z.enum(ENTITY_TYPES).default('DOCUMENT'),
  entityId: z.string().trim().optional().or(z.literal('')),
  docType: z.string().trim().max(64).optional().default('OTHER'),
  docName: z.string().trim().min(1).max(255).optional(),
});

function requiredResourceForEntity(entityType: RentalUploadEntityType): string {
  switch (entityType) {
    case 'BOOKING':
    case 'AGREEMENT':
      return 'counter';
    case 'INSPECTION':
      return 'inspections';
    case 'DAMAGE_CLAIM':
      return 'damage';
    case 'INSURANCE':
      return 'insurance';
    case 'CUSTOMER':
    case 'DOCUMENT':
    default:
      return 'documents';
  }
}

async function resolveStorageLocationAndVerifyOwnership(
  tx: TxClient,
  tenantId: string,
  entityType: RentalUploadEntityType,
  rawEntityId?: string,
): Promise<{ ok: true; subCategory: string; entityId: string } | { ok: false; error: string }> {
  const trimmedId = (rawEntityId ?? '').trim();

  switch (entityType) {
    case 'BOOKING':
    case 'INSPECTION': {
      if (!trimmedId) return { ok: false, error: 'entityId (bookingId) is required' };
      const bk = await tx.rentalBooking.findFirst({
        where: { id: trimmedId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (bk) return { ok: true, subCategory: 'bookings', entityId: bk.id };

      // Allow agreement ID fallback when walkaround photos are uploaded during Counter Return
      const agr = await tx.rentalAgreement.findFirst({
        where: { id: trimmedId, tenantId },
        select: { id: true },
      });
      if (agr) return { ok: true, subCategory: 'agreements', entityId: agr.id };

      return { ok: false, error: 'Rental booking or agreement not found in tenant' };
    }
    case 'AGREEMENT': {
      if (!trimmedId) return { ok: false, error: 'entityId (agreementId) is required' };
      const agr = await tx.rentalAgreement.findFirst({
        where: { id: trimmedId, tenantId },
        select: { id: true },
      });
      if (agr) return { ok: true, subCategory: 'agreements', entityId: agr.id };

      const bk = await tx.rentalBooking.findFirst({
        where: { id: trimmedId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (bk) return { ok: true, subCategory: 'bookings', entityId: bk.id };

      return { ok: false, error: 'Rental agreement not found in tenant' };
    }
    case 'CUSTOMER': {
      if (!trimmedId) return { ok: false, error: 'entityId (customerId) is required' };
      const cust = await tx.rentalCustomer.findFirst({
        where: { id: trimmedId, tenantId, deletedAt: null },
        select: { id: true },
      });
      return cust
        ? { ok: true, subCategory: 'customers', entityId: cust.id }
        : { ok: false, error: 'Rental customer not found in tenant' };
    }
    case 'DAMAGE_CLAIM': {
      if (trimmedId) {
        const claim = await tx.damageClaim.findFirst({
          where: { id: trimmedId, tenantId },
          select: { id: true },
        });
        if (claim) return { ok: true, subCategory: 'damage-claims', entityId: claim.id };

        const bk = await tx.rentalBooking.findFirst({
          where: { id: trimmedId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (bk) return { ok: true, subCategory: 'bookings', entityId: bk.id };

        return { ok: false, error: 'Damage claim or booking not found in tenant' };
      }
      return { ok: false, error: 'entityId (claimId or bookingId) is required for damage uploads' };
    }
    case 'INSURANCE': {
      const targetId =
        trimmedId && /^[0-9a-fA-F-]{8,64}$/.test(trimmedId) ? trimmedId : crypto.randomUUID();
      return { ok: true, subCategory: 'insurance', entityId: targetId };
    }
    case 'DOCUMENT':
    default: {
      if (trimmedId) {
        // If caller passed an existing customerId, verify it belongs to this tenant
        const cust = await tx.rentalCustomer.findFirst({
          where: { id: trimmedId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (cust) {
          return { ok: true, subCategory: 'documents', entityId: cust.id };
        }
        if (!/^[0-9a-fA-F-]{8,64}$/.test(trimmedId)) {
          return { ok: false, error: 'Invalid entityId format' };
        }
        return { ok: true, subCategory: 'documents', entityId: trimmedId };
      }
      return { ok: true, subCategory: 'documents', entityId: crypto.randomUUID() };
    }
  }
}

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
        { error: 'Missing "file" field in multipart body.' },
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

    const rawEntityType = String(form.get('entityType') ?? 'DOCUMENT').trim().toUpperCase();
    // Map legacy CONTRACT entityType from Counter walkaround uploader to BOOKING
    const normalizedEntityType =
      rawEntityType === 'CONTRACT' || rawEntityType === 'RENTAL_BOOKING'
        ? 'BOOKING'
        : rawEntityType === 'RENTAL_AGREEMENT'
          ? 'AGREEMENT'
          : rawEntityType === 'RENTAL_CUSTOMER'
            ? 'CUSTOMER'
            : rawEntityType;

    const parsed = metadataSchema.safeParse({
      entityType: normalizedEntityType,
      entityId: form.get('entityId') ? String(form.get('entityId')) : '',
      docType: form.get('docType') ? String(form.get('docType')) : 'OTHER',
      docName: form.get('docName') ? String(form.get('docName')) : file.name,
    });
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

    const permResource = requiredResourceForEntity(parsed.data.entityType);
    const permErr = await requireRentalPermission(
      req.headers,
      tenantId,
      'create',
      permResource,
      req.nextUrl.pathname,
    );
    if (permErr) return permErr;

    const buffer = Buffer.from(await file.arrayBuffer());
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

    const target = await withTenantRls(prisma, tenantId, (tx) =>
      resolveStorageLocationAndVerifyOwnership(
        tx,
        tenantId,
        parsed.data.entityType,
        parsed.data.entityId,
      ),
    );
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: 404 });
    }

    const storage = getStorage();
    const stored = await storage.upload({
      buffer,
      originalName: file.name,
      mimeType,
      prefix: `rental/${target.subCategory}/${target.entityId}`,
    });

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RentalDocumentUpload',
      entityId: target.entityId,
      entityName: parsed.data.docName ?? stored.originalName,
      action: 'CREATE',
      details: `Uploaded RAC ${parsed.data.docType} (${stored.originalName}, ${(stored.size / 1024).toFixed(1)} KB) under rental/${target.subCategory}/${target.entityId}`,
    });

    return NextResponse.json(
      {
        ok: true,
        url: stored.url,
        fileUrl: stored.url,
        storage: stored,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    captureException(err, { context: 'rental.documents.upload' });
    console.error('[rental documents upload] error:', err);
    return NextResponse.json({ error: 'Failed to upload RAC document' }, { status: 500 });
  }
}
