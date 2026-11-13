export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  parseDocumentOcr,
  scanKycDocumentMultimodal,
  type KycDocumentType,
  type LegacyOcrDocType,
} from '@/lib/digital-kyc-engine';
import {
  isRentalSecurityError,
  validateSafeDocumentOrSignatureUrl,
} from '@/lib/rental/security-guards';

const ALLOWED_DOC_TYPES = new Set<KycDocumentType>([
  'EMIRATES_ID',
  'DRIVING_LICENSE',
  'PASSPORT',
  'INTERNATIONAL_DRIVING_PERMIT',
]);

export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(
      (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>,
    ) as Record<string, unknown>;

    const rawDocType = String(body.documentType ?? body.docType ?? 'EMIRATES_ID')
      .trim()
      .toUpperCase() as KycDocumentType;
    const documentType: KycDocumentType = ALLOWED_DOC_TYPES.has(rawDocType)
      ? rawDocType
      : 'EMIRATES_ID';

    const hintName =
      typeof body.hintName === 'string' && body.hintName.trim()
        ? body.hintName.trim()
        : typeof body.name === 'string' && body.name.trim()
          ? body.name.trim()
          : undefined;

    const rawImage =
      typeof body.imageBase64OrUrl === 'string' && body.imageBase64OrUrl.trim()
        ? body.imageBase64OrUrl.trim()
        : typeof body.imageDataUrl === 'string' && body.imageDataUrl.trim()
          ? body.imageDataUrl.trim()
          : undefined;

    if (rawImage && (rawImage.startsWith('data:') || rawImage.startsWith('/') || rawImage.includes('://'))) {
      validateSafeDocumentOrSignatureUrl(rawImage, {
        allowPdfDataUrl: true,
        fieldName: 'imageBase64OrUrl',
      });
    }

    const mrzText =
      typeof body.mrzText === 'string' && body.mrzText.trim() ? body.mrzText.trim() : undefined;
    const mimeType =
      typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : undefined;

    if (rawImage || mrzText || documentType === 'INTERNATIONAL_DRIVING_PERMIT') {
      const scanResult = await scanKycDocumentMultimodal({
        documentType,
        imageBase64OrUrl: rawImage,
        mimeType,
        mrzText,
        hintName,
      });

      return NextResponse.json({
        success: true,
        ocrResult: {
          docType: scanResult.docType,
          documentType: scanResult.documentType,
          docNumber: scanResult.documentNumber,
          documentNumber: scanResult.documentNumber,
          fullName: scanResult.fullName,
          emiratesId: scanResult.emiratesId,
          emiratesIdValid: scanResult.emiratesIdValid,
          dateOfBirth: scanResult.dateOfBirth,
          expiryDate: scanResult.expiryDate ?? '',
          issueDate: scanResult.issueDate ?? '',
          nationality: scanResult.nationality ?? '',
          issuingCountry: scanResult.issuingCountry,
          licenseClass: scanResult.licenseClass,
          visaTypeHint: scanResult.visaTypeHint,
          isExpired: scanResult.isExpired,
          daysUntilExpiry: scanResult.daysUntilExpiry,
          warnings: scanResult.warnings,
          confidenceScore: scanResult.confidence,
          provider: scanResult.provider,
        },
        multimodal: scanResult,
      });
    }

    const legacyDocType: LegacyOcrDocType =
      documentType === 'PASSPORT'
        ? 'PASSPORT'
        : documentType === 'DRIVING_LICENSE'
          ? 'DRIVING_LICENSE'
          : 'EMIRATES_ID';

    const ocrResult = parseDocumentOcr(legacyDocType, hintName || 'Mohammed Al-Maktoum');

    return NextResponse.json({
      success: true,
      ocrResult,
    });
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/kyc/ocr-scan POST]', err);
    return NextResponse.json({ error: 'OCR Scan processing failed' }, { status: 500 });
  }
}
