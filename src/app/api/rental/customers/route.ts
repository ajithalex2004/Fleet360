export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { RENTAL_CUSTOMER_TYPES } from '@/lib/rental/categories';

const CACHE_TAG = 'rental:customers';

const ALLOWED_CUSTOMER_TYPES = new Set<string>(
  (RENTAL_CUSTOMER_TYPES as readonly (string | { value?: string; code?: string })[]).map((t) =>
    (typeof t === 'string' ? t : String(t.value ?? t.code ?? '')).toUpperCase(),
  ),
);

interface UaeCustomerKycRow {
  id: string;
  emirates_id: string | null;
  emirates_id_expiry: Date | string | null;
  passport_expiry: Date | string | null;
  visa_type: string | null;
  international_permit_no: string | null;
  international_permit_expiry: Date | string | null;
  license_issuing_country: string | null;
  license_issue_date: Date | string | null;
  date_of_birth: Date | string | null;
}

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function formatUaeCustomerKycRow(row: UaeCustomerKycRow) {
  return {
    emiratesId: row.emirates_id ?? null,
    emiratesIdExpiry: toIsoOrNull(row.emirates_id_expiry),
    passportExpiry: toIsoOrNull(row.passport_expiry),
    visaType: (row.visa_type ? row.visa_type.toUpperCase() : 'RESIDENT') as 'RESIDENT' | 'TOURIST',
    internationalPermitNo: row.international_permit_no ?? null,
    internationalPermitExpiry: toIsoOrNull(row.international_permit_expiry),
    licenseIssuingCountry: row.license_issuing_country ?? null,
    licenseIssueDate: toIsoOrNull(row.license_issue_date),
    dateOfBirth: toIsoOrNull(row.date_of_birth),
  };
}

function normalizeAndValidateEmiratesId(
  raw: string,
): { ok: true; formatted: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (/^784-\d{4}-\d{7}-\d$/.test(trimmed)) {
    const year = Number(trimmed.slice(4, 8));
    if (year >= 1900 && year <= 2100) {
      return { ok: true, formatted: trimmed };
    }
  }
  if (/^[\d\s-]+$/.test(trimmed)) {
    const digits = trimmed.replace(/[\s-]/g, '');
    if (/^784\d{12}$/.test(digits)) {
      const year = Number(digits.slice(3, 7));
      if (year >= 1900 && year <= 2100) {
        return {
          ok: true,
          formatted: `784-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14, 15)}`,
        };
      }
    }
  }
  return {
    ok: false,
    error: 'Invalid Emirates ID format (expected 784-YYYY-NNNNNNN-C)',
  };
}

function parseOptionalDateField(
  raw: unknown,
  fieldName: string,
): { ok: true; value: Date | null | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === '') return { ok: true, value: null };
  const dt = new Date(String(raw));
  if (Number.isNaN(dt.getTime())) {
    return { ok: false, error: `Invalid ${fieldName} date` };
  }
  return { ok: true, value: dt };
}

function parseOptionalVisaType(
  raw: unknown,
): { ok: true; value: 'RESIDENT' | 'TOURIST' | undefined } | { ok: false; error: string } {
  const s = optTrimmedString(raw);
  if (s === undefined) return { ok: true, value: undefined };
  if (s === null) return { ok: true, value: 'RESIDENT' };
  const upper = s.toUpperCase();
  if (upper === 'RESIDENT' || upper === 'CITIZEN') return { ok: true, value: 'RESIDENT' };
  if (upper === 'TOURIST' || upper === 'VISITOR' || upper === 'VISIT') {
    return { ok: true, value: 'TOURIST' };
  }
  return { ok: false, error: 'Invalid visaType: must be RESIDENT or TOURIST' };
}

const getCustomers = cacheRead(
  async (tenantId: string) => {
    return withTenantRls(prisma, tenantId, async (tx) => {
      const customers = await tx.rentalCustomer.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (
        customers.length === 0 ||
        typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe !== 'function'
      ) {
        return customers;
      }
      const kycRows = await withSavepoint<UaeCustomerKycRow[]>(
        tx,
        'sel_cust_uae_kyc_list',
        () =>
          tx.$queryRawUnsafe<UaeCustomerKycRow[]>(
            `SELECT id::text AS id,
                    emirates_id,
                    emirates_id_expiry,
                    passport_expiry,
                    visa_type,
                    international_permit_no,
                    international_permit_expiry,
                    license_issuing_country,
                    license_issue_date,
                    date_of_birth
               FROM rental_customers
              WHERE tenant_id = $1
                AND deleted_at IS NULL`,
            tenantId,
          ),
        [],
      );
      if (kycRows.length === 0) return customers;
      const kycById = new Map(kycRows.map((r) => [r.id, r]));
      return customers.map((c) => {
        const kyc = kycById.get(c.id);
        return kyc ? { ...c, ...formatUaeCustomerKycRow(kyc) } : c;
      });
    });
  },
  [CACHE_TAG],
  30,
);

function optTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return String(value).trim() || null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'customers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const customers = await getCustomers(tenantId);
    return NextResponse.json(customers, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (e) {
    console.error('Error fetching customers:', e);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const createDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'customers',
    req.nextUrl.pathname,
  );
  if (createDenied) return createDenied;

  try {
    const bodyRaw = await req.json();
    const cleaned = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );

    const rawCreditLimit =
      cleaned.creditLimit !== undefined ? cleaned.creditLimit : cleaned.credit_limit;
    let parsedCreditLimit: number | null | undefined = undefined;
    if (rawCreditLimit !== undefined) {
      if (rawCreditLimit === null || rawCreditLimit === '') {
        parsedCreditLimit = null;
      } else {
        const num = Number(rawCreditLimit);
        if (!Number.isFinite(num) || num < 0) {
          return NextResponse.json(
            { error: 'creditLimit must be a non-negative number' },
            { status: 400 },
          );
        }
        parsedCreditLimit = num;
      }
    }

    // Setting blacklist status/reason or granting a credit limit requires `rental:approve:customers`
    const setsBlacklist =
      cleaned.blacklisted === true ||
      Boolean(cleaned.blacklistReason) ||
      Boolean(cleaned.blacklist_reason);
    const setsCreditLimit = parsedCreditLimit !== undefined && parsedCreditLimit !== null && parsedCreditLimit > 0;

    if (setsBlacklist || setsCreditLimit) {
      const denied = await requireRentalPermission(
        req.headers,
        tenantId,
        'approve',
        'customers',
        req.nextUrl.pathname,
      );
      if (denied) return denied;
    }

    const explicitFullName = optTrimmedString(cleaned.fullName ?? cleaned.full_name);
    const composedName = [cleaned.firstName, cleaned.lastName]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim())
      .join(' ');
    const fullName = explicitFullName || composedName || optTrimmedString(cleaned.companyName ?? cleaned.company_name);
    if (!fullName) {
      return NextResponse.json({ error: 'fullName is required' }, { status: 400 });
    }

    let customerType: string | undefined = undefined;
    const rawCustomerType = optTrimmedString(cleaned.customerType ?? cleaned.customer_type);
    if (rawCustomerType) {
      const upper = rawCustomerType.toUpperCase();
      if (!ALLOWED_CUSTOMER_TYPES.has(upper)) {
        return NextResponse.json({ error: 'Invalid customerType' }, { status: 400 });
      }
      customerType = upper;
    }

    let licenseExpiry: Date | null | undefined = undefined;
    const rawLicenseExpiry = cleaned.licenseExpiry ?? cleaned.license_expiry;
    if (rawLicenseExpiry !== undefined) {
      if (rawLicenseExpiry === null || rawLicenseExpiry === '') {
        licenseExpiry = null;
      } else {
        const dt = new Date(String(rawLicenseExpiry));
        if (Number.isNaN(dt.getTime())) {
          return NextResponse.json({ error: 'Invalid licenseExpiry date' }, { status: 400 });
        }
        licenseExpiry = dt;
      }
    }

    let paymentTermsDays: number | undefined = undefined;
    const rawPaymentTerms = cleaned.paymentTermsDays ?? cleaned.payment_terms_days;
    if (rawPaymentTerms !== undefined && rawPaymentTerms !== null && rawPaymentTerms !== '') {
      const parsedTerms = Number(rawPaymentTerms);
      if (!Number.isFinite(parsedTerms) || parsedTerms < 0) {
        return NextResponse.json({ error: 'Invalid paymentTermsDays' }, { status: 400 });
      }
      paymentTermsDays = Math.trunc(parsedTerms);
    }

    const fallbackAddress = [cleaned.city, cleaned.country]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim())
      .join(', ');
    const address =
      cleaned.address !== undefined
        ? optTrimmedString(cleaned.address)
        : fallbackAddress || undefined;

    // Parse & validate UAE KYC regulatory fields
    const rawEmiratesId = optTrimmedString(cleaned.emiratesId ?? cleaned.emirates_id);
    let emiratesId: string | null | undefined = undefined;
    if (rawEmiratesId !== undefined) {
      if (rawEmiratesId === null) {
        emiratesId = null;
      } else {
        const eidCheck = normalizeAndValidateEmiratesId(rawEmiratesId);
        if (!eidCheck.ok) {
          return NextResponse.json(
            { error: eidCheck.error, code: 'INVALID_EMIRATES_ID' },
            { status: 400 },
          );
        }
        emiratesId = eidCheck.formatted;
      }
    }

    const eidExpiryParsed = parseOptionalDateField(
      cleaned.emiratesIdExpiry ?? cleaned.emirates_id_expiry,
      'emiratesIdExpiry',
    );
    if (!eidExpiryParsed.ok) {
      return NextResponse.json({ error: eidExpiryParsed.error }, { status: 400 });
    }

    const passportExpiryParsed = parseOptionalDateField(
      cleaned.passportExpiry ?? cleaned.passport_expiry,
      'passportExpiry',
    );
    if (!passportExpiryParsed.ok) {
      return NextResponse.json({ error: passportExpiryParsed.error }, { status: 400 });
    }

    const idpExpiryParsed = parseOptionalDateField(
      cleaned.internationalPermitExpiry ?? cleaned.international_permit_expiry,
      'internationalPermitExpiry',
    );
    if (!idpExpiryParsed.ok) {
      return NextResponse.json({ error: idpExpiryParsed.error }, { status: 400 });
    }

    const licenseIssueDateParsed = parseOptionalDateField(
      cleaned.licenseIssueDate ?? cleaned.license_issue_date,
      'licenseIssueDate',
    );
    if (!licenseIssueDateParsed.ok) {
      return NextResponse.json({ error: licenseIssueDateParsed.error }, { status: 400 });
    }

    const dobParsed = parseOptionalDateField(
      cleaned.dateOfBirth ?? cleaned.date_of_birth,
      'dateOfBirth',
    );
    if (!dobParsed.ok) {
      return NextResponse.json({ error: dobParsed.error }, { status: 400 });
    }

    const visaTypeParsed = parseOptionalVisaType(cleaned.visaType ?? cleaned.visa_type);
    if (!visaTypeParsed.ok) {
      return NextResponse.json({ error: visaTypeParsed.error }, { status: 400 });
    }

    const internationalPermitNo = optTrimmedString(
      cleaned.internationalPermitNo ?? cleaned.international_permit_no,
    );
    const licenseIssuingCountry = optTrimmedString(
      cleaned.licenseIssuingCountry ?? cleaned.license_issuing_country,
    );

    const hasUaeKycInput =
      emiratesId !== undefined ||
      eidExpiryParsed.value !== undefined ||
      passportExpiryParsed.value !== undefined ||
      visaTypeParsed.value !== undefined ||
      internationalPermitNo !== undefined ||
      idpExpiryParsed.value !== undefined ||
      licenseIssuingCountry !== undefined ||
      licenseIssueDateParsed.value !== undefined ||
      dobParsed.value !== undefined;

    // Explicit whitelist: never allow client to set id, deletedAt, createdAt, creditUsed, loyaltyPoints, totalRentals, or totalSpend
    const createData: Prisma.RentalCustomerUncheckedCreateInput = {
      tenantId,
      fullName,
      ...(customerType !== undefined ? { customerType } : {}),
      ...(cleaned.nationality !== undefined ? { nationality: optTrimmedString(cleaned.nationality) } : {}),
      ...((cleaned.passportNo ?? cleaned.passport_no) !== undefined
        ? { passportNo: optTrimmedString(cleaned.passportNo ?? cleaned.passport_no) }
        : {}),
      ...((cleaned.drivingLicenseNo ?? cleaned.driving_license_no ?? cleaned.licenseNo) !== undefined
        ? {
            drivingLicenseNo: optTrimmedString(
              cleaned.drivingLicenseNo ?? cleaned.driving_license_no ?? cleaned.licenseNo,
            ),
          }
        : {}),
      ...(licenseExpiry !== undefined ? { licenseExpiry } : {}),
      ...(cleaned.email !== undefined ? { email: optTrimmedString(cleaned.email) } : {}),
      ...(cleaned.phone !== undefined ? { phone: optTrimmedString(cleaned.phone) } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(typeof cleaned.blacklisted === 'boolean' ? { blacklisted: cleaned.blacklisted } : {}),
      ...((cleaned.companyName ?? cleaned.company_name) !== undefined
        ? { companyName: optTrimmedString(cleaned.companyName ?? cleaned.company_name) }
        : {}),
      ...((cleaned.tradeLicense ?? cleaned.trade_license ?? cleaned.tradeLicenseNo) !== undefined
        ? {
            tradeLicense: optTrimmedString(
              cleaned.tradeLicense ?? cleaned.trade_license ?? cleaned.tradeLicenseNo,
            ),
          }
        : {}),
      ...((cleaned.vatNumber ?? cleaned.vat_number ?? cleaned.trn) !== undefined
        ? { vatNumber: optTrimmedString(cleaned.vatNumber ?? cleaned.vat_number ?? cleaned.trn) }
        : {}),
      ...(parsedCreditLimit !== undefined ? { creditLimit: parsedCreditLimit } : {}),
      ...(paymentTermsDays !== undefined ? { paymentTermsDays } : {}),
      ...((cleaned.frequentFlyerNo ?? cleaned.frequent_flyer_no) !== undefined
        ? { frequentFlyerNo: optTrimmedString(cleaned.frequentFlyerNo ?? cleaned.frequent_flyer_no) }
        : {}),
    };

    const customer = await withTenantRls(prisma, tenantId, async (tx) => {
      const created = await tx.rentalCustomer.create({
        data: createData,
      });

      const hasExecRaw =
        typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function';
      if (hasUaeKycInput && hasExecRaw) {
        await withSavepoint(
          tx,
          'ins_cust_uae_kyc',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE rental_customers
                  SET emirates_id = $1,
                      emirates_id_expiry = $2::timestamptz,
                      passport_expiry = $3::timestamptz,
                      visa_type = $4,
                      international_permit_no = $5,
                      international_permit_expiry = $6::timestamptz,
                      license_issuing_country = $7,
                      license_issue_date = $8::timestamptz,
                      date_of_birth = $9::timestamptz
                WHERE id::text = $10
                  AND tenant_id = $11`,
              emiratesId ?? null,
              eidExpiryParsed.value ? eidExpiryParsed.value.toISOString() : null,
              passportExpiryParsed.value ? passportExpiryParsed.value.toISOString() : null,
              visaTypeParsed.value ?? 'RESIDENT',
              internationalPermitNo ?? null,
              idpExpiryParsed.value ? idpExpiryParsed.value.toISOString() : null,
              licenseIssuingCountry ?? null,
              licenseIssueDateParsed.value ? licenseIssueDateParsed.value.toISOString() : null,
              dobParsed.value ? dobParsed.value.toISOString() : null,
              created.id,
              tenantId,
            ),
          0,
        );
      }

      if (hasUaeKycInput) {
        return {
          ...created,
          emiratesId: emiratesId ?? null,
          emiratesIdExpiry: eidExpiryParsed.value ? eidExpiryParsed.value.toISOString() : null,
          passportExpiry: passportExpiryParsed.value
            ? passportExpiryParsed.value.toISOString()
            : null,
          visaType: visaTypeParsed.value ?? 'RESIDENT',
          internationalPermitNo: internationalPermitNo ?? null,
          internationalPermitExpiry: idpExpiryParsed.value
            ? idpExpiryParsed.value.toISOString()
            : null,
          licenseIssuingCountry: licenseIssuingCountry ?? null,
          licenseIssueDate: licenseIssueDateParsed.value
            ? licenseIssueDateParsed.value.toISOString()
            : null,
          dateOfBirth: dobParsed.value ? dobParsed.value.toISOString() : null,
        };
      }

      return created;
    });
    revalidateCache([CACHE_TAG]);
    return NextResponse.json(customer, { status: 201 });
  } catch (e) {
    console.error('Error creating customer:', e);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
