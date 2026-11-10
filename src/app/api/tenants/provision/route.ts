export const dynamic = 'force-dynamic';

/**
 * POST /api/tenants/provision
 * Public endpoint — no auth required.
 * Onboards a new company: creates Tenant, admin User, UserTenant, TenantModules,
 * persists AI-extracted Trade License & VAT Certificate fields/attachments,
 * sends a domain verification email, and sets an xl-session cookie.
 */

import { systemRolePermissions } from '@/lib/authz/session-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { canServeResidency, residencySessionClaim } from '@/lib/data-residency';
import { tenantBootstrapHandler } from '@/lib/handlers/tenant-bootstrap-handler';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { signSession } from '@/lib/tenant-session';
import {
  attachmentFileProblem,
  insertTenantAttachments,
  listAttachmentTypes,
  removeStoredFiles,
  storeAttachmentFiles,
  type AttachmentUpload,
} from '@/lib/tenant-attachments';
import type { StoredFile } from '@/lib/storage';

// ── Free email domains blocklist ─────────────────────────────────────────────
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'protonmail.com', 'tutanota.com', 'gmx.com',
]);

// ── Zod schema ───────────────────────────────────────────────────────────────
const OnboardingAttachmentSchema = z.object({
  docType:        z.enum(['TRADE_LICENSE', 'VAT_CERTIFICATE', 'CORPORATE_TAX_CERTIFICATE', 'OTHER']),
  fileName:       z.string().min(1),
  mimeType:       z.string().min(1),
  base64:         z.string().min(1),
  documentNumber: z.string().nullable().optional(),
  expiryDate:     z.string().nullable().optional(),
});

const ProvisionSchema = z.object({
  companyName:           z.string().min(2),
  arabicName:            z.string().optional(),
  domain:                z.string().min(3),
  contactEmail:          z.string().email(),
  contactName:           z.string().min(2),
  contactPhone:          z.string().optional(),
  country:               z.string().optional(),
  plan:                  z.enum(['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']).default('TRIAL'),
  selectedModules:       z.array(z.string()).min(0),
  adminFirstName:        z.string().min(1),
  adminLastName:         z.string().min(1),
  adminPassword:         z.string().min(8),
  trn:                   z.string().optional(),
  corporateTaxTrn:       z.string().optional(),
  tradeLicenseNo:        z.string().optional(),
  tradeLicenseAuthority: z.string().optional(),
  emirate:               z.string().optional(),
  emirateCode:           z.string().optional(),
  streetName:            z.string().optional(),
  additionalStreetName:  z.string().optional(),
  postalZone:            z.string().optional(),
  address:               z.string().optional(),
  attachments:           z.array(OnboardingAttachmentSchema).optional(),
  preVerificationId:     z.string().optional(), // from pre-registration domain verification
  /**
   * ENTERPRISE data-residency region. Only honoured when plan = ENTERPRISE.
   * Defaults to GLOBAL (shared primary DB).
   */
  dataResidency:         z.enum(['GLOBAL', 'EU', 'UAE', 'US']).default('GLOBAL'),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCode(name: string): string {
  const prefix = name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const digits  = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${digits}`;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Asks the new organisation's administrator to verify its domain, in the
 * platform's wording (Admin > Email templates > Account). The link is built
 * from NEXT_PUBLIC_APP_URL, never the request's Host header, and the token
 * is never logged.
 */
async function sendVerificationEmail(opts: {
  to: string; tenantName: string; token: string; tenantId: string;
}): Promise<void> {
  const verifyUrl = appUrl(
    `/api/tenants/verify-domain?token=${encodeURIComponent(opts.token)}&tenantId=${encodeURIComponent(opts.tenantId)}`,
  );
  const sent = await sendTemplatedEmail({
    tenantId: opts.tenantId,
    key: 'account.domain_verification_link',
    to: opts.to,
    values: { organisationName: opts.tenantName, verifyUrl },
  });
  if (!sent.sent) console.warn(`[provision] domain verification email for tenant ${opts.tenantId} not sent (${sent.reason ?? 'unknown'})`);
}

// ── Detect the actual User table name ONCE before the transaction ─────────────
async function detectUserTableName(): Promise<string> {
  try {
    type Row = { table_name: string };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('User', 'users')
       LIMIT 1`,
    );
    if (rows.length > 0) {
      return rows[0].table_name === 'User' ? '"User"' : 'users';
    }
  } catch (e) {
    console.warn('[provision] detectUserTableName failed, defaulting to "User":', e);
  }
  return '"User"';
}

// ── Detect whether domain verification columns exist ──────────────────────────
async function detectDomainVerifColumnsExist(): Promise<boolean> {
  try {
    type Row = { count: string };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'tenants'
         AND column_name  = 'domain_verification_token'`,
    );
    return parseInt(rows[0]?.count ?? '0', 10) > 0;
  } catch {
    return false;
  }
}

// ── Persist AI-extracted company profile fields & attachments post-commit ─────
async function persistPostCommitCompanyProfileAndAttachments(
  tenantId: string,
  userId: string,
  data: z.infer<typeof ProvisionSchema>,
): Promise<void> {
  try {
    await withTenantRls(prisma, tenantId, async (tx) => {
      const trnClean = data.trn ? data.trn.replace(/[\s-]/g, '') : null;
      const ctTrnClean = data.corporateTaxTrn ? data.corporateTaxTrn.replace(/[\s-]/g, '') : null;
      const localizedNameJson = JSON.stringify({
        en: data.companyName,
        ...(data.arabicName ? { ar: data.arabicName } : {}),
      });

      await tx.$executeRawUnsafe(
        `UPDATE tenants
         SET localized_name = $2::jsonb,
             address = COALESCE($3, address)
         WHERE id = $1`,
        tenantId,
        localizedNameJson,
        data.address || null,
      ).catch(() => {});

      // Attempt extended UAE Corporate VAT & PEPPOL columns if present in DB
      await tx.$executeRawUnsafe(
        `UPDATE tenants
         SET arabic_name = COALESCE($2, arabic_name),
             corporate_tax_trn = COALESCE($3, corporate_tax_trn),
             trade_license_no = COALESCE($4, trade_license_no),
             trade_license_authority = COALESCE($5, trade_license_authority),
             peppol_endpoint_id = COALESCE($6, peppol_endpoint_id),
             street_name = COALESCE($7, street_name),
             additional_street_name = COALESCE($8, additional_street_name),
             postal_zone = COALESCE($9, postal_zone),
             emirate = COALESCE($10, emirate),
             emirate_code = COALESCE($11, emirate_code)
         WHERE id = $1`,
        tenantId,
        data.arabicName || null,
        ctTrnClean,
        data.tradeLicenseNo || null,
        data.tradeLicenseAuthority || null,
        trnClean || data.tradeLicenseNo || null,
        data.streetName || data.address || null,
        data.additionalStreetName || null,
        data.postalZone || null,
        data.emirate || null,
        data.emirateCode || null,
      ).catch(() => {});
    });
  } catch (err) {
    console.warn('[provision] Extended company profile columns update skipped:', err);
  }

  // Persist uploaded Trade License / VAT Certificate attachments if provided
  if (Array.isArray(data.attachments) && data.attachments.length > 0) {
    let stored: StoredFile[] = [];
    try {
      const types = await withTenantRls(prisma, tenantId, (tx) => listAttachmentTypes(tx, { activeOnly: true }));
      const uploads: AttachmentUpload[] = [];

      for (const att of data.attachments) {
        const rawB64 = att.base64.includes(',') ? att.base64.split(',')[1] : att.base64;
        const buf = Buffer.from(rawB64, 'base64');
        if (buf.byteLength === 0 || buf.byteLength > 10 * 1024 * 1024) continue;

        const targetCode =
          att.docType === 'CORPORATE_TAX_CERTIFICATE' ? 'VAT_CERTIFICATE' : att.docType;
        const matchedType =
          types.find((t) => t.code === targetCode) ||
          types.find((t) => t.code === 'OTHER') ||
          types[0];
        if (!matchedType) continue;

        const fileObj = new File([new Uint8Array(buf)], att.fileName, { type: att.mimeType });
        const fileErr = await attachmentFileProblem(fileObj);
        if (fileErr) continue;

        uploads.push({
          attachmentTypeId: matchedType.id,
          file: fileObj,
          documentNumber:
            att.documentNumber ||
            (targetCode === 'VAT_CERTIFICATE' ? data.trn : data.tradeLicenseNo) ||
            att.fileName.replace(/\.[^.]+$/, '').slice(0, 60),
          expiryDate: att.expiryDate || null,
        });
      }

      if (uploads.length > 0) {
        stored = await storeAttachmentFiles(tenantId, uploads);
        await withTenantRls(prisma, tenantId, (tx) =>
          insertTenantAttachments(tx, tenantId, uploads, stored, userId),
        );
      }
    } catch (attErr) {
      await removeStoredFiles(stored);
      console.warn('[provision] Onboarding attachment storage warning:', attErr);
    }
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const [userTable, domainVerifColumnsExist] = await Promise.all([
    detectUserTableName(),
    detectDomainVerifColumnsExist(),
  ]);
  console.log(`[provision] userTable=${userTable} domainVerifCols=${domainVerifColumnsExist}`);

  const deferred: { run: (() => Promise<void>) | null } = { run: null };

  const bootstrapResponse = await tenantBootstrapHandler(request, 'create_pending_tenant', async ({ tx, rescopeToTenant }) => {
    try {
      const body   = await request.json();
      const parsed = ProvisionSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation Error', details: parsed.error.flatten() },
          { status: 422 },
        );
      }

      const data = parsed.data;

      if (data.plan === 'ENTERPRISE' && !canServeResidency(data.dataResidency)) {
        return NextResponse.json(
          {
            error: 'Validation Error',
            code: 'DATA_RESIDENCY_UNAVAILABLE',
            message: `Data residency region ${data.dataResidency} is not available on this deployment.`,
          },
          { status: 422 },
        );
      }

      // Block free email domains
      const contactEmailDomain = emailDomain(data.contactEmail);
      if (FREE_EMAIL_DOMAINS.has(contactEmailDomain)) {
        return NextResponse.json(
          { error: 'Validation Error', message: 'Please use your company email, not a free email provider.' },
          { status: 422 },
        );
      }

      // Email domain must match company domain
      const normalizedDomain = data.domain.replace(/^www\./, '').toLowerCase().trim();
      if (contactEmailDomain !== normalizedDomain) {
        return NextResponse.json(
          { error: 'Validation Error', message: `Email domain (${contactEmailDomain}) must match company domain (${normalizedDomain}).` },
          { status: 422 },
        );
      }

      // Duplicate domain check
      const existingTenant = await tx.tenant.findFirst({
        where: { domain: normalizedDomain },
        select: { id: true },
      });
      if (existingTenant) {
        return NextResponse.json(
          { error: 'Conflict', message: `A tenant with domain "${normalizedDomain}" already exists.` },
          { status: 409 },
        );
      }

      const existingUser = await tx.user.findUnique({
        where: { email: data.contactEmail },
        select: { id: true },
      });
      if (existingUser) {
        return NextResponse.json(
          { error: 'Conflict', message: 'An account with this email already exists. Sign in instead.' },
          { status: 409 },
        );
      }

      // ── Check pre-verification (if provided) ─────────────────────────────────
      let domainPreVerified = false;
      if (data.preVerificationId) {
        try {
          type PreRow = { domain: string; verified: boolean; expires_at: string };
          const preRows = await tx.$queryRawUnsafe<PreRow[]>(
            `SELECT domain, verified, expires_at FROM domain_pre_verifications WHERE id = $1`,
            data.preVerificationId,
          );
          if (
            preRows.length &&
            preRows[0].verified &&
            preRows[0].domain === normalizedDomain &&
            new Date(preRows[0].expires_at) > new Date()
          ) {
            domainPreVerified = true;
          }
        } catch {
          // Table may not exist yet — treat as not pre-verified
        }
      }

      // Prepare IDs
      const tenantId          = crypto.randomUUID();
      const userId            = crypto.randomUUID();
      const passwordHash      = hashPassword(data.adminPassword);
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const allModules        = Array.from(new Set(['admin', 'platform', ...data.selectedModules]));

      // ── DB transaction ────────────────────────────────────────────────────────
      const { tenant, user } = await (async (tx, rescopeToTenant) => {
        // 1. Create Tenant
        const tenant = await tx.tenant.create({
          data: {
            id:            tenantId,
            name:          data.companyName,
            domain:        normalizedDomain,
            contactEmail:  data.contactEmail,
            contactName:   data.contactName,
            contactPhone:  data.contactPhone,
            address:       data.address || undefined,
            plan:          data.plan,
            isActive:      true,
            code:          generateCode(data.companyName),
            dataResidency: data.plan === 'ENTERPRISE' ? data.dataResidency : 'GLOBAL',
          },
        });

        // 1a. Re-scope the bootstrap transaction to the tenant just created.
        await rescopeToTenant(tenant.id);

        // 1b. Set TRN via raw SQL
        if (data.trn) {
          await tx.$executeRawUnsafe(
            `UPDATE tenants SET trn = $1 WHERE id = $2`,
            data.trn,
            tenantId,
          );
        }

        // 2. Create TenantModules
        await tx.tenantModule.createMany({
          data: allModules.map(module => ({
            id:        crypto.randomUUID(),
            tenantId:  tenant.id,
            module,
            isEnabled: true,
          })),
          skipDuplicates: true,
        });

        // 3. Create User via Prisma ORM
        const user = await tx.user.create({
          data: {
            id:        userId,
            username:  data.contactEmail,
            email:     data.contactEmail,
            firstName: data.adminFirstName,
            lastName:  data.adminLastName,
            isActive:  true,
            updatedAt: new Date(),
          },
        });

        // 4. Store password hash
        await tx.$executeRawUnsafe(
          `UPDATE ${userTable} SET password_hash = $1 WHERE id = $2`,
          passwordHash,
          user.id,
        );

        // 5. Find or create TENANT_ADMIN role (scoped to this tenant)
        let role = await tx.role.findFirst({ where: { code: 'TENANT_ADMIN', tenantId: tenant.id } });

        if (!role) {
          role = await tx.role.create({
            data: {
              id:          crypto.randomUUID(),
              name:        'Tenant Admin',
              code:        'TENANT_ADMIN',
              tenantId:    tenant.id,
              isSystem:    false,
              description: 'Full administrative access within this organisation',
            },
          });
        }

        // 6. Create UserTenant
        await tx.userTenant.create({
          data: {
            id:       crypto.randomUUID(),
            userId:   user.id,
            tenantId: tenant.id,
            roleId:   role.id,
            isActive: true,
          },
        });

        // 7. Store domain verification token
        if (domainVerifColumnsExist) {
          if (domainPreVerified) {
            await tx.$executeRawUnsafe(
              `UPDATE tenants SET domain_verification_token = $1, domain_verified_at = NOW(), domain_verification_method = 'PRE_REGISTRATION' WHERE id = $2`,
              verificationToken,
              tenant.id,
            );
          } else {
            await tx.$executeRawUnsafe(
              `UPDATE tenants SET domain_verification_token = $1, domain_verification_method = 'EMAIL' WHERE id = $2`,
              verificationToken,
              tenant.id,
            );
          }
        } else {
          console.warn('[provision] domain verification columns not yet in DB — skipping token storage for tenant', tenant.id);
        }

        return { tenant, user };
      })(tx, rescopeToTenant);

      deferred.run = async () => {
        await persistPostCommitCompanyProfileAndAttachments(tenant.id, user.id, data);
        if (!domainPreVerified) {
          sendVerificationEmail({
            to: user.email ?? data.contactEmail,
            tenantName: tenant.name,
            token: verificationToken,
            tenantId: tenant.id,
          }).catch(() => {});
        }
        void import('@/lib/billing').then(m => m.startTrialForTenant(tenant.id)).catch(() => {});
      };

      // Set session cookie — newly provisioned users always start as TENANT_ADMIN
      const effectivePlan = tenant.plan ?? 'TRIAL';
      const sessionToken = await signSession({
        userId:        user.id,
        tenantId:      tenant.id,
        plan:          effectivePlan,
        role:          'TENANT_ADMIN',
        permissions:   systemRolePermissions('TENANT_ADMIN'),
        ...residencySessionClaim(tenant.dataResidency),
      });

      const payload: Record<string, unknown> = {
        ok:                   true,
        tenantId:             tenant.id,
        userId:               user.id,
        verificationRequired: !domainPreVerified,
        domainVerified:       domainPreVerified,
        domain:               normalizedDomain,
      };
      if (process.env.NODE_ENV !== 'production') {
        payload.verificationToken = verificationToken;
      }

      const isSecure = process.env.NODE_ENV === 'production';
      const response = NextResponse.json(payload, { status: 201 });

      response.cookies.delete('xl-session');

      response.cookies.set('xl-session', sessionToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure:   isSecure,
        maxAge:   86_400,
        path:     '/',
      });
      return response;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[tenants/provision] ERROR:', message, err);
      return NextResponse.json(
        {
          error:   'Internal Server Error',
          message: `Provisioning failed: ${message}`,
          detail:  message,
        },
        { status: 500 },
      );
    }
  });

  if (deferred.run) {
    await deferred.run();
  }
  return bootstrapResponse;
}
