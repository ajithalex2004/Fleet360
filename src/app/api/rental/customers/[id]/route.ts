export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { revalidateCache } from '@/lib/server-cache';
import { requireRentalPermission } from '@/lib/rental/rbac';
import { withSavepoint } from '@/lib/rental/locks';
import { RENTAL_CUSTOMER_TYPES } from '@/lib/rental/categories';

const CACHE_TAG = 'rental:customers';
const ALLOWED_CUSTOMER_TYPES = new Set<string>(
  (RENTAL_CUSTOMER_TYPES as readonly (string | { value?: string; code?: string })[]).map((t) =>
    (typeof t === 'string' ? t : String(t.value ?? t.code ?? '')).toUpperCase(),
  ),
);

function optTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return String(value).trim() || null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

function parsePatchDateField(
  raw: unknown,
  fieldName: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === '' || raw === undefined) {
    return { ok: true, value: null };
  }
  const dt = new Date(String(raw));
  if (Number.isNaN(dt.getTime())) {
    return { ok: false, error: `Invalid ${fieldName} date` };
  }
  return { ok: true, value: dt.toISOString() };
}

function parsePatchVisaType(
  raw: unknown,
): { ok: true; value: 'RESIDENT' | 'TOURIST' } | { ok: false; error: string } {
  const s = optTrimmedString(raw);
  if (!s) return { ok: true, value: 'RESIDENT' };
  const upper = s.toUpperCase();
  if (upper === 'RESIDENT' || upper === 'CITIZEN') return { ok: true, value: 'RESIDENT' };
  if (upper === 'TOURIST' || upper === 'VISITOR' || upper === 'VISIT') {
    return { ok: true, value: 'TOURIST' };
  }
  return { ok: false, error: 'Invalid visaType: must be RESIDENT or TOURIST' };
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant(req);
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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const customer = await tx.rentalCustomer.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        include: {
          bookings: {
            where: { tenantId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      });
      if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const hasQueryRaw =
        typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function';
      if (hasQueryRaw) {
        const kycRows = await withSavepoint<UaeCustomerKycRow[]>(
          tx,
          'sel_cust_uae_kyc_one',
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
                WHERE id::text = $1
                  AND tenant_id = $2
                  AND deleted_at IS NULL`,
              params.id,
              tenantId,
            ),
          [],
        );
        if (kycRows[0]) {
          return NextResponse.json({
            ...customer,
            ...formatUaeCustomerKycRow(kycRows[0]),
          });
        }
      }

      return NextResponse.json(customer);
    } catch (e) {
      console.error('Error fetching customer:', e);
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
    }
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const editDenied = await requireRentalPermission(
    req.headers,
    tenantId,
    'edit',
    'customers',
    req.nextUrl.pathname,
  );
  if (editDenied) return editDenied;

  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(
      (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
    );

    const touchesCreditLimit = 'creditLimit' in body || 'credit_limit' in body;
    let nextCreditLimit: number | null | undefined = undefined;
    if (touchesCreditLimit) {
      const rawCredit = 'creditLimit' in body ? body.creditLimit : body.credit_limit;
      if (rawCredit === null || rawCredit === '') {
        nextCreditLimit = null;
      } else if (rawCredit !== undefined) {
        const parsed = Number(rawCredit);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return NextResponse.json(
            { error: 'creditLimit must be a non-negative number or null' },
            { status: 400 },
          );
        }
        nextCreditLimit = parsed;
      }
    }

    return await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalCustomer.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
      });
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const touchesBlacklistReason = 'blacklistReason' in body || 'blacklist_reason' in body;
      const changingBlacklist =
        touchesBlacklistReason ||
        ('blacklisted' in body &&
          (Boolean(body.blacklisted) !== Boolean(existing.blacklisted) ||
            body.blacklisted === true));

      const existingCreditLimit =
        existing.creditLimit != null ? Number(existing.creditLimit) : null;
      const changingCreditLimit =
        touchesCreditLimit &&
        nextCreditLimit !== undefined &&
        nextCreditLimit !== existingCreditLimit;

      if (changingBlacklist || changingCreditLimit) {
        const denied = await requireRentalPermission(
          req.headers,
          tenantId,
          'approve',
          'customers',
          req.nextUrl.pathname,
        );
        if (denied) return denied;
      }

      // Explicit field whitelist: never allow client to mutate deletedAt, id, tenantId, createdAt, creditUsed, loyaltyPoints, totalRentals, or totalSpend
      const updateData: Prisma.RentalCustomerUncheckedUpdateInput = {
        updatedAt: new Date(),
      };

      const explicitFullName = optTrimmedString(body.fullName ?? body.full_name);
      const composedName = [body.firstName, body.lastName]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .map((part) => part.trim())
        .join(' ');
      if (explicitFullName) {
        updateData.fullName = explicitFullName;
      } else if (composedName) {
        updateData.fullName = composedName;
      } else if (('fullName' in body || 'full_name' in body) && !explicitFullName) {
        return NextResponse.json({ error: 'fullName cannot be empty' }, { status: 400 });
      }

      if ('customerType' in body || 'customer_type' in body) {
        const rawType = optTrimmedString(body.customerType ?? body.customer_type);
        if (rawType) {
          const upper = rawType.toUpperCase();
          if (!ALLOWED_CUSTOMER_TYPES.has(upper)) {
            return NextResponse.json({ error: 'Invalid customerType' }, { status: 400 });
          }
          updateData.customerType = upper;
        }
      }

      if ('nationality' in body) updateData.nationality = optTrimmedString(body.nationality);
      if ('passportNo' in body || 'passport_no' in body) {
        updateData.passportNo = optTrimmedString(body.passportNo ?? body.passport_no);
      }
      if ('drivingLicenseNo' in body || 'driving_license_no' in body || 'licenseNo' in body) {
        updateData.drivingLicenseNo = optTrimmedString(
          body.drivingLicenseNo ?? body.driving_license_no ?? body.licenseNo,
        );
      }
      if ('licenseExpiry' in body || 'license_expiry' in body) {
        const rawExp = body.licenseExpiry ?? body.license_expiry;
        if (rawExp === null || rawExp === '') {
          updateData.licenseExpiry = null;
        } else if (rawExp !== undefined) {
          const dt = new Date(String(rawExp));
          if (Number.isNaN(dt.getTime())) {
            return NextResponse.json({ error: 'Invalid licenseExpiry date' }, { status: 400 });
          }
          updateData.licenseExpiry = dt;
        }
      }
      if ('email' in body) updateData.email = optTrimmedString(body.email);
      if ('phone' in body) updateData.phone = optTrimmedString(body.phone);
      if ('address' in body) updateData.address = optTrimmedString(body.address);
      if (typeof body.blacklisted === 'boolean') updateData.blacklisted = body.blacklisted;
      if ('companyName' in body || 'company_name' in body) {
        updateData.companyName = optTrimmedString(body.companyName ?? body.company_name);
      }
      if ('tradeLicense' in body || 'trade_license' in body || 'tradeLicenseNo' in body) {
        updateData.tradeLicense = optTrimmedString(
          body.tradeLicense ?? body.trade_license ?? body.tradeLicenseNo,
        );
      }
      if ('vatNumber' in body || 'vat_number' in body || 'trn' in body) {
        updateData.vatNumber = optTrimmedString(body.vatNumber ?? body.vat_number ?? body.trn);
      }
      if (touchesCreditLimit && nextCreditLimit !== undefined) {
        updateData.creditLimit = nextCreditLimit;
      }
      if ('paymentTermsDays' in body || 'payment_terms_days' in body) {
        const rawTerms = body.paymentTermsDays ?? body.payment_terms_days;
        if (rawTerms === null || rawTerms === '') {
          updateData.paymentTermsDays = 0;
        } else if (rawTerms !== undefined) {
          const parsedTerms = Number(rawTerms);
          if (!Number.isFinite(parsedTerms) || parsedTerms < 0) {
            return NextResponse.json({ error: 'Invalid paymentTermsDays' }, { status: 400 });
          }
          updateData.paymentTermsDays = Math.trunc(parsedTerms);
        }
      }
      if ('frequentFlyerNo' in body || 'frequent_flyer_no' in body) {
        updateData.frequentFlyerNo = optTrimmedString(
          body.frequentFlyerNo ?? body.frequent_flyer_no,
        );
      }

      // Dynamic UAE KYC column patch (parameterized SQL via savepoint since @prisma/client predates migration)
      const kycSetClauses: string[] = [];
      const kycParams: unknown[] = [];
      const kycPatchPreview: Record<string, unknown> = {};

      if ('emiratesId' in body || 'emirates_id' in body) {
        const rawEid = optTrimmedString(body.emiratesId ?? body.emirates_id);
        let nextEid: string | null = null;
        if (rawEid) {
          const eidCheck = normalizeAndValidateEmiratesId(rawEid);
          if (!eidCheck.ok) {
            return NextResponse.json(
              { error: eidCheck.error, code: 'INVALID_EMIRATES_ID' },
              { status: 400 },
            );
          }
          nextEid = eidCheck.formatted;
        }
        kycParams.push(nextEid);
        kycSetClauses.push(`emirates_id = $${kycParams.length}`);
        kycPatchPreview.emiratesId = nextEid;
      }

      if ('emiratesIdExpiry' in body || 'emirates_id_expiry' in body) {
        const parsed = parsePatchDateField(
          body.emiratesIdExpiry ?? body.emirates_id_expiry,
          'emiratesIdExpiry',
        );
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        kycParams.push(parsed.value);
        kycSetClauses.push(`emirates_id_expiry = $${kycParams.length}::timestamptz`);
        kycPatchPreview.emiratesIdExpiry = parsed.value;
      }

      if ('passportExpiry' in body || 'passport_expiry' in body) {
        const parsed = parsePatchDateField(
          body.passportExpiry ?? body.passport_expiry,
          'passportExpiry',
        );
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        kycParams.push(parsed.value);
        kycSetClauses.push(`passport_expiry = $${kycParams.length}::timestamptz`);
        kycPatchPreview.passportExpiry = parsed.value;
      }

      if ('visaType' in body || 'visa_type' in body) {
        const parsed = parsePatchVisaType(body.visaType ?? body.visa_type);
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        kycParams.push(parsed.value);
        kycSetClauses.push(`visa_type = $${kycParams.length}`);
        kycPatchPreview.visaType = parsed.value;
      }

      if ('internationalPermitNo' in body || 'international_permit_no' in body) {
        const val = optTrimmedString(body.internationalPermitNo ?? body.international_permit_no) ?? null;
        kycParams.push(val);
        kycSetClauses.push(`international_permit_no = $${kycParams.length}`);
        kycPatchPreview.internationalPermitNo = val;
      }

      if ('internationalPermitExpiry' in body || 'international_permit_expiry' in body) {
        const parsed = parsePatchDateField(
          body.internationalPermitExpiry ?? body.international_permit_expiry,
          'internationalPermitExpiry',
        );
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        kycParams.push(parsed.value);
        kycSetClauses.push(`international_permit_expiry = $${kycParams.length}::timestamptz`);
        kycPatchPreview.internationalPermitExpiry = parsed.value;
      }

      if ('licenseIssuingCountry' in body || 'license_issuing_country' in body) {
        const val = optTrimmedString(body.licenseIssuingCountry ?? body.license_issuing_country) ?? null;
        kycParams.push(val);
        kycSetClauses.push(`license_issuing_country = $${kycParams.length}`);
        kycPatchPreview.licenseIssuingCountry = val;
      }

      if ('licenseIssueDate' in body || 'license_issue_date' in body) {
        const parsed = parsePatchDateField(
          body.licenseIssueDate ?? body.license_issue_date,
          'licenseIssueDate',
        );
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        kycParams.push(parsed.value);
        kycSetClauses.push(`license_issue_date = $${kycParams.length}::timestamptz`);
        kycPatchPreview.licenseIssueDate = parsed.value;
      }

      if ('dateOfBirth' in body || 'date_of_birth' in body) {
        const parsed = parsePatchDateField(
          body.dateOfBirth ?? body.date_of_birth,
          'dateOfBirth',
        );
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        kycParams.push(parsed.value);
        kycSetClauses.push(`date_of_birth = $${kycParams.length}::timestamptz`);
        kycPatchPreview.dateOfBirth = parsed.value;
      }

      const customer = await tx.rentalCustomer.update({
        where: { id: existing.id, tenantId },
        data: updateData,
      });

      const hasExecRaw =
        typeof (tx as { $executeRawUnsafe?: unknown }).$executeRawUnsafe === 'function';
      if (kycSetClauses.length > 0 && hasExecRaw) {
        const idIdx = kycParams.length + 1;
        const tenantIdx = kycParams.length + 2;
        await withSavepoint(
          tx,
          'upd_cust_uae_kyc',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE rental_customers
                  SET ${kycSetClauses.join(', ')}
                WHERE id::text = $${idIdx}
                  AND tenant_id = $${tenantIdx}`,
              ...kycParams,
              existing.id,
              tenantId,
            ),
          0,
        );
      }

      const hasQueryRaw =
        typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function';
      let mergedCustomer: Record<string, unknown> = customer as unknown as Record<string, unknown>;
      if (hasQueryRaw) {
        const kycRows = await withSavepoint<UaeCustomerKycRow[]>(
          tx,
          'sel_cust_uae_kyc_after_upd',
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
                WHERE id::text = $1
                  AND tenant_id = $2
                  AND deleted_at IS NULL`,
              existing.id,
              tenantId,
            ),
          [],
        );
        if (kycRows[0]) {
          mergedCustomer = { ...mergedCustomer, ...formatUaeCustomerKycRow(kycRows[0]) };
        } else if (kycSetClauses.length > 0) {
          mergedCustomer = { ...mergedCustomer, ...kycPatchPreview };
        }
      } else if (kycSetClauses.length > 0) {
        mergedCustomer = { ...mergedCustomer, ...kycPatchPreview };
      }

      revalidateCache([CACHE_TAG]);
      return NextResponse.json(mergedCustomer);
    });
  } catch (e) {
    console.error('Error updating customer:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'delete',
    'customers',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.rentalCustomer.findFirst({
        where: { id: params.id, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) {
        return { status: 404 as const, body: { error: 'Not found' } };
      }

      const hasRawSql = typeof (tx as { $queryRawUnsafe?: unknown }).$queryRawUnsafe === 'function';
      if (hasRawSql) {
        const activeAgrRows = await withSavepoint(
          tx,
          'chk_cust_del_agr',
          () =>
            tx.$queryRawUnsafe<Array<{ cnt: number }>>(
              `SELECT COUNT(*)::int AS cnt
                 FROM rental_agreements
                WHERE tenant_id::text = $1
                  AND customer_id = $2
                  AND deleted_at IS NULL
                  AND UPPER(status) = 'ACTIVE'`,
              tenantId,
              params.id,
            ),
          [{ cnt: 0 }],
        );
        if ((activeAgrRows[0]?.cnt ?? 0) > 0) {
          return {
            status: 409 as const,
            body: {
              error: 'Cannot delete customer with active rental agreements',
              code: 'ACTIVE_AGREEMENTS_EXIST',
            },
          };
        }

        const unpaidInvRows = await withSavepoint(
          tx,
          'chk_cust_del_inv',
          () =>
            tx.$queryRawUnsafe<Array<{ cnt: number }>>(
              `SELECT COUNT(*)::int AS cnt
                 FROM rental_invoices
                WHERE tenant_id::text = $1
                  AND (customer_id = $2 OR corporate_account_id = $2)
                  AND deleted_at IS NULL
                  AND UPPER(status) NOT IN ('PAID', 'VOID', 'CANCELLED')`,
              tenantId,
              params.id,
            ),
          [{ cnt: 0 }],
        );
        if ((unpaidInvRows[0]?.cnt ?? 0) > 0) {
          return {
            status: 409 as const,
            body: {
              error: 'Cannot delete customer with unpaid or open rental invoices',
              code: 'UNPAID_INVOICES_EXIST',
            },
          };
        }
      }

      await tx.rentalCustomer.updateMany({
        where: { id: params.id, tenantId, deletedAt: null },
        data: { deletedAt: new Date(), updatedAt: new Date() },
      });

      return { status: 200 as const, body: { success: true } };
    });

    if (result.status !== 200) {
      return NextResponse.json(result.body, { status: result.status });
    }

    revalidateCache([CACHE_TAG]);
    return NextResponse.json(result.body);
  } catch (e) {
    console.error('Error deleting customer:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
