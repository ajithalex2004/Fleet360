export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/documents/kyc-scan
 *
 * 3-Phase Multimodal RAC KYC Document Scanner & Optional Customer/Document Sync:
 *   - Phase 1: Authorize tenant (`requireAuthorizedTenant`), check `rental:create:customers`,
 *              sanitize payload (`stripTenantOwnershipFields`), and validate image data URL
 *              via `validateSafeDocumentOrSignatureUrl` (rejects SVG/HTML/SSRF external URLs).
 *   - Phase 2: Execute `scanKycDocumentMultimodal` strictly OUTSIDE `withTenantRls`
 *              (Gemini 2.5 Flash Vision -> OpenAI `gpt-4o-mini` Vision -> ICAO-9303 MRZ / fallback).
 *   - Phase 3: When `customerId` is supplied, verify tenant ownership and optionally update
 *              customer UAE KYC columns + insert `rental_documents` record inside `withTenantRls`.
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { revalidateCache } from '@/lib/server-cache';
import {
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
  isValidEmiratesIdNumber,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';
import {
  scanKycDocumentMultimodal,
  type KycDocumentType,
} from '@/lib/digital-kyc-engine';

const ALLOWED_DOC_TYPES = new Set<KycDocumentType>([
  'EMIRATES_ID',
  'DRIVING_LICENSE',
  'PASSPORT',
  'INTERNATIONAL_DRIVING_PERMIT',
]);

function parseOptionalIsoDate(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export async function POST(req: NextRequest) {
  // Phase 1: Auth, RBAC & Safe Input Validation
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const permErr = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'customers',
    req.nextUrl.pathname,
  );
  if (permErr) return permErr;

  const actorId = (req.headers.get('x-user-id') ?? '').trim() || 'system';

  try {
    let rawBodyObj: Record<string, unknown> = {};
    const contentType = (req.headers.get('content-type') ?? '').toLowerCase();

    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData();
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string') {
          rawBodyObj[k] = v;
        } else if (v && typeof (v as Blob).arrayBuffer === 'function') {
          const blob = v as File;
          if (blob.size > 1_500_000) {
            return NextResponse.json(
              { error: 'KYC document upload exceeds maximum allowed size (1.5 MB)' },
              { status: 413 },
            );
          }
          const mime = (blob.type || 'image/jpeg').toLowerCase();
          const buf = Buffer.from(await blob.arrayBuffer());
          rawBodyObj.imageDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
          rawBodyObj.mimeType = mime;
          if (!rawBodyObj.hintName && blob.name) {
            rawBodyObj.hintName = blob.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
          }
        }
      }
    } else {
      const parsedJson = await req.json();
      rawBodyObj =
        parsedJson && typeof parsedJson === 'object'
          ? (parsedJson as Record<string, unknown>)
          : {};
    }

    const body = stripTenantOwnershipFields(rawBodyObj) as Record<string, unknown>;

    const rawDocType = String(body.documentType ?? body.docType ?? 'EMIRATES_ID')
      .trim()
      .toUpperCase() as KycDocumentType;
    if (!ALLOWED_DOC_TYPES.has(rawDocType)) {
      return NextResponse.json(
        {
          error:
            'Invalid documentType: must be EMIRATES_ID, DRIVING_LICENSE, PASSPORT, or INTERNATIONAL_DRIVING_PERMIT',
        },
        { status: 400 },
      );
    }

    const rawImage =
      body.imageDataUrl ?? body.imageBase64OrUrl ?? body.fileUrl ?? null;
    const safeImageUrl =
      rawImage !== null && rawImage !== undefined && rawImage !== ''
        ? validateSafeDocumentOrSignatureUrl(rawImage, {
            allowPdfDataUrl: true,
            fieldName: 'imageDataUrl',
          })
        : null;

    const mrzText =
      typeof body.mrzText === 'string' && body.mrzText.trim() ? body.mrzText.trim() : undefined;
    const hintName =
      typeof body.hintName === 'string' && body.hintName.trim() ? body.hintName.trim() : undefined;
    const mimeType =
      typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : undefined;

    if (!safeImageUrl && !mrzText && !hintName) {
      return NextResponse.json(
        { error: 'Provide imageDataUrl (PNG/JPEG/WEBP/PDF data URL), mrzText, or hintName' },
        { status: 400 },
      );
    }

    // Phase 2: Multimodal Vision / MRZ OCR strictly OUTSIDE `withTenantRls`
    const scan = await scanKycDocumentMultimodal({
      documentType: rawDocType,
      imageBase64OrUrl: safeImageUrl ?? undefined,
      mimeType,
      mrzText,
      hintName,
    });

    const customerId =
      typeof body.customerId === 'string' && body.customerId.trim()
        ? body.customerId.trim()
        : null;
    const bookingId =
      typeof body.bookingId === 'string' && body.bookingId.trim() ? body.bookingId.trim() : null;
    const agreementId =
      typeof body.agreementId === 'string' && body.agreementId.trim()
        ? body.agreementId.trim()
        : null;
    const applyToCustomer = body.applyToCustomer !== false;

    let customerUpdated = false;
    let documentRecordId: string | null = null;

    // Phase 3: Optional Customer KYC Sync & Document Record Persistence inside `withTenantRls`
    if (customerId || bookingId || agreementId) {
      await withTenantRls(prisma, tenantId, async (tx) => {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          customerId,
          bookingId,
          agreementId,
        });

        if (customerId && applyToCustomer) {
          const validEid =
            scan.emiratesId && isValidEmiratesIdNumber(scan.emiratesId)
              ? scan.emiratesId
              : null;
          const dobIso = parseOptionalIsoDate(scan.dateOfBirth);
          const expIso = parseOptionalIsoDate(scan.expiryDate);
          const issIso = parseOptionalIsoDate(scan.issueDate);

          // Update base Prisma columns on `rentalCustomer`
          const prismaPatch: Record<string, unknown> = { updatedAt: new Date() };
          if (scan.nationality) prismaPatch.nationality = scan.nationality;
          if (rawDocType === 'PASSPORT' && scan.documentNumber) {
            prismaPatch.passportNo = scan.documentNumber;
          }
          if (rawDocType === 'DRIVING_LICENSE' && scan.documentNumber) {
            prismaPatch.drivingLicenseNo = scan.documentNumber;
            if (expIso) prismaPatch.licenseExpiry = new Date(expIso);
          }

          await tx.rentalCustomer.update({
            where: { id: customerId, tenantId },
            data: prismaPatch,
          });

          // Update extended UAE KYC columns via savepoint-guarded parameterized SQL
          await withSavepoint(
            tx,
            'kyc_scan_upd_customer_cols',
            () =>
              tx.$executeRawUnsafe(
                `UPDATE rental_customers
                    SET emirates_id = COALESCE($1, emirates_id),
                        emirates_id_expiry = CASE WHEN $2::timestamptz IS NOT NULL THEN $2::timestamptz ELSE emirates_id_expiry END,
                        passport_expiry = CASE WHEN $3::timestamptz IS NOT NULL THEN $3::timestamptz ELSE passport_expiry END,
                        visa_type = COALESCE($4, visa_type),
                        international_permit_no = COALESCE($5, international_permit_no),
                        international_permit_expiry = CASE WHEN $6::timestamptz IS NOT NULL THEN $6::timestamptz ELSE international_permit_expiry END,
                        license_issuing_country = COALESCE($7, license_issuing_country),
                        license_issue_date = CASE WHEN $8::timestamptz IS NOT NULL THEN $8::timestamptz ELSE license_issue_date END,
                        date_of_birth = CASE WHEN $9::timestamptz IS NOT NULL THEN $9::timestamptz ELSE date_of_birth END,
                        updated_at = NOW()
                  WHERE id::text = $10
                    AND tenant_id = $11`,
                validEid,
                rawDocType === 'EMIRATES_ID' ? expIso : null,
                rawDocType === 'PASSPORT' ? expIso : null,
                scan.visaTypeHint,
                rawDocType === 'INTERNATIONAL_DRIVING_PERMIT' ? scan.documentNumber : null,
                rawDocType === 'INTERNATIONAL_DRIVING_PERMIT' ? expIso : null,
                rawDocType === 'DRIVING_LICENSE' || rawDocType === 'INTERNATIONAL_DRIVING_PERMIT'
                  ? scan.issuingCountry
                  : null,
                rawDocType === 'DRIVING_LICENSE' ? issIso : null,
                dobIso,
                customerId,
                tenantId,
              ),
            0,
          );

          customerUpdated = true;
        }

        if (safeImageUrl) {
          const docId = crypto.randomUUID();
          const docTitle = `${rawDocType.replace(/_/g, ' ')} — ${scan.documentNumber}`;
          const nowIso = new Date().toISOString();

          const insertedDoc = await withSavepoint<boolean>(
            tx,
            'kyc_scan_ins_rental_doc',
            async () => {
              await tx.$executeRawUnsafe(
                `INSERT INTO rental_documents (
                   id, tenant_id, customer_id, booking_id, agreement_id,
                   document_type, title, file_url, document_no, expiry_date,
                   verified, verified_by, verified_at, created_at, updated_at
                 ) VALUES (
                   $1, $2, $3, $4, $5,
                   $6, $7, $8, $9, $10::timestamptz,
                   $11, $12, $13::timestamptz, $14::timestamptz, $14::timestamptz
                 )`,
                docId,
                tenantId,
                customerId,
                bookingId,
                agreementId,
                rawDocType,
                docTitle,
                safeImageUrl,
                scan.documentNumber,
                parseOptionalIsoDate(scan.expiryDate),
                !scan.isExpired,
                actorId,
                nowIso,
                nowIso,
              );
              return true;
            },
            false,
          );

          if (insertedDoc) {
            documentRecordId = docId;
          } else {
            const insertedMinDoc = await withSavepoint<boolean>(
              tx,
              'kyc_scan_ins_rental_doc_min',
              async () => {
                await tx.$executeRawUnsafe(
                  `INSERT INTO rental_documents (
                     id, tenant_id, customer_id, booking_id, agreement_id,
                     document_type, file_url, created_at, updated_at
                   ) VALUES (
                     $1, $2, $3, $4, $5,
                     $6, $7, $8::timestamptz, $8::timestamptz
                   )`,
                  docId,
                  tenantId,
                  customerId,
                  bookingId,
                  agreementId,
                  rawDocType,
                  safeImageUrl,
                  nowIso,
                );
                return true;
              },
              false,
            );
            if (insertedMinDoc) {
              documentRecordId = docId;
            }
          }
        }
      });

      if (customerUpdated) {
        revalidateCache(['rental:customers']);
      }
    }

    // Build ready-to-apply customer form fields for 1-click UI population
    const suggestedCustomerFields = {
      fullName: scan.fullName,
      nationality: scan.nationality,
      visaType: scan.visaTypeHint,
      dateOfBirth: scan.dateOfBirth,
      ...(rawDocType === 'EMIRATES_ID' || scan.emiratesId
        ? {
            emiratesId: scan.emiratesId ?? scan.documentNumber,
            ...(rawDocType === 'EMIRATES_ID' && scan.expiryDate
              ? { emiratesIdExpiry: scan.expiryDate }
              : {}),
          }
        : {}),
      ...(rawDocType === 'PASSPORT'
        ? {
            passportNo: scan.documentNumber,
            passportExpiry: scan.expiryDate,
          }
        : {}),
      ...(rawDocType === 'DRIVING_LICENSE'
        ? {
            drivingLicenseNo: scan.documentNumber,
            licenseExpiry: scan.expiryDate,
            licenseIssueDate: scan.issueDate,
            licenseIssuingCountry: scan.issuingCountry,
          }
        : {}),
      ...(rawDocType === 'INTERNATIONAL_DRIVING_PERMIT'
        ? {
            internationalPermitNo: scan.documentNumber,
            internationalPermitExpiry: scan.expiryDate,
            ...(scan.issuingCountry ? { licenseIssuingCountry: scan.issuingCountry } : {}),
          }
        : {}),
    };

    return NextResponse.json({
      success: true,
      scan,
      extracted: {
        ...scan,
        ...suggestedCustomerFields,
        licenseNumber: scan.documentNumber,
        idNumber: scan.emiratesId ?? scan.documentNumber,
      },
      suggestedCustomerFields,
      customerUpdated,
      documentRecordId,
    });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[rental/documents/kyc-scan POST] error:', err);
    return NextResponse.json(
      { error: 'Failed to scan KYC document' },
      { status: 500 },
    );
  }
}
