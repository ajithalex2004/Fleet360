export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import {
  UAE_EMIRATES,
  normalizeUaeTrn,
  validateUaeTrn,
  validateUaeCorporateTaxTrn,
} from '@/lib/finance/uae';
import {
  autofillCompanyDocument,
  resolveEmirateAndCode,
} from '@/lib/tenant-attachments-autofill';
import {
  attachmentFileProblem,
  insertTenantAttachments,
  listAttachmentTypes,
  listTenantAttachments,
  removeStoredFiles,
  storeAttachmentFiles,
  type AttachmentUpload,
  type TenantAttachmentRow,
  type AttachmentType,
} from '@/lib/tenant-attachments';
import type { StoredFile } from '@/lib/storage';

let columnEnsured = false;

async function ensureColumns() {
  if (columnEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "trn" TEXT,
        ADD COLUMN IF NOT EXISTS "corporate_tax_trn" TEXT,
        ADD COLUMN IF NOT EXISTS "trade_license_no" TEXT,
        ADD COLUMN IF NOT EXISTS "trade_license_authority" TEXT,
        ADD COLUMN IF NOT EXISTS "peppol_endpoint_id" TEXT,
        ADD COLUMN IF NOT EXISTS "peppol_scheme_id" TEXT DEFAULT '0235',
        ADD COLUMN IF NOT EXISTS "arabic_name" TEXT,
        ADD COLUMN IF NOT EXISTS "street_name" TEXT,
        ADD COLUMN IF NOT EXISTS "additional_street_name" TEXT,
        ADD COLUMN IF NOT EXISTS "postal_zone" TEXT,
        ADD COLUMN IF NOT EXISTS "emirate" TEXT,
        ADD COLUMN IF NOT EXISTS "emirate_code" TEXT,
        ADD COLUMN IF NOT EXISTS "country_code" TEXT DEFAULT 'AE',
        ADD COLUMN IF NOT EXISTS "tax_scheme_id" TEXT DEFAULT 'VAT'
    `);
    columnEnsured = true;
  } catch {
    // Non-fatal if app user does not hold DDL rights
  }
}

interface TenantCompanyRow {
  id: string;
  name: string;
  code: string | null;
  domain: string | null;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  trn: string | null;
  corporate_tax_trn: string | null;
  trade_license_no: string | null;
  trade_license_authority: string | null;
  peppol_endpoint_id: string | null;
  peppol_scheme_id: string | null;
  arabic_name: string | null;
  localized_name: unknown;
  street_name: string | null;
  additional_street_name: string | null;
  postal_zone: string | null;
  emirate: string | null;
  emirate_code: string | null;
  country_code: string | null;
  tax_scheme_id: string | null;
}

export async function GET(request: NextRequest) {
  const auth = requireAuthorizedTenant(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { tenantId } = auth;

  await ensureColumns();

  try {
    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<TenantCompanyRow[]>(
        `SELECT
           id, name, code, domain, address,
           contact_name, contact_email, contact_phone,
           trn, corporate_tax_trn, trade_license_no, trade_license_authority,
           peppol_endpoint_id, peppol_scheme_id, arabic_name, localized_name,
           street_name, additional_street_name, postal_zone,
           emirate, emirate_code, country_code, tax_scheme_id
         FROM tenants
         WHERE id = $1
         LIMIT 1`,
        tenantId
      );

      let attachmentTypes: AttachmentType[] = [];
      let attachments: TenantAttachmentRow[] = [];
      try {
        attachmentTypes = await listAttachmentTypes(tx, { activeOnly: true });
        attachments = await listTenantAttachments(tx, tenantId);
      } catch {
        // Attachments table not yet migrated in some test environments
      }

      return { row: rows[0] ?? null, attachmentTypes, attachments };
    });

    const row = result.row;
    if (!row) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const localized =
      row.localized_name && typeof row.localized_name === 'object'
        ? (row.localized_name as Record<string, string>)
        : {};

    return NextResponse.json({
      data: {
        id: row.id,
        name: row.name,
        code: row.code ?? '',
        domain: row.domain ?? '',
        address: row.address ?? '',
        contactName: row.contact_name ?? '',
        contactEmail: row.contact_email ?? '',
        contactPhone: row.contact_phone ?? '',
        trn: row.trn ?? '',
        corporateTaxTrn: row.corporate_tax_trn ?? '',
        tradeLicenseNo: row.trade_license_no ?? '',
        tradeLicenseAuthority: row.trade_license_authority ?? '',
        peppolEndpointId: row.peppol_endpoint_id ?? row.trn ?? '',
        peppolSchemeId: row.peppol_scheme_id ?? '0235',
        arabicName: row.arabic_name ?? localized.ar ?? '',
        streetName: row.street_name ?? row.address ?? '',
        additionalStreetName: row.additional_street_name ?? '',
        postalZone: row.postal_zone ?? '',
        emirate: row.emirate ?? 'Dubai',
        emirateCode: row.emirate_code ?? 'AE-DU',
        countryCode: row.country_code ?? 'AE',
        taxSchemeId: row.tax_scheme_id ?? 'VAT',
        emiratesCatalog: UAE_EMIRATES,
        attachmentTypes: result.attachmentTypes,
        attachments: result.attachments,
      },
    });
  } catch (err) {
    console.error('[GET /api/admin/company-profile]', err);
    return NextResponse.json({ error: 'Failed to load company profile' }, { status: 500 });
  }
}

async function handlePUT(request: NextRequest) {
  const auth = requireAuthorizedTenant(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { tenantId } = auth;

  await ensureColumns();

  try {
    const body = await request.json();

    const trnNormalized = body.trn ? normalizeUaeTrn(String(body.trn)) : '';
    if (trnNormalized) {
      const trnCheck = validateUaeTrn(trnNormalized);
      if (!trnCheck.valid) {
        return NextResponse.json({ error: trnCheck.error }, { status: 422 });
      }
    }

    const ctTrnNormalized = body.corporateTaxTrn
      ? String(body.corporateTaxTrn).replace(/[\s-]/g, '')
      : '';
    if (ctTrnNormalized) {
      const ctCheck = validateUaeCorporateTaxTrn(ctTrnNormalized);
      if (!ctCheck.valid) {
        return NextResponse.json({ error: ctCheck.error }, { status: 422 });
      }
    }

    const name = String(body.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Company legal name (English) is required' }, { status: 422 });
    }

    const arabicName = body.arabicName ? String(body.arabicName).trim() : null;
    const tradeLicenseNo = body.tradeLicenseNo ? String(body.tradeLicenseNo).trim() : null;
    const tradeLicenseAuthority = body.tradeLicenseAuthority
      ? String(body.tradeLicenseAuthority).trim()
      : null;
    const peppolEndpointId = body.peppolEndpointId
      ? String(body.peppolEndpointId).trim()
      : trnNormalized || null;
    const peppolSchemeId = body.peppolSchemeId ? String(body.peppolSchemeId).trim() : '0235';
    const streetName = body.streetName ? String(body.streetName).trim() : null;
    const additionalStreetName = body.additionalStreetName
      ? String(body.additionalStreetName).trim()
      : null;
    const postalZone = body.postalZone ? String(body.postalZone).trim() : null;
    const emirate = body.emirate ? String(body.emirate).trim() : 'Dubai';
    const emirateEntry = UAE_EMIRATES.find(
      (e) =>
        e.code.toUpperCase() === String(body.emirateCode ?? '').toUpperCase() ||
        e.nameEn.toLowerCase() === emirate.toLowerCase()
    );
    const emirateCode = emirateEntry?.code ?? (body.emirateCode ? String(body.emirateCode).trim() : 'AE-DU');
    const countryCode = body.countryCode ? String(body.countryCode).trim().toUpperCase() : 'AE';
    const taxSchemeId = body.taxSchemeId ? String(body.taxSchemeId).trim().toUpperCase() : 'VAT';
    const address =
      body.address !== undefined
        ? String(body.address).trim()
        : [streetName, additionalStreetName, emirate, postalZone].filter(Boolean).join(', ');
    const contactName = body.contactName !== undefined ? String(body.contactName).trim() : null;
    const contactEmail = body.contactEmail !== undefined ? String(body.contactEmail).trim() : null;
    const contactPhone = body.contactPhone !== undefined ? String(body.contactPhone).trim() : null;

    const localizedNameJson = JSON.stringify({
      en: name,
      ...(arabicName ? { ar: arabicName } : {}),
    });

    await withTenantRls(prisma, tenantId, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE tenants
         SET name = $2,
             arabic_name = $3,
             localized_name = $4::jsonb,
             trn = $5,
             corporate_tax_trn = $6,
             trade_license_no = $7,
             trade_license_authority = $8,
             peppol_endpoint_id = $9,
             peppol_scheme_id = $10,
             street_name = $11,
             additional_street_name = $12,
             postal_zone = $13,
             emirate = $14,
             emirate_code = $15,
             country_code = $16,
             tax_scheme_id = $17,
             address = $18,
             contact_name = COALESCE($19, contact_name),
             contact_email = COALESCE($20, contact_email),
             contact_phone = COALESCE($21, contact_phone),
             updated_at = NOW()
         WHERE id = $1`,
        tenantId,
        name,
        arabicName,
        localizedNameJson,
        trnNormalized || null,
        ctTrnNormalized || null,
        tradeLicenseNo,
        tradeLicenseAuthority,
        peppolEndpointId,
        peppolSchemeId,
        streetName,
        additionalStreetName,
        postalZone,
        emirate,
        emirateCode,
        countryCode,
        taxSchemeId,
        address || null,
        contactName,
        contactEmail,
        contactPhone
      );

      await tx.$executeRawUnsafe(
        `UPDATE tenant_branches
         SET trn = COALESCE($2, trn),
             address = COALESCE($3, address),
             city = COALESCE($4, city)
         WHERE tenant_id = $1 AND is_headquarters = TRUE`,
        tenantId,
        trnNormalized || null,
        address || null,
        emirate
      ).catch(() => {});
    });

    return NextResponse.json({
      ok: true,
      data: {
        id: tenantId,
        name,
        arabicName: arabicName ?? '',
        trn: trnNormalized,
        corporateTaxTrn: ctTrnNormalized,
        tradeLicenseNo: tradeLicenseNo ?? '',
        tradeLicenseAuthority: tradeLicenseAuthority ?? '',
        peppolEndpointId: peppolEndpointId ?? '',
        peppolSchemeId,
        streetName: streetName ?? '',
        additionalStreetName: additionalStreetName ?? '',
        postalZone: postalZone ?? '',
        emirate,
        emirateCode,
        countryCode,
        taxSchemeId,
        address,
        contactName: contactName ?? '',
        contactEmail: contactEmail ?? '',
        contactPhone: contactPhone ?? '',
      },
    });
  } catch (err) {
    console.error('[PUT /api/admin/company-profile]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update company profile' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/company-profile
 * Supports:
 * 1. AI Document Extraction + Attachment Storage (action = 'autofill-document' or default):
 *    Accepts { base64, mimeType, fileName, docType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'AUTO', saveAttachment?: boolean }
 *    Extracts UAE Trade License / FTA VAT Certificate fields via PDF text + AI Vision, and optionally stores the file in tenant_attachments.
 * 2. Delete Attachment (action = 'delete-attachment'):
 *    Accepts { action: 'delete-attachment', attachmentId: string }
 */
async function handlePOST(request: NextRequest) {
  const auth = requireAuthorizedTenant(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { tenantId, userId } = auth;

  try {
    const body = await request.json();
    const action = body.action || 'autofill-document';

    if (action === 'delete-attachment') {
      const attachmentId = String(body.attachmentId ?? '').trim();
      if (!attachmentId) {
        return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 });
      }

      const attachments = await withTenantRls(prisma, tenantId, async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE tenant_attachments SET deleted_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
          attachmentId,
          tenantId,
        );
        return listTenantAttachments(tx, tenantId);
      });

      return NextResponse.json({ ok: true, attachments });
    }

    // Default action: 'autofill-document'
    const base64Raw = typeof body.base64 === 'string' ? body.base64.trim() : '';
    const base64 = base64Raw.includes(',') ? base64Raw.split(',')[1] : base64Raw;
    const mimeType = typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : 'application/pdf';
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim() : 'company-document.pdf';
    const docType: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'AUTO' =
      body.docType === 'TRADE_LICENSE' ||
      body.docType === 'VAT_CERTIFICATE' ||
      body.docType === 'CORPORATE_TAX_CERTIFICATE'
        ? body.docType
        : 'AUTO';
    const saveAttachment = body.saveAttachment !== false;

    if (!base64) {
      return NextResponse.json({ error: 'base64 document content is required' }, { status: 400 });
    }

    const buf = Buffer.from(base64, 'base64');
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
    }
    if (buf.byteLength > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 400 });
    }

    // Run hybrid PDF + AI Vision extraction
    const extracted = await autofillCompanyDocument(
      { base64, mimeType, fileName },
      docType,
    );

    // Optionally persist the uploaded file into tenant_attachments under TRADE_LICENSE or VAT_CERTIFICATE
    let attachments: TenantAttachmentRow[] = [];
    let savedAttachmentTypeCode: string | null = null;

    if (saveAttachment) {
      let stored: StoredFile[] = [];
      try {
        const targetCode =
          docType !== 'AUTO'
            ? docType === 'CORPORATE_TAX_CERTIFICATE'
              ? 'VAT_CERTIFICATE'
              : docType
            : extracted.docType === 'VAT_CERTIFICATE' || extracted.docType === 'CORPORATE_TAX_CERTIFICATE'
              ? 'VAT_CERTIFICATE'
              : 'TRADE_LICENSE';

        const types = await withTenantRls(prisma, tenantId, (tx) => listAttachmentTypes(tx, { activeOnly: true }));
        const matchedType =
          types.find((t) => t.code === targetCode) ||
          types.find((t) => t.code === 'OTHER') ||
          types[0];

        if (matchedType) {
          const fileObj = new File([new Uint8Array(buf)], fileName, { type: mimeType });
          const fileErr = await attachmentFileProblem(fileObj);
          if (!fileErr) {
            const uploadInput: AttachmentUpload = {
              attachmentTypeId: matchedType.id,
              file: fileObj,
              documentNumber:
                extracted.documentNumber ||
                (targetCode === 'VAT_CERTIFICATE' ? extracted.trn : extracted.tradeLicenseNo) ||
                fileName.replace(/\.[^.]+$/, '').slice(0, 60),
              expiryDate: extracted.expiryDate || null,
            };

            stored = await storeAttachmentFiles(tenantId, [uploadInput]);
            attachments = await withTenantRls(prisma, tenantId, async (tx) => {
              // Soft-delete previous attachment of the same type if replacing
              await tx.$executeRawUnsafe(
                `UPDATE tenant_attachments
                 SET deleted_at = NOW()
                 WHERE tenant_id = $1 AND attachment_type_id = $2::uuid AND deleted_at IS NULL`,
                tenantId,
                matchedType.id,
              );
              await insertTenantAttachments(tx, tenantId, [uploadInput], stored, userId ?? null);
              return listTenantAttachments(tx, tenantId);
            });
            savedAttachmentTypeCode = matchedType.code;
          }
        }
      } catch (storageErr) {
        await removeStoredFiles(stored);
        console.warn('[POST /api/admin/company-profile] Non-fatal attachment storage error:', storageErr);
      }
    }

    const { emirate, emirateCode } = resolveEmirateAndCode(extracted.emirate || extracted.emirateCode);

    return NextResponse.json({
      ...extracted,
      emirate: emirate || extracted.emirate,
      emirateCode: emirateCode || extracted.emirateCode,
      savedAttachmentTypeCode,
      attachments,
    });
  } catch (err) {
    console.error('[POST /api/admin/company-profile]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to analyze company document' },
      { status: 500 },
    );
  }
}

export const PUT = withAuditedAction(handlePUT);
export const POST = withAuditedAction(handlePOST);
