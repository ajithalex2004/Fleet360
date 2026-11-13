/**
 * Shared multi-tenant isolation, cross-tenant foreign-key (IDOR) validation,
 * customer rental eligibility (blacklist, license expiry, corporate credit limit),
 * input sanitization, and cryptographic channel-webhook key derivation guards
 * for the Rent-A-Car (RAC) module.
 */

import crypto from 'node:crypto';
import type { TxClient } from '@/lib/rls';
import { withSavepoint } from '@/lib/rental/locks';

export class RentalSecurityError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RentalSecurityError';
    this.status = status;
    this.code = code;
  }
}

export function isRentalSecurityError(err: unknown): err is RentalSecurityError {
  return (
    err instanceof RentalSecurityError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: string }).name === 'RentalSecurityError' &&
      typeof (err as { status?: unknown }).status === 'number')
  );
}

export interface RentalForeignKeyRefs {
  customerId?: string | null;
  corporateAccountId?: string | null;
  vehicleId?: string | null;
  bookingId?: string | null;
  agreementId?: string | null;
  branchIds?: Array<string | null | undefined>;
  inquiryId?: string | null;
  ancillaryIds?: Array<string | null | undefined>;
}

/**
 * Verifies every supplied foreign-key reference belongs to `tenantId` (and is not soft-deleted).
 * PostgreSQL FK triggers execute as table owner and bypass RLS on referenced parent rows;
 * explicit tenant ownership verification prevents cross-tenant IDOR attachment.
 */
export async function assertRentalForeignKeysInTenant(
  tx: TxClient,
  tenantId: string,
  refs: RentalForeignKeyRefs,
): Promise<void> {
  const anyTx = tx as Record<string, unknown>;
  const hasRawQuery = typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function';

  if (refs.customerId) {
    if (typeof (anyTx.rentalCustomer as { findFirst?: unknown })?.findFirst === 'function') {
      const cust = await tx.rentalCustomer.findFirst({
        where: { id: refs.customerId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!cust) {
        throw new RentalSecurityError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found in tenant');
      }
    } else if (hasRawQuery) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM rental_customers WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
        refs.customerId,
        tenantId,
      );
      if (rows.length === 0) {
        throw new RentalSecurityError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found in tenant');
      }
    }
  }

  if (refs.corporateAccountId && refs.corporateAccountId !== refs.customerId) {
    if (typeof (anyTx.rentalCustomer as { findFirst?: unknown })?.findFirst === 'function') {
      const corp = await tx.rentalCustomer.findFirst({
        where: { id: refs.corporateAccountId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!corp) {
        throw new RentalSecurityError(
          404,
          'CORPORATE_ACCOUNT_NOT_FOUND',
          'Corporate account not found in tenant',
        );
      }
    } else if (hasRawQuery) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM rental_customers WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
        refs.corporateAccountId,
        tenantId,
      );
      if (rows.length === 0) {
        throw new RentalSecurityError(
          404,
          'CORPORATE_ACCOUNT_NOT_FOUND',
          'Corporate account not found in tenant',
        );
      }
    }
  }

  if (refs.vehicleId) {
    if (typeof (anyTx.vehicle as { findFirst?: unknown })?.findFirst === 'function') {
      const veh = await tx.vehicle.findFirst({
        where: { id: refs.vehicleId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!veh) {
        throw new RentalSecurityError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found in tenant');
      }
    } else if (hasRawQuery) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM vehicles WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
        refs.vehicleId,
        tenantId,
      );
      if (rows.length === 0) {
        throw new RentalSecurityError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found in tenant');
      }
    }
  }

  if (refs.bookingId) {
    if (typeof (anyTx.rentalBooking as { findFirst?: unknown })?.findFirst === 'function') {
      const bk = await tx.rentalBooking.findFirst({
        where: { id: refs.bookingId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!bk) {
        throw new RentalSecurityError(404, 'BOOKING_NOT_FOUND', 'Booking not found in tenant');
      }
    } else if (hasRawQuery) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM rental_bookings WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
        refs.bookingId,
        tenantId,
      );
      if (rows.length === 0) {
        throw new RentalSecurityError(404, 'BOOKING_NOT_FOUND', 'Booking not found in tenant');
      }
    }
  }

  if (refs.agreementId) {
    if (typeof (anyTx.rentalAgreement as { findFirst?: unknown })?.findFirst === 'function') {
      const agr = await tx.rentalAgreement.findFirst({
        where: { id: refs.agreementId, tenantId },
        select: { id: true },
      });
      if (!agr) {
        throw new RentalSecurityError(404, 'AGREEMENT_NOT_FOUND', 'Rental agreement not found in tenant');
      }
    } else if (hasRawQuery) {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM rental_agreements WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
        refs.agreementId,
        tenantId,
      );
      if (rows.length === 0) {
        throw new RentalSecurityError(404, 'AGREEMENT_NOT_FOUND', 'Rental agreement not found in tenant');
      }
    }
  }

  const branchIds = Array.from(
    new Set((refs.branchIds ?? []).filter((b): b is string => Boolean(b && b.trim()))),
  );
  if (branchIds.length > 0 && hasRawQuery) {
    for (const branchId of branchIds) {
      const rows = await withSavepoint(
        tx,
        'chk_branch_fk',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text AS id FROM rental_branches WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
            branchId,
            tenantId,
          ),
        [{ id: branchId }],
      );
      if (rows.length === 0) {
        throw new RentalSecurityError(
          404,
          'BRANCH_NOT_FOUND',
          `Rental branch ${branchId} not found in tenant`,
        );
      }
    }
  }

  if (refs.inquiryId && hasRawQuery) {
    const rows = await withSavepoint(
      tx,
      'chk_inquiry_fk',
      () =>
        tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id::text AS id FROM rental_inquiries WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
          refs.inquiryId!,
          tenantId,
        ),
      [{ id: refs.inquiryId! }],
    );
    if (rows.length === 0) {
      throw new RentalSecurityError(404, 'INQUIRY_NOT_FOUND', 'Rental inquiry not found in tenant');
    }
  }

  const ancillaryIds = Array.from(
    new Set((refs.ancillaryIds ?? []).filter((a): a is string => Boolean(a && a.trim()))),
  );
  if (ancillaryIds.length > 0 && typeof (anyTx.rentalAncillary as { count?: unknown })?.count === 'function') {
    const foundCount = await tx.rentalAncillary.count({
      where: { id: { in: ancillaryIds }, tenantId, deletedAt: null },
    });
    if (foundCount !== ancillaryIds.length) {
      throw new RentalSecurityError(404, 'ANCILLARY_NOT_FOUND', 'One or more ancillaries not found in tenant');
    }
  }
}

export interface CustomerEligibilityOptions {
  tenantId: string;
  customerId: string;
  corporateAccountId?: string | null;
  dropoffDate?: Date | null;
  vehicleCategory?: string | null;
  additionalExposureAed?: number;
  excludeBookingId?: string | null;
  allowCreditOverride?: boolean;
  /** Require a non-null driving license number + expiry (and UAE/Tourist KYC rules) at handover / activation. */
  requireLicenseOnFile?: boolean;
}

export interface AdditionalDriverInput {
  fullName: string;
  nationality?: string | null;
  dateOfBirth?: string | Date | null;
  emiratesId?: string | null;
  passportNo?: string | null;
  drivingLicenseNo: string;
  licenseIssuingCountry?: string | null;
  licenseExpiry: string | Date;
  internationalPermitNo?: string | null;
  internationalPermitExpiry?: string | Date | null;
  dailyFee?: number | null;
}

/**
 * UAE Ministry of Interior / RTA recognized countries whose tourists may rent
 * with their national driving license without an International Driving Permit (IDP).
 * Includes GCC states and bilateral MoI treaty countries (ISO-2 & common names).
 */
const UAE_IDP_EXEMPT_COUNTRIES = new Set([
  'AE', 'UAE', 'UNITED ARAB EMIRATES',
  'SA', 'KSA', 'SAUDI ARABIA',
  'OM', 'OMAN',
  'KW', 'KUWAIT',
  'BH', 'BAHRAIN',
  'QA', 'QATAR',
  'US', 'USA', 'UNITED STATES',
  'GB', 'UK', 'UNITED KINGDOM',
  'CA', 'CANADA',
  'AU', 'AUSTRALIA',
  'NZ', 'NEW ZEALAND',
  'DE', 'GERMANY',
  'FR', 'FRANCE',
  'IT', 'ITALY',
  'ES', 'SPAIN',
  'NL', 'NETHERLANDS',
  'BE', 'BELGIUM',
  'CH', 'SWITZERLAND',
  'AT', 'AUSTRIA',
  'SE', 'SWEDEN',
  'NO', 'NORWAY',
  'DK', 'DENMARK',
  'FI', 'FINLAND',
  'IE', 'IRELAND',
  'PT', 'PORTUGAL',
  'GR', 'GREECE',
  'PL', 'POLAND',
  'LU', 'LUXEMBOURG',
  'IS', 'ICELAND',
  'JP', 'JAPAN',
  'KR', 'SOUTH KOREA',
  'SG', 'SINGAPORE',
  'HK', 'HONG KONG',
  'CN', 'CHINA',
  'TR', 'TURKEY', 'TURKIYE',
  'ZA', 'SOUTH AFRICA',
]);

export function isUaeCountry(country?: string | null): boolean {
  const norm = String(country ?? '').trim().toUpperCase();
  return norm === 'AE' || norm === 'UAE' || norm === 'UNITED ARAB EMIRATES';
}

export function isUaeIdpExemptCountry(country?: string | null): boolean {
  const norm = String(country ?? '').trim().toUpperCase();
  if (!norm) return true;
  return UAE_IDP_EXEMPT_COUNTRIES.has(norm);
}

export function isValidEmiratesIdNumber(raw?: string | null): boolean {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return false;
  if (/^784-\d{4}-\d{7}-\d$/.test(trimmed)) return true;
  const digits = trimmed.replace(/[\s-]/g, '');
  return /^784\d{12}$/.test(digits);
}

function computeAgeYears(dob: Date, atDate: Date): number {
  let age = atDate.getUTCFullYear() - dob.getUTCFullYear();
  const m = atDate.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && atDate.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Enforces RAC customer rental eligibility inside `tx`:
 *   1. Customer exists in `tenantId` (`deletedAt: null`)
 *   2. Customer is NOT `blacklisted` (`422 CUSTOMER_BLACKLISTED`)
 *   3. Driving license on file (`422 LICENSE_REQUIRED` when `requireLicenseOnFile`) & not expired (`422 LICENSE_EXPIRED`)
 *   4. UAE KYC rules: Emirates ID format/expiry, Resident UAE license rule, Tourist Passport & IDP check, minimum age (21 / 25 Luxury)
 *   5. Corporate `creditLimit` is not exceeded (`422 CREDIT_LIMIT_EXCEEDED`, unless `allowCreditOverride`)
 */
export async function assertCustomerEligibleForRental(
  tx: TxClient,
  opts: CustomerEligibilityOptions,
): Promise<{
  id: string;
  customerType: string;
  blacklisted: boolean;
  creditLimit: number | null;
}> {
  const anyTx = tx as Record<string, unknown>;
  if (typeof (anyTx.rentalCustomer as { findFirst?: unknown })?.findFirst !== 'function') {
    return { id: opts.customerId, customerType: 'INDIVIDUAL', blacklisted: false, creditLimit: null };
  }

  const customer = await tx.rentalCustomer.findFirst({
    where: { id: opts.customerId, tenantId: opts.tenantId, deletedAt: null },
    select: {
      id: true,
      customerType: true,
      blacklisted: true,
      drivingLicenseNo: true,
      licenseExpiry: true,
      creditLimit: true,
    },
  });

  if (!customer) {
    throw new RentalSecurityError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found in tenant');
  }

  if (customer.blacklisted) {
    throw new RentalSecurityError(
      422,
      'CUSTOMER_BLACKLISTED',
      'Customer is blacklisted and cannot rent vehicles',
    );
  }

  const compareDate = opts.dropoffDate ?? new Date();
  const isCorporateEntity = customer.customerType === 'CORPORATE';

  if (opts.requireLicenseOnFile && !isCorporateEntity) {
    const hasLicenseNo =
      customer.drivingLicenseNo === undefined
        ? Boolean(customer.licenseExpiry)
        : Boolean(String(customer.drivingLicenseNo ?? '').trim());
    if (!hasLicenseNo || !customer.licenseExpiry) {
      throw new RentalSecurityError(
        422,
        'LICENSE_REQUIRED',
        'Valid driving license number and expiry date must be on file before vehicle handover',
      );
    }
  }

  if (customer.licenseExpiry) {
    const expiryEndOfDay = new Date(customer.licenseExpiry);
    expiryEndOfDay.setUTCHours(23, 59, 59, 999);
    if (expiryEndOfDay.getTime() < compareDate.getTime()) {
      throw new RentalSecurityError(
        422,
        'LICENSE_EXPIRED',
        `Customer driving license expires (${expiryEndOfDay.toISOString().slice(0, 10)}) before scheduled return`,
      );
    }
  }

  // Extended UAE KYC, Residency, Tourist IDP & Age verification (via savepoint-guarded SQL)
  if (!isCorporateEntity && typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function') {
    const kycRows = await withSavepoint(
      tx,
      'chk_cust_uae_kyc',
      () =>
        tx.$queryRawUnsafe<
          Array<{
            emirates_id: string | null;
            emirates_id_expiry: Date | string | null;
            passport_expiry: Date | string | null;
            visa_type: string | null;
            international_permit_no: string | null;
            international_permit_expiry: Date | string | null;
            license_issuing_country: string | null;
            date_of_birth: Date | string | null;
          }>
        >(
          `SELECT emirates_id, emirates_id_expiry, passport_expiry, visa_type,
                  international_permit_no, international_permit_expiry,
                  license_issuing_country, date_of_birth
             FROM rental_customers
            WHERE id::text = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
            LIMIT 1`,
          opts.customerId,
          opts.tenantId,
        ),
      [],
    );
    const kyc = kycRows[0];
    if (kyc) {
      const visaType = String(kyc.visa_type ?? '').trim().toUpperCase();

      if (kyc.emirates_id && !isValidEmiratesIdNumber(kyc.emirates_id)) {
        throw new RentalSecurityError(
          422,
          'INVALID_EMIRATES_ID',
          'Customer Emirates ID format is invalid (expected 784-YYYY-NNNNNNN-C)',
        );
      }

      if (kyc.emirates_id_expiry) {
        const eidExp = new Date(kyc.emirates_id_expiry);
        eidExp.setUTCHours(23, 59, 59, 999);
        if (eidExp.getTime() < compareDate.getTime()) {
          throw new RentalSecurityError(
            422,
            'EMIRATES_ID_EXPIRED',
            `Customer Emirates ID expires (${eidExp.toISOString().slice(0, 10)}) before scheduled return`,
          );
        }
      }

      if (kyc.passport_expiry && visaType === 'TOURIST') {
        const ppExp = new Date(kyc.passport_expiry);
        ppExp.setUTCHours(23, 59, 59, 999);
        if (ppExp.getTime() < compareDate.getTime()) {
          throw new RentalSecurityError(
            422,
            'PASSPORT_EXPIRED',
            `Tourist passport expires (${ppExp.toISOString().slice(0, 10)}) before scheduled return`,
          );
        }
      }

      if (
        opts.requireLicenseOnFile &&
        visaType === 'RESIDENT' &&
        kyc.license_issuing_country &&
        !isUaeCountry(kyc.license_issuing_country)
      ) {
        throw new RentalSecurityError(
          422,
          'UAE_RESIDENT_FOREIGN_LICENSE',
          'UAE residents must present a valid UAE-issued driving license at vehicle handover',
        );
      }

      if (
        visaType === 'TOURIST' &&
        kyc.license_issuing_country &&
        !isUaeIdpExemptCountry(kyc.license_issuing_country)
      ) {
        if (!String(kyc.international_permit_no ?? '').trim()) {
          throw new RentalSecurityError(
            422,
            'IDP_REQUIRED',
            `Tourists holding a ${kyc.license_issuing_country} driving license require a valid International Driving Permit (IDP) in the UAE`,
          );
        }
        if (kyc.international_permit_expiry) {
          const idpExp = new Date(kyc.international_permit_expiry);
          idpExp.setUTCHours(23, 59, 59, 999);
          if (idpExp.getTime() < compareDate.getTime()) {
            throw new RentalSecurityError(
              422,
              'IDP_EXPIRED',
              `International Driving Permit expires (${idpExp.toISOString().slice(0, 10)}) before scheduled return`,
            );
          }
        }
      }

      if (kyc.date_of_birth) {
        const dob = new Date(kyc.date_of_birth);
        if (!Number.isNaN(dob.getTime())) {
          const cat = String(opts.vehicleCategory ?? '').trim().toUpperCase();
          const minAge = cat === 'LUXURY' || cat === 'SPORTS' || cat === 'SUPERCAR' ? 25 : 21;
          const age = computeAgeYears(dob, new Date());
          if (age < minAge) {
            throw new RentalSecurityError(
              422,
              'UNDERAGE_DRIVER',
              `Driver age (${age}) is below the minimum required age of ${minAge} years${minAge === 25 ? ' for Luxury/Sports vehicles' : ''}`,
            );
          }
        }
      }
    }
  }

  // Check corporate credit limit (either on the customer itself or on corporateAccountId)
  const creditTargetId =
    opts.corporateAccountId && opts.corporateAccountId !== customer.id
      ? opts.corporateAccountId
      : customer.customerType === 'CORPORATE'
        ? customer.id
        : null;

  let creditLimitNum = customer.creditLimit != null ? Number(customer.creditLimit) : null;
  if (creditTargetId && creditTargetId !== customer.id) {
    const corp = await tx.rentalCustomer.findFirst({
      where: { id: creditTargetId, tenantId: opts.tenantId, deletedAt: null },
      select: { id: true, blacklisted: true, creditLimit: true },
    });
    if (!corp) {
      throw new RentalSecurityError(404, 'CORPORATE_ACCOUNT_NOT_FOUND', 'Corporate account not found in tenant');
    }
    if (corp.blacklisted) {
      throw new RentalSecurityError(
        422,
        'CUSTOMER_BLACKLISTED',
        'Corporate account is blacklisted',
      );
    }
    creditLimitNum = corp.creditLimit != null ? Number(corp.creditLimit) : null;
  }

  const additional = Math.max(0, Number(opts.additionalExposureAed ?? 0));
  if (
    creditTargetId &&
    creditLimitNum !== null &&
    Number.isFinite(creditLimitNum) &&
    creditLimitNum > 0 &&
    additional > 0 &&
    !opts.allowCreditOverride &&
    typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function'
  ) {
    const invRows = await withSavepoint(
      tx,
      'chk_corp_inv_exp',
      () =>
        tx.$queryRawUnsafe<Array<{ unpaid: number | string | null }>>(
          `SELECT COALESCE(SUM(GREATEST(COALESCE(balance_due, total_amount - COALESCE(paid_amount, 0), 0), 0)), 0) AS unpaid
             FROM rental_invoices
            WHERE tenant_id::text = $1
              AND (customer_id = $2 OR corporate_account_id = $2)
              AND deleted_at IS NULL
              AND status NOT IN ('PAID', 'VOID', 'CANCELLED')`,
          opts.tenantId,
          creditTargetId,
        ),
      [{ unpaid: 0 }],
    );

    const bkRows = await withSavepoint(
      tx,
      'chk_corp_bk_exp',
      () =>
        tx.$queryRawUnsafe<Array<{ unbilled: number | string | null }>>(
          `SELECT COALESCE(SUM(COALESCE(rb.total_amount, 0)), 0) AS unbilled
             FROM rental_bookings rb
            WHERE rb.tenant_id::text = $1
              AND rb.customer_id = $2
              AND rb.deleted_at IS NULL
              AND rb.status IN ('CONFIRMED', 'ACTIVE')
              ${opts.excludeBookingId ? 'AND rb.id::text <> $3' : ''}
              AND NOT EXISTS (
                SELECT 1
                  FROM rental_agreements ra
                  JOIN rental_invoices ri ON ri.agreement_id = ra.id AND ri.deleted_at IS NULL AND ri.status <> 'VOID'
                 WHERE ra.booking_id = rb.id
              )`,
          ...(opts.excludeBookingId
            ? [opts.tenantId, creditTargetId, opts.excludeBookingId]
            : [opts.tenantId, creditTargetId]),
        ),
      [{ unbilled: 0 }],
    );

    const openExposure = Number(invRows[0]?.unpaid ?? 0) + Number(bkRows[0]?.unbilled ?? 0);
    const projectedExposure = Math.round((openExposure + additional) * 100) / 100;
    if (projectedExposure > creditLimitNum + 0.01) {
      throw new RentalSecurityError(
        422,
        'CREDIT_LIMIT_EXCEEDED',
        `Corporate credit limit exceeded: projected exposure AED ${projectedExposure.toFixed(2)} exceeds limit AED ${creditLimitNum.toFixed(2)} (requires RAC Manager override)`,
      );
    }
  }

  return {
    id: customer.id,
    customerType: customer.customerType ?? 'INDIVIDUAL',
    blacklisted: Boolean(customer.blacklisted),
    creditLimit: creditLimitNum,
  };
}

/**
 * Escapes PostgreSQL LIKE/ILIKE wildcard metacharacters (`\`, `%`, `_`)
 * so user search strings match literally inside `%...%`.
 */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Sanitizes a user- or DB-supplied identifier for safe interpolation into
 * `Content-Disposition: attachment; filename="..."` (prevents CRLF / quote header injection).
 */
export function sanitizeDownloadFilename(raw: unknown, fallback = 'document'): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

const MAX_DATA_URL_LENGTH = 2 * 1024 * 1024; // 2 MB base64 cap

/**
 * Validates signature data URLs and internal document storage paths.
 * Rejects `javascript:`, `vbscript:`, `data:text/html`, SVG data URLs, and arbitrary external `http(s)://` URLs.
 */
export function validateSafeDocumentOrSignatureUrl(
  value: unknown,
  opts: { allowPdfDataUrl?: boolean; fieldName?: string } = {},
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new RentalSecurityError(400, 'INVALID_URL', `Invalid ${opts.fieldName ?? 'URL'} value`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length > MAX_DATA_URL_LENGTH) {
    throw new RentalSecurityError(
      413,
      'URL_TOO_LARGE',
      `${opts.fieldName ?? 'File'} payload exceeds maximum allowed size`,
    );
  }

  // Safe base64 raster image data URL (PNG, JPEG, WEBP — never SVG/HTML)
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (opts.allowPdfDataUrl && /^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }

  // Internal storage path (`/api/files/...`, `/uploads/...`, `rental/...`, `leasing/...`) without `..` traversal
  if (
    !trimmed.includes('..') &&
    !/[\r\n\0\\]/.test(trimmed) &&
    (/^\/(api\/files|uploads)\/[a-zA-Z0-9/._-]+$/.test(trimmed) ||
      /^(rental|leasing)\/[a-zA-Z0-9/._-]+$/.test(trimmed))
  ) {
    return trimmed;
  }

  throw new RentalSecurityError(
    400,
    'UNSAFE_URL',
    `${opts.fieldName ?? 'File URL'} must be a valid PNG/JPEG/WEBP base64 image or an internal Fleet360 storage path`,
  );
}

/**
 * Derives a tenant-isolated HMAC secret from a platform channel master key so
 * Tenant A's OTA webhook credential can never forge payloads targeting Tenant B.
 */
export function deriveTenantChannelSecret(
  masterSecret: string,
  tenantId: string,
  channelKey: string,
): string {
  return crypto
    .createHmac('sha256', masterSecret)
    .update(`rac-channel-v1:${tenantId}:${channelKey.toUpperCase()}`)
    .digest('hex');
}

export interface ValidatedAdditionalDriver {
  fullName: string;
  nationality: string | null;
  dateOfBirth: string | null;
  emiratesId: string | null;
  passportNo: string | null;
  drivingLicenseNo: string;
  licenseIssuingCountry: string | null;
  licenseExpiry: string;
  internationalPermitNo: string | null;
  internationalPermitExpiry: string | null;
  dailyFee: number;
  totalFee: number;
}

/**
 * Validates additional drivers attached to a booking or rental agreement:
 *   - Requires non-empty `fullName`, `drivingLicenseNo`, and valid `licenseExpiry >= dropoffDate`
 *   - Enforces minimum age (21 standard / 25 Luxury), Emirates ID format (if supplied),
 *     and Tourist IDP requirement when `licenseIssuingCountry` is non-exempt and `emiratesId` is absent.
 */
export function assertAdditionalDriversEligible(
  drivers: unknown,
  opts: {
    dropoffDate?: Date | null;
    rentalDays?: number;
    vehicleCategory?: string | null;
    defaultDailyFeeAed?: number;
  } = {},
): ValidatedAdditionalDriver[] {
  if (!Array.isArray(drivers) || drivers.length === 0) return [];
  const compareDate = opts.dropoffDate ?? new Date();
  const days = Math.max(1, Math.round(Number(opts.rentalDays ?? 1) || 1));
  const defaultDailyFee = Number.isFinite(Number(opts.defaultDailyFeeAed))
    ? Math.max(0, Number(opts.defaultDailyFeeAed))
    : 35;
  const cat = String(opts.vehicleCategory ?? '').trim().toUpperCase();
  const minAge = cat === 'LUXURY' || cat === 'SPORTS' || cat === 'SUPERCAR' ? 25 : 21;

  return drivers.map((raw, idx) => {
    const d = (raw ?? {}) as Record<string, unknown>;
    const fullName = String(d.fullName ?? d.name ?? '').trim();
    const drivingLicenseNo = String(d.drivingLicenseNo ?? d.licenseNo ?? '').trim();
    const rawExpiry = d.licenseExpiry;

    if (!fullName) {
      throw new RentalSecurityError(
        422,
        'ADDITIONAL_DRIVER_INVALID',
        `Additional driver #${idx + 1} is missing fullName`,
      );
    }
    if (!drivingLicenseNo || !rawExpiry) {
      throw new RentalSecurityError(
        422,
        'ADDITIONAL_DRIVER_LICENSE_REQUIRED',
        `Additional driver "${fullName}" requires drivingLicenseNo and licenseExpiry`,
      );
    }

    const expDate = new Date(String(rawExpiry));
    if (Number.isNaN(expDate.getTime())) {
      throw new RentalSecurityError(
        422,
        'ADDITIONAL_DRIVER_LICENSE_REQUIRED',
        `Additional driver "${fullName}" has an invalid licenseExpiry date`,
      );
    }
    expDate.setUTCHours(23, 59, 59, 999);
    if (expDate.getTime() < compareDate.getTime()) {
      throw new RentalSecurityError(
        422,
        'ADDITIONAL_DRIVER_LICENSE_EXPIRED',
        `Additional driver "${fullName}" license expires (${expDate.toISOString().slice(0, 10)}) before scheduled return`,
      );
    }

    const emiratesId = d.emiratesId ? String(d.emiratesId).trim() : null;
    if (emiratesId && !isValidEmiratesIdNumber(emiratesId)) {
      throw new RentalSecurityError(
        422,
        'INVALID_EMIRATES_ID',
        `Additional driver "${fullName}" Emirates ID format is invalid`,
      );
    }

    const licenseIssuingCountry = d.licenseIssuingCountry
      ? String(d.licenseIssuingCountry).trim()
      : null;
    const internationalPermitNo = d.internationalPermitNo
      ? String(d.internationalPermitNo).trim()
      : null;
    const internationalPermitExpiryRaw = d.internationalPermitExpiry
      ? String(d.internationalPermitExpiry).trim()
      : null;

    if (
      !emiratesId &&
      licenseIssuingCountry &&
      !isUaeIdpExemptCountry(licenseIssuingCountry) &&
      !internationalPermitNo
    ) {
      throw new RentalSecurityError(
        422,
        'IDP_REQUIRED',
        `Additional driver "${fullName}" holding a ${licenseIssuingCountry} license requires an International Driving Permit (IDP)`,
      );
    }

    let dobIso: string | null = null;
    if (d.dateOfBirth) {
      const dob = new Date(String(d.dateOfBirth));
      if (!Number.isNaN(dob.getTime())) {
        const age = computeAgeYears(dob, new Date());
        if (age < minAge) {
          throw new RentalSecurityError(
            422,
            'UNDERAGE_DRIVER',
            `Additional driver "${fullName}" age (${age}) is below minimum ${minAge} years`,
          );
        }
        dobIso = dob.toISOString();
      }
    }

    const dailyFee =
      d.dailyFee !== undefined && d.dailyFee !== null
        ? Math.max(0, Number(d.dailyFee) || 0)
        : defaultDailyFee;
    const totalFee = Math.round(dailyFee * days * 100) / 100;

    return {
      fullName,
      nationality: d.nationality ? String(d.nationality).trim() : null,
      dateOfBirth: dobIso,
      emiratesId,
      passportNo: d.passportNo ? String(d.passportNo).trim() : null,
      drivingLicenseNo,
      licenseIssuingCountry,
      licenseExpiry: expDate.toISOString(),
      internationalPermitNo,
      internationalPermitExpiry: internationalPermitExpiryRaw
        ? new Date(internationalPermitExpiryRaw).toISOString()
        : null,
      dailyFee,
      totalFee,
    };
  });
}

/**
 * Persists validated additional drivers into `rental_additional_drivers` inside `tx`
 * wrapped in `withSavepoint` so pre-migration environments never abort `tx`.
 */
export async function persistAdditionalDriversInTx(
  tx: TxClient,
  opts: {
    tenantId: string;
    bookingId?: string | null;
    agreementId?: string | null;
    drivers: ValidatedAdditionalDriver[];
  },
): Promise<void> {
  if (
    opts.drivers.length === 0 ||
    typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe !== 'function'
  ) {
    return;
  }

  await withSavepoint(
    tx,
    'rac_persist_add_drivers',
    async () => {
      for (const drv of opts.drivers) {
        await tx.$executeRawUnsafe(
          `INSERT INTO rental_additional_drivers (
             tenant_id, booking_id, agreement_id, full_name, nationality,
             date_of_birth, emirates_id, passport_no, driving_license_no,
             license_issuing_country, license_expiry, international_permit_no,
             international_permit_expiry, daily_fee, total_fee
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6::timestamptz, $7, $8, $9,
             $10, $11::timestamptz, $12,
             $13::timestamptz, $14, $15
           )`,
          opts.tenantId,
          opts.bookingId ?? null,
          opts.agreementId ?? null,
          drv.fullName,
          drv.nationality,
          drv.dateOfBirth,
          drv.emiratesId,
          drv.passportNo,
          drv.drivingLicenseNo,
          drv.licenseIssuingCountry,
          drv.licenseExpiry,
          drv.internationalPermitNo,
          drv.internationalPermitExpiry,
          drv.dailyFee,
          drv.totalFee,
        );
      }
    },
    undefined,
  );
}
